"""Library of model files (one folder each, next to the cases): models/<id>/model.txt and model.json (name, description,
version, added / updated, summary of sets, parameters and constraints). A case keeps its own copy of the model file it
uses (reproducible runs) and the id of the library model it came from."""

import hashlib, json, os, re, shutil, time
from . import config

MODEL_ID = re.compile(r'^[\w.-]{1,120}$')


def root():
    d = os.path.join(os.path.dirname(config.CASES), 'models')
    os.makedirs(d, exist_ok=True)
    return d


def path(mid):
    if not MODEL_ID.match(mid or ''):
        raise ValueError('bad model id')
    return os.path.join(root(), mid)


def summary(text):
    strip = re.sub(r'#[^\n]*', '', text)
    return {
        'params': len(re.findall(r'^\s*param\s+\w+', strip, re.M)),
        'sets': len(re.findall(r'^\s*set\s+\w+', strip, re.M)),
        'constraints': len(re.findall(r'^\s*s\.t\.\s+\w+', strip, re.M)),
        'size': len(text),
        'md5': hashlib.md5(text.encode('utf-8')).hexdigest()[:8],
    }


def listing():
    out = []
    for m in sorted(os.listdir(root())):
        f = os.path.join(root(), m, 'model.json')
        if os.path.isfile(f):
            try:
                rec = json.load(open(f, encoding='utf-8'))
            except Exception:
                continue
            rec['id'] = m
            out.append(rec)
    used = {}
    from . import cases

    for c, cp in cases.case_index().items():  # which cases use each model
        f = os.path.join(cp, 'case.json')
        try:
            mid = json.load(open(f, encoding='utf-8')).get('modelId') if os.path.isfile(f) else None
        except Exception:
            mid = None
        if mid:
            used.setdefault(mid, []).append(c)
    for r in out:
        r['cases'] = used.get(r['id'], [])
    return out


def get(mid):
    d = path(mid)
    f = os.path.join(d, 'model.json')
    if not os.path.isfile(f):
        return None
    rec = json.load(open(f, encoding='utf-8'))
    rec['id'] = mid
    rec['text'] = open(os.path.join(d, 'model.txt'), encoding='utf-8').read()
    return rec


def put(mid, body):
    d = path(mid)
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, 'model.json')
    rec = json.load(open(f, encoding='utf-8')) if os.path.isfile(f) else {'added': time.strftime('%Y-%m-%d %H:%M:%S')}
    if body.get('text'):
        open(os.path.join(d, 'model.txt'), 'w', encoding='utf-8', newline='\n').write(body['text'])
        rec.update(summary(body['text']))
    elif not os.path.isfile(os.path.join(d, 'model.txt')):
        raise ValueError('a new model needs its text')
    for k in ('name', 'description', 'version', 'source', 'file'):
        if k in body:
            rec[k] = body[k]
    rec['updated'] = time.strftime('%Y-%m-%d %H:%M:%S')
    tmp = f + '.tmp'
    json.dump(rec, open(tmp, 'w', encoding='utf-8'), indent=1)
    os.replace(tmp, f)
    return {'ok': True, 'id': mid}


def delete(mid):
    shutil.rmtree(path(mid), ignore_errors=True)
    return {'ok': True}
