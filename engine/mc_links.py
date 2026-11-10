"""Linked values and driver correlations of the Monte Carlo.

driver_links(F, kinds, Z)      10b: an uncertain parameter correlated with chosen cells of a DRIVER parameter (e.g. the
                               yield of durum wheat with the spring precipitation, rank correlation 0.23; with several
                               seasons, one coefficient each), keeping its own distribution
prepare_links(design, prep)    10: linked values - target cells computed in every sample by a formula from a driver
eval_links(prep, vals)         the linked values of one sample (LinkCheck when a value breaks its check)
formula_env / formula_functions / FORMULA_TEMPLATE   the formula file (.py) the modeller downloads, edits and uploads
"""

import math
from collections import defaultdict
import numpy as np
from derived import base_set


class LinkCheck(Exception):
    """a linked value of a sample breaks its check (negative, not a number, formula error): the sample is reported, not solved"""


FORMULA_TEMPLATE = (
    "# Formula file of the Monte Carlo linked values (Nour OSeMOSYS Studio).\n"
    "# Every function defined here can be used in the formulas of the linked values. They receive numpy arrays (one\n"
    "# value per cell of the target) and must return an array of the same length. In a formula:\n"
    "#   base  the target's value in the data      D  the driver's multiplier in this sample (sampled / data value)\n"
    "#   P     the driver's sampled value           B  the driver's data value       (means of the matching cells)\n"
    "# Example formulas:   base * D      base * D ** 0.5      np.minimum(1, base * D)      recharge_share(base, D)\n"
    "import numpy as np\n\n\n"
    "def recharge_share(base, D, threshold=0.7):\n"
    "    # the recharge share falls faster than the rain when the season is dry (below 70 % of normal)\n"
    "    return np.where(D < threshold, base * (D / threshold) ** 2 * threshold, base * D)\n"
)

BUILTINS = ('np', 'exp', 'log', 'sqrt', 'minimum', 'maximum', 'clip', 'where', 'abs')


def formula_env(design):
    """the names a formula can use: numpy, a few math functions and the functions of the formula file"""
    env = {
        'np': np,
        'exp': np.exp,
        'log': np.log,
        'sqrt': np.sqrt,
        'minimum': np.minimum,
        'maximum': np.maximum,
        'clip': np.clip,
        'where': np.where,
        'abs': np.abs,
    }
    txt = (design.get('formulaFile') or '').strip()
    if txt:
        ns = {'np': np, '__name__': 'formula_file'}
        try:
            exec(compile(txt, 'formula file', 'exec'), ns)
        except Exception as e:
            raise ValueError(f'formula file: {type(e).__name__}: {e}')
        env.update({k: v for k, v in ns.items() if callable(v) and not k.startswith('_') and k not in BUILTINS})
    return env


def formula_functions(text):
    """names of the functions of a formula file (shown in the Studio), or the error"""
    try:
        return {'functions': sorted(k for k in formula_env({'formulaFile': text}) if k not in BUILTINS)}
    except ValueError as e:
        return {'error': str(e)}


def _proj(dims, key, conv_ls, shared):
    """the key on the shared index sets (a time slice counts as its season when the other side has seasons)"""
    out = []
    for nm in shared:
        if nm in dims:
            out.append(str(key[dims.index(nm)]))
        else:
            out.append(str(conv_ls.get(key[dims.index('TIMESLICE')], '')))
    return tuple(out)


def prepare_links(design, prep):
    """each enabled link: its target cells (parameter + selection), its driver (an uncertain parameter or an earlier link),
    the cells of the driver matching each target cell (index sets in common; time slice -> season), the evaluation
    order (a link driven by another comes after it; loops are refused)"""
    L = [l for l in (design.get('links') or []) if l.get('enabled', True)]
    if not L:
        return []
    dims, params = prep['dims'], prep['params']
    conv_ls = {k[0]: k[1] for k, v in params.get('Conversionls', {'recs': {}})['recs'].items() if v}
    fac = {x['f'].get('id'): x for x in prep['factors']}
    ids = [l.get('id') for l in L]
    if len(set(ids)) != len(ids) or None in ids:
        raise ValueError('linked values: every link needs its own id')
    byid = {l['id']: l for l in L}
    order, state = [], {}

    def visit(i, path):
        if state.get(i) == 2:
            return
        if state.get(i) == 1:
            raise ValueError('linked values: a loop (' + ' -> '.join(path + [i]) + ')')
        state[i] = 1
        dv = byid[i].get('driver')
        if dv in byid:
            visit(dv, path + [i])
        state[i] = 2
        order.append(i)

    for i in ids:
        visit(i, [])
    env = formula_env(design)
    out, done = [], {}
    for i in order:
        l = byid[i]
        p = (l.get('target') or {}).get('param')
        nm = l.get('name') or i
        if p not in dims:
            raise ValueError(f'{nm}: {p} is not a parameter of the model file')
        d = [base_set(x) for x in dims[p]]
        P = params.get(p, {'recs': {}, 'def': None})
        sel = {k: set(map(str, v)) for k, v in ((l.get('target') or {}).get('select') or {}).items() if v}
        recs = {k: v for k, v in P['recs'].items() if all(k[j] in sel[x] for j, x in enumerate(d) if x in sel)}
        if not recs:
            raise ValueError(f'{nm}: no values of {p} in this selection')
        keys = list(recs)
        base = np.array([recs[k] for k in keys], float)
        try:
            code = compile(l.get('formula') or 'base', nm, 'eval')
        except SyntaxError as e:
            raise ValueError(f'{nm}: formula: {e.msg}')
        r = {
            'id': i,
            'name': nm,
            'param': p,
            'dims': d,
            'keys': keys,
            'base': base,
            'code': code,
            'formula': l.get('formula') or 'base',
            'nonneg': l.get('nonneg', True),
            'clip': l.get('clip') or [None, None],
            'driver': None,
            'env': env,
        }
        dv = l.get('driver')
        if dv:
            if dv in fac:
                x = fac[dv]
            elif dv in done:
                x = done[dv]
            else:
                raise ValueError(f'{nm}: its driver {dv} is not an uncertain parameter or a linked value of this design')
            src = {
                'param': x['param'],
                'dims': x['dims'],
                'keys': x['keys'],
                'base': np.asarray(x['base'], float),
                'name': x.get('name') or dv,
            }
            shared = [s for s in d if s in src['dims']]
            if 'TIMESLICE' in d and 'SEASON' in src['dims'] and 'SEASON' not in d:
                shared.append('SEASON')
            if 'SEASON' in d and 'TIMESLICE' in src['dims'] and 'SEASON' not in src['dims']:
                shared.append('SEASON')

            # an index set on which the driver has a single member (its technology, its commodity...) is not matched on;
            # l['matchOn'] gives the index sets explicitly
            def members(nm_):
                if nm_ in src['dims']:
                    return {k[src['dims'].index(nm_)] for k in src['keys']}
                return {conv_ls.get(k[src['dims'].index('TIMESLICE')]) for k in src['keys']}

            shared = list(l['matchOn']) if l.get('matchOn') else [s for s in shared if len(members(s)) > 1]
            pd_ = defaultdict(list)
            for j, k in enumerate(src['keys']):
                pd_[_proj(src['dims'], k, conv_ls, shared)].append(j)
            match = [pd_.get(_proj(d, k, conv_ls, shared), []) for k in keys]
            miss = sum(1 for m in match if not m)
            if miss:
                raise ValueError(
                    f'{nm}: {miss} cells of {p} have no matching cell in its driver {src["name"]} (index sets in common: {", ".join(shared) or "none"})'
                )
            src['match'] = [np.array(m) for m in match]
            src['shared'] = shared
            r['driver'] = src
        out.append(r)
        done[i] = r
    return out


def eval_links(prep, vals):
    """the linked values of one sample, in order, written into vals"""
    for r in prep.get('links') or []:
        n = len(r['keys'])
        D = np.ones(n)
        P_ = np.ones(n)
        B_ = np.ones(n)
        src = r['driver']
        if src:
            cur = vals.get(src['param'])
            new = np.array([cur.get(k, b) for k, b in zip(src['keys'], src['base'])], float) if cur else src['base']
            B_ = np.array([src['base'][m].mean() for m in src['match']])
            P_ = np.array([new[m].mean() for m in src['match']])
            ok = np.abs(B_) > 1e-300
            D = np.where(ok, P_ / np.where(ok, B_, 1.0), 1.0)
        env = dict(r['env'], base=r['base'].copy(), D=D, P=P_, B=B_)
        try:
            v = np.asarray(eval(r['code'], {'__builtins__': {}}, env), float)
        except Exception as e:
            raise LinkCheck(f"{r['name']}: the formula {r['formula']!r} failed: {type(e).__name__}: {e}")
        if v.ndim == 0:
            v = np.full(n, float(v))
        if v.shape != (n,):
            raise LinkCheck(f"{r['name']}: the formula gives {v.size} values for {n} cells")
        lo, hi = (list(r['clip']) + [None, None])[:2]
        if lo is not None:
            v = np.maximum(v, lo)
        if hi is not None:
            v = np.minimum(v, hi)
        if not np.all(np.isfinite(v)):
            raise LinkCheck(f"{r['name']}: not a number in {int((~np.isfinite(v)).sum())} cells")
        if r['nonneg'] and (v < -1e-12).any():
            j = int(np.argmin(v))
            raise LinkCheck(f"{r['name']}: negative value {v[j]:.6g} for {' '.join(map(str, r['keys'][j]))}")
        cur = vals.get(r['param']) or dict(prep['params'].get(r['param'], {'recs': {}})['recs'])
        for k, x in zip(r['keys'], v):
            cur[k] = float(x)
        vals[r['param']] = cur


def driver_links(F, kinds, Z):
    """For a target factor with driverLink {driver, terms: [{match, rho}]}: its normal scores become
         sum_k b_k u_k + sqrt(1 - b.r) e
    u_k = the driver's normal scores in the cells of term k (a season, a region . season...), r = the Pearson equivalents
    of the rank correlations asked (2 sin(pi rho / 6)), b = S^-1 r with S the correlation between the u_k (the seasons of
    the driver may be correlated with each other), e = the target's own scores. Each term gets its own coefficient and the
    target keeps its distribution. Z is changed in place; -> diagnostics for the preview."""
    fid = [x['f'].get('id') for x in F]
    out = []
    for i, x in enumerate(F):
        dl = x['f'].get('driverLink') or {}
        terms = [t for t in (dl.get('terms') or []) if str(t.get('match', '')).strip() != '' and t.get('rho') not in (None, '')]
        if not dl.get('driver') or not terms:
            continue
        nm = x['name']
        if dl['driver'] not in fid:
            raise ValueError(f'{nm}: its driver ({dl["driver"]}) is not among the enabled uncertain parameters')
        j = fid.index(dl['driver'])
        if j == i:
            raise ValueError(f'{nm}: a parameter cannot be its own driver')
        if (F[j]['f'].get('driverLink') or {}).get('driver'):
            raise ValueError(f'{nm}: its driver {F[j]["name"]} is itself linked to a driver (one level only)')
        if kinds[i] in ('sde', 'growth') or kinds[j] in ('sde', 'growth'):
            raise ValueError(
                f'{nm}: a driver link works with one draw for all years or a draw per year, not with growth rates or SDE paths'
            )
        zd, zi = Z[j], Z[i]
        if zd.shape[2] != zi.shape[2] and zi.shape[2] != 1 and zd.shape[2] != 1:
            raise ValueError(f'{nm}: the driver and the target must both have one draw for all years, or both a draw per year')
        U, R, labels = [], [], []
        for t in terms:
            m = str(t['match']).strip()
            cells = [
                (g, s)
                for g in range(zd.shape[1])
                for s in range(zd.shape[3])
                if m in [str(c) for c in F[j]['groups'][g]]
                or m == ' · '.join(map(str, F[j]['groups'][g]))
                or m == str(F[j]['slicegroups'][s])
            ]
            if not cells:
                raise ValueError(
                    f'{nm}: "{m}" is not a cell of the driver {F[j]["name"]} (its draws: '
                    + ', '.join(' · '.join(map(str, g)) or 'one for all' for g in F[j]['groups'][:8])
                    + '; choose "one per value" for one draw per season)'
                )
            u = np.mean([zd[:, g, :, s] for g, s in cells], axis=0)
            if zi.shape[2] == 1 and u.shape[1] > 1:
                u = u.mean(1, keepdims=True)
            u = (u - u.mean(0)) / np.maximum(u.std(0), 1e-12)
            rs = float(t['rho'])
            if abs(rs) >= 1:
                raise ValueError(f'{nm}: a correlation must be between -1 and 1')
            U.append(u)
            R.append(2 * math.sin(math.pi * rs / 6))
            labels.append(m)
        Ti = zi.shape[2]
        U = [np.repeat(u, Ti, 1) if u.shape[1] == 1 and Ti > 1 else u for u in U]
        S = np.corrcoef(np.stack([u.ravel() for u in U])) if len(U) > 1 else np.ones((1, 1))
        r = np.array(R)
        b = np.linalg.solve(S + 1e-12 * np.eye(len(R)), r)
        R2 = float(b @ r)
        if R2 >= 0.999:
            raise ValueError(
                f'{nm}: the coefficients asked ({", ".join(str(t["rho"]) for t in terms)}) are not possible together, given how the cells of the driver are correlated with each other; lower them'
            )
        comb = sum(bk * u for bk, u in zip(b, U))
        Z[i] = comb[:, None, :, None] + math.sqrt(1 - R2) * zi
        out.append(
            {
                'target': i,
                'driver': j,
                'name': nm,
                'driverName': F[j]['name'],
                'terms': [{'match': m, 'asked': float(t['rho']), 'u': u.mean(1)} for m, t, u in zip(labels, terms, U)],
            }
        )
    return out


def preview_links(prep, draws, n):
    """for the Studio: each linked value over n samples - base and percentiles of its cells' mean, rank correlation with its
    driver, and the samples that would not be solved (checks)"""
    from scipy import stats as st
    import mc

    R = prep.get('links') or []
    res = {r['id']: [] for r in R}
    drv = {r['id']: [] for r in R}
    fails = []
    for k in range(n):
        try:
            vals, _ = mc.apply(prep, draws, k)
        except LinkCheck as e:
            fails.append({'k': k, 'why': str(e)})
            continue
        for r in R:
            cur = vals[r['param']]
            res[r['id']].append(np.mean([cur[c] for c in r['keys']]))
            src = r['driver']
            if src:
                sv = vals.get(src['param'])
                new = np.array([sv.get(c, b) for c, b in zip(src['keys'], src['base'])]) if sv else src['base']
                drv[r['id']].append(float(new.mean()))
    out = []
    for r in R:
        v = np.array(res[r['id']])
        q = np.percentile(v, [5, 50, 95]) if v.size else [np.nan] * 3
        sp = None
        if r['driver'] and len(drv[r['id']]) > 2 and np.std(v) > 0 and np.std(drv[r['id']]) > 0:
            sp = float(st.spearmanr(v, drv[r['id']]).correlation)
        out.append(
            {
                'id': r['id'],
                'name': r['name'],
                'param': r['param'],
                'cells': len(r['keys']),
                'base': float(r['base'].mean()),
                'p5': float(q[0]),
                'p50': float(q[1]),
                'p95': float(q[2]),
                'spearman_with_driver': sp,
                'driver': r['driver']['name'] if r['driver'] else None,
                'shared': r['driver']['shared'] if r['driver'] else [],
            }
        )
    return {'links': out, 'n': n, 'failed': len(fails), 'failures': fails[:10]}
