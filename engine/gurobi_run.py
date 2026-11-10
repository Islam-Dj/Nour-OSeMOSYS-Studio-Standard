"""Solve an MPS file with Gurobi and write the Studio solution file (the format of highs_run.py).

    python gurobi_run.py problem.mps solution.txt '{"option": value}' [path of gurobi_cl]

Two ways, whichever the computer has:
  - gurobipy (Python package of Gurobi, with the user's licence): the model is read and solved in this process;
  - gurobi_cl (the command line of a Gurobi installation): run with a JSON solution file (JSONSolDetail = 1: the shadow
    prices of the rows too), then converted here.
Output, as HiGHS: solution.txt = "#status S", "#objective V", then "column value" (non-zero values), and solution.txt.duals =
"row value" (non-zero shadow prices, LP only). The names are those of the MPS (written by the Studio from the MathProg model:
RateOfActivity[R1,S1B1,PWRGAS,1,2030]), so the Results view, the charts, Monte Carlo, RDM and rolling horizon read Gurobi
results exactly as HiGHS results.
Options (Studio names): algorithm (simplex -> Method 1 dual simplex, ipm / barrier -> Method 2, pdlp -> Method 6 (PDHG, Gurobi
12+), choose -> automatic), crossover (off -> Crossover 0), threads, time_limit, tolerance (FeasibilityTol, OptimalityTol),
mip_gap, presolve (off -> Presolve 0), barrier_tolerance (BarConvTol).
"""

import json, os, re, subprocess, sys, time

STATUS = {
    1: 'LOADED',
    2: 'OPTIMAL',
    3: 'INFEASIBLE',
    4: 'INFEASIBLE_OR_UNBOUNDED',
    5: 'UNBOUNDED',
    6: 'CUTOFF',
    7: 'ITERATION_LIMIT',
    8: 'NODE_LIMIT',
    9: 'TIME_LIMIT',
    10: 'SOLUTION_LIMIT',
    11: 'INTERRUPTED',
    12: 'NUMERIC',
    13: 'SUBOPTIMAL',
    14: 'INPROGRESS',
    15: 'USER_OBJ_LIMIT',
    16: 'WORK_LIMIT',
    17: 'MEM_LIMIT',
}
ALG = {'simplex': 1, 'primal': 0, 'dual': 1, 'ipm': 2, 'barrier': 2, 'hipo': 2, 'ipx': 2, 'pdlp': 6, 'choose': -1}


def params(o):
    """Studio options -> Gurobi parameters"""
    p = {}
    if o.get('algorithm') in ALG:
        p['Method'] = ALG[o['algorithm']]
    if str(o.get('crossover', '')) == 'off':
        p['Crossover'] = 0
    if o.get('threads'):
        p['Threads'] = int(o['threads'])
    if o.get('time_limit'):
        p['TimeLimit'] = float(o['time_limit'])
    if o.get('tolerance'):
        p['FeasibilityTol'] = p['OptimalityTol'] = min(1e-2, max(1e-9, float(o['tolerance'])))
    if o.get('mip_gap'):
        p['MIPGap'] = float(o['mip_gap'])
    if str(o.get('presolve', '')) == 'off':
        p['Presolve'] = 0
    if o.get('barrier_tolerance'):
        p['BarConvTol'] = float(o['barrier_tolerance'])
    return p


def write(sol, st, obj, x, duals):
    with open(sol, 'w') as f:
        f.write(f'#status {st}\n#objective {obj!r}\n')
        f.writelines(f'{n} {v!r}\n' for n, v in x if abs(v) > 1e-9)
    if duals:
        with open(sol + '.duals', 'w') as f:
            f.writelines(f'{n} {v!r}\n' for n, v in duals if abs(v) > 1e-12)
    print('Gurobi status', st, 'objective', obj, flush=True)


def with_python(mps, sol, p):
    import gurobipy as gp

    m = gp.read(mps)
    for k, v in p.items():
        m.setParam(k, v)
    t0 = time.time()
    m.optimize()
    if m.Status == 4:  # infeasible or unbounded: ask which (presolve dual reductions off)
        print('Gurobi: infeasible or unbounded, solving again with DualReductions = 0 to tell which', flush=True)
        m.setParam('DualReductions', 0)
        m.reset()
        m.optimize()
    st = STATUS.get(m.Status, str(m.Status))
    has = m.SolCount > 0
    if st == 'TIME_LIMIT' and has:
        st = 'TIME_LIMIT (feasible point)'
    obj = m.ObjVal if has else None
    x = [(v.VarName, v.X) for v in m.getVars()] if has else []
    duals = [(c.ConstrName, c.Pi) for c in m.getConstrs()] if has and not m.IsMIP and m.Status == 2 else []
    print(f'Gurobi {gp.gurobi.version()} ({"MIP" if m.IsMIP else "LP"}): {time.time() - t0:.1f} s', flush=True)
    write(sol, st, obj, x, duals)


def with_exe(mps, sol, p, exe):
    js = sol + '.json'
    lg = sol + '.gurobi.log'
    for f in (js, lg):
        if os.path.isfile(f):
            os.remove(f)
    cmd = [exe, f'ResultFile={js}', 'JSONSolDetail=1', f'LogFile={lg}'] + [f'{k}={v}' for k, v in p.items()] + [mps]
    print(' '.join(cmd), flush=True)
    rc = subprocess.run(cmd).returncode
    if os.path.isfile(js):
        d = json.load(open(js))
        I = d.get('SolutionInfo', {})
        st = STATUS.get(I.get('Status'), str(I.get('Status')))
        if st == 'TIME_LIMIT':
            st = 'TIME_LIMIT (feasible point)'
        x = [(v['VarName'], v['X']) for v in d.get('Vars', []) if 'X' in v]
        duals = [(c['ConstrName'], c['Pi']) for c in d.get('Constrs', []) if 'Pi' in c] if st == 'OPTIMAL' else []
        write(sol, st, I.get('ObjVal'), x, duals)
        return
    # no solution: the status from the log (gurobi_cl writes no result file then)
    t = open(lg, errors='ignore').read() if os.path.isfile(lg) else ''
    if re.search(r'Infeasible or unbounded', t, re.I) and 'DualReductions' not in p:
        print('Gurobi: infeasible or unbounded, solving again with DualReductions = 0 to tell which', flush=True)
        return with_exe(mps, sol, {**p, 'DualReductions': 0}, exe)
    st = (
        'INFEASIBLE_OR_UNBOUNDED'
        if re.search(r'Infeasible or unbounded', t, re.I)
        else (
            'INFEASIBLE'
            if re.search(r'Infeasible model', t, re.I)
            else (
                'UNBOUNDED'
                if re.search(r'Unbounded model', t, re.I)
                else (
                    'TIME_LIMIT'
                    if re.search(r'Time limit reached', t, re.I)
                    else (
                        'NO_LICENCE'
                        if re.search(r'licen[cs]e', t, re.I) and re.search(r'error|not|invalid|expired', t, re.I)
                        else f'ERROR (exit code {rc})'
                    )
                )
            )
        )
    )
    write(sol, st, None, [], [])


if __name__ == '__main__':
    mps, sol, opts = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    exe = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
    p = params(opts)
    if exe:
        with_exe(mps, sol, p, exe)
    else:
        try:
            with_python(mps, sol, p)
        except Exception as e:  # licence missing / size-limited licence / Gurobi error: said in the status
            m = str(e)
            print('Gurobi error:', m, flush=True)
            st = (
                'NO_LICENCE (size-limited licence of the pip package: at most 2000 variables and constraints; install your Gurobi licence)'
                if re.search(r'size-limited|too large', m, re.I)
                else 'NO_LICENCE' if re.search(r'licen[cs]e', m, re.I) else 'ERROR'
            )
            write(sol, st + ': ' + m.replace('\n', ' ')[:300] if st == 'ERROR' else st, None, [], [])
