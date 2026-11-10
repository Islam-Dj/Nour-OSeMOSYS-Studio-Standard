"""The full package of a robust-decision run, to assess it outside the Studio.

    package(rdm_dir, out_zip, data=False, strategies=None, futures=None, metrics=None)

The zip holds:
  README.txt                      what each file is
  run/                            the run as kept on disk: rdm.json (design, strategies, metrics), log.txt, status.json
  strategies/<strategy>/          the base data file of each strategy, its uncertain factors and design
  raw/<strategy>/future_NNNNN.json  every solve record as kept (status, objective, notes, kept results, log when not optimal)
  design.json, strategies.csv     the uncertainties as set up, the strategies (scenarios of the case)
  futures.csv                     one row per future: the summary value of each uncertain factor (as in the Futures table)
  sampled/<parameter>.csv         EVERY drawn value: strategy, future, each index set of the parameter in its own column
                                  (REGION, TECHNOLOGY, COMMODITY, TIMESLICE, YEAR...), the value in that future and the base value
  metrics.csv                     strategy, future, metric, value (the metrics of the run); metrics_wide.csv one column per metric
  outputs/<result>.csv            the results kept for every solve: strategy, future, its index sets, value; status.csv
  data/<strategy>/future_NNNNN.txt  (when data=True) the complete data file of that strategy in that future, ready for GLPK
  model.txt                       the model file of the run
Futures are numbered from 1, as in the Studio. strategies / futures limit the package (None = all).
"""

import csv, io, json, os, sys, zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import mc
import rdm


def _csv(rows, head):
    b = io.StringIO()
    w = csv.writer(b, lineterminator='\n')
    w.writerow(head)
    w.writerows(rows)
    return b.getvalue()


def parse_futures(spec, n):
    """'1-10, 25' -> {0..9, 24} (futures numbered from 1); None or '' -> all"""
    if not spec:
        return None
    out = set()
    for part in str(spec).replace(';', ',').split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            out.update(range(int(a) - 1, min(int(b), n)))
        else:
            out.add(int(part) - 1)
    return {k for k in out if 0 <= k < n}


def package(rdm_dir, out_zip, data=False, strategies=None, futures=None, metrics=None, raw=True):
    R = json.load(open(os.path.join(rdm_dir, 'rdm.json')))
    D = R['design']
    n = int(D['sampling']['n'])
    S = [s for s in R['strategies'] if not strategies or s['id'] in strategies or s['name'] in strategies]
    keep = parse_futures(futures, n) if not isinstance(futures, set) else futures
    K = sorted(keep) if keep is not None else list(range(n))
    z = zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED, allowZip64=True)
    z.writestr('design.json', json.dumps(D, indent=1))
    # the run as it is on disk too
    for f in ('rdm.json', 'log.txt', 'status.json'):
        if os.path.isfile(os.path.join(rdm_dir, f)):
            z.write(os.path.join(rdm_dir, f), 'run/' + f)
    z.writestr('strategies.csv', _csv([[s['id'], s['name'], s.get('desc', '')] for s in S], ['strategy', 'name', 'description']))
    mp = os.path.join(rdm_dir, 'model.txt')
    if os.path.isfile(mp):
        z.write(mp, 'model.txt')
    sd0 = rdm.sdir(rdm_dir, S[0]['id']) if S else None
    # ---- futures: the summary value of each uncertain factor
    fac = json.load(open(os.path.join(sd0, 'factors.json'))) if sd0 and os.path.isfile(os.path.join(sd0, 'factors.json')) else {'names': []}
    if sd0 and os.path.isfile(os.path.join(sd0, 'factor_summary.npy')):
        summ = np.load(os.path.join(sd0, 'factor_summary.npy'))
        z.writestr('futures.csv', _csv([[k + 1] + [float(x) for x in summ[k]] for k in K if k < len(summ)], ['future'] + fac.get('names', [])))
    # ---- every drawn value, with every index set in its own column
    sampled = {}  # param -> rows
    status = []
    outs = {}  # result -> rows of every strategy
    for s in S:
        sd = rdm.sdir(rdm_dir, s['id'])
        if not os.path.isfile(os.path.join(sd, 'design.json')):
            continue
        for f in ('data.txt', 'factors.json', 'design.json'):  # the base data of the strategy and its uncertainty set-up
            if os.path.isfile(os.path.join(sd, f)):
                z.write(os.path.join(sd, f), f'strategies/{s["name"]}/{f}')
        D_, prep, draws = mc.regen(sd)
        spans = None
        base_txt = open(os.path.join(sd, 'data.txt'), encoding='utf-8', errors='ignore').read() if data else None
        # the records each factor draws (the others keep the base value, except linked values, compared below)
        drawn = {}
        for x in prep['factors']:
            drawn.setdefault(x['param'], set()).update(x['keys'])
        for k in K:
            vals, _ = mc.apply(prep, draws, k) if prep['factors'] else ({}, [])
            for p, recs in vals.items():
                base = prep['params'].get(p, {'recs': {}})['recs']
                dd = drawn.get(p, set())
                rows = sampled.setdefault(p, [])
                for key, v in recs.items():
                    b = base.get(key)
                    if key in dd or b is None or abs(float(v) - float(b)) > 1e-12 * max(1.0, abs(float(b))):
                        rows.append([s['name'], k + 1, *key, v, b])
            if data:
                if spans is None:
                    spans = mc.param_spans(base_txt)
                tmp = os.path.join(rdm_dir, f'_pkg_{s["id"]}_{k}.txt')
                mc.write_sample(base_txt, vals, prep, tmp, spans)
                z.write(tmp, f'data/{s["name"]}/future_{k + 1:05d}.txt')
                os.remove(tmp)
        SM = rdm.samples(sd)
        if raw:  # every solve record as the run kept it (status, objective, notes, kept results, solver log when not optimal)
            for k in K:
                if k in SM:
                    z.writestr(f'raw/{s["name"]}/future_{k + 1:05d}.json', json.dumps(SM[k]))
        for k in K:
            x = SM.get(k)
            status.append([s['name'], k + 1, x['status'] if x else 'not solved', x.get('objective') if x else None])
        # ---- the results kept for every solve (all strategies in one file per result)
        for k in K:
            x = SM.get(k)
            if not x:
                continue
            for var, rows in (x.get('outputs') or {}).items():
                if rows:
                    o = outs.setdefault(var, {'sd': sd, 'rows': []})
                    o['rows'].extend([s['name'], k + 1, *r] for r in rows)
    for var, o in outs.items():
        dims = mc.out_dims(o['sd'], var, len(o['rows'][0]) - 3)
        z.writestr(f'outputs/{var.replace("/", "_")}.csv', _csv(o['rows'], ['strategy', 'future', *dims, 'value']))
    dims_of = lambda p: [mc.base_set(x) for x in (prep['dims'].get(p) or [])] if S else []
    for p, rows in sampled.items():
        if rows:
            d = dims_of(p) or [f'index{i + 1}' for i in range(len(rows[0]) - 4)]
            z.writestr(f'sampled/{p}.csv', _csv(rows, ['strategy', 'future', *d, 'value', 'base value']))
    z.writestr('status.csv', _csv(status, ['strategy', 'future', 'status', 'objective']))
    # ---- metrics
    try:
        ev = rdm.evaluate(rdm_dir, metrics)
        mets = metrics if metrics is not None else R.get('metrics', [])
        long, wide = [], {}
        for m in mets:
            V = ev['values'].get(m['id'])
            if not isinstance(V, list):
                continue
            for si, s in enumerate(ev['strategies']):
                if strategies and s['id'] not in strategies and s['name'] not in strategies:
                    continue
                for fi, f in enumerate(ev['futures']):
                    if keep is not None and f - 1 not in keep:
                        continue
                    long.append([s['name'], f, m.get('name') or m.get('var'), V[si][fi]])
                    wide.setdefault((s['name'], f), {})[m.get('name') or m.get('var')] = V[si][fi]
        names = [m.get('name') or m.get('var') for m in mets if isinstance(ev['values'].get(m['id']), list)]
        z.writestr('metrics.csv', _csv(long, ['strategy', 'future', 'metric', 'value']))
        z.writestr('metrics_wide.csv', _csv([[a, b] + [w.get(nm) for nm in names] for (a, b), w in wide.items()], ['strategy', 'future'] + names))
    except Exception as e:
        z.writestr('metrics_error.txt', str(e))
    z.writestr('README.txt', __doc__.split('The zip holds:')[1].replace('\n  ', '\n') if 'The zip holds:' in __doc__ else '')
    z.close()
    return out_zip


if __name__ == '__main__':
    # python rdm_export.py <rdm folder> <out.zip> [--data] [--strategies=A,B] [--futures=1-10,25]
    opt = {a.split('=', 1)[0]: (a.split('=', 1)[1] if '=' in a else True) for a in sys.argv[3:]}
    st = [x for x in str(opt.get('--strategies') or '').split(',') if x] or None
    print(package(sys.argv[1], sys.argv[2], data=bool(opt.get('--data')), strategies=st, futures=opt.get('--futures') or None, raw=opt.get('--raw', '1') != '0'))
