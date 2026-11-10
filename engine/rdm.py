"""Robust decision making (RDM) engine of Nour OSeMOSYS Studio.

XLRM: the uncertainties X are Monte Carlo factors (engine mc.py: distributions, SDEs, correlations, LHS / Sobol ...),
the strategies L are Studio scenarios (one data file per strategy), R is the model, the metrics M are computed AFTER the run
from the kept results, so they can be changed without solving again.

Every strategy is solved on the SAME futures (same draws, common random numbers), future by future (future 1 for every
strategy, then future 2 ...): a run stopped early still compares the strategies on the futures done.

  folder rdm/<id>/ : rdm.json (design, strategies, metrics), model.txt, s/<strategy>/ = a Monte Carlo folder per strategy
                     (data.txt, design.json, factors.json, factor_summary.npy, samples/<k>.json), status.json, log.txt
  run(dir)           solve futures x strategies with the chosen solver, several at once
  evaluate(dir, M)   metric values per strategy and future + the factor values of each future

Command line (used by the server):  python rdm.py run <rdm folder>
"""

import json, math, os, re, shutil, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mc
from mc_links import LinkCheck

DEFAULT_OUT = ['TotalCapacityAnnual', 'NewCapacity', 'ProductionByTechnologyAnnual', 'AnnualEmissions', 'CapitalInvestment']


def status(d, **kw):
    return mc.status(d, **kw)


def strategies(d):
    return json.load(open(os.path.join(d, 'rdm.json')))['strategies']


def sdir(d, sid):
    return os.path.join(d, 's', sid)


def outputs_needed(R):
    """results to keep: the design's list + every variable a metric reads"""
    outs = set(v for v in (R['design'].get('outputs') or DEFAULT_OUT) if v)  # never an empty name
    for m in R.get('metrics', []):
        if m.get('var') and m['var'] != 'Objective' and m.get('kind') != 'formula':
            outs.add(m['var'])
        for t in (m.get('terms') or []) if m.get('kind') == 'formula' else []:  # outputs read by a formula metric
            if t.get('src') == 'output' and t.get('var'):
                outs.add(t['var'])
    return sorted(outs)


def run(rdm_dir):
    R = json.load(open(os.path.join(rdm_dir, 'rdm.json')))
    D = R['design']
    S = R['strategies']
    model = os.path.join(rdm_dir, 'model.txt')
    mt = open(model, encoding='utf-8', errors='ignore').read()
    logf = open(os.path.join(rdm_dir, 'log.txt'), 'a', encoding='utf-8')
    lk = threading.Lock()

    def log(m):
        with lk:
            logf.write(time.strftime('%H:%M:%S ') + m + '\n')
            logf.flush()

    t0 = time.time()
    n = int(D['sampling']['n'])
    total = n * len(S)
    status(rdm_dir, state='running', stage='preparing the futures', started=time.strftime('%Y-%m-%d %H:%M:%S'), total=total, done=0, ok=0)
    try:
        outs = set(outputs_needed(R))
        import derived as DV

        need_derived = bool(outs & set(DV.DERIVED_DIMS))
        want_duals = any(v.startswith('DUAL.') for v in outs)
        P = {}
        ref = None
        for s in S:  # one preparation per strategy: its own base values, the same draws
            sd = sdir(rdm_dir, s['id'])
            dt = open(os.path.join(sd, 'data.txt'), encoding='utf-8', errors='ignore').read()
            prep = mc.prepare(D, mt, dt)
            draws, summ, repaired = mc.generate(D, prep, n=n)
            np.save(os.path.join(sd, 'factor_summary.npy'), summ)
            json.dump(
                {'names': [x['name'] for x in prep['factors']], 'params': [x['param'] for x in prep['factors']], 'repaired': repaired},
                open(os.path.join(sd, 'factors.json'), 'w'),
            )
            shutil.copy(model, os.path.join(sd, 'model.txt'))
            json.dump(dict(D, outputs=sorted(outs)), open(os.path.join(sd, 'design.json'), 'w'), indent=1)
            same = ref is None or (ref.shape == summ.shape and np.allclose(ref, summ, rtol=1e-9, atol=1e-12))
            if ref is None:
                ref = summ
            if not same:
                log(
                    f'WARNING strategy {s["name"]}: its futures differ from the first strategy (an uncertain parameter has other records in this strategy): comparisons are less exact'
                )
            P[s['id']] = (prep, draws, dt, mc.param_spans(dt))
            os.makedirs(os.path.join(sd, 'samples'), exist_ok=True)
        log(
            f'{n} futures x {len(S)} strategies = {total} solves, {len(P[S[0]["id"]][0]["factors"])} uncertain factor(s), {int(D.get("workers", 2))} at once'
        )
        done = {'n': 0, 'ok': 0}
        stop = os.path.join(rdm_dir, 'STOP')

        def one(task):
            k, s = task
            if os.path.exists(stop):
                return
            sd = sdir(rdm_dir, s['id'])
            sf = os.path.join(sd, 'samples', f'{k:05d}.json')
            if os.path.isfile(sf):  # resumed run: already solved
                ok = json.load(open(sf)).get('status') == 'OPTIMAL'
                with lk:
                    done['n'] += 1
                    done['ok'] += ok
                return
            prep, draws, dt, spans = P[s['id']]
            work = tempfile.mkdtemp(prefix=f'rdm{k}_')
            try:
                vals, notes = mc.apply(prep, draws, k)
                dp = os.path.join(work, 'data.txt')
                mc.write_sample(dt, vals, prep, dp, spans)
                with open(os.path.join(work, 'log.txt'), 'w') as lg:
                    s_, obj, const, res = mc.solve_one(work, model, dp, D['solver'], D.get('options', {}), lg, want_duals)
                if res and need_derived:
                    shutil.copy(model, os.path.join(work, 'model.txt'))
                    json.dump(res, open(os.path.join(work, 'results.json'), 'w'))
                    for kk, vv in DV.compute(work, set(res)).items():
                        res[kk] = vv['rows']
                rec = {
                    'k': k,
                    'status': s_,
                    'objective': obj,
                    'constant': const,
                    'notes': notes,
                    'outputs': {v: res.get(v, []) for v in outs},
                }
                if s_ != 'OPTIMAL':
                    rec['log'] = open(os.path.join(work, 'log.txt'), errors='ignore').read()[-3000:]
                json.dump(rec, open(sf + '.tmp', 'w'))
                os.replace(sf + '.tmp', sf)
                log(f'future {k + 1} · {s["name"]}: {s_}' + (f', objective {obj:,.4f}' if obj is not None else ''))
                ok = s_ == 'OPTIMAL'
            except LinkCheck as e:
                rec = {'k': k, 'status': 'CHECK_FAILED', 'objective': None, 'constant': 0.0, 'notes': [str(e)], 'outputs': {}}
                json.dump(rec, open(sf + '.tmp', 'w'))
                os.replace(sf + '.tmp', sf)
                log(f'future {k + 1} · {s["name"]}: not solved - {e}')
                ok = False
            except Exception as e:
                log(f'future {k + 1} · {s["name"]}: ERROR {e}')
                ok = False
            finally:
                shutil.rmtree(work, ignore_errors=True)
            with lk:
                done['n'] += 1
                done['ok'] += ok
                el = time.time() - t0
                status(
                    rdm_dir,
                    done=done['n'],
                    ok=done['ok'],
                    stage=f'solving: {done["n"]} / {total}',
                    eta=round(el / done['n'] * (total - done['n'])),
                    elapsed=round(el),
                )

        only = {
            sid: (None if ks is None else set(int(k) for k in ks)) for sid, ks in (R.get('only') or {}).items()
        }  # an enhanced strategy on chosen futures
        tasks = [(k, s) for k in range(n) for s in S if only.get(s['id']) is None or k in only[s['id']]]  # future by future
        total = len(tasks)
        status(rdm_dir, total=total, stage=f'solving: 0 / {total}')
        with ThreadPoolExecutor(max_workers=max(1, int(D.get('workers', 2)))) as ex:
            list(ex.map(one, tasks))
        st_ = 'stopped' if os.path.exists(stop) else 'done'
        status(rdm_dir, state=st_, stage=st_, elapsed=round(time.time() - t0), done=done['n'], ok=done['ok'])
        log(f'{st_}: {done["ok"]} optimal of {done["n"]} solves in {time.time() - t0:.0f} s')
    except Exception as e:
        import traceback

        log('FAILED: ' + traceback.format_exc())
        status(rdm_dir, state='failed', stage='failed', error=str(e))


# --------------------------------------------------------------------------- results
_CACHE = {}


def samples(sd):
    p = os.path.join(sd, 'samples')
    files = sorted(f for f in os.listdir(p) if f.endswith('.json')) if os.path.isdir(p) else []
    key = (sd, len(files), os.path.getmtime(p) if files else 0)
    if key not in _CACHE:
        for k in [k for k in _CACHE if k[0] == sd]:
            del _CACHE[k]
        _CACHE[key] = {s['k']: s for s in (json.load(open(os.path.join(p, f))) for f in files)}
    return _CACHE[key]


def _num(a):
    try:
        return float(a)
    except Exception:
        return None


def metric_value(s, m, dims_of):
    """one number per solved future: the metric's variable, filtered, aggregated over the years"""
    if m.get('var', 'Objective') == 'Objective':
        return (s['objective'] or 0.0) / float(m.get('divide') or 1)
    if m['var'] not in s['outputs']:
        raise ValueError(f"{m['var']} was not kept in this run: add it to the results to keep and run again")
    rows = s['outputs'].get(m['var']) or []
    if not rows:
        return 0.0
    dims = dims_of(m['var'], len(rows[0]) - 1)
    yi = dims.index('YEAR') if 'YEAR' in dims else None
    flt = {dims.index(k): set(map(str, v)) for k, v in (m.get('filters') or {}).items() if k in dims and v}
    y0, y1 = (list(m.get('years') or []) + [None, None])[:2]
    agg = m.get('agg', 'sum')
    by = {}
    for r in rows:
        if not all(r[i] in v for i, v in flt.items()):
            continue
        y = _num(r[yi]) if yi is not None else None
        if yi is not None and ((y0 is not None and y < float(y0)) or (y1 is not None and y > float(y1))):
            continue
        by[y] = by.get(y, 0.0) + float(r[-1])
    if not by:
        return 0.0
    return _reduce(by, m)


# ---- formula metrics: a metric written as a formula of inputs and outputs, over the sets
# Each term is a series over the years: an output (a kept result), an input (a parameter of the model in that future: the
# drawn value when it is uncertain, else the base value of the strategy) or the objective; each filtered on its sets. The
# formula is applied year by year (a term without years counts in every year), then the years are reduced (sum, mean, last...).
_SAFE = {n: getattr(math, n) for n in ('log', 'log10', 'log2', 'exp', 'sqrt', 'sin', 'cos', 'tan', 'atan', 'floor', 'ceil')}
_SAFE.update(ln=math.log, abs=abs, min=min, max=max, pow=pow, pi=math.pi, e=math.e)


def compile_formula(expr, names):
    expr = str(expr or '').strip()
    if not expr:
        raise ValueError('the formula is empty')
    if not re.match(r'^[\w\s.+\-*/(),^%<>=!]*$', expr):
        raise ValueError(f'the formula has characters that are not allowed: {expr}')
    bad = [w for w in re.findall(r'[A-Za-z_]\w*', expr) if w not in names and w not in _SAFE]
    if bad:
        raise ValueError(
            f"unknown name(s) in the formula: {', '.join(sorted(set(bad)))} (terms: {', '.join(names)}; functions: log, ln, log10, exp, sqrt, abs, min, max, pow)"
        )
    return compile(expr.replace('^', '**'), '<metric>', 'eval')


def _reduce(by, m):
    """the years of a metric -> one number: sum, average, median, first / last / a chosen year, highest / lowest year, range, standard
    deviation and coefficient of variation over the years, growth first -> last (%), average yearly growth (%), and the sum
    discounted to the first year at a rate (%)."""
    agg = m.get('agg', 'sum')
    ys = sorted(y for y in by if y is not None)
    if not by:
        return 0.0
    vals = [by[y] for y in ys] if ys else list(by.values())
    n = len(vals)
    mean = sum(vals) / n
    if not ys:
        v = sum(by.values())
    elif agg == 'last':
        v = by[ys[-1]]
    elif agg == 'first':
        v = by[ys[0]]
    elif agg == 'year':
        yy = float(m.get('year') or ys[-1])
        v = by.get(yy, by[min(ys, key=lambda y: abs(y - yy))])
    elif agg == 'mean':
        v = mean
    elif agg == 'median':
        q = sorted(vals)
        v = q[n // 2] if n % 2 else (q[n // 2 - 1] + q[n // 2]) / 2
    elif agg == 'max':
        v = max(vals)
    elif agg == 'min':
        v = min(vals)
    elif agg == 'range':
        v = max(vals) - min(vals)
    elif agg in ('sd', 'cv'):
        sd = (sum((x - mean) ** 2 for x in vals) / (n - 1)) ** 0.5 if n > 1 else 0.0
        v = sd if agg == 'sd' else (sd / abs(mean) * 100 if mean else 0.0)
    elif agg == 'growth':
        v = (by[ys[-1]] / by[ys[0]] - 1) * 100 if by[ys[0]] else 0.0
    elif agg == 'cagr':
        a, b, k = by[ys[0]], by[ys[-1]], ys[-1] - ys[0]
        v = ((b / a) ** (1 / k) - 1) * 100 if a and k and b / a > 0 else 0.0
    elif agg == 'npv':
        r = float(m.get('rate') or 5) / 100
        v = sum(by[y] / (1 + r) ** (y - ys[0]) for y in ys)
    else:
        v = sum(by.values())
    return v / float(m.get('divide') or 1)


def _series_rows(rows, dims, flt_by_name, how='sum'):
    yi = dims.index('YEAR') if 'YEAR' in dims else None
    flt = {dims.index(k): set(map(str, v)) for k, v in (flt_by_name or {}).items() if k in dims and v}
    acc, cnt, hi, lo = {}, {}, {}, {}
    for r in rows:
        key, val = r[:-1], r[-1]
        if not all(str(key[i]) in v for i, v in flt.items()):
            continue
        y = _num(key[yi]) if yi is not None else None
        x = float(val)
        acc[y] = acc.get(y, 0.0) + x
        cnt[y] = cnt.get(y, 0) + 1
        hi[y] = max(hi.get(y, x), x)
        lo[y] = min(lo.get(y, x), x)
    # over the items of a year: sum, average, largest, smallest
    pick = {'mean': lambda y: acc[y] / cnt[y], 'max': lambda y: hi[y], 'min': lambda y: lo[y]}.get(how, lambda y: acc[y])
    return {y: pick(y) for y in acc}


def formula_value(s, m, dims_of, inputs):
    """one number per future for a formula metric; inputs(param) -> (dims, {key: value}) of this future"""
    T = m.get('terms') or []
    names = [t['n'] for t in T]
    code = compile_formula(m.get('expr'), names)
    ser = {}
    for t in T:
        if t.get('src') == 'objective':
            ser[t['n']] = {None: float(s.get('objective') or 0.0)}
        elif t.get('src') == 'input':
            dims, recs = inputs(t['param'])
            ser[t['n']] = _series_rows([list(k) + [v] for k, v in recs.items()], dims, t.get('filters'), t.get('how', 'sum'))
        else:
            if t.get('var') not in s['outputs']:
                raise ValueError(f"{t.get('var')} was not kept in this run: add it to the results to keep and run again")
            rows = s['outputs'].get(t['var']) or []
            ser[t['n']] = _series_rows(rows, dims_of(t['var'], len(rows[0]) - 1) if rows else [], t.get('filters'), t.get('how', 'sum'))
    y0, y1 = (list(m.get('years') or []) + [None, None])[:2]
    years = sorted({y for v in ser.values() for y in v if y is not None})
    years = [y for y in years if (y0 is None or y >= float(y0)) and (y1 is None or y <= float(y1))] or [None]
    by = {}
    for y in years:
        env = {n: (v[None] if None in v else v.get(y, 0.0)) for n, v in ser.items()}
        try:
            x = eval(code, {'__builtins__': {}}, {**_SAFE, **env})
        except (ValueError, ZeroDivisionError, OverflowError):
            continue  # e.g. log(0) in that year: the year is left out
        if isinstance(x, (int, float)) and math.isfinite(x):
            by[y] = float(x)
    return _reduce(by, m)


def evaluate(rdm_dir, metrics=None):
    """-> strategies, factor names and values per future, metric values [metric][strategy][future] on the futures solved
    optimally for EVERY strategy, and the count of futures per strategy"""
    R = json.load(open(os.path.join(rdm_dir, 'rdm.json')))
    S = R['strategies']
    metrics = metrics if metrics is not None else R.get('metrics', [])
    SM = {s['id']: samples(sdir(rdm_dir, s['id'])) for s in S}
    common = sorted(set.intersection(*[{k for k, x in SM[s['id']].items() if x['status'] == 'OPTIMAL'} for s in S])) if S else []
    sd0 = sdir(rdm_dir, S[0]['id']) if S else None
    dims_cache = {}

    def dims_of(var, n0):
        if (var, n0) not in dims_cache:
            dims_cache[(var, n0)] = mc.out_dims(sd0, var, n0)
        return dims_cache[(var, n0)]

    fac = (
        json.load(open(os.path.join(sd0, 'factors.json')))
        if sd0 and os.path.isfile(os.path.join(sd0, 'factors.json'))
        else {'names': [], 'params': []}
    )
    summ = np.load(os.path.join(sd0, 'factor_summary.npy')) if sd0 and os.path.isfile(os.path.join(sd0, 'factor_summary.npy')) else None
    X = summ[common].tolist() if summ is not None and common else []
    vals = {}
    GEN = {}

    def inputs_of(sd, k):
        def get(param):
            if sd not in GEN:
                GEN[sd] = (mc.regen(sd), {})
            (D_, prep, draws), cache = GEN[sd]
            if k not in cache:
                cache.clear()
                cache[k] = mc.apply(prep, draws, k)[0] if prep['factors'] else {}
            if param not in prep['dims']:
                raise ValueError(f'{param} is not a parameter of the model')
            dims = [mc.base_set(x) for x in prep['dims'][param]]
            return dims, cache[k].get(param) or prep['params'].get(param, {'recs': {}})['recs']

        return get

    for m in metrics:
        try:
            if m.get('kind') == 'formula':
                vals[m['id']] = [
                    [formula_value(SM[s['id']][k], m, dims_of, inputs_of(sdir(rdm_dir, s['id']), k)) for k in common] for s in S
                ]
            else:
                vals[m['id']] = [[metric_value(SM[s['id']][k], m, dims_of) for k in common] for s in S]
        except Exception as e:
            vals[m['id']] = {'error': str(e)}
    per = [
        {
            'id': s['id'],
            'name': s['name'],
            'solved': len(SM[s['id']]),
            'optimal': sum(1 for x in SM[s['id']].values() if x['status'] == 'OPTIMAL'),
            'failed': sorted(k + 1 for k, x in SM[s['id']].items() if x['status'] != 'OPTIMAL')[:50],
        }
        for s in S
    ]
    return {
        'strategies': per,
        'factors': fac.get('names', []),
        'params': fac.get('params', []),
        'futures': [k + 1 for k in common],
        'X': X,
        'values': vals,
        'n': int(R['design']['sampling']['n']),
    }


def members(rdm_dir, var):
    """index sets and members of a kept result (for the metric editor), read from the first strategy"""
    S = strategies(rdm_dir)
    sd = sdir(rdm_dir, S[0]['id'])
    SM = samples(sd)
    rows = next((x['outputs'].get(var) for x in SM.values() if x['status'] == 'OPTIMAL' and x['outputs'].get(var)), [])
    if not rows:
        return {'dims': [], 'members': {}}
    dims = mc.out_dims(sd, var, len(rows[0]) - 1)
    mem = {
        d: sorted({str(r[i]) for x in list(SM.values())[:10] for r in x['outputs'].get(var, [])}, key=mc._num_sort)
        for i, d in enumerate(dims)
    }
    return {'dims': dims, 'members': mem}


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'run':
        run(sys.argv[2])
    else:
        print(__doc__)
