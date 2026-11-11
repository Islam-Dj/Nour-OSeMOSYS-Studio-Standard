"""Monte Carlo engine of Nour OSeMOSYS Studio.

  detect(model, data)            every parameter with data: can it vary, what kind of uncertainty, recommended setting
  prepare(design, base)          the records each factor changes (selection, scope of draws, years, time slices)
  generate(design, prep, n)      draws for n samples (MC / Latin hypercube / Halton / Sobol, Gaussian copula correlations,
                                 per-year smoothing, SDE paths, active years, ramps, time-slice groups)
  apply(prep, draws, k)          parameter values of sample k (with bounds, profile re-normalisation, min <= max checks)
  write_sample(base_text, ...)   the data file of a sample (only the changed parameters are rewritten)
  preview(design, base, ...)     what the Studio draws before running (densities, fan charts, achieved correlations)
  run(mc_dir)                    solve every sample with the chosen solver (several at once), keep the chosen outputs
  aggregate(mc_dir, ...)         percentile bands, histograms, VaR / CVaR, rank correlations (tornado)

Command line (used by the server):  python mc.py run <mc folder>
"""

import warnings, json, math, os, re, sys, time, shutil, subprocess, tempfile, threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from scipy import stats as st
from scipy.stats import qmc

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mc_dist as MD
from mc_links import LinkCheck, prepare_links, eval_links, driver_links
from muio_bridge import parse_data, model_dims
from derived import base_set, var_dims, cons_dims, DERIVED_DIMS

FROZEN = getattr(sys, 'frozen', False)


def tool(name):
    return [sys.executable, '--tool', name] if FROZEN else [sys.executable, os.path.join(HERE, name + '.py')]


NOWIN = {'creationflags': 0x08000000} if os.name == 'nt' else {}

# --------------------------------------------------------------------------- detection and recommendations
STRUCTURAL = {
    'YearSplit': 'time structure (share of the year of each time slice): changing it changes the model, not an uncertainty',
    'Conversionls': 'time structure (time slice to season)',
    'Conversionld': 'time structure (time slice to day type)',
    'Conversionlh': 'time structure (time slice to day part)',
    'DaySplit': 'time structure',
    'DaysInDayType': 'time structure',
    'CapacityToActivityUnit': 'unit conversion (e.g. 31.536 PJ per GW-year)',
    'CapacityOfOneTechnologyUnit': 'unit size for integer investments',
    'FlatActivity': 'switch (0 / 1): the same rate in every time slice',
    'TradeRoute': 'network structure (0 / 1)',
    'UDCTag': 'type of a constraint (0 = <=, 1 = =)',
    'RETagTechnology': 'tag (0 / 1)',
    'RETagFuel': 'tag (0 / 1)',
    'ReserveMarginTagTechnology': 'tag of what counts for the reserve margin',
    'ReserveMarginTagFuel': 'tag (0 / 1)',
    'TechnologyToStorage': 'storage connection (0 / 1)',
    'TechnologyFromStorage': 'storage connection (0 / 1)',
    'StorageLevelStart': 'initial state',
    'TechnologyBalanceLevel': 'balance level setting',
    'BalanceEquality': 'balance setting',
    'OperationalLifeStorage': 'lifetime of storage (use OperationalLife-like settings with care)',
    'MinStorageCharge': 'operating rule',
    'DepreciationMethod': 'accounting setting',
    'ModelPeriodExogenousEmission': 'exogenous accounting term',
    # MASTER [Y] and [K]: switches, links and timing data
    'YieldResponse': 'switch of the yield response (0 off, 1 season, 2 by stage)',
    'CropWaterInput': 'switch (0 / 1 ETm / 2 ETa)',
    'CropLandInput': 'switch (0 / 1)',
    'CropWaterOutside': 'switch (0 / 1)',
    'CropLand': 'link of a crop to its land use (0 / 1)',
    'CropET0': 'ET0 of the zone for the crops: fixed data (the weather varies through the rain)',
    'CropSowingDay': 'the calendar: each sowing date is its own technology, the model chooses among them (vary the weather, not the date)',
    'ConstructionYears': 'whole construction years (a delay is a scenario: change it in a copy of the model)',
    'ConstructionYearsStorage': 'whole construction years (a delay is a scenario)',
    'CapitalSpendProfile': 'timing of the payments (weights normalised to shares)',
    'CapitalSpendProfileStorage': 'timing of the payments (weights normalised to shares)',
}
# MASTER rules applied to every draw, whatever the design: whole days; -1 = "no limit / the land's value" is kept
MC_ROUND = {'CropStageDays'}
MC_KEEP_MINUS1 = {'CropSoilMax', 'MaxUnderConstruction', 'MaxUnderConstructionStorage'}
MC_CLIP = {
    'YieldFloor': (0, 1),
    'YieldKy': (0, None),
    'YieldKySeason': (0, None),
    'CropKcIni': (0, None),
    'CropKcMid': (0, None),
    'CropKcEnd': (0, None),
    'CropStageDays': (0, None),
}
# parameters that may only change smoothly from one year to the next (no independent yearly draws)
SMOOTH_ONLY = {
    'SpecifiedAnnualDemand': 'demand follows a trend: it cannot jump up and down from one year to the next',
    'AccumulatedAnnualDemand': 'demand follows a trend: it cannot jump up and down from one year to the next',
    'CapitalCost': 'cost paths (learning) change gradually',
    'CapitalCostStorage': 'cost paths (learning) change gradually',
    'FixedCost': 'cost paths change gradually',
    'ResidualCapacity': 'existing capacity retires gradually',
    'ResidualStorageCapacity': 'existing capacity retires gradually',
}


def smooth_only(p):
    return SMOOTH_ONLY.get(p) or ('demand follows a trend: it cannot jump from one year to the next' if re.search(r'Demand$', p) else None)


def rec(dist, params, mode='mult', time='static', sde=None, sdeparams=None, slices='same', scope='entity', smooth='none', trunc=None):
    return {
        'dist': {'key': dist, 'params': params, 'trunc': trunc},
        'mode': mode,
        'time': {
            'kind': time,
            'smooth': smooth,
            'rho': 0.6,
            'width': 3,
            'knot': 10,
            'sde': sde or 'gbm',
            'sdeParams': sdeparams or {},
            'active': '',
            'outside': 'base',
            'ramp': 0,
        },
        'slices': {'kind': slices, 'rho': 0.5},
        'scope': scope,
    }


def classify(p, dims, vals, has_year, has_slice):
    """-> (category, structural?, recommendation, explanation, post-rules)"""
    n = p
    nonneg = all(v >= 0 for v in vals)
    in01 = nonneg and all(v <= 1 for v in vals)
    post = {'clip': [0, None] if nonneg else [None, None], 'renorm': False}
    if p in STRUCTURAL:
        return 'structure', True, None, 'Not varied: ' + STRUCTURAL[p] + '.', post
    if re.search(r'Tag$|Tag[A-Z]|Route$', p):
        return 'structure', True, None, 'Not varied: a tag or switch (0 / 1).', post
    # MASTER [Y] crop yield and calendar (FAO-33 / FAO-56)
    if p in ('YieldKy', 'YieldKySeason'):
        return (
            'yield response factor Ky',
            False,
            rec('triangular', {'min': 0.8, 'mode': 1, 'max': 1.2}, scope='entity'),
            'Sensitivity of the yield to a water shortage (FAO-33): uncertain by +/- 20 %, one draw per crop for all years.',
            post,
        )
    if p in ('CropKcIni', 'CropKcMid', 'CropKcEnd'):
        return (
            'crop coefficient Kc',
            False,
            rec('triangular', {'min': 0.9, 'mode': 1, 'max': 1.1}, scope='entity'),
            'Crop water need per unit of ET0 (FAO-56): +/- 10 %, one draw per crop.',
            post,
        )
    if p == 'CropStageDays':
        return (
            'length of the crop stages (days)',
            False,
            rec('triangular', {'min': 0.9, 'mode': 1, 'max': 1.1}, scope='entity'),
            'Stage lengths (FAO-56) change with the variety and the temperature: +/- 10 %, rounded to whole days in every sample.',
            post,
        )
    if p == 'CropSoilMax':
        return (
            'soil water store of the crop',
            False,
            rec('triangular', {'min': 0.8, 'mode': 1, 'max': 1.2}, scope='region_entity'),
            'Root zone water store: +/- 20 %. The value -1 (= the store of the land) is never changed.',
            post,
        )
    if p == 'YieldFloor':
        post['clip'] = [0, 1]
        return (
            'lowest yield factor',
            False,
            rec('uniform', {'min': 0.8, 'max': 1.2}, scope='entity'),
            'Lower bound of the yield factor, kept within [0, 1].',
            post,
        )
    if p in ('MaxUnderConstruction', 'MaxUnderConstructionStorage'):
        return (
            'limit of the capacity under construction',
            False,
            rec('uniform', {'min': 0.8, 'max': 1.2}, scope='entity'),
            'Construction capacity of the country (contractors, equipment): a range (uniform). The value -1 (no limit) is never changed.',
            post,
        )
    if p in ('SpecifiedDemandProfile',) or re.search(r'Profile', p):
        post.update(clip=[0, 1], renorm=True)
        return (
            'profile (shares of the year)',
            False,
            rec('normal', {'mean': 1, 'sd': 0.05}, slices='slice', scope='region_entity', time='peryear', smooth='ar1'),
            'Shares over the time slices: varied slice by slice and re-normalised so each year still sums to the base total (1). Per-year draws, smoothed (AR(1)), reproduce weather / behaviour variability between years.',
            post,
        )
    if re.search(r'CapacityFactor', p):
        post['clip'] = [0, 1]
        return (
            'capacity factor (bounded 0-1)',
            False,
            rec(
                'truncnormal',
                {'mean': 1, 'sd': 0.08, 'min': 0.7, 'max': 1.25},
                slices='season',
                scope='region_entity',
                time='peryear',
                smooth='ar1',
            ),
            'Weather-driven output (sun, wind, water): varies between years and seasons; kept within [0, 1]. Alternative over time: the Jacobi SDE (bounded).',
            post,
        )
    if re.search(r'AvailabilityFactor', p):
        post['clip'] = [0, 1]
        return (
            'availability (bounded 0-1)',
            False,
            rec('truncnormal', {'mean': 1, 'sd': 0.04, 'min': 0.85, 'max': 1.05}, scope='region_entity', time='peryear'),
            'Outages and maintenance: small variations year by year, kept within [0, 1]; a Bernoulli (on / off) models full outages of a unit or link.',
            post,
        )
    if re.search(r'^SpecifiedAnnualDemand|^AccumulatedAnnualDemand|Demand$', p):
        return (
            'demand',
            False,
            rec('lognormal', {'median': 1, 'sigma': 0.1}, time='sde', sde='gbm', sdeparams={'mu': 0, 'sigma': 0.02}, scope='region_entity'),
            'Final demand: uncertainty grows with time (GBM, 2 % per year), the base projection stays the median path. Alternative: one lognormal multiplier for all years.',
            post,
        )
    if re.search(r'EmissionsPenalty|CarbonPrice|CO2Price', p):
        return (
            'carbon price (policy)',
            False,
            rec(
                'discrete',
                {'values': '0.5, 1, 2', 'probs': '0.25, 0.5, 0.25'},
                time='sde',
                sde='gbm',
                sdeparams={'mu': 0, 'sigma': 0.15},
                scope='all',
            ),
            'Policy price: wide uncertainty growing with time (GBM 15 %); discrete low / central / high scenarios are an alternative.',
            post,
        )
    if re.search(r'EmissionLimit', p):
        return (
            'emission limit (policy)',
            False,
            rec('uniform', {'min': 0.8, 'max': 1.2}, scope='all'),
            'Policy cap: a range of ambition levels (uniform), the same in all years.',
            post,
        )
    if re.search(r'EmissionActivityRatio|EmissionToActivity', p):
        return (
            'emission factor',
            False,
            rec('triangular', {'min': 0.95, 'mode': 1, 'max': 1.05}, scope='entity'),
            'Fuel-specific emission factors (IPCC ranges): small symmetric uncertainty, constant over time.',
            post,
        )
    if re.search(r'InputActivityRatio|InputToNewCapacity|InputToTotalCapacity', p):
        return (
            'input ratio (efficiency)',
            False,
            rec('truncnormal', {'mean': 1, 'sd': 0.03, 'min': 0.9, 'max': 1.1}, scope='entity'),
            'Fuel use per unit of output (1 / efficiency): narrow, bounded uncertainty per technology. Leave links and trade ratios (= 1) unchanged.',
            post,
        )
    if re.search(r'OutputActivityRatio', p):
        return (
            'output ratio',
            False,
            rec('truncnormal', {'mean': 1, 'sd': 0.02, 'min': 0.95, 'max': 1.05}, scope='entity'),
            'Usually 1 (one unit of activity = one unit of output): vary only real conversion ratios (co-products, yields), never balance or transmission links.',
            post,
        )
    if re.search(r'^CapitalCost|^FixedCost|CostStorage|InvestmentCost', p):
        return (
            'cost',
            False,
            rec('lognormal', {'median': 1, 'sigma': 0.2}, scope='entity', sdeparams={'mu': 0, 'sigma': 0.05}),
            'Investment and O&M costs: positive and right-skewed (lognormal, cost overruns more likely than savings), one draw per technology for all years (fully correlated over time). Over time: GBM 5 % per year for uncertain learning. Correlate the same technology across regions.',
            post,
        )
    if re.search(r'^VariableCost', p):
        return (
            'variable cost / fuel price',
            False,
            rec('lognormal', {'median': 1, 'sigma': 0.2}, time='sde', sde='expou', sdeparams={'kappa': 0.3, 'sigma': 0.15}, scope='entity'),
            'For import / extraction technologies this is the fuel price: mean-reverting log process (Schwartz exponential OU) or Merton jumps for crises. For other technologies a lognormal multiplier.',
            post,
        )
    if re.search(r'Price|Revenue|Tariff', p):
        return (
            'price',
            False,
            rec('lognormal', {'median': 1, 'sigma': 0.2}, time='sde', sde='expou', sdeparams={'kappa': 0.3, 'sigma': 0.15}, scope='entity'),
            'A price: positive, mean reverting around the base path (exponential OU); Merton jumps for price crises.',
            post,
        )
    if re.search(r'DiscountRate', p):
        b = float(np.median(vals)) if vals else 0.05
        return (
            'discount rate',
            False,
            rec('triangular', {'min': round(b * 0.6, 4), 'mode': round(b, 4), 'max': round(b * 1.6, 4)}, mode='abs', scope='all'),
            'Financing conditions: absolute values around the base rate (triangular). It also changes the weight of the future in the objective.',
            post,
        )
    if re.search(r'OperationalLife', p):
        return (
            'lifetime',
            False,
            rec('triangular', {'min': 0.8, 'mode': 1, 'max': 1.2}, scope='entity'),
            'Technical lifetime: +/- 20 % (triangular).',
            post,
        )
    if re.search(r'ResidualCapacity|ResidualStorage', p):
        return (
            'existing capacity',
            False,
            rec('triangular', {'min': 0.95, 'mode': 1, 'max': 1.05}, scope='entity'),
            'Existing stock: statistics are fairly accurate (+/- 5 %).',
            post,
        )
    if re.search(r'ReserveMargin$|REMinProduction|Target', p):
        return (
            'policy target',
            False,
            rec('uniform', {'min': 0.9, 'max': 1.1}, scope='all'),
            'Policy or reliability target: a range of levels (uniform).',
            post,
        )
    if re.search(r'^UDC', p):
        return (
            'user constraint',
            False,
            rec('uniform', {'min': 0.9, 'max': 1.1}, scope='entity'),
            'Constraint constant or multiplier: a range around the base.',
            post,
        )
    if re.search(r'Max|Min|Upper|Lower|Limit|Budget|Cap', p):
        return (
            'limit (deployment / policy)',
            False,
            rec('uniform', {'min': 0.8, 'max': 1.2}, scope='entity'),
            'Build or activity limit: a range (uniform). The Studio keeps every lower limit at or below its upper limit in each sample.',
            post,
        )
    if re.search(r'^UDC', p):
        return (
            'user constraint',
            False,
            rec('uniform', {'min': 0.9, 'max': 1.1}, scope='entity'),
            'Constraint constant or multiplier: a range around the base.',
            post,
        )
    if in01:
        post['clip'] = [0, 1]
        return (
            'share / fraction (0-1, model-specific)',
            False,
            rec('truncnormal', {'mean': 1, 'sd': 0.05, 'min': 0.85, 'max': 1.15}, scope='entity'),
            'A model-specific parameter whose data are all between 0 and 1: treated as a bounded share. Check its meaning.',
            post,
        )
    return (
        'model-specific',
        False,
        rec('triangular', {'min': 0.9, 'mode': 1, 'max': 1.1}, scope='entity'),
        'A parameter of your model file: generic +/- 10 % (triangular). Check its meaning and units before varying it.',
        post,
    )


def detect(model_txt, data_txt):
    dims = model_dims(model_txt)
    sets, params, _ = parse_data(data_txt, dims)
    out = []
    for p, P in sorted(params.items()):
        d = [base_set(x) for x in dims.get(p, [])]
        if not d:
            continue
        vals = [v for v in P['recs'].values()]
        has_year, has_slice = 'YEAR' in d, 'TIMESLICE' in d
        nz = [v for v in vals if v]
        cat, structural, r, why, post = classify(p, d, nz[:5000], has_year, has_slice)
        varies = False
        if has_year and nz:
            yi = d.index('YEAR')
            g = defaultdict(set)
            for k, v in P['recs'].items():
                g[k[:yi] + k[yi + 1 :]].add(round(v, 9))
            varies = any(len(s) > 1 for s in g.values())
        mem, withdata = {}, {}
        for i, x in enumerate(d):  # every member of the set (values at the default can be varied too), and those with data
            if x in ('YEAR',):
                continue
            key = x if x not in mem else f'{x} 2'
            have = sorted({k[i] for k in P['recs']})
            full = sets.get(x) or (sets.get('FUEL') if x == 'COMMODITY' else None) or have
            mem[key] = sorted(set(map(str, full)) | set(have), key=lambda z: (0, float(z)) if re.match(r'^-?\d+(\.\d+)?$', z) else (1, z))[
                :2000
            ]
            withdata[key] = have[:2000]
        out.append(
            {
                'param': p,
                'members': mem,
                'with_data': withdata,
                'smooth_only': smooth_only(p) if has_year else None,
                'dims': d,
                'records': len(vals),
                'nonzero': len(nz),
                'default': P['def'],
                'has_year': has_year,
                'has_slice': has_slice,
                'nonneg': all(v >= 0 for v in nz),
                'in01': all(0 <= v <= 1 for v in nz) if nz else False,
                'changes_over_years': varies,
                'min': min(nz) if nz else None,
                'max': max(nz) if nz else None,
                'category': cat,
                'structural': structural,
                'recommend': r,
                'why': why,
                'post': post,
            }
        )
    full = lambda x: [str(m) for m in (sets.get(x) or (sets.get('FUEL') if x == 'COMMODITY' else None) or [])][:2000]
    declared = [
        {
            'param': p,
            'dims': [base_set(x) for x in ds],
            'records': 0,
            'category': 'no data (model default only)',
            'structural': p in STRUCTURAL,
            'members': {base_set(x): full(base_set(x)) for x in ds if base_set(x) != 'YEAR'},
            'with_data': {},
        }
        for p, ds in dims.items()
        if p not in params
    ]
    return {
        'params': out,
        'declared_without_data': declared,
        'years': sets.get('YEAR', []),
        'sets': {k: v for k, v in sets.items() if len(v) < 5000},
    }


# --------------------------------------------------------------------------- factors: the records each one changes
SCOPE_DIMS = {'all': [], 'region': ['REGION'], 'entity': ['ENTITY'], 'region_entity': ['REGION', 'ENTITY'], 'record': ['*']}
ENTITY_ORDER = ['TECHNOLOGY', 'COMMODITY', 'EMISSION', 'STORAGE', 'UDC']


def years_mask(spec, years):
    """'2030-2050, 2060' -> boolean mask over the model years (empty = all years)"""
    spec = (spec or '').strip()
    if not spec:
        return np.ones(len(years), bool)
    m = np.zeros(len(years), bool)
    ys = np.array([int(y) for y in years])
    for part in re.split(r'[,;\s]+', spec):
        if not part:
            continue
        a = re.match(r'^(\d{4})\s*(?:-|to|:)\s*(\d{4})$', part)
        if a:
            m |= (ys >= int(a.group(1))) & (ys <= int(a.group(2)))
        elif re.match(r'^\d{4}$', part):
            m |= ys == int(part)
        elif re.match(r'^\d{4}-$', part):
            m |= ys >= int(part[:4])
        else:
            raise ValueError(f'years "{part}": write 2030-2050, 2060 or 2040-')
    return m


def prepare(design, model_txt, data_txt):
    dims = model_dims(model_txt)
    sets, params, _ = parse_data(data_txt, dims)
    years = sets.get('YEAR', [])
    Y = {y: i for i, y in enumerate(years)}
    slices = sets.get('TIMESLICE', [])
    conv = lambda p: {k[0]: k[1] for k, v in params.get(p, {'recs': {}})['recs'].items() if v}
    out = []
    for f in design['factors']:
        if not f.get('enabled', True):
            continue
        p = f['param']
        if p not in dims:
            raise ValueError(f'{f.get("name") or p}: {p} is not a parameter of the model file')
        d = [base_set(x) for x in dims[p]]
        P = params.get(p, {'recs': {}, 'def': None})
        sel = {k: set(map(str, v)) for k, v in (f.get('select') or {}).items() if v}
        recs = {k: v for k, v in P['recs'].items() if all(k[i] in sel[x] for i, x in enumerate(d) if x in sel)}
        if f.get('includeDefaults'):  # also the index combinations at the default value
            dv = P['def'] if P['def'] is not None else float(f.get('defaultValue', 0) or 0)
            mem = [
                (
                    sorted(sel[x])
                    if x in sel
                    else sets.get('COMMODITY' if x == 'COMMODITY' else x, sets.get('FUEL', []) if x == 'COMMODITY' else [])
                )
                for x in d
            ]
            total = int(np.prod([len(m) for m in mem])) if mem else 0
            if total > 400000:
                raise ValueError(f'{p}: {total:,} combinations at the default value: select fewer members')
            import itertools

            for k in itertools.product(*mem):
                if k not in recs:
                    recs[k] = dv
        if not recs:
            raise ValueError(
                f'{f.get("name") or p}: no values selected (the parameter has no data for this selection; tick "also vary values at their default")'
            )
        yi = d.index('YEAR') if 'YEAR' in d else None
        si = d.index('TIMESLICE') if 'TIMESLICE' in d else None
        ent = next((i for i, x in enumerate(d) if x in ENTITY_ORDER), None)
        ri = d.index('REGION') if 'REGION' in d else None
        scope = f.get('scope', 'entity')

        def gkey(k):
            if scope == 'all':
                return ()
            if scope == 'region':
                return (k[ri],) if ri is not None else ()
            if scope == 'entity':
                return (k[ent],) if ent is not None else ()
            if scope == 'region_entity':
                return tuple(k[i] for i in (ri, ent) if i is not None)
            return tuple(x for i, x in enumerate(k) if i not in (yi, si))

        sk = (f.get('slices') or {}).get('kind', 'same') if si is not None else 'same'
        smap = {'season': conv('Conversionls'), 'daytype': conv('Conversionld'), 'daypart': conv('Conversionlh')}.get(sk)

        def skey(k):
            if si is None or sk == 'same':
                return '*'
            if sk == 'slice' or not smap:
                return k[si]
            return smap.get(k[si], k[si])

        keys = list(recs)
        G = {}
        S = {}
        gi = np.empty(len(keys), np.int32)
        ti = np.empty(len(keys), np.int32)
        sj = np.empty(len(keys), np.int32)
        base = np.empty(len(keys))
        for n, k in enumerate(keys):
            gi[n] = G.setdefault(gkey(k), len(G))
            sj[n] = S.setdefault(skey(k), len(S))
            ti[n] = Y.get(k[yi], -1) if yi is not None else -1
            base[n] = recs[k]
        # profile re-normalisation groups: all indices except the time slice
        ng = None
        if (f.get('post') or {}).get('renorm') and si is not None:
            NG = {}
            ng = np.array([NG.setdefault(tuple(x for i, x in enumerate(k) if i != si), len(NG)) for k in keys], np.int32)
        out.append(
            {
                'f': f,
                'param': p,
                'dims': d,
                'keys': keys,
                'base': base,
                'g': gi,
                't': ti,
                's': sj,
                'G': len(G),
                'S': len(S),
                'groups': list(G),
                'slicegroups': list(S),
                'has_year': yi is not None,
                'renorm': ng,
                'default': P['def'],
                'name': f.get('name') or p,
            }
        )
    prep = {'factors': out, 'years': years, 'params': params, 'sets': sets, 'dims': dims}
    prep['links'] = prepare_links(design, prep)  # linked values
    return prep


# --------------------------------------------------------------------------- generation of the draws
def nearest_corr(C):
    """nearest valid correlation matrix (eigenvalues clipped, unit diagonal); returns (matrix, repaired?)"""
    C = (np.asarray(C, float) + np.asarray(C, float).T) / 2
    np.fill_diagonal(C, 1)
    w, V = np.linalg.eigh(C)
    if w.min() > 1e-10:
        return C, False
    for _ in range(100):
        w, V = np.linalg.eigh(C)
        C = V @ np.diag(np.maximum(w, 1e-8)) @ V.T
        d = np.sqrt(np.diag(C))
        C = C / np.outer(d, d)
        np.fill_diagonal(C, 1)
        if np.linalg.eigvalsh(C).min() > 1e-10:
            break
    return C, True


def uniforms(method, n, dim, seed):
    if dim == 0:
        return np.zeros((n, 0))
    if method == 'lhs':
        return qmc.LatinHypercube(d=dim, seed=seed).random(n)
    if method == 'halton':
        return qmc.Halton(d=dim, scramble=True, seed=seed).random(n)
    if method == 'sobol':
        m = int(math.ceil(math.log2(max(n, 2))))
        return (
            qmc.Sobol(d=min(dim, 21201), scramble=True, seed=seed).random(2**m)[:n]
            if dim <= 21201
            else np.random.default_rng(seed).random((n, dim))
        )
    return np.random.default_rng(seed).random((n, dim))


def generate(design, prep, n=None, seed=None, only=None):
    """-> list (one per factor) of arrays (n, G, T, S) of draw values, and the (n, K) sample summary used for sensitivity"""
    smp = design.get('sampling', {})
    n = int(n or smp.get('n', 100))
    seed = int(seed if seed is not None else smp.get('seed', 12345))
    method = smp.get('method', 'lhs')
    years = prep['years']
    T = len(years)
    ys = np.array([int(y) for y in years], float)
    F = [x for i, x in enumerate(prep['factors']) if only is None or i in only]
    K = len(F)
    rng = np.random.default_rng(seed)
    if n * sum(x['G'] * x['S'] * T for x in F) > 6e7:
        raise ValueError(
            'too many draws to keep in memory: lower the number of samples or use a coarser scope (one draw per region / for all)'
        )
    # Each draw = sqrt(c) * DRIVER of the factor + sqrt(1 - c) * its own noise   (c = coherence inside the factor).
    # The drivers (one per sample, and per year for per-year draws / per step for SDEs) are correlated between factors
    # with the correlation matrix (Gaussian copula); the own noises come from the sampling method (MC, LHS, Halton, Sobol).
    kinds = [x['f'].get('time', {}).get('kind', 'static') if x['has_year'] else 'static' for x in F]
    gyear = lambda x: (x['f'].get('time') or {}).get('growthPer', 'one') == 'yearly'
    shapes = [
        (x['G'], 1 if k == 'static' or (k == 'growth' and not gyear(x)) else T if k in ('peryear', 'growth') else max(T - 1, 1), x['S'])
        for x, k in zip(F, kinds)
    ]
    coh = [float(x['f'].get('coherence', 1.0 if x['G'] * x['S'] == 1 else 0.5)) for x in F]
    qd_e = [int(np.prod(s)) if k != 'sde' else 0 for s, k in zip(shapes, kinds)]
    qd_c = [s[1] if k != 'sde' else 0 for s, k in zip(shapes, kinds)]
    U = uniforms(method, n, sum(qd_e) + sum(qd_c), seed)
    ppf = lambda u: st.norm.ppf(np.clip(u, 1e-12, 1 - 1e-12))
    E, Cdrv, c = [], [], 0
    for s, k, qe, qc in zip(shapes, kinds, qd_e, qd_c):
        if k == 'sde':
            E.append(rng.standard_normal((n,) + s))
            Cdrv.append(rng.standard_normal((n, s[1])))
        else:
            E.append(ppf(U[:, c : c + qe]).reshape((n,) + s))
            c += qe
            Cdrv.append(ppf(U[:, c : c + qc]))
            c += qc
    corr = design.get('corr') or {}
    ids = corr.get('ids') or []
    Cm = corr.get('matrix')
    repaired = False
    Cfull = np.eye(K)
    if Cm and ids:
        fid = [x['f'].get('id') for x in F]
        idx = [fid.index(i) if i in fid else None for i in ids]
        for a_, ia in enumerate(idx):
            for b_, ib in enumerate(idx):
                if ia is not None and ib is not None and ia != ib:
                    Cfull[ia, ib] = float(Cm[a_][b_] or 0)
        Cfull, repaired = nearest_corr(Cfull)
    if np.any(np.abs(Cfull - np.eye(K)) > 1e-12):
        L = np.linalg.cholesky(Cfull)
        Tm = max(s[1] for s in shapes)
        mixed = []
        for i in range(K):
            m_ = np.zeros((n, shapes[i][1]))
            for j in range(i + 1):
                if L[i, j] == 0:
                    continue
                src = Cdrv[j]
                cols = np.minimum(np.arange(shapes[i][1]), src.shape[1] - 1)  # a static driver serves every year
                m_ += L[i, j] * src[:, cols]
            mixed.append(m_)
        Cdrv = mixed
    Z = [math.sqrt(ch) * Cd[:, None, :, None] + math.sqrt(max(1 - ch, 0)) * e for ch, Cd, e in zip(coh, Cdrv, E)]
    prep['driverlinks'] = driver_links(F, kinds, Z)  # correlations with a driver
    out, summ = [], np.zeros((n, K))
    for i, (x, k, z) in enumerate(zip(F, kinds, Z)):
        f = x['f']
        tm = f.get('time') or {}
        G, S = x['G'], x['S']
        so = smooth_only(f.get('param', ''))
        if so and x['has_year'] and k == 'peryear' and (tm.get('smooth') or 'none') == 'none' and not tm.get('allowJumps'):
            raise ValueError(
                f"{f.get('name') or f.get('param')}: independent draws for each year are not allowed here ({so}). "
                "Use one draw for all years, a smoothed yearly draw (AR(1), kernel, knot years), a growth rate or an SDE path; or tick 'allow year-to-year jumps'."
            )
        sl = f.get('slices') or {}
        rs = float(sl.get('rho', 0) or 0)
        if S > 1 and rs > 0:  # correlation between the time-slice groups
            common = z.mean(-1, keepdims=True) * math.sqrt(S)
            z = math.sqrt(rs) * common + math.sqrt(1 - rs) * z
        mode = 'mult' if k in ('sde', 'growth') else f.get('mode', 'mult')
        neutral = 1.0 if mode == 'mult' else 0.0
        if k == 'growth':  # a growth rate (% per year) drawn, compounded from the start year: smooth paths
            if z.shape[2] > 1:  # a rate for each year, smoothed (AR(1)) around the factor's distribution
                r_ = float(tm.get('rho', 0.8))
                zz = z.copy()
                for t in range(1, T):
                    zz[:, :, t] = r_ * zz[:, :, t - 1] + math.sqrt(1 - r_ * r_) * z[:, :, t]
                z = zz
            dd = MD.make(f['dist']['key'], f['dist'].get('params', {}), f['dist'].get('trunc'))
            rate = dd.ppf(st.norm.cdf(z)) / 100.0
            act = years_mask(tm.get('active', ''), years)
            t0 = int(np.argmax(act)) if act.any() else 0
            if rate.shape[2] == 1:
                ex = np.clip(ys - ys[t0], 0, None)[None, None, :, None]
                v = np.power(np.maximum(1 + rate, 1e-9), ex)
            else:
                dt = np.diff(ys, prepend=ys[0])
                dt[: t0 + 1] = 0
                v = np.exp(np.cumsum(np.log(np.maximum(1 + rate, 1e-9)) * dt[None, None, :, None], axis=2))
        elif k in ('static', 'peryear'):
            if k == 'peryear':
                sm = tm.get('smooth', 'none')
                if sm == 'ar1':
                    r = float(tm.get('rho', 0.6))
                    zz = z.copy()
                    for t in range(1, T):
                        zz[:, :, t] = r * zz[:, :, t - 1] + math.sqrt(1 - r * r) * z[:, :, t]
                    z = zz
                elif sm == 'kernel':
                    w = float(tm.get('width', 3)) or 1
                    kk = np.exp(-0.5 * (np.arange(-3 * w, 3 * w + 1) / w) ** 2)
                    kk /= math.sqrt((kk**2).sum())
                    z = np.apply_along_axis(lambda a: np.convolve(np.pad(a, (len(kk) // 2,), mode='reflect'), kk, 'valid')[:T], 2, z)
            dd = MD.make(f['dist']['key'], f['dist'].get('params', {}), f['dist'].get('trunc'))
            v = dd.ppf(st.norm.cdf(z))
            if k == 'peryear' and tm.get('smooth') == 'knots':  # values drawn at knot years, interpolated between
                step = max(1, int(tm.get('knot', 10)))
                kn = list(range(0, T, step)) + ([T - 1] if (T - 1) % step else [])
                v = np.stack(
                    [
                        np.stack([np.stack([np.interp(np.arange(T), kn, v[a, g, kn, s]) for s in range(S)], -1) for g in range(G)])
                        for a in range(n)
                    ]
                )
            if k == 'static':
                v = np.repeat(v, T, axis=2)
        else:  # SDE paths over the years, from the start year
            key = tm.get('sde', 'gbm')
            act = years_mask(tm.get('active', ''), years)
            t0 = int(np.argmax(act)) if act.any() else 0
            tt = ys - ys[t0]
            zz = z
            v = np.ones((n, G, T, S))
            for g in range(G):
                for s in range(S):
                    bp = None
                    if key == 'jacobi':
                        m = (x['g'] == g) & (x['s'] == s)
                        bp = np.ones(T)
                        for t in range(T):
                            q = x['base'][m & (x['t'] == t)]
                            bp[t] = q.mean() if q.size else (bp[t - 1] if t else 0.5)
                    zt = zz[:, g, :, s][:, t0 : T - 1] if T - 1 > t0 else np.zeros((n, 0))
                    path = MD.sde_paths(key, tm.get('sdeParams', {}), tt[t0:], zt, rng, base=bp[t0:] if bp is not None else None)
                    if key == 'jacobi':
                        path = path / np.maximum(bp[t0:], 1e-12)  # bounded value -> multiplier of the base
                    v[:, g, t0:, s] = path
        # active years, outside = base or hold, ramp in
        if x['has_year']:
            act = years_mask(tm.get('active', ''), years)
            if not act.all():
                if tm.get('outside', 'base') == 'hold':
                    last = None
                    for t in range(T):
                        if act[t]:
                            last = t
                        elif last is not None:
                            v[:, :, t] = v[:, :, last]
                        else:
                            v[:, :, t] = neutral
                else:
                    v[:, :, ~act] = neutral
            rp = float(tm.get('ramp', 0) or 0)
            if rp > 0 and act.any():
                t0 = int(np.argmax(act))
                w = np.clip((ys - ys[t0] + 1) / rp, 0, 1)
                v = neutral + (v - neutral) * w[None, None, :, None] if mode in ('mult', 'add', 'pct') else v
        out.append(v.astype(np.float32))
        act = years_mask(tm.get('active', ''), years) if x['has_year'] else np.ones(T, bool)
        summ[:, i] = v[:, :, act, :].mean(axis=(1, 2, 3)) if act.any() else v.mean(axis=(1, 2, 3))
    return out, summ, repaired


# --------------------------------------------------------------------------- apply a sample
PAIRS = [
    ('TotalAnnualMinCapacity', 'TotalAnnualMaxCapacity'),
    ('TotalAnnualMinCapacityInvestment', 'TotalAnnualMaxCapacityInvestment'),
    ('TotalTechnologyAnnualActivityLowerLimit', 'TotalTechnologyAnnualActivityUpperLimit'),
    ('TotalTechnologyModelPeriodActivityLowerLimit', 'TotalTechnologyModelPeriodActivityUpperLimit'),
]


def apply(prep, draws, k):
    """-> {param: {key: value}} for the changed parameters of sample k, and notes"""
    vals, notes = {}, []
    for x, d in zip(prep['factors'], draws):
        f = x['f']
        p = x['param']
        mode = f.get('mode', 'mult')
        if x['has_year'] and (f.get('time') or {}).get('kind') in ('sde', 'growth'):
            mode = 'mult'  # SDE and growth paths are multipliers of the base path
        cur = vals.get(p) or dict(prep['params'].get(p, {'recs': {}})['recs'])
        b = np.array([cur.get(kk, bb) for kk, bb in zip(x['keys'], x['base'])])
        t = np.where(x['t'] >= 0, x['t'], 0)
        dv = d[k][x['g'], t, x['s']].astype(float)
        nv = b * dv if mode == 'mult' else b + dv if mode == 'add' else b * (1 + dv / 100) if mode == 'pct' else dv
        post = f.get('post') or {}
        lo, hi = (list(post.get('clip') or []) + [None, None])[:2]
        if lo is not None:
            nv = np.maximum(nv, lo)
        if hi is not None:
            nv = np.minimum(nv, hi)
        if p in MC_CLIP:
            lo2, hi2 = MC_CLIP[p]
            nv = np.maximum(nv, lo2) if lo2 is not None else nv
            nv = np.minimum(nv, hi2) if hi2 is not None else nv
        if p in MC_ROUND:
            nv = np.round(nv)
        if p in MC_KEEP_MINUS1:
            nv = np.where(b == -1, -1.0, np.maximum(nv, 0))
        if x['renorm'] is not None:  # each profile keeps its base total over the time slices
            g = x['renorm']
            s0 = np.bincount(g, weights=x['base'])
            s1 = np.bincount(g, weights=nv)
            nv = nv * np.where(s1[g] > 0, s0[g] / np.maximum(s1[g], 1e-300), 1)
        for kk, v in zip(x['keys'], nv):
            cur[kk] = float(v)
        vals[p] = cur
    if prep.get('links'):
        eval_links(prep, vals)  # linked values, after the factors
    for lo_p, hi_p in PAIRS:  # lower limits never above upper limits
        if lo_p in vals or hi_p in vals:
            L = vals.get(lo_p, prep['params'].get(lo_p, {'recs': {}})['recs'])
            H = vals.get(hi_p, prep['params'].get(hi_p, {'recs': {}})['recs'])
            fixed = 0
            for kk, v in list(L.items()):
                if kk in H and v > H[kk] + 1e-12:
                    if lo_p in vals:
                        L[kk] = H[kk]
                    else:
                        H[kk] = v
                    fixed += 1
            if fixed:
                if lo_p in vals:
                    vals[lo_p] = L
                else:
                    vals[hi_p] = H
                notes.append(f'{fixed} {lo_p} values lowered to {hi_p}')
    return vals, notes


# --------------------------------------------------------------------------- data file of a sample
def param_spans(text):
    """{name: (start, end)} of each 'param NAME ... ;' statement (comments skipped)"""
    out = {}
    for m in re.finditer(r'(?m)^[ \t]*param[ \t]+([A-Za-z_]\w*)', text):
        i = m.end()
        n = len(text)
        while i < n:
            ch = text[i]
            if ch == '#':
                i = text.find('\n', i)
                i = n if i < 0 else i
            elif ch == ';':
                break
            else:
                i += 1
        out.setdefault(m.group(1), (m.start(), i + 1))
    return out


def write_sample(base_text, vals, prep, path, spans=None):
    spans = spans or param_spans(base_text)
    parts, last = [], 0
    extra = []
    for p, (a, b) in sorted(((p, spans[p]) for p in vals if p in spans), key=lambda x: x[1][0]):
        parts.append(base_text[last:a])
        parts.append(block(p, vals[p], prep['params'].get(p, {}).get('def')))
        last = b
    for p in vals:
        if p not in spans:
            extra.append(block(p, vals[p], prep['params'].get(p, {}).get('def')))
    rest = base_text[last:]
    if extra:
        m = re.search(r'(?m)^\s*end;\s*$', rest)
        rest = rest[: m.start()] + '\n' + '\n'.join(extra) + '\n' + rest[m.start() :] if m else rest + '\n' + '\n'.join(extra) + '\n'
    parts.append(rest)
    with open(path, 'w', encoding='utf-8', newline='\n') as fo:
        fo.write(''.join(parts))


def block(p, recs, default):
    L = [f'param {p}' + (f' default {default:.15g}' if default is not None else '') + ' :=']
    L += [' '.join(k) + f' {v:.12g}' for k, v in recs.items()]
    return '\n'.join(L) + '\n;'


# --------------------------------------------------------------------------- preview (before running)
def preview(design, model_txt, data_txt, factor_index=None, n=300, paths=12, year=None):
    prep = prepare(design, model_txt, data_txt)
    years = prep['years']
    only = None if factor_index is None else [factor_index]
    if only is not None:  # a parameter linked to a driver: draw the driver too
        dv = (prep['factors'][factor_index]['f'].get('driverLink') or {}).get('driver')
        jj = next((j for j, x in enumerate(prep['factors']) if dv and x['f'].get('id') == dv), None)
        if jj is not None and jj != factor_index:
            only = [factor_index, jj]
    draws, summ, repaired = generate(design, prep, n=n, seed=design.get('sampling', {}).get('seed', 12345), only=only)
    out = {'years': years, 'factors': [], 'repaired': repaired}
    F = prep['factors'] if only is None else [prep['factors'][k_] for k_ in sorted(only)]  # the order generate() uses
    achieved = {}
    for dl in prep.get('driverlinks') or []:  # rank correlation achieved with each cell of the driver
        tv = summ[:, dl['target']]
        achieved[dl['target']] = [
            {'match': t['match'], 'asked': t['asked'], 'achieved': float(st.spearmanr(t['u'], tv).correlation)} for t in dl['terms']
        ]
    if only is not None:  # show the factor asked only (its driver was drawn with it)
        pos = sorted(only).index(factor_index)
        F, draws = [F[pos]], [draws[pos]]
        achieved = {0: achieved[pos]} if pos in achieved else {}
    for fi_, (x, d) in enumerate(zip(F, draws)):
        f = x['f']
        info = {
            'name': x['name'],
            'param': x['param'],
            'records': len(x['keys']),
            'groups': len(x['groups']),
            'slicegroups': x['slicegroups'][:60],
            'G': x['G'],
            'S': x['S'],
        }
        kind = f.get('time', {}).get('kind', 'static') if x['has_year'] else 'static'
        if kind != 'sde':
            dd = MD.make(f['dist']['key'], f['dist'].get('params', {}), f['dist'].get('trunc'))
            info['dist'] = MD.describe(dd)
        m = d[:, 0, :, 0]  # first group, first slice group: the draw over the years
        q = np.percentile(m, [5, 25, 50, 75, 95], axis=0)
        info['draw'] = {
            'p5': q[0].tolist(),
            'p25': q[1].tolist(),
            'p50': q[2].tolist(),
            'p75': q[3].tolist(),
            'p95': q[4].tolist(),
            'mean': m.mean(0).tolist(),
            'paths': m[:paths].tolist(),
            'group': ' · '.join(g for g in x['groups'][0] if g != '__none__') or 'all values',
        }
        # resulting parameter values: sum over the selected records per year (or mean for ratios), base and bands
        vals = np.zeros((min(n, 150), len(years)))
        basev = np.zeros(len(years))
        cnt = np.zeros(len(years))
        agg_mean = bool(re.search(r'Factor|Ratio|Profile|Rate|Life|Split|Cost|Price|Penalty', x['param']))
        sub = {'factors': [x], 'params': prep['params']}
        ys_ = [str(y) for y in years]
        tsel = ys_.index(str(year)) if year is not None and str(year) in ys_ else len(years) // 2
        show = [j for j, key in enumerate(x['keys']) if not x['has_year'] or x['t'][j] == tsel][:15]  # items listed: base and drawn values
        items = np.zeros((vals.shape[0], len(show)))
        allv = np.zeros((vals.shape[0], len(x['keys'])))
        for kk in range(vals.shape[0]):
            v, _ = apply(sub, [d], kk)
            cur = v[x['param']]
            nv = np.array([cur[key] for key in x['keys']])
            allv[kk] = nv
            if show:
                items[kk] = nv[show]
            vals[kk] = np.bincount(np.where(x['t'] >= 0, x['t'], 0), weights=nv, minlength=len(years))
        basev = np.bincount(np.where(x['t'] >= 0, x['t'], 0), weights=x['base'], minlength=len(years))
        cnt = np.bincount(np.where(x['t'] >= 0, x['t'], 0), minlength=len(years))
        if agg_mean:
            vals = vals / np.maximum(cnt, 1)
            basev = basev / np.maximum(cnt, 1)
        q = np.percentile(vals, [5, 25, 50, 75, 95], axis=0)
        info['values'] = {
            'how': 'mean of the selected values' if agg_mean else 'sum of the selected values',
            'base': basev.tolist(),
            'p5': q[0].tolist(),
            'p25': q[1].tolist(),
            'p50': q[2].tolist(),
            'p75': q[3].tolist(),
            'p95': q[4].tolist(),
            'has_year': x['has_year'],
        }
        ys = [str(y) for y in years]
        tm = (
            ys.index(str(year)) if year is not None and str(year) in ys else len(years) // 2
        )  # the year shown (chosen, else the middle one)
        ti = tm if x['has_year'] else 0  # the parameter itself: the year shown, or its only value(s)
        info['year'] = {
            'year': years[tm] if x['has_year'] else None,
            'base': float(basev[ti]),
            'values': vals[:, ti].tolist(),
            'p5': float(q[0][ti]),
            'p50': float(q[2][ti]),
            'p95': float(q[4][ti]),
            'how': 'mean' if agg_mean else 'sum',
            'n': int(cnt[ti]),
        }
        info['dims'] = x['dims']
        if fi_ in achieved:
            info['driverLink'] = achieved[fi_]
        if x['has_year']:  # each item (the key without the year) over the years: base and bands
            yi = x['dims'].index('YEAR') if 'YEAR' in x['dims'] else None
            lab = {}
            for j, key in enumerate(x['keys']):
                l_ = ' · '.join(str(c) for i_, c in enumerate(key) if i_ != yi)
                lab.setdefault(l_, []).append(j)
            order = sorted(lab, key=lambda l_: -float(np.abs(x['base'][lab[l_]]).sum()))[:60]
            ser = []
            for l_ in order:
                js = lab[l_]
                tt = np.where(x['t'][js] >= 0, x['t'][js], 0)
                M = np.full((allv.shape[0], len(years)), np.nan)
                B = np.full(len(years), np.nan)
                for j, t_ in zip(js, tt):
                    M[:, t_] = allv[:, j] if np.isnan(M[0, t_]) else M[:, t_] + allv[:, j]
                    B[t_] = x['base'][j] if np.isnan(B[t_]) else B[t_] + x['base'][j]
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore')
                    qq = np.nanpercentile(M, [5, 50, 95], axis=0) if np.isfinite(M).any() else np.full((3, len(years)), np.nan)
                cl = lambda a: [None if not np.isfinite(z) else float(z) for z in a]
                ser.append(
                    {'label': l_, 'base': cl(B), 'p5': cl(qq[0]), 'p50': cl(qq[1]), 'p95': cl(qq[2]), 'paths': [cl(r) for r in M[:6]]}
                )
            info['series'] = ser
            info['series_total'] = len(lab)
        info['items'] = [
            {
                'key': [str(k) for k in x['keys'][j]],
                'base': float(x['base'][j]),
                'p5': float(np.percentile(items[:, i], 5)),
                'p50': float(np.percentile(items[:, i], 50)),
                'p95': float(np.percentile(items[:, i], 95)),
            }
            for i, j in enumerate(show)
        ]
        if x['S'] > 1:  # time-slice groups in the year shown
            info['slices'] = {
                'year': years[tm],
                'names': x['slicegroups'],
                'p5': np.percentile(d[:, 0, tm, :], 5, 0).tolist(),
                'p50': np.percentile(d[:, 0, tm, :], 50, 0).tolist(),
                'p95': np.percentile(d[:, 0, tm, :], 95, 0).tolist(),
            }
        out['factors'].append(info)
    if only is None and len(F) > 1:
        out['achieved'] = {
            'names': [x['name'] for x in F],
            'spearman': np.nan_to_num(
                st.spearmanr(summ).correlation
                if len(F) > 2
                else np.array(
                    [[1, st.spearmanr(summ[:, 0], summ[:, 1]).correlation], [st.spearmanr(summ[:, 0], summ[:, 1]).correlation, 1]]
                )
            ).tolist(),
        }
    return out


def preview_links(design, model_txt, data_txt, n=200):
    import mc_links

    prep = prepare(design, model_txt, data_txt)
    draws, _, _ = generate(design, prep, n=n)
    return mc_links.preview_links(prep, draws, n)


# --------------------------------------------------------------------------- running
def read_solution(solver, path, duals=None):
    st_, obj, x = 'UNKNOWN', None, {}
    lines = open(path, encoding='utf-8', errors='ignore').read().splitlines()
    if solver == 'cbc':  # with -printingOptions all: rows block (name activity dual), then columns block
        h = lines[0] if lines else ''
        st_ = 'OPTIMAL' if h.lower().startswith('optimal') else h.split(' - ')[0].upper() or 'UNKNOWN'
        m = re.search(r'objective value\s+(-?[\d.eE+]+)', h)
        obj = float(m.group(1)) if m else None
        body = [ln.replace('**', ' ').split() for ln in lines[1:]]
        body = [t for t in body if len(t) >= 3]
        starts = [k for k, t in enumerate(body) if t[0] == '0']
        cut = starts[1] if len(starts) > 1 else 0
        for k, t in enumerate(body):
            if k < cut:
                if duals is not None and len(t) >= 4 and abs(float(t[3])) > 1e-12:
                    duals[t[1]] = float(t[3])
            elif abs(float(t[2])) > 1e-12:
                x[t[1]] = float(t[2])
    else:  # our format (HiGHS, GLPK, Gurobi through gurobi_run.py)
        for ln in lines:
            if ln.startswith('#status'):
                st_ = ln.split(None, 1)[1].strip()
            elif ln.startswith('#objective'):
                v_ = ln.split()[1]
                obj = None if v_ == 'None' else float(v_)
            elif ln and not ln.startswith('#'):
                n_, v = ln.rsplit(' ', 1)
                x[n_] = float(v)
    return st_, obj, x


def solve_one(work, model, data, solver, opts, log, want_duals=False):
    """build with GLPK and solve; -> (status, objective incl. constant, constant, {var: rows}); with want_duals the
    shadow prices go in the rows as DUAL.<constraint>"""
    mps, sol = os.path.join(work, 'p.mps'), os.path.join(work, 'sol.txt')
    const = 0.0
    run = lambda cmd: subprocess.run(cmd, cwd=work, stdout=log, stderr=subprocess.STDOUT, **NOWIN).returncode
    if solver == 'glpk':
        run(tool('solve_check') + [model, data, f'--glpk-solve={sol}', f"--method={opts.get('glpk_method', 'simplex')}"])
    else:
        rc = run(tool('solve_check') + [model, data, f'--write-mps={mps}'])
        if rc or not os.path.isfile(mps):
            return 'BUILD_FAILED', None, 0.0, {}
        const = float(open(mps + '.const').read() or 0) if os.path.isfile(mps + '.const') else 0.0
        if solver == 'highs':
            ho = {'output_flag': False}
            if opts.get('algorithm'):
                ho['solver'] = opts['algorithm']
            if opts.get('threads'):
                ho['threads'] = int(opts['threads'])
            if opts.get('time_limit'):
                ho['time_limit'] = float(opts['time_limit'])
            if opts.get('crossover'):
                ho['run_crossover'] = str(opts['crossover'])  # on / off / choose (interior point)
            if opts.get('presolve'):
                ho['presolve'] = str(opts['presolve'])
            if opts.get('mip_gap'):
                ho['mip_rel_gap'] = float(opts['mip_gap'])  # integer models (whole units)
            if opts.get('tolerance'):
                for k in ('primal_feasibility_tolerance', 'dual_feasibility_tolerance', 'ipm_optimality_tolerance'):
                    ho[k] = float(opts['tolerance'])
            run(tool('highs_run') + [mps, sol, json.dumps(ho)])
        elif solver == 'cbc':
            cmd = [opts['solver_path'], mps]
            if opts.get('time_limit'):
                cmd += ['-sec', str(opts['time_limit'])]
            run(cmd + ['-solve'] + (['-printingOptions', 'all'] if want_duals else []) + ['-solu', sol])
        elif solver == 'gurobi':  # gurobipy or gurobi_cl (solver_path), our solution format
            run(
                tool('gurobi_run')
                + [mps, sol, json.dumps({k: v for k, v in opts.items() if k != 'solver_path'}), opts.get('solver_path') or '']
            )
    if not os.path.isfile(sol):
        return 'NO_SOLUTION', None, const, {}
    dl = {} if want_duals else None
    st_, obj, x = read_solution(solver, sol, dl)
    if want_duals and os.path.isfile(sol + '.duals'):
        for ln in open(sol + '.duals', encoding='utf-8', errors='ignore'):
            if ln.strip():
                n_, v = ln.rsplit(' ', 1)
                dl[n_] = float(v)
    if solver == 'glpk':
        for ln in open(sol):
            if ln.startswith('#constant'):
                const = float(ln.split()[1])
                break
    res = defaultdict(list)
    for nm, v in x.items():
        m = re.match(r'^([A-Za-z_]\w*)\[(.*)\]$', nm)
        if m:
            res[m.group(1)].append(m.group(2).split(',') + [v])
    for nm, v in (dl or {}).items():
        m = re.match(r'^([A-Za-z_]\w*)\[(.*)\]$', nm)
        if m:
            res['DUAL.' + m.group(1)].append(m.group(2).split(',') + [v])
        elif re.match(r'^[A-Za-z_]\w*$', nm):
            res['DUAL.' + nm].append([v])
    for f in os.listdir(work):
        if f.startswith('p.mps') or f.startswith('sol.txt'):
            os.remove(os.path.join(work, f))
    return st_.upper(), obj, const, dict(res)


def _read_json(p):
    """a JSON file of a run: {} if missing, or if it cannot be read after a few tries (left empty by an interruption)"""
    if not os.path.isfile(p):
        return {}
    for _ in range(3):
        try:
            return json.load(open(p))
        except (ValueError, OSError):
            time.sleep(0.05)
    return {}


def status(d, **kw):
    p = os.path.join(d, 'status.json')
    s = _read_json(p)
    s.update(kw)
    tmp = p + f'.{os.getpid()}.{threading.get_ident()}.tmp'  # one file per writer: the server and the engine may write at once
    with open(tmp, 'w') as f:
        json.dump(s, f, indent=1)
        f.flush()
        os.fsync(f.fileno())  # on disk before the switch: an interruption leaves the old status or the new one, never an empty file
    os.replace(tmp, p)
    return s


def run(mc_dir):
    D = json.load(open(os.path.join(mc_dir, 'design.json')))
    model = os.path.join(mc_dir, 'model.txt')
    data = os.path.join(mc_dir, 'data.txt')
    mt, dt = open(model, encoding='utf-8', errors='ignore').read(), open(data, encoding='utf-8', errors='ignore').read()
    logf = open(os.path.join(mc_dir, 'log.txt'), 'a', encoding='utf-8')

    def log(m):
        logf.write(time.strftime('%H:%M:%S ') + m + '\n')
        logf.flush()

    t0 = time.time()
    status(mc_dir, state='running', stage='preparing the samples', started=time.strftime('%Y-%m-%d %H:%M:%S'))
    try:
        prep = prepare(D, mt, dt)
        n = int(D['sampling']['n'])
        draws, summ, repaired = generate(D, prep, n=n)
        np.save(os.path.join(mc_dir, 'factor_summary.npy'), summ)
        json.dump(
            {'names': [x['name'] for x in prep['factors']], 'params': [x['param'] for x in prep['factors']], 'repaired': repaired},
            open(os.path.join(mc_dir, 'factors.json'), 'w'),
        )
        log(
            f'{n} samples, {len(prep["factors"])} factors' + (' (correlation matrix repaired to the nearest valid one)' if repaired else '')
        )
        spans = param_spans(dt)
        os.makedirs(os.path.join(mc_dir, 'samples'), exist_ok=True)
        outs = set(
            D.get('outputs')
            or ['TotalCapacityAnnual', 'NewCapacity', 'ProductionByTechnologyAnnual', 'AnnualEmissions', 'CapitalInvestment']
        )
        import derived as DV

        need_derived = bool(outs & set(DV.DERIVED_DIMS))
        want_duals = any(v.startswith('DUAL.') for v in outs)
        if want_duals and D['solver'] == 'gurobi':
            log('Gurobi: shadow prices are not read from its solution file; DUAL outputs will be empty')
        done = {'n': 0, 'ok': 0}
        lock = threading.Lock()
        stop = os.path.join(mc_dir, 'STOP')

        def one(k):
            if os.path.exists(stop):
                return
            sf = os.path.join(mc_dir, 'samples', f'{k:05d}.json')
            if os.path.isfile(sf):
                with lock:
                    done['n'] += 1
                    done['ok'] += 1
                return
            work = tempfile.mkdtemp(prefix=f'mc{k}_')
            try:
                vals, notes = apply(prep, draws, k)
                dp = os.path.join(work, 'data.txt')
                write_sample(dt, vals, prep, dp, spans)
                with open(os.path.join(work, 'log.txt'), 'w') as lg:
                    s_, obj, const, res = solve_one(work, model, dp, D['solver'], D.get('options', {}), lg, want_duals)
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
                with lock:
                    done['n'] += 1
                    done['ok'] += s_ == 'OPTIMAL'
                    el = time.time() - t0
                    status(
                        mc_dir,
                        done=done['n'],
                        ok=done['ok'],
                        stage=f'solving: {done["n"]} / {n}',
                        eta=round(el / done['n'] * (n - done['n'])),
                        elapsed=round(el),
                    )
                log(
                    f'sample {k + 1}: {s_}'
                    + (f', objective {obj:,.4f}' if obj is not None else '')
                    + (f' ({"; ".join(notes)})' if notes else '')
                )
            except LinkCheck as e:  # reported, not solved
                rec = {'k': k, 'status': 'CHECK_FAILED', 'objective': None, 'constant': 0.0, 'notes': [str(e)], 'outputs': {}}
                json.dump(rec, open(sf + '.tmp', 'w'))
                os.replace(sf + '.tmp', sf)
                log(f'sample {k + 1}: not solved - a linked value breaks its check: {e}')
                with lock:
                    done['n'] += 1
            except Exception as e:
                log(f'sample {k + 1}: ERROR {e}')
                with lock:
                    done['n'] += 1
            finally:
                shutil.rmtree(work, ignore_errors=True)

        status(mc_dir, stage=f'solving: 0 / {n}', done=0, ok=0, total=n)
        with ThreadPoolExecutor(max_workers=max(1, int(D.get('workers', 2)))) as ex:
            list(ex.map(one, range(n)))
        st_ = 'stopped' if os.path.exists(stop) else 'done'
        status(mc_dir, state=st_, stage=st_, elapsed=round(time.time() - t0), done=done['n'], ok=done['ok'])
        log(f'{st_}: {done["ok"]} optimal of {done["n"]} in {time.time() - t0:.0f} s')
    except Exception as e:
        import traceback

        log('FAILED: ' + traceback.format_exc())
        status(mc_dir, state='failed', stage='failed', error=str(e))


# --------------------------------------------------------------------------- results
_CACHE = {}


def load_samples(mc_dir):
    files = (
        sorted(f for f in os.listdir(os.path.join(mc_dir, 'samples')) if f.endswith('.json'))
        if os.path.isdir(os.path.join(mc_dir, 'samples'))
        else []
    )
    key = (mc_dir, len(files))
    if key not in _CACHE:
        _CACHE.clear()
        _CACHE[key] = [json.load(open(os.path.join(mc_dir, 'samples', f))) for f in files]
    return _CACHE[key]


def out_dims(mc_dir, var, n0):
    """index sets of a kept result: a variable of the model, a derived result (as MUIO) or DUAL.<constraint>"""
    mt = open(os.path.join(mc_dir, 'model.txt'), encoding='utf-8', errors='ignore').read()
    md = cons_dims(mt) if var.startswith('DUAL.') else var_dims(mt)
    key = var[5:] if var.startswith('DUAL.') else var
    if md.get(key) and len(md[key]) == n0:
        return md[key]
    if DERIVED_DIMS.get(var) and len(DERIVED_DIMS[var]) == n0:
        return DERIVED_DIMS[var]
    return [f'index {i + 1}' for i in range(n0)]


def aggregate(mc_dir, var, by='YEAR', filters=None, divide=1.0, run_dims=None):
    """per optimal sample: the variable summed over everything except `by` (after filters) -> bands, histogram data, VaR / CVaR,
    rank correlation of each factor with the output (total over `by`)"""
    S = [s for s in load_samples(mc_dir) if s['status'] == 'OPTIMAL']
    fac = json.load(open(os.path.join(mc_dir, 'factors.json'))) if os.path.isfile(os.path.join(mc_dir, 'factors.json')) else {'names': []}
    summ = np.load(os.path.join(mc_dir, 'factor_summary.npy')) if os.path.isfile(os.path.join(mc_dir, 'factor_summary.npy')) else None
    if var == 'Objective':
        y = np.array([s['objective'] for s in S], float) / divide
        members = ['total']
        M = y[:, None]
        dims = []
    else:
        dims = out_dims(mc_dir, var, next((len(s['outputs'][var][0]) - 1 for s in S if s['outputs'].get(var)), 0))
        bi = dims.index(by) if by in dims else None
        flt = {dims.index(k): set(map(str, v)) for k, v in (filters or {}).items() if k in dims and v}
        mem = set()
        for s in S:
            for r in s['outputs'].get(var, []):
                mem.add(r[bi] if bi is not None else 'total')
        members = sorted(mem, key=lambda a: (0, float(a)) if re.match(r'^-?\d+(\.\d+)?$', a) else (1, a))
        ix = {m: i for i, m in enumerate(members)}
        M = np.zeros((len(S), max(1, len(members))))
        for a, s in enumerate(S):
            for r in s['outputs'].get(var, []):
                if all(r[i] in v for i, v in flt.items()):
                    M[a, ix[r[bi]] if bi is not None else 0] += r[-1] / divide
        y = M.sum(1)
    out = {'var': var, 'by': by, 'dims': dims, 'members': members, 'n': len(S), 'total_samples': len(load_samples(mc_dir))}
    if not len(S):
        return out
    P = [1, 5, 10, 25, 50, 75, 90, 95, 99]
    q = np.percentile(M, P, axis=0)
    out['bands'] = {str(p): q[i].tolist() for i, p in enumerate(P)}
    out['mean'] = M.mean(0).tolist()
    out['sd'] = M.std(0, ddof=1).tolist() if len(S) > 1 else [0] * M.shape[1]
    out['paths'] = M.tolist()
    out['totals'] = y.tolist()
    srt = np.sort(y)
    a95 = max(1, int(math.ceil(0.05 * len(srt))))
    out['risk'] = {
        'mean': float(y.mean()),
        'sd': float(y.std(ddof=1)) if len(y) > 1 else 0.0,
        'p5': float(np.percentile(y, 5)),
        'p50': float(np.percentile(y, 50)),
        'p95': float(np.percentile(y, 95)),
        'VaR95': float(np.percentile(y, 95)),
        'CVaR95': float(srt[-a95:].mean()),
        'VaR95_low': float(np.percentile(y, 5)),
        'CVaR95_low': float(srt[:a95].mean()),
        'min': float(srt[0]),
        'max': float(srt[-1]),
    }
    if summ is not None and len(fac.get('names', [])):
        ks = [s['k'] for s in S]
        X = summ[ks]
        out['sensitivity'] = [
            {
                'factor': nm,
                'spearman': float(np.nan_to_num(st.spearmanr(X[:, i], y).correlation)) if np.std(X[:, i]) > 0 and np.std(y) > 0 else 0.0,
            }
            for i, nm in enumerate(fac['names'])
        ]
        out['factor_values'] = X.tolist()
    return out


# --------------------------------------------------------------------------- exploring the results
_GEN = {}


def regen(mc_dir):
    """the design, prepared factors and draws of a run, made again (same seed = the same draws as the run)"""
    dp = os.path.join(mc_dir, 'design.json')
    key = (mc_dir, os.path.getmtime(dp))
    if key not in _GEN:
        D = json.load(open(dp))
        mt = open(os.path.join(mc_dir, 'model.txt'), encoding='utf-8', errors='ignore').read()
        dt = open(os.path.join(mc_dir, 'data.txt'), encoding='utf-8', errors='ignore').read()
        prep = prepare(D, mt, dt)
        draws, _, _ = generate(D, prep, n=int(D['sampling']['n']))
        _GEN.clear()
        _GEN[key] = (D, prep, draws)
    return _GEN[key]


def _item_label(x, key):
    yi = x['dims'].index('YEAR') if 'YEAR' in x['dims'] else None
    return ' · '.join(str(c) for i, c in enumerate(key) if i != yi)


def input_catalog(mc_dir):
    """the uncertain parameters of a run: their items (key without the year) and years, to pick an input for the scatter"""
    D, prep, draws = regen(mc_dir)
    out = []
    for i, x in enumerate(prep['factors']):
        its = {}
        for j, key in enumerate(x['keys']):
            its[_item_label(x, key)] = its.get(_item_label(x, key), 0) + abs(float(x['base'][j]))
        out.append(
            {
                'index': i,
                'name': x['name'],
                'param': x['param'],
                'dims': x['dims'],
                'has_year': x['has_year'],
                'years': prep['years'] if x['has_year'] else [],
                'items': sorted(its, key=lambda l: -its[l])[:500],
                'n_items': len(its),
            }
        )
    return out


def input_values(mc_dir, fi, item=None, year=None, ks=None):
    """per sample: the value of uncertain parameter fi (one item or all, one year or all; sum, or mean for ratios / costs), and its mean draw"""
    D, prep, draws = regen(mc_dir)
    x = prep['factors'][int(fi)]
    d = draws[int(fi)]
    years = [str(y) for y in prep['years']]
    m = np.ones(len(x['keys']), bool)
    if item:
        m &= np.array([_item_label(x, k) == item for k in x['keys']])
    if year not in (None, '', 'all') and x['has_year']:
        m &= (x['t'] == years.index(str(year))) if str(year) in years else np.zeros(len(m), bool)
    if not m.any():
        return {'error': 'no value of this parameter for that item / year', 'values': []}
    sub = dict(x)
    sub.update(
        {
            'keys': [k for k, b in zip(x['keys'], m) if b],
            'base': x['base'][m],
            'g': x['g'][m],
            't': x['t'][m],
            's': x['s'][m],
            'renorm': None,
        }
    )
    agg_mean = bool(re.search(r'Factor|Ratio|Profile|Rate|Life|Split|Cost|Price|Penalty', x['param']))
    ks = list(range(d.shape[0])) if ks is None else [int(k) for k in ks]
    vals, mult = [], []
    for k in ks:
        v, _ = apply({'factors': [sub], 'params': prep['params']}, [d], k)
        nv = np.array([v[x['param']][kk] for kk in sub['keys']])
        vals.append(float(nv.mean() if agg_mean else nv.sum()))
        tt = np.where(sub['t'] >= 0, sub['t'], 0)
        mult.append(float(d[k][sub['g'], tt, sub['s']].mean()))
    b = sub['base']
    return {
        'values': vals,
        'multiplier': mult,
        'base': float(b.mean() if agg_mean else b.sum()),
        'how': 'mean' if agg_mean else 'sum',
        'n_values': int(m.sum()),
        'param': x['param'],
        'name': x['name'],
    }


def _num_sort(a):
    return (0, float(a)) if re.match(r'^-?\d+(\.\d+)?$', str(a)) else (1, str(a))


def explore(mc_dir, var, filters=None, divide=1.0, along='YEAR', focus='sum', breakdown=None, maxpaths=None, keep=None, bmax=None):
    # every sample's path (no cap) and every member of a split unless bmax is given
    """everything the results view draws, per optimal sample:
    along     paths of the result along a set (YEAR: spaghetti), every sample; bands from all samples
    focus     the number each sample gives: 'sum' of all years, 'mean' per year, or one year -> distribution, exceedance, risk
    breakdown the focus number split by the members of a set (box plots)
    and the rank correlation of each uncertain parameter with the focus number"""
    S = [s for s in load_samples(mc_dir) if s['status'] == 'OPTIMAL']
    divide = float(divide or 1)
    if keep is not None:
        kp = set(int(k) for k in keep)
        S = [s for s in S if s['k'] in kp]
    out = {
        'var': var,
        'n': len(S),
        'total_samples': len(load_samples(mc_dir)),
        'ks': [s['k'] for s in S],
        'objectives': [s.get('objective') for s in S],
    }
    if var == 'Objective':
        y = np.array([s['objective'] for s in S], float) / divide
        dims = []
        out.update({'dims': [], 'along': None, 'members': [], 'years': [], 'focus': 'total'})
        A = None
        Bk = None
    else:
        dims = out_dims(mc_dir, var, next((len(s['outputs'][var][0]) - 1 for s in S if s['outputs'].get(var)), 0))
        out['dims'] = dims
        yi = dims.index('YEAR') if 'YEAR' in dims else None
        ai = dims.index(along) if along in dims else None
        bi = dims.index(breakdown) if breakdown in dims and breakdown != along else None
        flt = {dims.index(k): set(map(str, v)) for k, v in (filters or {}).items() if k in dims and v is not None}
        if any(not v for v in flt.values()):
            return dict(out, error='nothing selected in ' + next(dims[i] for i, v in flt.items() if not v))
        rows_all = [[r for r in s['outputs'].get(var, []) if all(r[i] in v for i, v in flt.items())] for s in S]
        yrs = sorted({r[yi] for rr in rows_all for r in rr}, key=_num_sort) if yi is not None else []
        if yi is None or focus in ('sum', 'mean', None, ''):
            fy = None
        else:
            fy = str(focus)
        out['years'] = yrs
        out['focus'] = fy or (focus if yi is not None else 'total')
        out['along'] = dims[ai] if ai is not None else None
        amem = sorted({r[ai] for rr in rows_all for r in rr}, key=_num_sort) if ai is not None else []
        aix = {m: i for i, m in enumerate(amem)}
        bmem = sorted({r[bi] for rr in rows_all for r in rr}, key=_num_sort) if bi is not None else []
        bix = {m: i for i, m in enumerate(bmem)}
        A = np.zeros((len(S), max(1, len(amem))))
        Bk = np.zeros((len(S), max(1, len(bmem))))
        y = np.zeros(len(S))
        for a, rr in enumerate(rows_all):
            for r in rr:
                v = r[-1] / divide
                inf = fy is None or r[yi] == fy
                if ai is not None and (inf or ai == yi):
                    A[a, aix[r[ai]]] += v
                if inf:
                    y[a] += v
                    if bi is not None:
                        Bk[a, bix[r[bi]]] += v
        if focus == 'mean' and yi is not None and yrs:
            y = y / len(yrs)
            Bk = Bk / len(yrs)
        out['members'] = amem
        out['bmembers'] = bmem
    if not len(S):
        return out
    P = [1, 5, 10, 25, 50, 75, 90, 95, 99]
    if A is not None and out.get('members'):
        q = np.percentile(A, P, axis=0)
        out['bands'] = {str(p): q[i].tolist() for i, p in enumerate(P)}
        out['mean'] = A.mean(0).tolist()
        out['sd'] = A.std(0, ddof=1).tolist() if len(S) > 1 else [0] * A.shape[1]
        out['paths'] = (A if not maxpaths else A[:maxpaths]).tolist()
    if Bk is not None and out.get('bmembers'):
        order = np.argsort(-np.abs(Bk.mean(0)))[: (int(bmax) if bmax else None)]
        qb = np.percentile(Bk[:, order], [5, 25, 50, 75, 95], axis=0)
        out['breakdown'] = {
            'set': breakdown,
            'members': [out['bmembers'][i] for i in order],
            'p5': qb[0].tolist(),
            'p25': qb[1].tolist(),
            'p50': qb[2].tolist(),
            'p75': qb[3].tolist(),
            'p95': qb[4].tolist(),
            'mean': Bk[:, order].mean(0).tolist(),
            'values': (Bk if not maxpaths else Bk[:maxpaths])[:, order].T.tolist(),
            'total_members': len(out['bmembers']),
        }
    srt = np.sort(y)
    a95 = max(1, int(math.ceil(0.05 * len(srt))))
    out['totals'] = y.tolist()
    out['percentiles'] = {str(p): float(np.percentile(y, p)) for p in P}
    out['risk'] = {
        'mean': float(y.mean()),
        'sd': float(y.std(ddof=1)) if len(y) > 1 else 0.0,
        'cv': float(y.std(ddof=1) / abs(y.mean())) if len(y) > 1 and y.mean() else 0.0,
        'p5': float(np.percentile(y, 5)),
        'p50': float(np.percentile(y, 50)),
        'p95': float(np.percentile(y, 95)),
        'VaR95': float(np.percentile(y, 95)),
        'CVaR95': float(srt[-a95:].mean()),
        'VaR95_low': float(np.percentile(y, 5)),
        'CVaR95_low': float(srt[:a95].mean()),
        'min': float(srt[0]),
        'max': float(srt[-1]),
    }
    fac = json.load(open(os.path.join(mc_dir, 'factors.json'))) if os.path.isfile(os.path.join(mc_dir, 'factors.json')) else {'names': []}
    summ = np.load(os.path.join(mc_dir, 'factor_summary.npy')) if os.path.isfile(os.path.join(mc_dir, 'factor_summary.npy')) else None
    if summ is not None and len(fac.get('names', [])):
        X = summ[out['ks']]
        out['factor_values'] = X.tolist()
        out['factor_names'] = fac['names']
        out['sensitivity'] = [
            {
                'factor': nm,
                'index': i,
                'spearman': float(np.nan_to_num(st.spearmanr(X[:, i], y).correlation)) if np.std(X[:, i]) > 0 and np.std(y) > 0 else 0.0,
            }
            for i, nm in enumerate(fac['names'])
        ]
    return out


# --------------------------------------------------------------------------- full extraction
def export_full(mc_dir, out_zip, wide=False, inputs=True, outputs=True, stats=True, log=None):
    """every sample of a run, organised to be read outside the Studio (R, Python, Excel), in a zip of CSV files:
    run.csv, factors.csv, inputs/ (the values each uncertain parameter took, by sample, item and year),
    outputs/ (objective and every result kept, by sample and index), statistics/ (mean, sd, percentiles over the samples).
    Every table starts with: case, mc_run, base_scenarios, sample  (so several runs or cases can be stacked).
    wide=True: years as columns (one line per sample and item) instead of one value per line."""
    import csv, io, zipfile

    meta = _read_json(os.path.join(mc_dir, 'meta.json'))
    D = json.load(open(os.path.join(mc_dir, 'design.json')))
    st_ = _read_json(os.path.join(mc_dir, 'status.json'))
    run_id = os.path.basename(mc_dir)
    case = meta.get('case') or ''
    scen = ' + '.join(meta.get('scenarios') or []) or 'base'
    KEY = ['case', 'mc_run', 'base_scenarios', 'sample']
    key = lambda k: [case, run_id, scen, k + 1]
    S = load_samples(mc_dir)
    ok = [s for s in S if s['status'] == 'OPTIMAL']
    z = zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=6)
    files = []

    def table(name, header, rows):
        with z.open(name, 'w') as fb:
            f = io.TextIOWrapper(fb, encoding='utf-8', newline='')
            w = csv.writer(f)
            w.writerow(header)
            n = 0
            for r in rows:
                w.writerow(r)
                n += 1
            f.flush()
            f.detach()
        files.append((name, n))
        log and log(f'{name}: {n} lines')

    table(
        'run.csv',
        ['item', 'value'],
        [
            ['case', case],
            ['mc_run', run_id],
            ['name', meta.get('name', '')],
            ['base_scenarios', scen],
            ['model', meta.get('model_name', '')],
            ['solver', D.get('solver', '')],
            ['samples', D['sampling'].get('n')],
            ['method', D['sampling'].get('method')],
            ['seed', D['sampling'].get('seed')],
            ['optimal_samples', len(ok)],
            ['created', meta.get('created', '')],
            ['state', st_.get('state', '')],
            ['results_kept', ' '.join(D.get('outputs') or [])],
        ],
    )
    table(
        'factors.csv',
        [
            'factor_id',
            'name',
            'parameter',
            'enabled',
            'distribution',
            'distribution_parameters',
            'truncation',
            'applied_as',
            'over_time',
            'time_settings',
            'draws',
            'selection',
        ],
        [
            [
                f.get('id'),
                f.get('name'),
                f.get('param'),
                f.get('enabled', True),
                (f.get('dist') or {}).get('key'),
                json.dumps((f.get('dist') or {}).get('params', {})),
                json.dumps((f.get('dist') or {}).get('trunc')),
                'multiplier' if (f.get('time') or {}).get('kind') in ('sde', 'growth') else f.get('mode', 'mult'),
                (f.get('time') or {}).get('kind', 'static'),
                json.dumps({k: v for k, v in (f.get('time') or {}).items() if k != 'kind'}),
                f.get('scope'),
                json.dumps(f.get('select') or {}),
            ]
            for f in D['factors']
        ],
    )
    if inputs:
        Dd, prep, draws = regen(mc_dir)
        years = [str(y) for y in prep['years']]
        ks = [s['k'] for s in S]
        names = [x['name'] for x in prep['factors']]
        summ = np.load(os.path.join(mc_dir, 'factor_summary.npy')) if os.path.isfile(os.path.join(mc_dir, 'factor_summary.npy')) else None
        if summ is not None:
            table(
                'inputs/draws_by_sample.csv',
                KEY + ['status'] + [f'mean draw: {n}' for n in names],
                (key(s['k']) + [s['status']] + [float(v) for v in summ[s['k']]] for s in S),
            )
        for fi, (x, d) in enumerate(zip(prep['factors'], draws)):
            dims = [dd if dd != 'FUEL' else 'COMMODITY' for dd in x['dims']]
            yi = dims.index('YEAR') if 'YEAR' in dims else None
            sub = {'factors': [x], 'params': prep['params']}
            fid = re.sub(r'[^\w-]+', '_', f"{x['f'].get('id', fi)}_{x['param']}")
            tt = np.where(x['t'] >= 0, x['t'], 0)

            def vals(k):
                v, _ = apply(sub, [d], k)
                cur = v[x['param']]
                return [cur[kk] for kk in x['keys']], d[k][x['g'], tt, x['s']]

            if wide and yi is not None:
                items = {}
                [
                    items.setdefault(tuple(c for i, c in enumerate(kk) if i != yi), {}).__setitem__(kk[yi], j)
                    for j, kk in enumerate(x['keys'])
                ]
                hdr = KEY + ['factor', 'parameter'] + [dd for i, dd in enumerate(dims) if i != yi] + ['what'] + years

                def gen():
                    for it, yj in items.items():
                        yield [case, run_id, scen, 'base', x['name'], x['param'], *it, 'value'] + [
                            float(x['base'][yj[y]]) if y in yj else '' for y in years
                        ]
                    for k in ks:
                        nv, mult = vals(k)
                        for it, yj in items.items():
                            yield key(k) + [x['name'], x['param'], *it, 'value'] + [float(nv[yj[y]]) if y in yj else '' for y in years]
                            yield key(k) + [x['name'], x['param'], *it, 'multiplier'] + [
                                float(mult[yj[y]]) if y in yj else '' for y in years
                            ]

                table(f'inputs/{fid}.csv', hdr, gen())
            else:
                hdr = KEY + ['factor', 'parameter'] + dims + ['base', 'value', 'multiplier']

                def gen():
                    for k in ks:
                        nv, mult = vals(k)
                        for j, kk in enumerate(x['keys']):
                            yield key(k) + [x['name'], x['param'], *kk, float(x['base'][j]), float(nv[j]), float(mult[j])]

                table(f'inputs/{fid}.csv', hdr, gen())
    if outputs or stats:
        table(
            'outputs/objective.csv',
            KEY + ['status', 'objective_full', 'constant_part', 'objective_as_muio'],
            (
                key(s['k'])
                + [
                    s['status'],
                    s.get('objective'),
                    s.get('constant', 0.0),
                    (s['objective'] - (s.get('constant') or 0.0)) if s.get('objective') is not None else '',
                ]
                for s in S
            ),
        )
        allv = sorted({v for s in S for v in (s.get('outputs') or {})})
        for v in allv:
            n0 = next((len(s['outputs'][v][0]) - 1 for s in ok if s['outputs'].get(v)), 0)
            dims = out_dims(mc_dir, v, n0)
            yi = dims.index('YEAR') if 'YEAR' in dims else None
            fn = re.sub(r'[^\w.-]+', '_', v)
            if outputs:
                if wide and yi is not None:
                    hdr = KEY + [dd for i, dd in enumerate(dims) if i != yi]
                    yrs = sorted(
                        {r[yi] for s in ok[:20] for r in s['outputs'].get(v, [])},
                        key=lambda a: float(a) if re.match(r'^-?\d+(\.\d+)?$', a) else 0,
                    )

                    def gen(v=v, yi=yi, yrs=yrs):
                        for s in ok:
                            m = {}
                            for r in s['outputs'].get(v, []):
                                m.setdefault(tuple(c for i, c in enumerate(r[:-1]) if i != yi), {})[r[yi]] = r[-1]
                            for it, ym in m.items():
                                yield key(s['k']) + list(it) + [ym.get(y, 0.0) for y in yrs]

                    table(f'outputs/{fn}.csv', hdr + yrs, gen())
                else:
                    table(f'outputs/{fn}.csv', KEY + dims + ['value'], (key(s['k']) + list(r) for s in ok for r in s['outputs'].get(v, [])))
            if stats and ok:
                acc = {}
                for a, s in enumerate(ok):
                    for r in s['outputs'].get(v, []):
                        acc.setdefault(tuple(r[:-1]), {})[a] = r[-1]
                P = [5, 25, 50, 75, 95]

                def gen(acc=acc):
                    for idx, m in acc.items():
                        arr = np.array([m.get(a, 0.0) for a in range(len(ok))], float)
                        q = np.percentile(arr, P)
                        yield list(idx) + [
                            len(ok),
                            float(arr.mean()),
                            float(arr.std(ddof=1)) if len(arr) > 1 else 0.0,
                            float(arr.min()),
                            *map(float, q),
                            float(arr.max()),
                        ]

                table(f'statistics/{fn}.csv', dims + ['samples', 'mean', 'sd', 'min'] + [f'p{p}' for p in P] + ['max'], gen())
    readme = f"""Nour OSeMOSYS Studio - Monte Carlo run {run_id} (case {case or '-'}, base {scen}), {len(S)} samples ({len(ok)} optimal)
Every table starts with: case, mc_run, base_scenarios, sample  -> tables of several runs or cases can be stacked.
Layout: {'wide: the years are columns (one line per sample and item)' if wide else 'long: one value per line (YEAR is a column)'}.
run.csv              the run: case, model, solver, sampling method, seed, results kept
factors.csv          the uncertain parameters: distribution and its parameters, over time, draws, selection
inputs/draws_by_sample.csv   per sample, the mean draw of each uncertain parameter (the X of the sensitivity)
inputs/<factor>_<parameter>.csv   per sample, item and year: base value, value used in the sample, multiplier (draw)
                     (wide layout: a 'base' line per item, then per sample a 'value' and a 'multiplier' line)
outputs/objective.csv   per sample: status, objective (full), its constant part, the objective as MUIO shows it
outputs/<variable>.csv  per sample: the index sets of the result (REGION, TECHNOLOGY, ..., YEAR) and the value
                     (shadow prices: DUAL.<constraint>; only optimal samples; zeros are not written by the solvers)
statistics/<variable>.csv  per index: samples, mean, sd, min, p5, p25, p50, p75, p95, max over the optimal samples
                     (a missing value in a sample counts as 0)
Files: """ + ', '.join(f'{n} ({c} lines)' for n, c in files)
    z.writestr('README.txt', readme)
    z.close()
    return {'ok': True, 'path': out_zip, 'size': os.path.getsize(out_zip), 'files': files}


def cube(mc_dir, var, filters=None, divide=1.0, by='TECHNOLOGY', mode='bands', ks=None, keep=None, thr=None, top=None, paths=None):
    # every member and every sample's path unless limits are asked (top, paths)
    """a result split by a set and the years, over the samples:
    mode 'bands'   per member and year: p5 p25 p50 p75 p95, mean, and a few sample paths   (small multiples)
    mode 'samples' per member and year, the values of the samples ks                      (mix at percentiles)
    mode 'prob'    per member and year, the share of samples where the value is above thr (probability map)"""
    S = [s for s in load_samples(mc_dir) if s['status'] == 'OPTIMAL']
    divide = float(divide or 1)
    if keep is not None:
        kp = set(int(k) for k in keep)
        S = [s for s in S if s['k'] in kp]
    if not S or var == 'Objective':
        return {'error': 'no sample' if not S else 'the objective has no members', 'n': len(S)}
    dims = out_dims(mc_dir, var, next((len(s['outputs'][var][0]) - 1 for s in S if s['outputs'].get(var)), 0))
    yi = dims.index('YEAR') if 'YEAR' in dims else None
    bi = dims.index(by) if by in dims else None
    if yi is None:
        return {'error': f'{var} has no YEAR', 'dims': dims}
    flt = {dims.index(k): set(map(str, v)) for k, v in (filters or {}).items() if k in dims and v is not None}
    years = sorted({r[yi] for s in S for r in s['outputs'].get(var, [])}, key=_num_sort)
    mem = sorted(
        {(r[bi] if bi is not None else 'total') for s in S for r in s['outputs'].get(var, []) if all(r[i] in v for i, v in flt.items())},
        key=_num_sort,
    )
    yx, mx = {y: i for i, y in enumerate(years)}, {m: i for i, m in enumerate(mem)}
    C = np.zeros((len(S), len(mem), len(years)))
    for a, s in enumerate(S):
        for r in s['outputs'].get(var, []):
            if r[yi] in yx and all(r[i] in v for i, v in flt.items()):
                C[a, mx[r[bi] if bi is not None else 'total'], yx[r[yi]]] += r[-1] / divide
    order = list(np.argsort(-np.abs(C).mean(axis=(0, 2))))[: (int(top) if top else None)]
    members = [mem[i] for i in order]
    C = C[:, order, :]
    out = {
        'var': var,
        'by': by if bi is not None else None,
        'dims': dims,
        'years': years,
        'members': members,
        'total_members': len(mem),
        'n': len(S),
        'ks': [s['k'] for s in S],
    }
    if mode == 'bands':
        q = np.percentile(C, [5, 25, 50, 75, 95], axis=0)
        out.update(
            {
                'p5': q[0].tolist(),
                'p25': q[1].tolist(),
                'p50': q[2].tolist(),
                'p75': q[3].tolist(),
                'p95': q[4].tolist(),
                'mean': C.mean(0).tolist(),
                'paths': (C if not paths else C[: int(paths)]).transpose(1, 0, 2).tolist(),
            }
        )
    elif mode == 'samples':
        idx = {s['k']: a for a, s in enumerate(S)}
        want = [int(k) for k in (ks or []) if int(k) in idx]
        out.update({'samples': want, 'values': [C[idx[k]].tolist() for k in want]})
    elif mode == 'prob':
        t = float(thr if thr not in (None, '') else 1e-6)
        out.update({'thr': t, 'prob': (C > t).mean(0).tolist(), 'mean': C.mean(0).tolist(), 'p50': np.percentile(C, 50, axis=0).tolist()})
    return out


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'run':
        run(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'detect':
        print(json.dumps(detect(open(sys.argv[2]).read(), open(sys.argv[3]).read()), indent=1)[:4000])
    else:
        print(__doc__)
