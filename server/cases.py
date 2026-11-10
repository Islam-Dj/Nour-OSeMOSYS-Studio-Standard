"""Cases (one folder per model, like MUIO's DataStorage) and the run folders.

the cases are grouped by the model file they use.
cases/<model>/_model.json, _model.txt   the model file of the group (its name, and a copy of its text)
cases/<model>/<case>/  data.txt, model.txt, case.json (names, colours, charts), runs/<run>/, mc/, rdm/, rh/
   <model> = OSeMOSYS (the built-in OSeMOSYS standard model), the id of a model
   of the library (models/<id>/), or Other_models (a case with its own model file, not from the library)
runs/<run>/    runs made without a case
A case id stays unique over all the groups. Cases of earlier versions (cases/<case>/) are moved into their group when the
server starts (migrate); a case whose model changes moves to the new group.
"""

import json, os, re, shutil, threading, time

_PUT = threading.Lock()  # one case save at a time (the page may save twice at once)
from . import config
from .util import longp  # run folders in Windows' long form (no 260-character limit)

CASE_ID = re.compile(r'^[\w.-]{1,120}$')


# ---------------------------------------------------------------------------------------------------- groups by model
BUILTIN_GROUPS = {
    '_muio54': ('OSeMOSYS', 'OSeMOSYS standard model (built in)'),
    '_master': ('OSeMOSYS', 'OSeMOSYS standard model (built in)'),
    '_muio57': ('OSeMOSYS', 'OSeMOSYS standard model (built in)'),
}
OTHER = ('Other_models', 'Other model files (a case with its own model file)')


def group_of(rec):
    """the folder (group) of a case: from the model it uses"""
    mid = rec.get('modelId')
    if mid in BUILTIN_GROUPS:
        return BUILTIN_GROUPS[mid][0]
    if mid and CASE_ID.match(mid) and os.path.isfile(os.path.join(os.path.dirname(config.CASES), 'models', mid, 'model.json')):
        return mid
    if not mid and not rec.get('model'):
        return BUILTIN_GROUPS['_muio54'][0]  # no model file of its own: the built-in model
    if not mid and str(rec.get('modelName') or '').startswith(('MUIO 5.7', 'OSeMOSYS standard model')):
        return BUILTIN_GROUPS['_muio57'][0]  # imported from MUIO 5.7
    return OTHER[0]


def _group_meta(g):
    """_model.json (and _model.txt, a copy of the model file) of a group folder"""
    d = os.path.join(config.CASES, g)
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, '_model.json')
    if os.path.isfile(f):
        return d
    web = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web', 'data')
    name, src = next(((n, i) for i, (gg, n) in BUILTIN_GROUPS.items() if gg == g), (None, None))
    if g == OTHER[0]:
        name, text = OTHER[1], None
    elif name:
        text = (
            open(os.path.join(web, 'builtin_model.txt'), encoding='utf-8').read()
            if os.path.isdir(web)
            else None
        )
    else:
        mj = os.path.join(os.path.dirname(config.CASES), 'models', g)
        try:
            name = json.load(open(os.path.join(mj, 'model.json'), encoding='utf-8')).get('name') or g
        except Exception:
            name = g
        text = open(os.path.join(mj, 'model.txt'), encoding='utf-8').read() if os.path.isfile(os.path.join(mj, 'model.txt')) else None
    json.dump(
        {
            'group': g,
            'name': name,
            'note': 'Cases that use this model file; _model.txt is a copy of it (each case also keeps its own model.txt when it has one).',
        },
        open(f, 'w', encoding='utf-8'),
        indent=1,
    )
    if text:
        open(os.path.join(d, '_model.txt'), 'w', encoding='utf-8', newline='\n').write(text)
    return d


def case_index():
    """{case id: folder} over the groups (and the flat folders of earlier versions)"""
    idx = {}
    if not os.path.isdir(config.CASES):
        return idx
    for a in sorted(os.listdir(config.CASES)):
        p = os.path.join(config.CASES, a)
        if not os.path.isdir(p):
            continue
        if os.path.isfile(os.path.join(p, 'case.json')):
            idx.setdefault(a, p)
            continue
        for c in sorted(os.listdir(p)):
            q = os.path.join(p, c)
            if os.path.isdir(q) and os.path.isfile(os.path.join(q, 'case.json')):
                idx.setdefault(c, q)
    return idx


def case_ids():
    return list(case_index())


def migrate():
    """move the cases of earlier versions (cases/<case>/) into the folder of their model"""
    moved = 0
    with _PUT:
        for a in sorted(os.listdir(config.CASES)) if os.path.isdir(config.CASES) else []:
            p = os.path.join(config.CASES, a)
            f = os.path.join(p, 'case.json')
            if not os.path.isfile(f):
                continue
            try:
                rec = json.load(open(f, encoding='utf-8'))
            except Exception:
                continue
            if os.path.isfile(os.path.join(p, 'model.txt')) and not rec.get('modelId'):
                rec['model'] = True
            g = group_of(rec)
            dest = os.path.join(_group_meta(g), a)
            if os.path.exists(dest):
                continue
            shutil.move(p, dest)
            moved += 1
    return moved


def groups():
    """the groups with their names and number of cases (for the Cases page)"""
    out = []
    for a in sorted(os.listdir(config.CASES)) if os.path.isdir(config.CASES) else []:
        p = os.path.join(config.CASES, a)
        f = os.path.join(p, '_model.json')
        if os.path.isfile(f):
            try:
                m = json.load(open(f, encoding='utf-8'))
            except Exception:
                m = {'name': a}
            n = sum(1 for c in os.listdir(p) if os.path.isfile(os.path.join(p, c, 'case.json')))
            out.append({'group': a, 'name': m.get('name', a), 'cases': n, 'path': p})
    return out


def run_dir(rid):
    """folder of a run: runs/<id> or cases/<model>/<case>/runs/<id>"""
    d = os.path.join(config.RUNS, rid)
    if os.path.isdir(d):
        return longp(d)
    for c, p in case_index().items():
        d = os.path.join(p, 'runs', rid)
        if os.path.isdir(d):
            return longp(d)
    return longp(os.path.join(config.RUNS, rid))


def all_run_dirs():
    out = [os.path.join(config.RUNS, r) for r in os.listdir(config.RUNS)]
    for c, p in sorted(case_index().items()):
        rd = os.path.join(p, 'runs')
        if os.path.isdir(rd):
            out += [os.path.join(rd, r) for r in os.listdir(rd)]
    return [longp(d) for d in out if os.path.isfile(os.path.join(longp(d), 'meta.json'))]


def run_base(cid):
    """where a new run (or Monte Carlo run) goes: inside its case if the case exists"""
    return cid if cid and CASE_ID.match(cid) and cid in case_index() else None


def case_path(cid, rec=None):
    """folder of a case; a new case goes into the group of its model (rec)"""
    if not CASE_ID.match(cid or ''):
        raise ValueError('bad case id')
    p = case_index().get(cid)
    if p:
        return p
    return os.path.join(_group_meta(group_of(rec or {})), cid)


def case_list():
    out = []
    for c, p in case_index().items():
        f = os.path.join(p, 'case.json')
        try:
            m = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        rd = os.path.join(p, 'runs')
        m.pop('charts', None)
        m['id'] = c
        m['runs'] = len(os.listdir(rd)) if os.path.isdir(rd) else 0
        g = os.path.basename(os.path.dirname(p))
        m['group'] = g if os.path.dirname(p) != os.path.normpath(config.CASES) else ''
        out.append(m)
    return out


# folders (themes) of the cases: one file next to the case folders, [{id, name, desc}]; a case names its folder in case.json
def folders_get():
    f = os.path.join(config.CASES, '_folders.json')
    try:
        L = json.load(open(f, encoding='utf-8'))
    except Exception:
        return []
    return [x for x in L if isinstance(x, dict) and 'id' in x and 'name' in x] if isinstance(L, list) else []


def folders_put(L):
    if not isinstance(L, list):
        raise ValueError('a list of folders is expected')
    out = []
    for x in L:
        if not isinstance(x, dict) or not CASE_ID.match(str(x.get('id', ''))):
            raise ValueError('bad folder id')
        out.append({'id': str(x['id']), 'name': str(x.get('name', ''))[:200], 'desc': str(x.get('desc', ''))[:2000]})
    with _PUT:
        f = os.path.join(config.CASES, '_folders.json')
        tmp = f'{f}.{os.getpid()}.{time.time_ns()}.tmp'
        json.dump(out, open(tmp, 'w', encoding='utf-8'), indent=1)
        os.replace(tmp, f)
    return True


def case_get(cid):
    d = case_path(cid)
    f = os.path.join(d, 'case.json')
    if not os.path.isfile(f):
        return None
    m = json.load(open(f, encoding='utf-8'))
    m['id'] = cid
    m['data'] = open(os.path.join(d, 'data.txt'), encoding='utf-8').read() if os.path.isfile(os.path.join(d, 'data.txt')) else ''
    m['model'] = open(os.path.join(d, 'model.txt'), encoding='utf-8').read() if os.path.isfile(os.path.join(d, 'model.txt')) else None
    return m


def case_put(cid, rec):
    with _PUT:
        d = case_path(cid, rec)
        # the model of the case changed: the case moves to the group of its new model
        if os.path.isdir(d) and ('modelId' in rec or 'model' in rec):
            want = group_of({'modelId': rec.get('modelId'), 'model': rec.get('model'), 'modelName': rec.get('modelName')})
            have = os.path.basename(os.path.dirname(d))
            if want != have and os.path.dirname(d) != os.path.normpath(config.CASES):
                nd = os.path.join(_group_meta(want), cid)
                if not os.path.exists(nd):
                    shutil.move(d, nd)
                    d = nd
        os.makedirs(d, exist_ok=True)
        f = os.path.join(d, 'case.json')
        m = json.load(open(f, encoding='utf-8')) if os.path.isfile(f) else {'created': time.strftime('%Y-%m-%d %H:%M:%S')}
        if 'data' in rec:
            open(os.path.join(d, 'data.txt'), 'w', encoding='utf-8', newline='\n').write(rec['data'] or '')
        if 'model' in rec:
            mp = os.path.join(d, 'model.txt')
            if rec['model']:
                open(mp, 'w', encoding='utf-8', newline='\n').write(rec['model'])
            elif os.path.isfile(mp):
                os.remove(mp)
        for k, v in rec.items():
            if k not in ('data', 'model', 'id'):
                m[k] = v
        tmp = f'{f}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp'
        json.dump(m, open(tmp, 'w', encoding='utf-8'), indent=1)
        os.replace(tmp, f)  # unique: two saves at once must not collide
    return True
