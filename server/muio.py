"""Export to MUIO (engine/muio_bridge.py runs MUIO's own code in a separate process)."""

import json, os, subprocess, tempfile
from . import config
from .util import tool, NOWIN, settings
from .cases import run_dir


def bridge_found():
    return os.path.isfile(os.path.join(config.ENGINE, 'muio_bridge.py')) or bool(config.FROZEN)


def muio_candidates():
    """MUIO DataStorage folders found on this computer (a DataStorage folder holds Parameters.json)"""
    import glob

    pats = [os.environ.get('MUIO_DATA_STORAGE', '')]
    for base in (
        os.environ.get('ProgramFiles', ''),
        os.environ.get('ProgramFiles(x86)', ''),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs'),
        os.environ.get('LOCALAPPDATA', ''),
        os.environ.get('APPDATA', ''),
        os.path.expanduser('~'),
        os.path.join(os.path.expanduser('~'), 'Documents'),
        os.path.join(os.path.expanduser('~'), 'Desktop'),
        'C:\\',
        'D:\\',
    ):
        if base:
            pats += [
                os.path.join(base, '*MUIO*', 'WebAPP', 'DataStorage'),
                os.path.join(base, '*MUIO*', '*', 'WebAPP', 'DataStorage'),
                os.path.join(base, '*muio*', 'WebAPP', 'DataStorage'),
            ]
    out = []
    for pt in pats:
        for f in (glob.glob(pt) if pt else []):
            f = os.path.abspath(f)
            if os.path.isfile(os.path.join(f, 'Parameters.json')) and f not in out:
                out.append(f)
    return out


def muio_info():
    s = settings()
    st = s.get('muio_storage') or ''
    try:
        import pandas

        pv = pandas.__version__
    except Exception:
        pv = None
    ok_pd = bool(pv) and int(pv.split('.')[0]) >= 2
    cases = sorted(x for x in os.listdir(st) if os.path.isfile(os.path.join(st, x, 'genData.json'))) if st and os.path.isdir(st) else []
    return {
        'storage': st,
        'valid': bool(st) and os.path.isfile(os.path.join(st, 'Parameters.json')),
        'candidates': muio_candidates(),
        'cases': cases,
        'pandas': pv,
        'pandas_ok': ok_pd,
        'bridge': bridge_found(),
        'needs': None if ok_pd else 'MUIO code needs pandas (2.2 or later) and openpyxl: pip install "pandas>=2.2" openpyxl',
    }


def bridge(action, data, model, extra=()):
    with tempfile.TemporaryDirectory() as t:
        fd, fm = os.path.join(t, 'data.txt'), os.path.join(t, 'model.txt')
        open(fd, 'w', encoding='utf-8', newline='\n').write(data)
        open(fm, 'w', encoding='utf-8', newline='\n').write(model)
        st = settings().get('muio_storage') or t
        rf = os.path.join(t, 'result.json')
        r = subprocess.run(
            tool('muio_bridge') + [action, '--storage', st, '--data', fd, '--model', fm, *extra],
            capture_output=True,
            text=True,
            timeout=3600,
            env=dict(os.environ, NOUR_RESULT_FILE=rf, PYTHONIOENCODING='utf-8'),
            **NOWIN,
        )
        if os.path.isfile(rf):
            return json.load(open(rf, encoding='utf-8'))
    line = next((l for l in reversed((r.stdout or '').splitlines()) if l.startswith('RESULT ')), None)
    return (
        json.loads(line[7:])
        if line
        else {'ok': False, 'error': ((r.stderr or '') + (r.stdout or ''))[-1500:] or f'the MUIO bridge stopped (exit code {r.returncode})'}
    )


def run_files(rid):
    d = run_dir(rid)
    return d, open(os.path.join(d, 'data.txt'), encoding='utf-8').read(), open(os.path.join(d, 'model.txt'), encoding='utf-8').read()


def config_storage(body):
    """POST /api/muio/config: the MUIO DataStorage folder (the MUIO folder or its WebAPP folder is accepted too)"""
    st = os.path.abspath(os.path.expanduser(body.get('storage', '').strip().strip('"')))
    for sub in (('WebAPP', 'DataStorage'), ('DataStorage',)):
        if os.path.isfile(os.path.join(st, *sub, 'Parameters.json')):
            st = os.path.join(st, *sub)
            break
    if not os.path.isfile(os.path.join(st, 'Parameters.json')):
        return dict(muio_info(), error=f'{st} is not a MUIO DataStorage folder (no Parameters.json)')
    settings(muio_storage=st)
    return muio_info()


def assess(body):
    """POST /api/muio/assess: can this model (and this run) go to MUIO?"""
    try:
        data, model = run_files(body['run'])[1:] if body.get('run') else (body['data'], body['model'])
    except Exception as e:
        return {'full': False, 'results': False, 'reasons': [f'run files not found: {e}']}
    a = bridge('assess', data, model)
    a['results'] = bool(body.get('run')) and a.get('results', False)
    if body.get('run'):
        sf = os.path.join(run_dir(body['run']), 'status.json')
        rs = json.load(open(sf)) if os.path.isfile(sf) else {}
        if not str(rs.get('solver_status') or '').upper().startswith('OPTIMAL'):
            a['results'] = False
            a.setdefault('reasons', []).append(
                f"the run is {rs.get('solver_status') or rs.get('state') or 'not solved'}: only an optimal run has results to export (a full model export leaves the results out)"
            )
    if not body.get('run'):
        a.setdefault('reasons', []).append('results-only needs a solved run: choose one')
    info = muio_info()
    if not info['valid']:
        a['full'] = a['results'] = False
    return dict(a, muio=info)


def export(body):
    """POST /api/muio/export"""
    info = muio_info()
    if not info['valid']:
        return {'ok': False, 'error': 'set the MUIO DataStorage folder first'}
    if not info['pandas_ok']:
        return {'ok': False, 'error': info['needs']}
    extra = ['--case', body['case'], '--mode', body['mode']]
    if body.get('run'):
        d, data, model = run_files(body['run'])
        extra += ['--run', d, '--runname', body.get('runname') or body['run']]
    else:
        data, model = body['data'], body['model']
    if body['mode'] == 'results' and not body.get('run'):
        return {'ok': False, 'error': 'results-only export needs a run'}
    return bridge('export', data, model, extra)


def import_case(zbytes, fname=''):
    """POST /api/muio/import (body: the zip of a MUIO case, or of WebAPP/DataStorage/<case>): a Studio case with the base data,
    MUIO's scenarios, descriptions and units, and each MUIO run with its results (engine/muio_import.py, MUIO's own code)"""
    import re, shutil, time
    from . import cases

    with tempfile.TemporaryDirectory() as t:
        zp, out, rf = os.path.join(t, 'case.zip'), os.path.join(t, 'out'), os.path.join(t, 'result.json')
        open(zp, 'wb').write(zbytes)
        r = subprocess.run(
            tool('muio_import') + [zp, out],
            capture_output=True,
            text=True,
            timeout=3600,
            env=dict(os.environ, NOUR_RESULT_FILE=rf, PYTHONIOENCODING='utf-8'),
            **NOWIN,
        )
        res = (
            json.load(open(rf, encoding='utf-8'))
            if os.path.isfile(rf)
            else {'ok': False, 'error': ((r.stderr or '') + (r.stdout or ''))[-1500:] or f'the importer stopped (exit code {r.returncode})'}
        )
        if not res.get('ok'):
            return res
        base = re.sub(r'[^\w.-]+', '_', res['case'])[:40] or 'MUIO_case'
        cid = base
        k = 2
        ids = set(cases.case_index())
        while cid in ids:
            cid = f'{base}_{k}'
            k += 1
        data = open(os.path.join(out, 'data.txt'), encoding='utf-8').read()
        model = open(os.path.join(out, 'model.txt'), encoding='utf-8').read()
        cases.case_put(
            cid,
            {
                'name': res['case'] + (f' ({k - 1})' if cid != base else ''),
                'description': res.get('description', ''),
                'version': f"MUIO {res.get('version', '')}".strip(),
                'data': data,
                'model': model,
                'modelId': '_muio57',
                'modelName': 'OSeMOSYS standard model (model.v.5.7.txt, from MUIO)',
                'imported': {'from': fname or 'MUIO', 'date': time.strftime('%Y-%m-%d %H:%M:%S')},
                'updated': int(time.time() * 1000),
            },
        )
        made = []
        for rn in sorted(os.listdir(os.path.join(out, 'runs'))) if os.path.isdir(os.path.join(out, 'runs')) else []:
            src = os.path.join(out, 'runs', rn)
            info = json.load(open(os.path.join(src, 'info.json')))
            rid = time.strftime('%Y%m%d-%H%M%S-') + 'MUIO_' + re.sub(r'[^\w.-]+', '_', rn)[:40]
            d = os.path.join(cases.case_path(cid), 'runs', rid)
            os.makedirs(d)
            shutil.copy(os.path.join(src, 'results.json'), d)
            if os.path.isfile(os.path.join(src, 'data.txt')):
                shutil.copy(os.path.join(src, 'data.txt'), d)
            open(os.path.join(d, 'model.txt'), 'w', encoding='utf-8').write(model)
            json.dump(
                {
                    'name': f"MUIO {rn}" + (' + ' + ' + '.join(info['scenarios']) if info['scenarios'] else ''),
                    'model_name': 'OSeMOSYS standard model (model.v.5.7.txt, from MUIO)',
                    'case': cid,
                    'scenarios': info['scenarios'],
                    'solver': 'MUIO (imported)',
                    'options': {},
                    'created': info.get('runtime') or time.strftime('%Y-%m-%d %H:%M:%S'),
                    'imported': True,
                },
                open(os.path.join(d, 'meta.json'), 'w'),
                indent=1,
            )
            json.dump(
                {
                    'state': 'done',
                    'stage': 'imported from MUIO',
                    'solver_status': info.get('status', 'OPTIMAL'),
                    'objective': info.get('objective'),
                    'objective_constant': 0.0,
                    'variables': info.get('variables', {}),
                    'imported': True,
                },
                open(os.path.join(d, 'status.json'), 'w'),
                indent=1,
            )
            open(os.path.join(d, 'log.txt'), 'w').write(
                f"Imported from MUIO: run {rn}, results from MUIO's csv files (objective as MUIO shows it).\n"
            )
            made.append(rid)
        return dict(res, ok=True, id=cid, run_ids=made)
