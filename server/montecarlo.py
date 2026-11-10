"""Monte Carlo runs (engine/mc.py; each run is a folder mc/<id>/ or cases/<case>/mc/<id>/ solved by a separate process)."""

import json, os, re, shutil, subprocess, time
from . import config, cases as _cases
from .util import tool, NOWIN
from .cases import run_base
from .solvers import detect

MCJOBS = {}


def mc_dirs():
    out = []
    for base in [config.MCROOT] + [os.path.join(cp, 'mc') for cp in _cases.case_index().values()]:
        if os.path.isdir(base):
            out += [os.path.join(base, x) for x in os.listdir(base) if os.path.isfile(os.path.join(base, x, 'design.json'))]
    return out


def mc_dir(mid):
    return next((d for d in mc_dirs() if os.path.basename(d) == mid), None)


def _info(d):
    s = json.load(open(os.path.join(d, 'status.json'))) if os.path.isfile(os.path.join(d, 'status.json')) else {}
    s.update(json.load(open(os.path.join(d, 'meta.json'))) if os.path.isfile(os.path.join(d, 'meta.json')) else {})
    return s


def mc_list():
    out = []
    for d in sorted(mc_dirs(), key=os.path.basename, reverse=True):
        s = _info(d)
        s['id'] = os.path.basename(d)
        out.append(s)
    return out


def mc_get(mid):
    """GET /api/mc/<id>: status, meta, last log lines, design and the factors"""
    d = mc_dir(mid)
    if not d:
        return None
    s = _info(d)
    s['id'] = mid
    s['log'] = (
        open(os.path.join(d, 'log.txt'), encoding='utf-8', errors='ignore').read().splitlines()[-40:]
        if os.path.isfile(os.path.join(d, 'log.txt'))
        else []
    )
    s['design'] = json.load(open(os.path.join(d, 'design.json')))
    if os.path.isfile(os.path.join(d, 'factors.json')):
        s['factors'] = json.load(open(os.path.join(d, 'factors.json')))
    return s


def catalogue():
    import mc_dist

    return mc_dist.catalogue()


def mc_post(path, body):
    import mc

    if path == '/api/mc/detect':
        return mc.detect(body['model'], body['data'])
    if path == '/api/mc/preview':
        return mc.preview(body['design'], body['model'], body['data'], body.get('factor'), int(body.get('n', 300)), year=body.get('year'))
    if path == '/api/mc/preview_links':
        return mc.preview_links(body['design'], body['model'], body['data'], int(body.get('n', 200)))
    if path == '/api/mc/formula_file':
        import mc_links

        return {'template': mc_links.FORMULA_TEMPLATE} if body.get('template') else mc_links.formula_functions(body.get('text', ''))
    if path == '/api/mc/run':
        D = body['design']
        S = {s['id']: s for s in detect()['solvers']}
        if D['solver'] not in S:
            raise ValueError(f"solver {D['solver']} not found on this computer")
        D.setdefault('options', {})['solver_path'] = S[D['solver']].get('path')
        cid = body.get('case')
        c = run_base(cid)
        base = os.path.join(_cases.case_path(c), 'mc') if c else config.MCROOT
        mid = time.strftime('%Y%m%d-%H%M%S-') + re.sub(r'[^\w.-]+', '_', body.get('name') or 'mc')[:24]
        d = os.path.join(base, mid)
        os.makedirs(d)
        open(os.path.join(d, 'data.txt'), 'w', encoding='utf-8').write(body['data'])
        open(os.path.join(d, 'model.txt'), 'w', encoding='utf-8').write(body['model'])
        json.dump(D, open(os.path.join(d, 'design.json'), 'w'), indent=1)
        json.dump(
            {
                'name': body.get('name'),
                'case': cid,
                'model_name': body.get('model_name'),
                'created': time.strftime('%Y-%m-%d %H:%M:%S'),
                'n': D['sampling']['n'],
                'solver': D['solver'],
                'scenarios': body.get('scenarios'),
            },
            open(os.path.join(d, 'meta.json'), 'w'),
            indent=1,
        )
        mc.status(d, state='queued', stage='queued', total=D['sampling']['n'], done=0, ok=0)
        lf = open(os.path.join(d, 'process.txt'), 'w')
        MCJOBS[mid] = subprocess.Popen(tool('mc') + ['run', d], stdout=lf, stderr=subprocess.STDOUT, **NOWIN)
        return {'ok': True, 'id': mid}
    m = re.match(r'^/api/mc/([\w.-]+)/(agg|stop|delete|members|explore|inputs|input|export|reveal|cube)$', path)
    if m:
        mid, act = m.groups()
        d = mc_dir(mid)
        if not d:
            raise ValueError('no such Monte Carlo run')
        if act == 'export':  # full extraction: a zip of CSV files in the run's folder
            os.makedirs(os.path.join(d, 'exports'), exist_ok=True)
            wide = bool(body.get('wide'))
            out = os.path.join(d, 'exports', f"{mid}_full_{'wide' if wide else 'long'}.zip")
            r = mc.export_full(
                d, out, wide=wide, inputs=body.get('inputs', True), outputs=body.get('outputs', True), stats=body.get('stats', True)
            )
            return dict(r, name=os.path.basename(out), url=f'/api/mc/{mid}/download?f={os.path.basename(out)}')
        if act == 'reveal':
            from .util import reveal

            return reveal(os.path.join(d, 'exports') if os.path.isdir(os.path.join(d, 'exports')) else d)
        if act == 'explore':
            return mc.explore(
                d,
                body.get('var', 'Objective'),
                body.get('filters'),
                float(body.get('divide') or 1),
                body.get('along', 'YEAR'),
                body.get('focus', 'sum'),
                body.get('breakdown'),
                keep=body.get('keep'),
                bmax=body.get('bmax'),
            )
        if act == 'cube':
            return mc.cube(
                d,
                body.get('var'),
                body.get('filters'),
                float(body.get('divide') or 1),
                body.get('by', 'TECHNOLOGY'),
                body.get('mode', 'bands'),
                body.get('ks'),
                body.get('keep'),
                body.get('thr'),
                body.get('top'),
                body.get('paths'),
            )
        if act == 'inputs':
            return {'inputs': mc.input_catalog(d)}
        if act == 'input':
            return mc.input_values(d, body.get('factor', 0), body.get('item'), body.get('year'), body.get('ks'))
        if act == 'agg':
            return mc.aggregate(
                d, body.get('var', 'Objective'), body.get('by', 'YEAR'), body.get('filters'), float(body.get('divide') or 1)
            )
        if act == 'members':  # index sets and members of an output variable
            S_ = mc.load_samples(d)
            v = body.get('var')
            rows = next((s['outputs'].get(v) for s in S_ if s['status'] == 'OPTIMAL' and s['outputs'].get(v)), [])
            a = mc.aggregate(d, v, '__none__') if rows else {'dims': []}
            dims = a.get('dims', [])
            return {
                'dims': dims,
                'members': {
                    dd: sorted(
                        {str(r[i]) for s in S_ for r in s['outputs'].get(v, [])},
                        key=lambda z: (0, float(z)) if re.match(r'^-?\d+(\.\d+)?$', z) else (1, z),
                    )
                    for i, dd in enumerate(dims)
                },
                'outputs': sorted({k for s in S_ for k in s.get('outputs', {})}),
            }
        if act == 'stop':
            open(os.path.join(d, 'STOP'), 'w').close()
            return {'ok': True}
        if act == 'delete':
            open(os.path.join(d, 'STOP'), 'w').close()
            j = MCJOBS.get(mid)
            if j:
                j.terminate()
            shutil.rmtree(d, ignore_errors=True)
            return {'ok': True}
    raise ValueError('unknown Monte Carlo request')


def mc_download(mid, name):
    """GET /api/mc/<id>/download?f=<file>: a file of the run's exports folder -> (bytes, file name)"""
    d = mc_dir(mid)
    if not d or not re.match(r'^[\w.-]+\.zip$', name or ''):
        raise ValueError('no such file')
    f = os.path.join(d, 'exports', name)
    if not os.path.isfile(f):
        raise ValueError('no such file')
    return open(f, 'rb').read(), name
