"""Derived results of a run, computed after the solve as MUIO does (for model files that do not output them).

From the run's data file, model file and solution:
  ProductionByTechnology[r,l,t,f,y]        = sum_m RateOfActivity[r,l,t,m,y] * OutputActivityRatio[r,t,f,m,y] * YearSplit[l,y]
  ProductionByTechnologyByMode[r,t,m,f,y]  = sum_l ...            ProductionByTechnologyAnnual[r,t,f,y] = sum_l,m ...
  UseByTechnology / ...ByMode / ...Annual   the same with InputActivityRatio
  ProductionByTechnologyByModeTs, RateOfProductionByTechnologyByMode (and Use...) by time slice and mode, as MUIO
  CapitalInvestment = CapitalCost x NewCapacity; AnnualizedInvestmentCost as MUIO (CRF of DiscountRateIdv, last OL years)
  TotalStorageCapacity = AccumulatedNewStorageCapacity + ResidualStorageCapacity
  AnnualTechnologyEmissionByMode[r,t,e,m,y] = sum_l RateOfActivity * EmissionActivityRatio * YearSplit
  AnnualTechnologyEmission[r,t,e,y], AnnualEmissions[r,e,y]
  TotalAnnualTechnologyActivityByMode[r,t,m,y], TotalTechnologyAnnualActivity[r,t,y]
  Demand[r,l,f,y] = SpecifiedAnnualDemand[r,f,y] * SpecifiedDemandProfile[r,f,l,y]
A variable is derived only when the solution does not already contain it. Ratios indexed by time slice (extended models,
e.g. OutputActivityRatio[r,l,t,f,m,y]) are used slice by slice. Also: var_dims(model) = index sets of every variable.
"""

import json, os, re, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from muio_bridge import parse_data, model_dims

BASE = [
    'TECHNOLOGY',
    'COMMODITY',
    'FUEL',
    'EMISSION',
    'STORAGE',
    'REGION',
    'YEAR',
    'TIMESLICE',
    'MODE_OF_OPERATION',
    'SEASON',
    'DAYTYPE',
    'DAILYTIMEBRACKET',
    'UDC',
]


def base_set(s):
    """TECHNOLOGY_TS -> TECHNOLOGY, FUEL -> COMMODITY (subsets shown under their base set)"""
    for b in BASE:
        if s == b or s.startswith(b + '_'):
            return 'COMMODITY' if b == 'FUEL' else b
    if s.startswith('MODEper') or s.startswith('MODE_'):
        return 'MODE_OF_OPERATION'  # m in MODEperTECHNOLOGY[t]
    return s


def var_dims(model_txt):
    """index sets of every variable, from its domain: var NAME{r in REGION, (r,t,v,y) in RTVY, m in MODEperTECHNOLOGY[t]: ...}
    (a tuple set gives one dimension per member, named from the dummy index: r REGION, t TECHNOLOGY, v VINTAGE...)"""
    src = re.sub(r'#[^\n]*', '', model_txt)
    out = {}
    for m in re.finditer(r'\bvar\s+([A-Za-z_]\w*)\s*(\{([^}]*)\})?', src, re.S):
        d = [named(x) for x in dom_dims(m.group(3) or '')]
        out[m.group(1)] = [x if d.index(x) == i else f'{x} 2' for i, x in enumerate(d)]
    return out


def named(x):
    """a set of the domain -> the set shown in the results (subsets under their base set)"""
    if x.startswith('FIN_') or x == 'FINANCE':
        return 'FINANCE'
    if x.startswith('TECH_'):
        return 'TECHNOLOGY'
    if x.startswith('STORAGEINTRA'):
        return 'STORAGE'
    return base_set(x)


def dom_dims(dom):
    """split a domain {a in A, (b,c) in BC, d in D[c]: cond} into its index sets, one per dummy index"""
    dom = dom.split(':')[0]
    parts, cur, dp = [], '', 0
    for ch in dom:
        if ch in '([':
            dp += 1
        if ch in ')]':
            dp -= 1
        if ch == ',' and dp == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += ch
    parts.append(cur)
    dims = []
    for p in parts:
        mm = re.match(r'\s*\(([^)]*)\)\s+in\s+', p) or re.match(r'\s*(\w+)\s+in\s+', p)
        if not mm:
            continue
        for v in [x.strip() for x in mm.group(1).split(',')]:
            ss = re.match(r'\s*\w+\s+in\s+(\w+)', p)
            dims.append(ss.group(1) if ss and '(' not in p.split(' in ')[0] else GUESS.get(v, v.upper()))
    return dims


R_, T_, F_, E_, Y_, L_, M_ = 'REGION', 'TECHNOLOGY', 'COMMODITY', 'EMISSION', 'YEAR', 'TIMESLICE', 'MODE_OF_OPERATION'
DERIVED_DIMS = {  # every result compute() can derive, with its index sets (as MUIO)
    'ProductionByTechnology': [R_, L_, T_, F_, Y_],
    'ProductionByTechnologyByMode': [R_, T_, M_, F_, Y_],
    'ProductionByTechnologyAnnual': [R_, T_, F_, Y_],
    'ProductionByTechnologyByModeTs': [R_, L_, T_, M_, F_, Y_],
    'RateOfProductionByTechnologyByMode': [R_, L_, T_, M_, F_, Y_],
    'UseByTechnology': [R_, L_, T_, F_, Y_],
    'UseByTechnologyByMode': [R_, T_, M_, F_, Y_],
    'UseByTechnologyAnnual': [R_, T_, F_, Y_],
    'UseByTechnologyByModeTs': [R_, L_, T_, M_, F_, Y_],
    'RateOfUseByTechnologyByMode': [R_, L_, T_, M_, F_, Y_],
    'AnnualTechnologyEmissionByMode': [R_, T_, E_, M_, Y_],
    'AnnualTechnologyEmission': [R_, T_, E_, Y_],
    'AnnualEmissions': [R_, E_, Y_],
    'TotalAnnualTechnologyActivityByMode': [R_, T_, M_, Y_],
    'TotalTechnologyAnnualActivity': [R_, T_, Y_],
    'CapitalInvestment': [R_, T_, Y_],
    'AnnualizedInvestmentCost': [R_, T_, Y_],
    'TotalStorageCapacity': [R_, 'STORAGE', Y_],
    'Demand': [R_, L_, F_, Y_],
    'ProductionByTechnologyByVintage': [R_, T_, 'VINTAGE', F_, Y_],
    'UseByTechnologyByVintage': [R_, T_, 'VINTAGE', F_, Y_],
    'AnnualTechnologyEmissionByVintage': [R_, T_, 'VINTAGE', E_, Y_],
    # the annual results that had no time slice, slice by slice (amounts in the slice)
    'TechnologyActivityTS': [R_, L_, T_, Y_],
    'StorageChargeTS': [R_, 'STORAGE', L_, Y_],
    'StorageDischargeTS': [R_, 'STORAGE', L_, Y_],
    'AnnualTechnologyEmissionTS': [R_, L_, T_, E_, Y_],
}


GUESS = {
    'r': 'REGION',
    'rr': 'REGION',
    't': 'TECHNOLOGY',
    'f': 'COMMODITY',
    'l': 'TIMESLICE',
    'y': 'YEAR',
    'yy': 'YEAR',
    'm': 'MODE_OF_OPERATION',
    'e': 'EMISSION',
    's': 'STORAGE',
    'u': 'UDC',
    'ls': 'SEASON',
    'ld': 'DAYTYPE',
    'lh': 'DAILYTIMEBRACKET',
    'v': 'VINTAGE',
    'a': 'AGE',
    'fs': 'FINANCE',
    'g': 'TSGROUP',
    'te': 'TECHNOLOGY',
    'tc': 'TECHNOLOGY',
    'mc': 'MODE_OF_OPERATION',
    'me': 'MODE_OF_OPERATION',
    'tt': 'TECHNOLOGY',
    'ff': 'COMMODITY',
}


def cons_dims(model):
    """index sets of every constraint of a model file, from its domain: s.t. NAME{r in REGION, (m,t) in X[e], ...}: ..."""
    out = {}
    txt = re.sub(r'#[^\n]*', '', model)
    for m in re.finditer(r's\.t\.\s+(\w+)\s*\{', txt):
        i, depth = m.end(), 1
        while i < len(txt) and depth:
            depth += {'{': 1, '}': -1}.get(txt[i], 0)
            i += 1
        out[m.group(1)] = dom_dims(txt[m.end() : i - 1])
    KNOWN = set(BASE) | {'VINTAGE', 'AGE', 'FINANCE', 'TSGROUP', 'YSTAGE'}
    within = {
        a: b for a, b in re.findall(r'\bset\s+(\w+)\s+(?:within|default|:=)\s*(?:\{\s*\w+\s+in\s+)?(\w+)', txt) if a != b and b != 'setof'
    }  # subsets -> their set

    def base(x, k=0):
        x = named(x)
        if x in KNOWN or x.endswith(' 2'):
            return x
        if x in within and k < 5:
            return base(within[x], k + 1)
        return next(
            (b for b in ('TECHNOLOGY', 'COMMODITY', 'STORAGE', 'EMISSION', 'REGION') if x.startswith(b + '_')), x
        )  # COMMODITY_S, TECHNOLOGY_TS...

    return {c: ['COMMODITY' if base(x) == 'FUEL' else base(x) for x in dims] for c, dims in out.items()}


def ratio_in_slice(params, YS):
    """-> f(kind 'I'/'O', r, t, f, m, l, y, data ratio) = the ratio in time slice l as the master model computes it:
    data ratio x ProfileX[l] x the mean over the seasons of l of: the season profile, or (MASTER [9]) the cascade value
    of a land use / its precipitation input, or (MASTER [L]) the linked value. Returns the data ratio when none applies."""
    from collections import defaultdict as _dd

    G = lambda n: params.get(n) or {'recs': {}, 'def': None}

    def pv(n, k, d=0.0):
        P_ = G(n)
        v = P_['recs'].get(k)
        if v is not None:
            return v
        return P_.get('def') if P_.get('def') is not None else d

    PROF = {'I': ('InputActivityRatio', 'ProfileIAR', 'SeasonProfileIAR'), 'O': ('OutputActivityRatio', 'ProfileOAR', 'SeasonProfileOAR')}
    seas = {}
    for k, cv in G('Conversionls')['recs'].items():
        if cv == 1:
            seas.setdefault(k[0], []).append(k[1])
    years = {k[1] for k in G('YearSplit')['recs']}
    sshare = _dd(float)
    for l_, lss in seas.items():
        for ls_ in lss:
            for y_ in years:
                sshare[(ls_, y_)] += YS(l_, y_)
    drv = {k[0] for k, v in G('WaterDriverFuel')['recs'].items() if v == 1}
    land = _dd(list)
    for (r_, t_, f_, m_), rule in G('CascadeRule')['recs'].items():
        if rule:
            land[(r_, t_, m_)].append((f_, int(rule)))
    LT = {k: int(v) for k, v in G('LinkTarget')['recs'].items() if v}
    src = _dd(list)
    for k, v in G('LinkFrom')['recs'].items():
        if v and tuple(k[:4]) in LT:
            src[tuple(k[:4])].append((k[4], k[5], k[6], v))
    lseason = lambda r_, t_, f_, m_, ls_: pv('LinkSeason', (r_, t_, f_, m_, ls_), 1.0) > 0
    allseas = sorted(
        {ls_ for lss in seas.values() for ls_ in lss}, key=lambda z: float(z) if str(z).replace('.', '', 1).isdigit() else str(z)
    )

    def profile(kd, r_, t_, f_, m_, l_, y_):
        n_, pp, sp = PROF[kd]
        return pv(pp, (r_, t_, f_, m_, l_, y_), 1.0)

    def season_profile(kd, r_, t_, f_, m_, ls_, y_):
        return pv(PROF[kd][2], (r_, t_, f_, m_, ls_, y_), 1.0)

    def plain(kd, r_, t_, f_, m_, l_, y_):
        """data ratio x profiles (no cascade, no link)"""
        R_ = pv(PROF[kd][0], (r_, t_, f_, m_, y_))
        lss = seas.get(l_) or []
        return (
            R_
            * profile(kd, r_, t_, f_, m_, l_, y_)
            * ((sum(season_profile(kd, r_, t_, f_, m_, ls_, y_) for ls_ in lss) / len(lss)) if lss else 1.0)
        )

    def link_plain(r_, t_, f_, m_, l_, y_):
        kd = 'I' if pv('LinkSourceKind', (r_, t_, f_, m_), 2.0) == 1 else 'O'
        return sum(fac * plain(kd, r_, ts, fs, ms, l_, y_) for ts, fs, ms, fac in src[(r_, t_, f_, m_)])

    def depth(r_, t_, m_, ls_, y_):
        fl = [f_ for f_ in drv if LT.get((r_, t_, f_, m_)) == 1]
        if fl:
            if any(lseason(r_, t_, f_, m_, ls_) for f_ in fl):
                return sum(link_plain(r_, t_, f_, m_, l_, y_) * YS(l_, y_) for f_ in fl for l_, lss in seas.items() if ls_ in lss)
        return pv('WaterDriverDepth', (r_, ls_, y_))

    bcache = {}

    def bucket(r_, t_, m_, y_):
        key = (r_, t_, m_, y_)
        if key in bcache:
            return bcache[key]
        rows = land[(r_, t_, m_)]
        f6 = [f_ for f_, ru in rows if ru == 6]
        f7 = [f_ for f_, ru in rows if ru == 7]
        f8 = [f_ for f_, ru in rows if ru == 8]
        smax = pv('CascadeSoilMax', (r_, t_, m_))
        fd = pv('CascadeSoilDrain', (r_, t_, m_))
        st = pv('CascadeSoilStart', (r_, t_, m_), -1.0)
        S = []
        for ls_ in allseas:
            P = depth(r_, t_, m_, ls_, y_)
            I = P * (1 - sum(pv('CascadeShare', (r_, t_, f_, m_, ls_, y_)) for f_ in f6))
            pot = pv('ReferenceET', (r_, ls_, y_)) * sum(pv('CascadeShare', (r_, t_, f_, m_, ls_, y_)) for f_ in f7)
            S.append((ls_, P, I, pot, (1 - fd) * max(0.0, I - pot) - max(0.0, pot - I)))
        clamp = lambda x: max(0.0, min(smax, x))
        if st >= 0:
            s0 = st
        else:
            lo, hi = 0.0, smax
            for *_, c in S:
                lo, hi = clamp(lo + c), clamp(hi + c)
            s0 = hi if sum(c for *_, c in S) > 1e-9 * (1 + smax) else lo
        out, sb = {}, s0
        for ls_, P, I, pot, c in S:
            se = clamp(sb + c)
            v_ = {}
            for f_ in f6:
                v_[f_] = pv('CascadeShare', (r_, t_, f_, m_, ls_, y_)) * P
            for f_ in f7:
                v_[f_] = min(pot, I) + max(0.0, sb - se)
            for f_ in f8:
                v_[f_] = max(0.0, I - pot) - max(0.0, se - sb)
            v_['__soil_begin'] = sb
            out[ls_] = v_
            sb = se
        bcache[key] = out
        return out

    def cvals(r_, t_, m_, ls_, y_):
        rows = land[(r_, t_, m_)]
        if any(ru >= 6 for _, ru in rows):
            return {k_: v_ for k_, v_ in bucket(r_, t_, m_, y_).get(ls_, {}).items() if k_ != '__soil_begin'}
        P = depth(r_, t_, m_, ls_, y_)
        E0 = pv('ReferenceET', (r_, ls_, y_))
        sh = lambda f_: pv('CascadeShare', (r_, t_, f_, m_, ls_, y_))
        v_ = {}
        et = sum(min(P, (1 if ru == 2 else E0) * sh(f_)) for f_, ru in rows if ru in (2, 3))
        for f_, ru in rows:
            if ru == 1:
                v_[f_] = sh(f_) * P
            elif ru == 2:
                v_[f_] = min(P, sh(f_))
            elif ru == 3:
                v_[f_] = min(P, sh(f_) * E0)
            elif ru == 5:
                v_[f_] = sh(f_) * max(0.0, P - et)
        for f_, ru in rows:
            if ru == 4:
                v_[f_] = P - sum(v_.values())
        return v_

    # ---- MASTER [Y] (calendars as modes, harvest month, ET0 of the land): crop calendars and the yield factor, as the model computes them before the solve
    YRe = {k: int(v) for k, v in G('YieldResponse')['recs'].items() if v}
    YWi = {k: int(v) for k, v in G('CropWaterInput')['recs'].items() if v in (1, 2)}
    YLi = {k for k, v in G('CropLandInput')['recs'].items() if v == 1}
    ycrops = {(k[0], k[1], k[3]) for k in list(YRe) + list(YWi) + list(YLi)}
    yrs = sorted(years, key=lambda z: float(z))
    y0 = yrs[0] if yrs else None
    sdays = {ls_: round(365 * sshare.get((ls_, y0), 0.0)) for ls_ in allseas} if y0 is not None else {}
    sfirst, acc = {}, 1
    for ls_ in allseas:
        sfirst[ls_] = acc
        acc += sdays[ls_]

    def ymonths(r_, t_, mo_):
        st_ = [pv('CropStageDays', (r_, t_, mo_, str(k_)), 0.0) for k_ in range(1, 5)]
        ends = [sum(st_[: k_ + 1]) for k_ in range(4)]
        ki, km, ke = pv('CropKcIni', (r_, t_)), pv('CropKcMid', (r_, t_)), pv('CropKcEnd', (r_, t_))
        sow = pv('CropSowingDay', (r_, t_, mo_), 1.0)
        M_ = {}
        last = None
        for d_ in range(int(round(sum(st_)))):
            a_ = sow + d_
            o_ = 1 if a_ <= 0 else 0
            dd = a_ + 365 * o_
            ls_ = max((z for z in allseas if sfirst[z] <= dd), key=lambda z: sfirst[z])
            k_ = next(i for i in range(4) if d_ < ends[i])
            kc = (
                ki
                if k_ == 0
                else (
                    ki + (km - ki) * (d_ - ends[0] + 0.5) / st_[1]
                    if k_ == 1
                    else km if k_ == 2 else km + (ke - km) * (d_ - ends[2] + 0.5) / st_[3]
                )
            )
            m_ = M_.setdefault((o_, ls_), [0, [0.0] * 4])
            m_[0] += 1
            m_[1][k_] += kc
            last = ls_
        return M_, last

    ymcache, ycache = {}, {}

    def ycrop(r_, t_, mo_, y_):
        """calendar mode mo_ -> (yield factor, {season: water need}, {season: days-in-field share}, {season: water got}, harvest season)"""
        key = (r_, t_, mo_, y_)
        if key in ycache:
            return ycache[key]
        if (r_, t_, mo_) not in ymcache:
            ymcache[(r_, t_, mo_)] = ymonths(r_, t_, mo_)
        M_, hv = ymcache[(r_, t_, mo_)]
        lu = [k[2] for k, v in G('CropLand')['recs'].items() if v == 1 and k[0] == r_ and k[1] == t_]
        u_ = lu[0] if lu else None
        um = (r_, u_, '1')
        rows = land.get(um, [])
        isb = any(ru >= 6 for _, ru in rows)
        cs = pv('CropSoilMax', (r_, t_), -1.0)
        smax = cs if cs >= 0 else (pv('CascadeSoilMax', um) if isb else 0.0)
        fd = pv('CascadeSoilDrain', um) if isb else 0.0
        f6 = [f_ for f_, ru in rows if ru == 6]
        Em, Ea, water, wata = [0.0] * 4, [0.0] * 4, {}, {}
        soil = None
        for o_, ls_ in sorted(M_, key=lambda z: (-z[0], sfirst[z[1]])):
            n_, kcs = M_[(o_, ls_)]
            yy = yrs[yrs.index(y_) - 1] if o_ == 1 and y_ != y0 else y_
            E0 = pv('CropET0', (r_, u_, ls_)) if u_ is not None else 0.0
            etk = [kc * E0 / sdays[ls_] for kc in kcs]
            etm = sum(etk)
            P_ = depth(r_, u_, '1', ls_, yy) * n_ / sdays[ls_]
            I_ = P_ * (1 - sum(pv('CascadeShare', (r_, u_, f_, '1', ls_, yy)) for f_ in f6))
            if soil is None:
                soil = min(smax, bucket(r_, u_, '1', yy).get(ls_, {}).get('__soil_begin', 0.0)) if isb else 0.0
            ch = (1 - fd) * max(0.0, I_ - etm) - max(0.0, etm - I_)
            s1 = max(0.0, min(smax, soil + ch))
            eta = min(etm, I_) + max(0.0, soil - s1)
            soil = s1
            for k_ in range(4):
                Em[k_] += etk[k_]
                Ea[k_] += eta * etk[k_] / etm if etm > 0 else 0.0
            water[ls_] = water.get(ls_, 0.0) + etm
            wata[ls_] = wata.get(ls_, 0.0) + eta
        meth = max([v for k, v in YRe.items() if k[0] == r_ and k[1] == t_ and k[3] == mo_] or [0])
        if meth == 1:
            F_ = 1 - pv('YieldKySeason', (r_, t_)) * (1 - sum(Ea) / sum(Em)) if sum(Em) > 0 else 1.0
        else:
            F_ = 1.0
            for k_ in range(4):
                if Em[k_] > 0:
                    F_ *= 1 - pv('YieldKy', (r_, t_, str(k_ + 1))) * (1 - Ea[k_] / Em[k_])
        F_ = max(pv('YieldFloor', (r_, t_)), min(1.0, F_))
        share = {ls_: sum(v[0] for (o_, l2), v in M_.items() if l2 == ls_) / sdays[ls_] for ls_ in allseas}
        if pv('CropWaterOutside', (r_, t_)) == 1 and u_ is not None:
            f7 = [f_ for f_, ru in rows if ru == 7]
            for ls_ in allseas:
                if share[ls_] < 1:
                    wata[ls_] = wata.get(ls_, 0.0) + (1 - share[ls_]) * sum(cvals(r_, u_, '1', ls_, y_).get(f_, 0.0) for f_ in f7)
        ycache[key] = (F_, water, share, wata, hv)
        return ycache[key]

    def season_term(kd, r_, t_, f_, m_, ls_, y_, R_):
        """the season factor x data ratio (without ProfileX): cascade, or the season profile"""
        if kd == 'O' and (r_, t_, f_, m_) in YRe:  # the output goes to the harvest month of the mode, x F
            c_ = ycrop(r_, t_, m_, y_)
            return R_ * c_[0] / (sshare.get((ls_, y_)) or 1.0) if ls_ == c_[4] else 0.0
        if kd == 'I' and (r_, t_, f_, m_) in YWi:
            return ycrop(r_, t_, m_, y_)[1 if YWi[(r_, t_, f_, m_)] == 1 else 3].get(ls_, 0.0) / (sshare.get((ls_, y_)) or 1.0)
        if kd == 'I' and (r_, t_, f_, m_) in YLi:
            return (
                ycrop(r_, t_, m_, y_)[2].get(ls_, 0.0) * R_ * season_profile(kd, r_, t_, f_, m_, ls_, y_)
            )  # the data ratio x share of days
        if kd == 'I' and f_ in drv and (r_, t_, m_) in land:
            return depth(r_, t_, m_, ls_, y_) / (sshare.get((ls_, y_)) or 1.0)
        if kd == 'O' and (r_, t_, m_) in land and any(ff == f_ for ff, _ in land[(r_, t_, m_)]):
            return cvals(r_, t_, m_, ls_, y_).get(f_, 0.0) / (sshare.get((ls_, y_)) or 1.0)
        return R_ * season_profile(kd, r_, t_, f_, m_, ls_, y_)

    def nolink(kd, r_, t_, f_, m_, l_, y_, R_=None):
        R_ = pv(PROF[kd][0], (r_, t_, f_, m_, y_)) if R_ is None else R_
        lss = seas.get(l_) or []
        if not lss:
            return R_ * profile(kd, r_, t_, f_, m_, l_, y_)
        return profile(kd, r_, t_, f_, m_, l_, y_) * sum(season_term(kd, r_, t_, f_, m_, ls_, y_, R_) for ls_ in lss) / len(lss)

    def link_val(r_, t_, f_, m_, l_, y_):
        kd = 'I' if pv('LinkSourceKind', (r_, t_, f_, m_), 2.0) == 1 else 'O'
        return sum(fac * nolink(kd, r_, ts, fs, ms, l_, y_) for ts, fs, ms, fac in src[(r_, t_, f_, m_)])

    anyprof = {kd: bool(G(PROF[kd][1])['recs'] or G(PROF[kd][2])['recs']) for kd in PROF}
    fast = {kd: not (anyprof[kd] or land or LT or ycrops) for kd in PROF}

    def ratio(kd, r_, t_, f_, m_, l_, y_, R_):
        v_ = ratio0(kd, r_, t_, f_, m_, l_, y_, R_)
        return v_

    def ratio0(kd, r_, t_, f_, m_, l_, y_, R_):
        if fast[kd]:
            return R_  # nothing changes the data ratio (as in a MUIO case)
        lss = seas.get(l_) or []
        if LT.get((r_, t_, f_, m_)) == (1 if kd == 'I' else 2) and lss:
            lv = None
            tot = 0.0
            for ls_ in lss:
                if lseason(r_, t_, f_, m_, ls_):
                    lv = link_val(r_, t_, f_, m_, l_, y_) if lv is None else lv
                    tot += lv
                else:
                    tot += profile(kd, r_, t_, f_, m_, l_, y_) * season_term(kd, r_, t_, f_, m_, ls_, y_, R_)
            return tot / len(lss)
        return nolink(kd, r_, t_, f_, m_, l_, y_, R_)

    return ratio


def compute(run_dir, have):
    """-> {name: {'dims': [...], 'rows': [[idx..., value], ...]}} for the derived variables not in `have`"""
    model = open(os.path.join(run_dir, 'model.txt'), encoding='utf-8', errors='ignore').read()
    data = open(os.path.join(run_dir, 'data.txt'), encoding='utf-8', errors='ignore').read()
    res = json.load(open(os.path.join(run_dir, 'results.json')))
    pd, vd = model_dims(model), var_dims(model)
    sets, params, _ = parse_data(data, pd)
    out = {}
    RA, YS = None, None
    ra = res.get('RateOfActivity')
    rd = vd.get('RateOfActivity')
    if ra and rd:
        pos = {base_set(s.split(' ')[0]): i for i, s in enumerate(rd)}
        need = ('REGION', 'TIMESLICE', 'TECHNOLOGY', 'MODE_OF_OPERATION', 'YEAR')
        if all(k in pos for k in need):
            RA = [
                (r[pos['REGION']], r[pos['TIMESLICE']], r[pos['TECHNOLOGY']], r[pos['MODE_OF_OPERATION']], r[pos['YEAR']], r[-1])
                for r in ra
            ]
            ys = params.get('YearSplit', {'recs': {}, 'def': None})
            ysd = ys['def'] or 0.0
            YS = lambda l, y: ys['recs'].get((l, y), ysd)

            def ratio_index(p):
                """(r,t,m,y) -> [(f, l or None, v)] for a ratio parameter, whatever the order of its index sets"""
                d = [base_set(s) for s in pd.get(p, [])]
                P = params.get(p)
                if not P or not d:
                    return None
                ix = {s: i for i, s in enumerate(d)}
                key = 'EMISSION' if 'EMISSION' in ix else 'COMMODITY'
                if not all(k in ix for k in ('REGION', 'TECHNOLOGY', key, 'MODE_OF_OPERATION', 'YEAR')):
                    return None
                tl = ix.get('TIMESLICE')
                M = defaultdict(list)
                for k, v in P['recs'].items():
                    if v:
                        M[(k[ix['REGION']], k[ix['TECHNOLOGY']], k[ix['MODE_OF_OPERATION']], k[ix['YEAR']])].append(
                            (k[ix[key]], k[tl] if tl is not None else None, v)
                        )
                return M

            # MASTER [2] vintaging: flows of each cohort (vintage) as the model's result rows count them, and the corrections
            # they make to the flows by time slice (the cohort factors VintFac x AgeDeg x VintSeason on the ratios)
            def rows_of(var, need):
                R_ = res.get(var)
                d_ = vd.get(var)
                if not R_ or not d_:
                    return []
                pos_ = {base_set(s.split(' ')[0]): i for i, s in enumerate(d_)}
                if not all(k in pos_ for k in need):
                    return []
                return [tuple(str(r[pos_[k]]) for k in need) + (r[-1],) for r in R_ if r[-1]]

            AAV = rows_of('AnnualActivityByVintage', ('REGION', 'TECHNOLOGY', 'VINTAGE', 'YEAR', 'MODE_OF_OPERATION'))
            RAV = rows_of('RateOfActivityByVintage', ('REGION', 'TECHNOLOGY', 'VINTAGE', 'YEAR', 'TIMESLICE', 'MODE_OF_OPERATION'))

            def pv0(n, k, d):
                P_ = params.get(n)
                if not P_:
                    return d
                v_ = P_['recs'].get(k)
                return v_ if v_ is not None else (P_['def'] if P_.get('def') is not None else d)

            VMODE = lambda t: int(float(pv0('VintageMode', (t,), 0) or 0))
            SEAS_L = {}
            for k_, cv in (params.get('Conversionls') or {'recs': {}})['recs'].items():
                if cv == 1:
                    SEAS_L.setdefault(k_[0], []).append(k_[1])

            def vfac(kd, t, v, y, l=None):
                """cohort factor of the ratio kd ('IAR', 'OAR', 'EAR') of vintage v in year y (and slice l: season factor)"""
                age = str(int(float(y)) - int(float(v)))
                f_ = pv0('VintFac' + kd, (t, v), 1.0) * pv0('AgeDeg' + kd, (t, age), 1.0)
                if l is not None and kd in ('IAR', 'OAR') and SEAS_L.get(l):
                    f_ *= sum(pv0('VintSeason' + kd, (t, v, ls_), 1.0) for ls_ in SEAS_L[l]) / len(SEAS_L[l])
                return f_

            AAVt = defaultdict(float)
            for r, t, v, y, m, a in AAV:
                AAVt[(r, t, m, y)] += a
            RAbyT = defaultdict(list)
            for r, l, t, m, y, a in RA:
                RAbyT[(str(r), str(t), str(m), str(y))].append((str(l), a))
            VINT_OUT = {}

            def vintage_flows(p, M, RS, kind, ts, bm, an, tsm, rate):
                """adds the cohort corrections to the flows of vintaged technologies and keeps the flows by vintage"""
                kd = {'OutputActivityRatio': 'OAR', 'InputActivityRatio': 'IAR', 'EmissionActivityRatio': 'EAR'}[p]
                byV = defaultdict(float)

                def add(r, l, t, m, f, y, q):  # a correction in slice l (None: annual only)
                    if not q:
                        return
                    bm[(r, t, m, f, y)] += q
                    an[(r, t, f, y)] += q
                    if l is not None:
                        ts[(r, l, t, f, y)] += q
                        tsm[(r, l, t, m, f, y)] += q
                        rate[(r, l, t, m, f, y)] += q / (YS(l, y) or 1)

                ratio = lambda r, t, f, m, l, y, R_: RS(kind, r, t, f, m, l, y, R_) if RS is not None else R_
                if kd == 'EAR':
                    dec = lambda e, t, m: pv0('EmissionDecoupled', (e, t, m), 0) == 1
                    for r, t, v, y, l, m, a in RAV:
                        for f, ll, R_ in M.get((r, t, m, y), ()):
                            fac = (1.0 if dec(f, t, m) else vfac('IAR', t, v, y, l)) * vfac('EAR', t, v, y)
                            q = a * YS(l, y) * R_
                            byV[(r, t, v, f, y)] += q * fac
                            add(r, None, t, m, f, y, q * (fac - 1))
                    for r, t, v, y, m, a in AAV:
                        if VMODE(t) != 1:
                            continue
                        for f, ll, R_ in M.get((r, t, m, y), ()):
                            fac = (1.0 if dec(f, t, m) else vfac('IAR', t, v, y)) * vfac('EAR', t, v, y)
                            byV[(r, t, v, f, y)] += a * R_ * fac
                            add(r, None, t, m, f, y, a * R_ * (fac - 1))
                    return byV
                for r, t, v, y, l, m, a in RAV:  # VintageMode 2: each cohort in each slice
                    for f, ll, R_ in M.get((r, t, m, y), ()):
                        if ll is not None and ll != l:
                            continue
                        q = a * ratio(r, t, f, m, l, y, R_) * YS(l, y)
                        fac = vfac(kd, t, v, y, l)
                        byV[(r, t, v, f, y)] += q * fac
                        add(r, l, t, m, f, y, q * (fac - 1))
                for r, t, v, y, m, a in AAV:  # VintageMode 1: yearly cohorts
                    if VMODE(t) != 1:
                        continue
                    tot = AAVt[(r, t, m, y)] or 1.0
                    sl = RAbyT.get((r, t, m, y), [])
                    for f, ll, R_ in M.get((r, t, m, y), ()):
                        if ll is not None:
                            continue
                        base_l = [(l, ra * ratio(r, t, f, m, l, y, R_) * YS(l, y)) for l, ra in sl]
                        base = sum(q for _, q in base_l)
                        yrs = [l for l, _ in sl]
                        ysum = sum(YS(l, y) for l in yrs) or 1.0
                        mean = sum(ratio(r, t, f, m, l, y, R_) * YS(l, y) for l in yrs) / ysum if yrs else R_
                        annual = pv0('CommodityTimeSliced', (f,), 1) != 1
                        corr = a * mean * (vfac(kd, t, v, y) - 1) if annual else 0.0
                        byV[(r, t, v, f, y)] += a / tot * base + corr
                        if corr:
                            for l, q in base_l:
                                add(r, l, t, m, f, y, corr * (q / base if base else YS(l, y) / ysum))
                return byV

            def flows(p, ts_name, mode_name, ann_name, key='COMMODITY'):
                M = ratio_index(p)
                if M is None:
                    return
                ts, bm, an, tsm, rate = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)
                # the ratio in each time slice as the model computes it: annual ratio x profiles; water cascade [9] (and its soil
                # bucket); linked ratios [L]. ratio_in_slice() is shared by the input and output ratios (links may cross them).
                kind = {'InputActivityRatio': 'I', 'OutputActivityRatio': 'O'}.get(p)
                RS = ratio_in_slice(params, YS) if kind else None
                for r, l, t, m, y, a in RA:
                    for f, ll, v in M.get((r, t, m, y), ()):
                        if ll is not None and ll != l:
                            continue
                        if RS is not None and ll is None:
                            v = RS(kind, r, t, f, m, l, y, v)
                        elif ll is None and p == 'EmissionActivityRatio':
                            pass
                        q = a * v * YS(l, y)
                        if q:
                            ts[(r, l, t, f, y)] += q
                            bm[(r, t, m, f, y)] += q
                            an[(r, t, f, y)] += q
                            tsm[(r, l, t, m, f, y)] += q
                            rate[(r, l, t, m, f, y)] += a * v
                if (AAV or RAV) and p in ('OutputActivityRatio', 'InputActivityRatio', 'EmissionActivityRatio'):
                    VINT_OUT[p] = vintage_flows(p, M, RS, kind, ts, bm, an, tsm, rate)
                if key != 'EMISSION':  # by time slice AND mode, as MUIO: quantity in the slice, and rate (per year)
                    nm = 'Production' if p == 'OutputActivityRatio' else 'Use'
                    for name, D_ in ((f'{nm}ByTechnologyByModeTs', tsm), (f'RateOf{nm}ByTechnologyByMode', rate)):
                        if name not in have:
                            out[name] = {
                                'dims': ['REGION', 'TIMESLICE', 'TECHNOLOGY', 'MODE_OF_OPERATION', 'COMMODITY', 'YEAR'],
                                'rows': [list(k) + [v] for k, v in D_.items()],
                            }
                lab = 'EMISSION' if key == 'EMISSION' else 'COMMODITY'
                if ts_name and ts_name not in have:
                    out[ts_name] = {
                        'dims': ['REGION', 'TIMESLICE', 'TECHNOLOGY', lab, 'YEAR'],
                        'rows': [list(k) + [v] for k, v in ts.items()],
                    }
                if mode_name not in have:
                    out[mode_name] = {
                        'dims': (
                            ['REGION', 'TECHNOLOGY', 'MODE_OF_OPERATION', lab, 'YEAR']
                            if key != 'EMISSION'
                            else ['REGION', 'TECHNOLOGY', 'EMISSION', 'MODE_OF_OPERATION', 'YEAR']
                        ),
                        'rows': (
                            [list(k) + [v] for k, v in bm.items()]
                            if key != 'EMISSION'
                            else [[k[0], k[1], k[3], k[2], k[4], v] for k, v in bm.items()]
                        ),
                    }
                if ann_name not in have:
                    out[ann_name] = {'dims': ['REGION', 'TECHNOLOGY', lab, 'YEAR'], 'rows': [list(k) + [v] for k, v in an.items()]}
                return an

            flows('OutputActivityRatio', 'ProductionByTechnology', 'ProductionByTechnologyByMode', 'ProductionByTechnologyAnnual')
            flows('InputActivityRatio', 'UseByTechnology', 'UseByTechnologyByMode', 'UseByTechnologyAnnual')
            em = flows('EmissionActivityRatio', None, 'AnnualTechnologyEmissionByMode', 'AnnualTechnologyEmission', key='EMISSION')
            for p_, name_, lab_ in (
                ('OutputActivityRatio', 'ProductionByTechnologyByVintage', 'COMMODITY'),
                ('InputActivityRatio', 'UseByTechnologyByVintage', 'COMMODITY'),
                ('EmissionActivityRatio', 'AnnualTechnologyEmissionByVintage', 'EMISSION'),
            ):
                if VINT_OUT.get(p_) and name_ not in have:
                    out[name_] = {
                        'dims': ['REGION', 'TECHNOLOGY', 'VINTAGE', lab_, 'YEAR'],
                        'rows': [list(k) + [v] for k, v in VINT_OUT[p_].items() if v],
                    }
            if em is not None and 'AnnualEmissions' not in have:
                ae = defaultdict(float)
                for (r, t, e, y), v in em.items():
                    ae[(r, e, y)] += v
                out['AnnualEmissions'] = {'dims': ['REGION', 'EMISSION', 'YEAR'], 'rows': [list(k) + [v] for k, v in ae.items()]}
            act_m, act = defaultdict(float), defaultdict(float)
            for r, l, t, m, y, a in RA:
                q = a * YS(l, y)
                act_m[(r, t, m, y)] += q
                act[(r, t, y)] += q
            if 'TotalAnnualTechnologyActivityByMode' not in have:
                out['TotalAnnualTechnologyActivityByMode'] = {
                    'dims': ['REGION', 'TECHNOLOGY', 'MODE_OF_OPERATION', 'YEAR'],
                    'rows': [list(k) + [v] for k, v in act_m.items() if v],
                }
            if 'TotalTechnologyAnnualActivity' not in have:
                out['TotalTechnologyAnnualActivity'] = {
                    'dims': ['REGION', 'TECHNOLOGY', 'YEAR'],
                    'rows': [list(k) + [v] for k, v in act.items() if v],
                }

    def pval(p, key):  # parameter value for an index tuple in the model's order, else its default
        P = params.get(p)
        return None if not P else P['recs'].get(key, P['def'])

    def dims_of(p):
        return [base_set(s) for s in pd.get(p, [])]

    nc = res.get('NewCapacity')
    ncd = vd.get('NewCapacity')
    if nc and ncd and 'CapitalInvestment' not in have and dims_of('CapitalCost') == ['REGION', 'TECHNOLOGY', 'YEAR']:
        pos = {base_set(s.split(' ')[0]): i for i, s in enumerate(ncd)}
        rows = [
            [
                r[pos['REGION']],
                r[pos['TECHNOLOGY']],
                r[pos['YEAR']],
                r[-1] * (pval('CapitalCost', (r[pos['REGION']], r[pos['TECHNOLOGY']], r[pos['YEAR']])) or 0),
            ]
            for r in nc
        ]
        out['CapitalInvestment'] = {'dims': ['REGION', 'TECHNOLOGY', 'YEAR'], 'rows': [x for x in rows if x[-1]]}
    ci = res.get('CapitalInvestment') or (out.get('CapitalInvestment') or {}).get('rows')
    if ci and 'AnnualizedInvestmentCost' not in have and pd.get('OperationalLife'):
        # MUIO: CRF = (1 - (1+d)^-1) / (1 - (1+d)^-OL) with d = DiscountRateIdv (else DiscountRate); cost of a year = sum of
        # CapitalInvestment x CRF of the last OL years
        cid = vd.get('CapitalInvestment') if res.get('CapitalInvestment') else ['REGION', 'TECHNOLOGY', 'YEAR']
        pos = {base_set(s.split(' ')[0]): i for i, s in enumerate(cid)}
        years = sorted({str(y) for y in sets.get('YEAR', [])}, key=lambda z: float(z))
        by = defaultdict(dict)
        for r in ci:
            by[(r[pos['REGION']], r[pos['TECHNOLOGY']])][str(r[pos['YEAR']])] = r[-1]
        rows = []
        for (rg, t), cy in by.items():
            d = pval('DiscountRateIdv', (rg, t)) if params.get('DiscountRateIdv') else None
            if d is None:
                d = pval('DiscountRate', (rg,)) or 0.05
            ol = int(float(pval('OperationalLife', (rg, t)) or 1))
            crf = (1 - (1 + d) ** -1) / (1 - (1 + d) ** -ol) if d else 1.0 / ol
            seq = [cy.get(y, 0.0) * crf for y in years]
            for i, y in enumerate(years):
                v = sum(seq[max(0, i - ol + 1) : i + 1])
                if v:
                    rows.append([rg, t, y, v])
        out['AnnualizedInvestmentCost'] = {'dims': ['REGION', 'TECHNOLOGY', 'YEAR'], 'rows': rows}
    an = res.get('AccumulatedNewStorageCapacity')
    and_ = vd.get('AccumulatedNewStorageCapacity')
    if 'TotalStorageCapacity' not in have and and_ and (an or params.get('ResidualStorageCapacity')):
        tot = defaultdict(float)
        pos = {base_set(s.split(' ')[0]): i for i, s in enumerate(and_)}
        for r in an or []:
            tot[(r[pos['REGION']], r[pos['STORAGE']], r[pos['YEAR']])] += r[-1]
        rs = params.get('ResidualStorageCapacity')
        if rs and dims_of('ResidualStorageCapacity') == ['REGION', 'STORAGE', 'YEAR']:
            for k, v in rs['recs'].items():
                tot[k] += v or 0
        out['TotalStorageCapacity'] = {'dims': ['REGION', 'STORAGE', 'YEAR'], 'rows': [list(k) + [v] for k, v in tot.items() if v]}
    if 'Demand' not in have and params.get('SpecifiedAnnualDemand') and params.get('SpecifiedDemandProfile'):
        dd = [base_set(s) for s in pd.get('SpecifiedDemandProfile', [])]
        ix = {s: i for i, s in enumerate(dd)}
        if all(k in ix for k in ('REGION', 'COMMODITY', 'TIMESLICE', 'YEAR')):
            ad = params['SpecifiedAnnualDemand']['recs']
            rows = []
            for k, v in params['SpecifiedDemandProfile']['recs'].items():
                q = v * ad.get((k[ix['REGION']], k[ix['COMMODITY']], k[ix['YEAR']]), 0)
                if q:
                    rows.append([k[ix['REGION']], k[ix['TIMESLICE']], k[ix['COMMODITY']], k[ix['YEAR']], q])
            out['Demand'] = {'dims': ['REGION', 'TIMESLICE', 'COMMODITY', 'YEAR'], 'rows': rows}
    if RA and YS:
        slice_results(RA, YS, params, pd, have, out)
    return {k: v for k, v in out.items() if v['rows']}


def slice_results(RA, YS, params, pd, have, out):
    """Activity, storage charge and discharge, and emissions of each technology in each time slice (amounts in the slice:
    rate x YearSplit). Grouped by season, day type or day part on the Results page (the fields of a time slice)."""
    act = defaultdict(float)
    for r, l, t, m, y, v in RA:
        if v:
            act[(r, l, t, y)] += v * YS(l, y)
    if 'TechnologyActivityTS' not in have:
        out['TechnologyActivityTS'] = {'dims': ['REGION', 'TIMESLICE', 'TECHNOLOGY', 'YEAR'], 'rows': [list(k) + [v] for k, v in act.items() if v]}

    def by_rtm(p, key):
        """(r, t, m) -> [(s or e, value)] and (r,t,m,y) for ratios with a year"""
        P, d = params.get(p), [base_set(x) for x in pd.get(p, [])]
        if not P or not d:
            return None, None
        ix = {x: i for i, x in enumerate(d)}
        if not all(k in ix for k in ('REGION', 'TECHNOLOGY', key, 'MODE_OF_OPERATION')):
            return None, None
        M_ = defaultdict(list)
        for k, v in P['recs'].items():
            if v:
                M_[(k[ix['REGION']], k[ix['TECHNOLOGY']], k[ix['MODE_OF_OPERATION']]) + ((k[ix['YEAR']],) if 'YEAR' in ix else ())].append(
                    (k[ix[key]], k[ix['TIMESLICE']] if 'TIMESLICE' in ix else None, v)
                )
        return M_, 'YEAR' in ix

    for p, name in (('TechnologyToStorage', 'StorageChargeTS'), ('TechnologyFromStorage', 'StorageDischargeTS')):
        if name in have:
            continue
        M_, _ = by_rtm(p, 'STORAGE')
        if not M_:
            continue
        acc = defaultdict(float)
        for r, l, t, m, y, v in RA:
            for st, _l, w in M_.get((r, t, m), ()):
                acc[(r, st, l, y)] += v * w * YS(l, y)
        out[name] = {'dims': ['REGION', 'STORAGE', 'TIMESLICE', 'YEAR'], 'rows': [list(k) + [v] for k, v in acc.items() if v]}
    if 'AnnualTechnologyEmissionTS' not in have:
        M_, withy = by_rtm('EmissionActivityRatio', 'EMISSION')
        if M_:
            acc = defaultdict(float)
            for r, l, t, m, y, v in RA:
                for e, ll, w in M_.get((r, t, m, y) if withy else (r, t, m), ()):
                    if ll is None or ll == l:
                        acc[(r, l, t, e, y)] += v * w * YS(l, y)
            out['AnnualTechnologyEmissionTS'] = {
                'dims': ['REGION', 'TIMESLICE', 'TECHNOLOGY', 'EMISSION', 'YEAR'],
                'rows': [list(k) + [v] for k, v in acc.items() if v],
            }


DERIVED_VERSION = '0.20.0'  # bump when the derived results change: runs solved before are computed again when opened


def is_current(run_dir):
    f = os.path.join(run_dir, 'results_derived.json')
    vf = os.path.join(run_dir, 'results_derived.version')
    try:
        return (
            os.path.isfile(f)
            and os.path.getmtime(f) >= os.path.getmtime(os.path.join(run_dir, 'results.json'))
            and open(vf).read().strip() == DERIVED_VERSION
        )
    except OSError:
        return False


def cached(run_dir):
    """derived results of a run, computed once and kept in results_derived.json (again when DERIVED_VERSION changes)"""
    f = os.path.join(run_dir, 'results_derived.json')
    if is_current(run_dir):
        return json.load(open(f))
    have = set(json.load(open(os.path.join(run_dir, 'results.json'))))
    try:
        out = compute(run_dir, have)
    except Exception as e:
        out = {'_error': {'dims': [], 'rows': [], 'error': str(e)}}
    json.dump(out, open(f, 'w'))
    open(os.path.join(run_dir, 'results_derived.version'), 'w').write(DERIVED_VERSION)
    return out


if __name__ == '__main__':
    d = sys.argv[1]
    r = cached(d)
    for k, v in r.items():
        print(k, v['dims'], len(v['rows']))
