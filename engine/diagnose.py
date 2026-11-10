"""Why is a run infeasible?  python diagnose.py problem.mps out.json [time limit s]

When the solver ends without an optimal solution (infeasible), the values it leaves are NOT a solution: CBC, for example,
writes the point where it stopped (capacities and fixed costs of the existing plants, everything else 0). This tool asks
HiGHS for an IIS (irreducible infeasible set): the smallest group of constraints and bounds that cannot hold together.
Each constraint is named with the model row and its indices, and with the data parameter(s) that row reads, so the
modeller knows which value to look at.
"""

import json, re, sys, time

# model row -> what it means and the parameters to check
ROWS = {
    'EBa11': (
        'energy balance in a time slice (production + imports >= use + demand + exports)',
        'SpecifiedAnnualDemand, SpecifiedDemandProfile, the producers of the commodity (their capacity, CapacityFactor, OutputActivityRatio)',
    ),
    'EBa11b': ('balance with equality (BalanceEquality = 1)', 'BalanceEquality, the users of the commodity'),
    'EBb4': ('yearly energy balance', 'AccumulatedAnnualDemand, the producers of the commodity'),
    'EBs': ('seasonal balance (CommodityTimeSliced = 2)', 'CommodityTimeSliced, the producers in that season'),
    'CAa4': (
        'capacity limit in a time slice: activity <= capacity x CapacityFactor x CapacityToActivityUnit',
        'CapacityFactor, CapacityToActivityUnit, ResidualCapacity',
    ),
    'CAb1': (
        'yearly availability: activity <= capacity x AvailabilityFactor x ...',
        'AvailabilityFactor, CapacityFactor, ResidualCapacity',
    ),
    'TCC1': (
        'total capacity <= TotalAnnualMaxCapacity',
        'TotalAnnualMaxCapacity (0 forbids the technology; existing capacity above it is impossible)',
    ),
    'TCC2': ('total capacity >= TotalAnnualMinCapacity', 'TotalAnnualMinCapacity'),
    'NCC1': ('new capacity <= TotalAnnualMaxCapacityInvestment', 'TotalAnnualMaxCapacityInvestment (0 = no new build in that year)'),
    'NCC2': ('new capacity >= TotalAnnualMinCapacityInvestment', 'TotalAnnualMinCapacityInvestment'),
    'AAC2': ('yearly activity <= upper limit', 'TotalTechnologyAnnualActivityUpperLimit (0 forbids any activity)'),
    'AAC3': ('yearly activity >= lower limit', 'TotalTechnologyAnnualActivityLowerLimit'),
    'TAC2': ('activity over the horizon <= upper limit', 'TotalTechnologyModelPeriodActivityUpperLimit'),
    'TAC3': ('activity over the horizon >= lower limit', 'TotalTechnologyModelPeriodActivityLowerLimit'),
    'LU1': ('activity of a mode <= limit', 'TechnologyActivityByModeUpperLimit'),
    'LU2': ('activity of a mode >= limit', 'TechnologyActivityByModeLowerLimit'),
    'LU3': ('growth of a mode limited', 'TechnologyActivityIncreaseByModeLimit'),
    'LU4': ('fall of a mode limited', 'TechnologyActivityDecreaseByModeLimit'),
    'E8': ('yearly emission limit of the region', 'AnnualEmissionLimit (0 = no emission allowed)'),
    'E8b': ('emission limit summed over the regions', 'RegionalAnnualEmissionLimit'),
    'E9': ('emission limit over the horizon', 'ModelPeriodEmissionLimit'),
    'UDC1': ('user-defined constraint (<=)', 'UDCMultiplier*, UDCConstant'),
    'UDC2': ('user-defined constraint (=)', 'UDCMultiplier*, UDCConstant'),
    'RUDC1': ('regional user-defined constraint (<=)', 'UDCMultiplier*, UDCConstant'),
    'RUDC2': ('regional user-defined constraint (=)', 'UDCMultiplier*, UDCConstant'),
    'E_AnnualBudgetLimit': ('capital budget of the year', 'BudgetBaseline, BudgetCapitalShare, MaxFDI, MaxBorrowing'),
    'OP1': ('operational profile fixes the shape of the activity', 'OperationalProfile'),
    'CAv2': ('cohorts must add up to the capacity', 'ResidualCapacityByVintage (its sum must equal ResidualCapacity every year)'),
    'FS1': ('capital spending must be covered by finance sources', 'FinanceAvailable, FinanceEligible'),
    'FS1s': ('storage spending must be covered by finance sources', 'FinanceAvailable, FinanceEligibleStorage'),
    'FS3a': ('finance source limit', 'FinanceAvailable'),
    'FS3b': ('committed finance', 'FinanceMin'),
    'FS5': (
        'budget of the region (budget sources)',
        'FinanceAvailable, FinanceRentShare, FinanceBudgetImportShare, FinanceBudgetOpexShare, FinanceServiceInBudget',
    ),
    'FS2b': ('smallest share of a project a source must pay', 'FinanceMinShare'),
    'FS2t': ('smallest share of a storage project a source must pay', 'FinanceMinShareStorage'),
    'FS3c': ('total money of a source over the period', 'FinanceCumulativeMax'),
    'FS6c': ('regional fund: draws within the pool', 'FinanceRentShare, FinanceAvailable of the fund'),
    'FS6b': ('regional fund: draw share of a region', 'FinanceDrawShare'),
    'UC3': ('minimum stable load', 'MinStableLoad'),
    'UC5': ('minimum up time', 'MinUpTime'),
    'UC6': ('minimum down time', 'MinDownTime'),
    'UC7': ('ramp up', 'RampUpRate'),
    'UC8': ('ramp down', 'RampDownRate'),
}
COLS = {
    'NewCapacity': 'new capacity',
    'RateOfActivity': 'activity',
    'TotalCapacityAnnual': 'total capacity',
    'NewStorageCapacity': 'new storage capacity',
    'Trade': 'trade',
}


fin = lambda v: v if abs(v) < 1e300 else None  # JSON has no infinity


def explain(name):
    key = name.split('[')[0]
    fam = key.split('_')[0]
    for k in (key, fam, re.sub(r'\d+$', '', fam)):
        if k in ROWS:
            return ROWS[k]
    if fam.startswith('CS'):
        return ('chronological storage', 'Storage* parameters, MinStorageCharge, TimesliceHours')
    if fam.startswith('S') or fam.startswith('SC'):
        return ('storage (extended equations)', 'MinStorageCharge, TechnologyTo/FromStorage, storage capacity')
    return ('', '')


# rows whose right-hand side is data (a limit, a target, a demand): the elastic check may move them
RELAX = re.compile(
    r'^(EBa11|EBa11b|EBb4|EBs|TCC1|TCC2|NCC1|NCC2|AAC2|AAC3|TAC2|TAC3|LU1|LU2|LU3|LU4|E8|E8b|E9|UDC1|UDC2|RUDC1|RUDC2|'
    r'E_AnnualBudgetLimit|B6|B6b|B7|B7b|OP1|CAv2|FS1|FS1s|FS2|FS2b|FS2s|FS2t|FS3a|FS3b|FS3c|FS5|FS6b|FS6c|UC3|UC5|UC6|UC7|UC8|CS6|CS7|CS11|CS12|CS13)_'
)


def elastic(h, tlim=300):
    """The smallest changes of the limits that make the model feasible (an exact LP): every row of RELAX gets a slack that
    lets it be broken, at a cost of 1 per unit relative to its right-hand side (so 10 % of a big limit costs as much as
    10 % of a small one; a balance, i.e. a demand not served, costs 1000 times more); the costs of the model are set to 0. The slacks > 0 say which limit, demand or target must change,
    and by how much. Another set of changes may work too: this one is the smallest in that relative sense."""
    import highspy

    lp = h.getLp()
    nr, nc = lp.num_row_, lp.num_col_
    inf = highspy.kHighsInf
    e = highspy.Highs()
    e.setOptionValue('output_flag', False)
    e.setOptionValue('time_limit', float(tlim))
    e.passModel(lp)
    import numpy as np

    e.changeColsCost(nc, np.arange(nc, dtype=np.int32), np.zeros(nc))
    if lp.integrality_ and len(lp.integrality_):  # the relaxed LP is enough to locate the limits
        e.changeColsIntegrality(nc, np.arange(nc, dtype=np.int32), np.array([highspy.HighsVarType.kContinuous] * nc))
    slacks = []
    for i, n in enumerate(lp.row_names_):
        if not RELAX.match(n):
            continue
        lo, up = lp.row_lower_[i], lp.row_upper_[i]
        for sign, bnd in ((-1.0, up), (1.0, lo)):  # -1: the row may go above its upper bound; +1: below its lower bound
            if abs(bnd) >= inf:
                continue
            w = (1000.0 if n.startswith('EB') else 1.0) / max(1.0, abs(bnd))  # a demand not served is the last resort
            e.addCol(w, 0.0, inf, 1, np.array([i], dtype=np.int32), np.array([sign]))
            slacks.append((i, sign, bnd))
    e.run()
    st = e.modelStatusToString(e.getModelStatus())
    if 'ptimal' not in st:
        return {'status': st, 'changes': []}
    x = e.getSolution().col_value
    ch = []
    for k, (i, sign, bnd) in enumerate(slacks):
        v = x[nc + k]
        if v > 1e-7 * max(1.0, abs(bnd)):
            n = lp.row_names_[i]
            what, check = explain(n)
            ch.append(
                {
                    'name': n,
                    'meaning': what,
                    'check': check,
                    'limit': fin(bnd),
                    'needed': bnd - v if sign > 0 else bnd + v,
                    'by': v,
                    'side': 'upper' if sign < 0 else 'lower',
                }
            )
    ch.sort(key=lambda c: -c['by'] / max(1.0, abs(c['limit'])))
    return {'status': st, 'changes': ch[:200], 'count': len(ch)}


def diagnose(mps, out, tlim=300, check=False):
    """after an infeasible run: the smallest changes of the limits (elastic LP), then, if those say nothing, an IIS.
    check=True (before a run, "Check feasibility"): only the elastic LP, which is cheap (no costs, any feasible point)."""
    import highspy

    t0 = time.time()
    h = highspy.Highs()
    h.setOptionValue('output_flag', False)
    h.setOptionValue('time_limit', float(tlim))
    h.readModel(mps)
    res = {'status': '', 'rows': [], 'cols': [], 'note': ''}
    if check:
        el = elastic(h, tlim)
        res['elastic'] = el
        res['status'] = 'Infeasible' if el.get('changes') else ('Feasible' if 'ptimal' in el.get('status', '') else el.get('status', ''))
        res['rows'] = [{k: c[k] for k in ('name', 'meaning', 'check')} for c in el.get('changes', [])]
        st = res['status']
    else:
        h.run()
        st = h.modelStatusToString(h.getModelStatus())
        res['status'] = st
    if not check and 'nfeasible' not in st:
        res['note'] = f'HiGHS finds the problem {st}: no infeasible set to show.'
    elif not check:
        try:
            res['elastic'] = elastic(h, tlim)
        except Exception as ex:
            res['elastic'] = {'status': 'failed', 'error': str(ex), 'changes': []}
        if res['elastic'].get('changes'):
            res['rows'] = [{k: c[k] for k in ('name', 'meaning', 'check')} for c in res['elastic']['changes']]
            res['note'] = 'Smallest changes of the limits that make the model feasible (exact LP).'
        else:
            lp = h.getLp()
            iis = None
            for strat in (4, 2):  # 4: small set from the LP; 2: from the ray (larger)
                try:
                    h.setOptionValue('iis_strategy', strat)
                    s_, i = h.getIis()
                    if i.valid_ and (len(i.row_index_) or len(i.col_index_)):
                        iis = i
                        break
                except Exception as e:
                    res['note'] = str(e)
            if iis is None:
                res['note'] = res['note'] or 'HiGHS could not isolate an infeasible set.'
            else:
                bnd = lambda b: {0: 'lower', 1: 'lower', 2: 'upper', 3: 'both', 4: 'both'}.get(int(b), str(b))
                for k, i in enumerate(iis.row_index_):
                    n = lp.row_names_[i]
                    what, chk = explain(n)
                    res['rows'].append(
                        {'name': n, 'meaning': what, 'check': chk, 'bound': bnd(iis.row_bound_[k]) if k < len(iis.row_bound_) else ''}
                    )
                for k, j in enumerate(iis.col_index_):
                    n = lp.col_names_[j]
                    res['cols'].append(
                        {
                            'name': n,
                            'meaning': COLS.get(n.split('[')[0], ''),
                            'bound': bnd(iis.col_bound_[k]) if k < len(iis.col_bound_) else '',
                            'lower': fin(lp.col_lower_[j]),
                            'upper': fin(lp.col_upper_[j]),
                        }
                    )
    # one line per constraint family, the limits first (the balances and accounting rows only carry the flows):
    # a large set (e.g. 279 rows) usually comes down to one or two limits, such as an emission cap of 0
    fam = {}
    for x in res['rows']:
        k = x['name'].split('[')[0]
        f = fam.setdefault(k, {'family': k, 'count': 0, 'meaning': x['meaning'], 'check': x['check'], 'example': x['name']})
        f['count'] += 1
    acct = lambda k: (
        1 if re.match(r'^(EB|Acc|AAC1|CAa[123]|TDC|RES_|CC1|SV|SI|S\d|E1_|E2_|E5|V|AVv|CAv1)', k) and not re.match(r'^(EBa11b)', k) else 0
    )
    res['families'] = sorted(fam.values(), key=lambda f: (acct(f['family']), f['count']))
    res['seconds'] = round(time.time() - t0, 1)
    json.dump(res, open(out, 'w'), indent=1)
    return res


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if x != '--check']
    r = diagnose(a[0], a[1], float(a[2]) if len(a) > 2 else 300, check='--check' in sys.argv)
    print('DIAGNOSIS', r['status'], len(r['rows']), 'rows', len(r['cols']), 'columns', r['note'])
    for x in r['families']:
        print(f"  {x['family']} x{x['count']} | {x['meaning']} | check: {x['check']} | e.g. {x['example']}")
    for c in (r.get('elastic') or {}).get('changes', [])[:20]:
        print(f"  CHANGE {c['name']}: {c['side']} bound {c['limit']:.6g} -> {c['needed']:.6g} | {c['check']}")
