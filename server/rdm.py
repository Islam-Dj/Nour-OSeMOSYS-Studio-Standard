"""Robust decision making runs (engine/rdm.py): a folder rdm/<id>/ or cases/<case>/rdm/<id>/, solved by a separate process.
One sub-folder per strategy (a Monte Carlo folder): the same futures for every strategy."""

import json, os, re, shutil, subprocess, time
from . import config, cases as _cases
from .util import tool, NOWIN
from .cases import run_base
from .solvers import detect

RDMJOBS = {}
root = lambda: os.path.join(os.path.dirname(config.RUNS), 'rdm')


def rdm_dirs():
    out = []
    for base in [root()] + [os.path.join(cp, 'rdm') for cp in _cases.case_index().values()]:
        if os.path.isdir(base):
            out += [os.path.join(base, x) for x in os.listdir(base) if os.path.isfile(os.path.join(base, x, 'rdm.json'))]
    return out


def rdm_dir(rid):
    return next((d for d in rdm_dirs() if os.path.basename(d) == rid), None)


def _info(d):
    s = json.load(open(os.path.join(d, 'status.json'))) if os.path.isfile(os.path.join(d, 'status.json')) else {}
    s.update(json.load(open(os.path.join(d, 'meta.json'))) if os.path.isfile(os.path.join(d, 'meta.json')) else {})
    return s


def rdm_list():
    out = []
    for d in sorted(rdm_dirs(), key=os.path.basename, reverse=True):
        s = _info(d)
        s['id'] = os.path.basename(d)
        out.append(s)
    return out


def rdm_get(rid):
    d = rdm_dir(rid)
    if not d:
        return None
    s = _info(d)
    s['id'] = rid
    R = json.load(open(os.path.join(d, 'rdm.json')))
    s['log'] = (
        open(os.path.join(d, 'log.txt'), encoding='utf-8', errors='ignore').read().splitlines()[-40:]
        if os.path.isfile(os.path.join(d, 'log.txt'))
        else []
    )
    s['strategies'] = R['strategies']
    s['metrics'] = R.get('metrics', [])
    s['design'] = R['design']
    s['only'] = R.get('only', {})
    return s


def rdm_post(path, body):
    import rdm

    if path == '/api/rdm/run':
        D = body['design']
        S = {s['id']: s for s in detect()['solvers']}
        ST = body['strategies']
        if D['solver'] not in S:
            raise ValueError(f"solver {D['solver']} not found on this computer")
        if not ST:
            raise ValueError('no strategy: add at least two (each one a set of scenarios)')
        if len({s['id'] for s in ST}) != len(ST) or any(not re.match(r'^[\w.-]{1,40}$', s['id']) for s in ST):
            raise ValueError('bad strategy codes')
        D.setdefault('options', {})['solver_path'] = S[D['solver']].get('path')
        cid = body.get('case')
        c = run_base(cid)
        base = os.path.join(_cases.case_path(c), 'rdm') if c else root()
        rid = time.strftime('%Y%m%d-%H%M%S-') + re.sub(r'[^\w.-]+', '_', body.get('name') or 'rdm')[:24]
        d = os.path.join(base, rid)
        os.makedirs(d)
        open(os.path.join(d, 'model.txt'), 'w', encoding='utf-8').write(body['model'])
        for s in ST:
            sd = os.path.join(d, 's', s['id'])
            os.makedirs(sd)
            open(os.path.join(sd, 'data.txt'), 'w', encoding='utf-8').write(body['data'][s['id']])
        json.dump(
            {
                'design': D,
                'strategies': [{k: s.get(k) for k in ('id', 'name', 'desc', 'scenarios')} for s in ST],
                'metrics': body.get('metrics', []),
                'name': body.get('name'),
            },
            open(os.path.join(d, 'rdm.json'), 'w'),
            indent=1,
        )
        json.dump(
            {
                'name': body.get('name'),
                'case': cid,
                'model_name': body.get('model_name'),
                'created': time.strftime('%Y-%m-%d %H:%M:%S'),
                'n': D['sampling']['n'],
                'strategies': len(ST),
                'solver': D['solver'],
            },
            open(os.path.join(d, 'meta.json'), 'w'),
            indent=1,
        )
        rdm.status(d, state='queued', stage='queued', total=D['sampling']['n'] * len(ST), done=0, ok=0)
        start(d)
        return {'ok': True, 'id': rid}
    m = re.match(r'^/api/rdm/([\w.-]+)/(eval|members|metrics|stop|resume|delete|enhance|widen)$', path)
    if m:
        rid, act = m.groups()
        d = rdm_dir(rid)
        if not d:
            raise ValueError('no such RDM run')
        if act == 'eval':
            return rdm.evaluate(d, body.get('metrics'))
        if act == 'members':
            return rdm.members(d, body.get('var'))
        if act == 'metrics':  # the metrics are kept with the run (they can change after it)
            f = os.path.join(d, 'rdm.json')
            R = json.load(open(f))
            R['metrics'] = body.get('metrics', [])
            json.dump(R, open(f + '.tmp', 'w'), indent=1)
            os.replace(f + '.tmp', f)
            return {'ok': True}
        # strategic enhancement. A new strategy (the strategy being enhanced + a new scenario) is added to the run and solved
        # on the futures chosen (the failed ones, or all): the futures are drawn again with the same seed, so they are exactly the same.
        # The strategies already solved are not solved again; nothing of them is changed.
        if act in ('enhance', 'widen'):
            j = RDMJOBS.get(rid)
            if j and j.poll() is None:  # the process may be closing after writing "done": give it a moment
                try:
                    j.wait(timeout=20)
                except Exception:
                    return {'ok': False, 'error': 'the run is still solving: wait until it ends (or stop it), then add the enhancement'}
            f = os.path.join(d, 'rdm.json')
            R = json.load(open(f))
            only = R.setdefault('only', {})
            if act == 'enhance':
                st = body['strategy']
                base = re.sub(r'[^\w.-]+', '_', st.get('id') or 'ENH')[:36] or 'ENH'
                sid, k = base, 2
                while any(x['id'] == sid for x in R['strategies']):
                    sid = f'{base}_{k}'
                    k += 1
                sd = os.path.join(d, 's', sid)
                os.makedirs(sd)
                open(os.path.join(sd, 'data.txt'), 'w', encoding='utf-8').write(body['data'])
                R['strategies'].append(
                    {
                        'id': sid,
                        'name': st.get('name') or sid,
                        'desc': st.get('desc', ''),
                        'scenarios': st.get('scenarios', []),
                        'enhances': body.get('base'),
                    }
                )
                ks = body.get('ks')
                only[sid] = None if ks is None else sorted(int(x) for x in ks)
            else:
                sid = body['strategy']
                only[sid] = None
            json.dump(R, open(f + '.tmp', 'w'), indent=1)
            os.replace(f + '.tmp', f)
            mt = os.path.join(d, 'meta.json')
            M_ = json.load(open(mt)) if os.path.isfile(mt) else {}
            M_['strategies'] = len(R['strategies'])
            json.dump(M_, open(mt, 'w'), indent=1)
            if os.path.exists(os.path.join(d, 'STOP')):
                os.remove(os.path.join(d, 'STOP'))
            rdm.status(d, state='queued', stage='queued (enhancement)')
            start(d)
            return {'ok': True, 'id': sid}
        if act == 'stop':
            open(os.path.join(d, 'STOP'), 'w').close()
            return {'ok': True}
        if act == 'resume':
            if os.path.exists(os.path.join(d, 'STOP')):
                os.remove(os.path.join(d, 'STOP'))
            j = RDMJOBS.get(rid)
            if j and j.poll() is None:
                return {'ok': True, 'running': True}
            rdm.status(d, state='queued', stage='resuming')
            start(d)
            return {'ok': True}
        if act == 'delete':
            open(os.path.join(d, 'STOP'), 'w').close()
            j = RDMJOBS.get(rid)
            if j:
                j.terminate()
            shutil.rmtree(d, ignore_errors=True)
            return {'ok': True}
    raise ValueError('unknown RDM request')


def start(d):
    lf = open(os.path.join(d, 'process.txt'), 'a')
    RDMJOBS[os.path.basename(d)] = subprocess.Popen(tool('rdm') + ['run', d], stdout=lf, stderr=subprocess.STDOUT, **NOWIN)


def rdm_package(rid, data=False, strategies='', futures='', raw=True):
    """The full package of a run as a zip file (made by engine/rdm_export.py) -> (path, file name)"""
    import tempfile
    d = rdm_dir(rid)
    if not os.path.isfile(os.path.join(d, 'rdm.json')):
        raise ValueError('no such robust-decision run')
    fd, fp = tempfile.mkstemp(suffix='.zip', prefix='rdm_pkg_')
    os.close(fd)
    cmd = tool('rdm_export') + [d, fp] + (['--data'] if data else []) + ([f'--strategies={strategies}'] if strategies else []) + ([f'--futures={futures}'] if futures else []) + ([] if raw else ['--raw=0'])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=7200, **NOWIN)
    if r.returncode or not os.path.getsize(fp):
        raise ValueError((r.stderr or r.stdout or 'the package could not be made')[-800:])
    name = json.load(open(os.path.join(d, 'rdm.json'))).get('name') or rid
    return fp, re.sub(r'[^\w.-]+', '_', name)[:60] + ('_with_data' if data else '') + '_package.zip'
