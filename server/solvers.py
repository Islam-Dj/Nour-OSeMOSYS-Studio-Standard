"""Solvers found on this computer and the pipeline of a run (folder <run>/):

data.txt + model.txt -> pre-processing (MUIO sets, CRF, PvAnnuity; engine/solve_check.py) -> GLPK builds the problem
(problem.mps, written by HiGHS with the objective constant in problem.mps.const) -> solver (HiGHS, CBC, GLPK, Gurobi)
-> solution -> solution_std.txt, results/<Variable>.csv, results.json (non-zero values of every variable), status.json, log.txt
"""

import csv, json, os, re, shutil, subprocess, sys, threading, time
from . import config
from .util import longp, shortp, tool, NOWIN
from .cases import CASE_ID, run_base, case_path

JOBS = {}  # run id -> {'proc': Popen or None, 'stop': bool}


def detect():
    """solvers available on this computer"""
    out = []

    def mod(n):
        try:
            __import__(n)
            return True
        except Exception:
            return False

    exe = lambda n: next(
        (p for p in (os.path.join(config.SOLVERS, n + ('.exe' if os.name == 'nt' else '')),) if os.path.isfile(p)), None
    ) or shutil.which(n)
    if mod('highspy'):
        out.append({'id': 'highs', 'name': 'HiGHS (highspy)', 'kind': 'python'})
    elif exe('highs'):
        out.append({'id': 'highs', 'name': 'HiGHS (highs executable)', 'kind': 'exe', 'path': exe('highs')})
    cbc = exe('cbc')
    if not cbc:
        try:
            import pulp

            p = pulp.apis.PULP_CBC_CMD().path
            cbc = p if p and os.path.isfile(p) else None
        except Exception:
            pass
    if cbc:
        out.append({'id': 'cbc', 'name': 'CBC', 'kind': 'exe', 'path': cbc})
    if mod('swiglpk'):
        out.append({'id': 'glpk', 'name': 'GLPK (simplex / interior point)', 'kind': 'python'})
    # Gurobi, if the computer has it: the Python package (gurobipy, with its licence) or the command line gurobi_cl
    # (PATH, the solvers folder of the Studio, or GUROBI_HOME\bin); the app has no Python packages, so it uses gurobi_cl
    grb = exe('gurobi_cl') or next(
        (
            p
            for p in (os.path.join(os.environ.get('GUROBI_HOME', ''), 'bin', 'gurobi_cl' + ('.exe' if os.name == 'nt' else '')),)
            if os.environ.get('GUROBI_HOME') and os.path.isfile(p)
        ),
        None,
    )
    if mod('gurobipy') and not config.FROZEN:
        out.append({'id': 'gurobi', 'name': 'Gurobi (gurobipy)', 'kind': 'python', 'path': ''})
    elif grb:
        out.append({'id': 'gurobi', 'name': 'Gurobi (gurobi_cl)', 'kind': 'exe', 'path': grb})
    return {
        'solvers': out,
        'cpus': os.cpu_count(),
        'glpk_builder': mod('swiglpk'),
        'python': sys.version.split()[0],
        'executable': sys.executable,
        'runs_folder': config.RUNS,
        'cases_folder': config.CASES,
        'app': bool(config.FROZEN) or bool(os.environ.get('NOUR_STUDIO_APP')),
    }


def log(d, msg):
    with open(os.path.join(d, 'log.txt'), 'a', encoding='utf-8') as f:
        f.write(time.strftime('%H:%M:%S ') + msg.rstrip() + '\n')


def status(d, **kw):
    p = os.path.join(d, 'status.json')
    s = read_status(d)
    s.update(kw)
    tmp = p + f'.{os.getpid()}.{threading.get_ident()}.tmp'
    with open(tmp, 'w') as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, p)
    return s  # atomic: a reader never sees a half-written file


def read_status(d):
    p = os.path.join(d, 'status.json')
    for _ in range(5):
        try:
            return json.load(open(p)) if os.path.isfile(p) else {}
        except (ValueError, OSError):
            time.sleep(0.05)
    return {}


def sh(rid, d, cmd, what):
    log(d, f'{what}: ' + ' '.join(f'"{c}"' if ' ' in c else c for c in cmd))
    with open(os.path.join(d, 'log.txt'), 'a', encoding='utf-8') as f:
        # the run folder may be in Windows' long form: other programs get the ordinary working folder and file names
        # relative to it (the run folder itself is short enough; its files may not be)
        pre = d.rstrip('\\/') + os.sep
        cmd = [a.replace(pre, '') if isinstance(a, str) else a for a in cmd]
        pr = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=shortp(d), **NOWIN)
        JOBS[rid]['proc'] = pr
        rc = pr.wait()
        JOBS[rid]['proc'] = None
    if JOBS[rid].get('stop'):
        raise RuntimeError('stopped by the user')
    return rc


def read_solution(solver, path, duals=None):
    """-> (status, objective, {column name: value}); with a dict as duals, the shadow prices of the rows go in it"""
    st, obj, x = 'UNKNOWN', None, {}
    lines = open(path, encoding='utf-8', errors='ignore').read().splitlines()
    if (
        solver == 'cbc'
    ):  # "Optimal - objective value 123" then (printingOptions all) rows "idx name activity dual", then columns "idx name value reduced"
        h = lines[0] if lines else ''
        st = 'OPTIMAL' if h.lower().startswith('optimal') else h.split(' - ')[0].upper() or 'UNKNOWN'
        m = re.search(r'objective value\s+(-?[\d.eE+]+)', h)
        obj = float(m.group(1)) if m else None
        body = [ln.replace('**', ' ').split() for ln in lines[1:]]
        body = [t for t in body if len(t) >= 3]
        starts = [k for k, t in enumerate(body) if t[0] == '0']
        cut = starts[1] if len(starts) > 1 else 0  # two blocks: rows, then columns
        for k, t in enumerate(body):
            if k < cut:
                if duals is not None and len(t) >= 4 and abs(float(t[3])) > 1e-12:
                    duals[t[1]] = float(t[3])
            elif abs(float(t[2])) > 1e-12:
                x[t[1]] = float(t[2])  # non-zero values, as the other solvers
    else:  # our format: "#status S", "#objective V", "name value" (HiGHS, GLPK, Gurobi through engine/gurobi_run.py)
        for ln in lines:
            if ln.startswith('#status'):
                st = ln.split(None, 1)[1].strip()
            elif ln.startswith('#objective'):
                v_ = ln.split()[1]
                obj = None if v_ == 'None' else float(v_)
            elif ln and not ln.startswith('#'):
                n, v = ln.rsplit(' ', 1)
                x[n] = float(v)
    return st, obj, x


def convert_highs_exe(src, dst):
    """solution file of the highs executable -> our format"""
    st, obj, x, cols = 'UNKNOWN', None, {}, False
    for ln in open(src, errors='ignore').read().splitlines():
        if ln.startswith('Model status'):
            continue
        if re.match(r'^(Optimal|Infeasible|Unbounded|Time limit)', ln):
            st = ln.strip().upper()
        if ln.startswith('Objective'):
            obj = float(ln.split()[-1])
        if ln.startswith('# Columns'):
            cols = True
            continue
        if ln.startswith('# Rows'):
            cols = False
        if cols and ln.strip():
            t = ln.split()
            if len(t) >= 2:
                try:
                    x[t[0]] = float(t[1])
                except ValueError:
                    pass
    with open(dst, 'w') as f:
        f.write(f'#status {st}\n#objective {obj!r}\n')
        f.writelines(f'{k} {v!r}\n' for k, v in x.items() if abs(v) > 1e-12)


def why(d, default):
    """a clearer reason when the solver step could not start"""
    try:
        lg = open(os.path.join(d, 'log.txt'), encoding='utf-8', errors='ignore').read()
    except OSError:
        return default
    m = re.search(r"No module named '(\w+)'", lg)
    if m:
        return (
            f'the Python package {m.group(1)} is not installed for {sys.executable}: close the Studio and run START_SOLVER.bat again, '
            f'or in a command window: "{sys.executable}" -m pip install {m.group(1)}  (the desktop app needs no Python)'
        )
    return default


def run_job(rid, d, solver, opts):
    t0 = time.time()
    S = {s['id']: s for s in detect()['solvers']}
    S.setdefault('check', {'name': 'feasibility check'})
    try:
        status(d, stage='pre-processing and building the problem (GLPK)', state='running', started=time.strftime('%Y-%m-%d %H:%M:%S'))
        mps = os.path.join(d, 'problem.mps')
        sol = os.path.join(d, 'solution.txt')
        if solver == 'check':  # "Check feasibility": the exact test, before solving (engine/diagnose.py --check)
            rc = sh(rid, d, tool('solve_check') + ['model.txt', 'data.txt', f'--write-mps={mps}'], 'GLPK builds the problem')
            if rc or not os.path.isfile(mps):
                raise RuntimeError(why(d, 'GLPK could not build the problem (model or data rejected: see the log)'))
            status(d, stage='testing feasibility: smallest changes of the limits (HiGHS, no costs)', built=round(time.time() - t0, 1))
            sh(
                rid,
                d,
                tool('diagnose') + [mps, os.path.join(d, 'diagnosis.json'), str(opts.get('diagnose_time', 600)), '--check'],
                'feasibility check',
            )
            diag = json.load(open(os.path.join(d, 'diagnosis.json')))
            feas = diag.get('status') == 'Feasible'
            if not opts.get('keep_mps') and os.path.isfile(mps):
                os.remove(mps)
            log(
                d,
                (
                    'feasible: the solver will find a solution'
                    if feas
                    else f"infeasible: {len(diag.get('rows', []))} limits must change (see the list)"
                ),
            )
            status(
                d,
                state='done',
                stage='done',
                kind='check',
                solver_status='FEASIBLE' if feas else 'INFEASIBLE',
                not_solution=not feas,
                diagnosis=diag,
                objective=None,
                elapsed=round(time.time() - t0, 1),
                variables={},
                duals={},
            )
            return
        if solver == 'glpk':
            rc = sh(
                rid,
                d,
                tool('solve_check')
                + ['model.txt', 'data.txt', f'--glpk-solve={sol}', f"--method={opts.get('glpk_method', 'simplex')}"]
                + ([f"--tmlim={opts['time_limit']}"] if opts.get('time_limit') else []),
                'GLPK',
            )
            if rc:
                raise RuntimeError(why(d, 'GLPK stopped (model or data rejected: see the log)'))
        else:
            rc = sh(rid, d, tool('solve_check') + ['model.txt', 'data.txt', f'--write-mps={mps}'], 'GLPK builds the problem')
            if rc or not os.path.isfile(mps):
                raise RuntimeError(why(d, 'GLPK could not build the problem (model or data rejected: see the log)'))
            status(d, stage=f'solving with {S[solver]["name"]}', built=round(time.time() - t0, 1))
            if solver == 'highs':
                ho = {'output_flag': True, 'log_to_console': True}
                if opts.get('algorithm'):
                    ho['solver'] = opts['algorithm']
                if opts.get('crossover'):
                    ho['run_crossover'] = opts['crossover']
                if opts.get('time_limit'):
                    ho['time_limit'] = float(opts['time_limit'])
                if opts.get('threads'):
                    ho['threads'] = int(opts['threads'])
                if opts.get('tolerance'):
                    ho['primal_feasibility_tolerance'] = ho['dual_feasibility_tolerance'] = float(opts['tolerance'])
                if opts.get('mip_gap'):
                    ho['mip_rel_gap'] = float(opts['mip_gap'])
                if S['highs']['kind'] == 'python':
                    rc = sh(
                        rid, d, tool('highs_run') + [mps, sol, json.dumps(ho)], 'HiGHS'
                    )  # an interior point that stops "Unknown" is rescued inside (dual simplex, same process)
                else:
                    with open(os.path.join(d, 'highs.opt'), 'w') as f:
                        f.write(
                            '\n'.join(f'{k} = {str(v).lower() if isinstance(v, bool) else v}' for k, v in ho.items())
                            + '\nwrite_solution_style = 1\n'
                        )
                    rc = sh(
                        rid,
                        d,
                        [S['highs']['path'], '--model_file', mps, '--options_file', 'highs.opt', '--solution_file', 'highs_sol.txt'],
                        'HiGHS',
                    )
                    convert_highs_exe(os.path.join(d, 'highs_sol.txt'), sol)
            elif solver == 'cbc':
                cmd = [S['cbc']['path'], mps]
                if opts.get('time_limit'):
                    cmd += ['-sec', str(opts['time_limit'])]
                if opts.get('threads'):
                    cmd += ['-threads', str(opts['threads'])]
                if opts.get('mip_gap'):
                    cmd += ['-ratioGap', str(opts['mip_gap'])]
                if opts.get('cbc_method') == 'barrier':
                    cmd += ['-barrier']
                cmd += ['-solve', '-printingOptions', 'all', '-solu', sol]
                rc = sh(rid, d, cmd, 'CBC')
            elif solver == 'gurobi':  # engine/gurobi_run.py writes our solution format (+ shadow prices)
                rc = sh(rid, d, tool('gurobi_run') + [mps, sol, json.dumps(opts), S['gurobi'].get('path') or ''], 'Gurobi')
            if not os.path.isfile(sol):
                raise RuntimeError(f'the solver wrote no solution (exit code {rc}): see the log')
        status(d, stage='reading the results')
        duals = {}
        st, obj, x = read_solution(solver, sol, duals)
        if str(st).startswith('NO_LICENCE'):
            raise RuntimeError(f'Gurobi has no licence for this model: {st}')
        if os.path.isfile(sol + '.duals'):
            for ln in open(sol + '.duals', encoding='utf-8', errors='ignore'):
                n, v = ln.rsplit(' ', 1)
                duals[n] = float(v)
        const = 0.0  # constant part of the objective (in the objective of every solver)
        for f, pre in ((mps + '.const', ''), (sol, '#constant')):
            if os.path.isfile(f):
                for ln in open(f, encoding='utf-8', errors='ignore'):
                    if ln.startswith(pre):
                        try:
                            const = float(ln[len(pre) :].strip())
                            break
                        except ValueError:
                            pass
        with open(os.path.join(d, 'solution_std.txt'), 'w') as f:  # the solution in one form whatever the solver (read by the MUIO export)
            f.write(f'#status {st}\n#objective {obj!r}\n#constant {const!r}\n')
            f.writelines(f'{n} {v!r}\n' for n, v in x.items() if abs(v) > 1e-12)
        res = {}
        for n, v in x.items():
            m = re.match(r'^([A-Za-z_]\w*)\[(.*)\]$', n)
            if m:
                res.setdefault(m.group(1), []).append(m.group(2).split(',') + [v])
            elif re.match(r'^[A-Za-z_]\w*$', n):
                res.setdefault(n, []).append([v])
        os.makedirs(os.path.join(d, 'results'), exist_ok=True)
        for k, rows in res.items():
            with open(os.path.join(d, 'results', k + '.csv'), 'w', newline='') as f:
                w = csv.writer(f)
                w.writerow([f'i{j + 1}' for j in range(len(rows[0]) - 1)] + ['value'])
                w.writerows(rows)
        json.dump(res, open(os.path.join(d, 'results.json'), 'w'))
        try:
            var_index(d)  # one file per variable, for the Results view
        except Exception as e:
            log(d, f'results by variable not written: {e}')
        dres = {}  # shadow prices by constraint
        for n, v in duals.items():
            m = re.match(r'^([A-Za-z_]\w*)\[(.*)\]$', n)
            if m:
                dres.setdefault(m.group(1), []).append(m.group(2).split(',') + [v])
            elif re.match(r'^[A-Za-z_]\w*$', n):
                dres.setdefault(n, []).append([v])
        json.dump(dres, open(os.path.join(d, 'results_duals.json'), 'w'))
        diag = None
        if not re.search(r'OPTIMAL', st or '', re.I) and re.search(
            r'INFEAS|UNBOUND|UNKNOWN|UNDEF|ERROR|SOLVER_RC|NUMERIC|INTERRUPTED', st or 'UNKNOWN', re.I
        ):
            # not a solution: the values the solver left (CBC writes the point where it stopped) must not be read as results.
            # Ask HiGHS for the smallest set of constraints that cannot hold together (engine/diagnose.py).
            log(d, f'the solver ended with status {st}: the values written are NOT a solution. Looking for the cause (infeasible set)...')
            status(d, stage='looking for the cause of the infeasibility (HiGHS IIS)')
            try:
                if not os.path.isfile(mps):
                    sh(rid, d, tool('solve_check') + ['model.txt', 'data.txt', f'--write-mps={mps}'], 'GLPK builds the problem')
                sh(rid, d, tool('diagnose') + [mps, os.path.join(d, 'diagnosis.json'), str(opts.get('diagnose_time', 300))], 'diagnosis')
                diag = json.load(open(os.path.join(d, 'diagnosis.json')))
            except Exception as e:
                log(d, f'diagnosis failed: {e}')
                diag = {'note': f'diagnosis failed: {e}', 'rows': [], 'cols': []}
        if os.path.isfile(mps) and not opts.get('keep_mps'):
            os.remove(mps)
        status(
            d,
            state='done',
            not_solution=diag is not None,
            diagnosis=diag,
            kind='solve',
            stage='done',
            solver_status=st,
            objective=obj,
            objective_constant=const,
            elapsed=round(time.time() - t0, 1),
            variables={k: len(v) for k, v in res.items()},
            duals={k: len(v) for k, v in dres.items()},
        )
        log(
            d,
            f'done: {st}, objective {obj}, {sum(len(v) for v in res.values())} non-zero values in {len(res)} variables, {time.time() - t0:.1f} s',
        )
    except Exception as e:
        log(d, f'FAILED: {e}')
        status(d, state='failed', stage='failed', error=str(e), elapsed=round(time.time() - t0, 1))


def start_run(body):
    """POST /api/run: new run folder, then the pipeline in a thread"""
    name = re.sub(r'[^\w.-]+', '_', body.get('name') or 'run')[:24]
    rid = time.strftime('%Y%m%d-%H%M%S-') + name  # 24 characters: Windows paths stay short
    cid = run_base(body.get('case'))
    base = os.path.join(case_path(cid), 'runs') if cid else config.RUNS
    d = longp(os.path.join(base, rid))
    os.makedirs(d)
    open(os.path.join(d, 'data.txt'), 'w', encoding='utf-8', newline='\n').write(body['data'])
    open(os.path.join(d, 'model.txt'), 'w', encoding='utf-8', newline='\n').write(body['model'])
    meta = {
        'name': body.get('name'),
        'model_name': body.get('model_name'),
        'case': cid,
        'scenarios': body.get('scenarios'),
        'solver': body['solver'],
        'options': body.get('options', {}),
        'created': time.strftime('%Y-%m-%d %H:%M:%S'),
    }
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
    status(d, state='queued', stage='queued')
    JOBS[rid] = {'proc': None, 'stop': False}
    threading.Thread(target=run_job, args=(rid, d, body['solver'], body.get('options', {})), daemon=True).start()
    return {'id': rid}


def stop_run(rid, delete=False):
    from .cases import run_dir

    j = JOBS.get(rid)
    if j:
        j['stop'] = True
        (j['proc'] and j['proc'].terminate())
    if delete:
        shutil.rmtree(run_dir(rid), ignore_errors=True)
    return {'ok': True}


# ---- results by variable: the results of a run are split once into one small file per variable, so showing a variable
# reads that file only (a large model: 13 MB for RateOfActivity instead of the 87 MB of every variable, 0.2 s instead of 4-5 s).
# results.json stays the reference (MUIO export, Monte Carlo, older Studios); the split files are made from it when missing.
_SPLIT_LOCK = threading.Lock()
_VCACHE = {}  # (path, mtime) -> rows, a few recent variables


def _split(d, src_name, out_dir, with_dims=False):
    src = os.path.join(d, src_name)
    od = os.path.join(d, out_dir)
    idx = os.path.join(od, '_index.json')
    if not os.path.isfile(src):
        return {}
    with _SPLIT_LOCK:
        if os.path.isfile(idx) and os.path.getmtime(idx) >= os.path.getmtime(src):
            return read_json_safe(idx)
        res = json.load(open(src))
        os.makedirs(od, exist_ok=True)
        index = {}
        for k, v in res.items():
            rows = v['rows'] if with_dims else v
            with open(os.path.join(od, k + '.json'), 'w') as f:
                json.dump(v if with_dims else {'rows': rows}, f)
            index[k] = {
                'n': len(rows),
                **({'dims': v.get('dims', []), **({'error': v['error']} if 'error' in v else {})} if with_dims else {}),
            }
        tmp = idx + '.tmp'
        json.dump(index, open(tmp, 'w'))
        os.replace(tmp, idx)
        return index


def read_json_safe(p):
    for _ in range(5):
        try:
            return json.load(open(p))
        except (ValueError, OSError):
            time.sleep(0.05)
    return {}


def var_index(d):
    """{variable: rows} of the solver results (split files made if needed)"""
    return {k: v['n'] for k, v in _split(d, 'results.json', 'results_vars').items()}


def derived_index(d):
    """{variable: {n, dims}} of the derived results (computed once by engine/derived.py, then split)"""
    import derived as DV

    if not DV.is_current(d):
        DV.cached(d)
    return _split(d, 'results_derived.json', 'results_derived_vars', with_dims=True)


def _var_file(f):
    k = (f, os.path.getmtime(f))
    if k not in _VCACHE:
        if len(_VCACHE) >= 6:
            _VCACHE.pop(next(iter(_VCACHE)))
        _VCACHE[k] = json.load(open(f))
    return _VCACHE[k]


def run_info(d, rid, full):
    """GET /api/run/<id>[/status]: status, last log lines, meta; with full, the index sets of every variable and the derived results"""
    s = read_status(d)
    lg = (
        open(os.path.join(d, 'log.txt'), encoding='utf-8', errors='ignore').read().splitlines()
        if os.path.isfile(os.path.join(d, 'log.txt'))
        else []
    )
    s['log'] = lg[-60:]
    s['id'] = rid
    s.update(json.load(open(os.path.join(d, 'meta.json'))))
    if full and s.get('state') == 'done' and os.path.isfile(os.path.join(d, 'results.json')):
        try:
            import derived as DV

            s['vardims'] = DV.var_dims(open(os.path.join(d, 'model.txt'), encoding='utf-8', errors='ignore').read())
            dv = derived_index(d)
            s['derived'] = {k: v['n'] for k, v in dv.items() if not k.startswith('_')}
            s['vardims'].update({k: v['dims'] for k, v in dv.items() if not k.startswith('_')})
            if '_error' in dv:
                s['derived_error'] = dv['_error'].get('error')
        except Exception as e:
            s['derived_error'] = str(e)
        try:
            s['inputs'] = {k: len(v['rows']) for k, v in run_inputs(d).items()}
        except Exception as e:
            s['inputs_error'] = str(e)
        try:  # the descriptions written in the run's data file (#@desc CODE text, #@setdesc SET CODE text), for Ask the results
            txt = open(os.path.join(d, 'data.txt'), encoding='utf-8', errors='ignore').read()
            s['desc'] = dict(re.findall(r'(?m)^#@desc\s+(\S+)\s+(.*\S)', txt))
            s['setdesc'] = [list(x) for x in re.findall(r'(?m)^#@setdesc\s+(\S+)\s+(\S+)\s+(.*\S)', txt)]
            s['sets'] = {k: v.split() for k, v in re.findall(r'(?m)^set\s+(\w+)\s*:=\s*([^;]*);', txt)}
        except Exception:
            pass
        try:
            s['consdims'] = cons_dims(open(os.path.join(d, 'model.txt'), encoding='utf-8', errors='ignore').read())
        except Exception:
            s['consdims'] = {}
    return s


def cons_dims(model):
    """index sets of every constraint of a model file (the code is in engine/derived.py, shared with Monte Carlo)"""
    import derived as DV

    return DV.cons_dims(model)


_ICACHE = {}


def run_inputs(d):
    """The data of the chart builder: every input of the run and every result, with all their details.
    every parameter given a value in the run's data file -> {name: {'dims': [...], 'rows': [[idx..., value], ...]}}"""
    dp, mp = os.path.join(d, 'data.txt'), os.path.join(d, 'model.txt')
    if not os.path.isfile(dp) or not os.path.isfile(mp):
        return {}
    k = (d, os.path.getmtime(dp))
    if k not in _ICACHE:
        from muio_bridge import parse_data, model_dims
        import derived as DV

        pd = model_dims(open(mp, encoding='utf-8', errors='ignore').read())
        _, params, _ = parse_data(open(dp, encoding='utf-8', errors='ignore').read(), pd)
        out = {}
        for p, P in params.items():
            rows = [list(key) + [v] for key, v in P['recs'].items() if v is not None]
            if rows:
                dims = [DV.base_set(x) for x in pd.get(p, [])]
                n = len(rows[0]) - 1
                out[p] = {'dims': dims if len(dims) == n else [f'index {i + 1}' for i in range(n)], 'rows': rows}
        if len(_ICACHE) >= 4:
            _ICACHE.pop(next(iter(_ICACHE)))
        _ICACHE[k] = out
    return _ICACHE[k]


def run_var(d, name):
    if name == 'OBJECTIVE':  # the objective, its constant part, the number MUIO shows
        s = read_status(d)
        o, c = s.get('objective'), s.get('objective_constant') or 0.0
        return {
            'name': name,
            'dims': ['PART'],
            'rows': [] if o is None else [['Objective (full)', o], ['Constant part', c], ['As MUIO shows it', o - c]],
        }
    if name.startswith('DUAL.'):  # shadow prices of a constraint
        dv = json.load(open(os.path.join(d, 'results_duals.json'))) if os.path.isfile(os.path.join(d, 'results_duals.json')) else {}
        rows = dv.get(name[5:], [])
        dims = cons_dims(open(os.path.join(d, 'model.txt'), encoding='utf-8', errors='ignore').read()).get(name[5:], []) if rows else []
        return {
            'name': name,
            'rows': rows,
            'dims': dims if rows and len(dims) == len(rows[0]) - 1 else [f'index {i + 1}' for i in range(len(rows[0]) - 1)] if rows else [],
            'dual': True,
        }
    if name.startswith('IN.'):  # an input (parameter of the run's data file), with all its index sets
        P = run_inputs(d).get(name[3:])
        return {'name': name, 'rows': P['rows'] if P else [], 'dims': P['dims'] if P else [], 'input': True}
    if not re.match(r'^[A-Za-z_]\w*$', name):
        return {'name': name, 'rows': []}
    if name in var_index(d):
        return {'name': name, 'rows': _var_file(os.path.join(d, 'results_vars', name + '.json'))['rows']}
    if os.path.isfile(os.path.join(d, 'results_derived.json')):
        dv = derived_index(d)
        if name in dv:
            v = _var_file(os.path.join(d, 'results_derived_vars', name + '.json'))
            return {'name': name, 'rows': v['rows'], 'dims': v['dims'], 'derived': True}
    return {'name': name, 'rows': []}


def run_list():
    from .cases import all_run_dirs

    out = []
    for d in sorted(all_run_dirs(), key=os.path.basename, reverse=True):
        m = json.load(open(os.path.join(d, 'meta.json')))
        m.update(read_status(d))
        m['id'] = os.path.basename(d)
        m.pop('variables', None)
        out.append(m)
    return out
