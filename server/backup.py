"""Back up a case as ONE zip and restore it.

The zip holds the whole case folder: case.json (names, descriptions, units, systems, scenarios, charts, the Monte Carlo and
RDM set-ups, the folder it belongs to), data.txt, model.txt, runs/ (every solve with its results), mc/ (Monte Carlo runs),
rdm/ (robust-decision runs) and any later sub-folder (rolling horizon ...), plus its checkpoints (frozen copies), and a
manifest.json (what is inside, Studio version, date). A "light" backup leaves out the solved samples of the Monte Carlo
and RDM runs (their set-up, factors and logs stay: they can be solved again, or resumed).

Restoring never overwrites: the case comes back as a new case (a new code if the code is taken); runs, Monte Carlo and
RDM runs whose codes are already used on this computer get a new code too.
"""

import io, json, os, re, shutil, tempfile, time, zipfile
from . import config, cases
from .cases import CASE_ID

FORMAT = 'NOUR-Studio-case-backup'
FORMAT_VERSION = 1
SAMPLE_DIR = re.compile(r'(^|/)(mc/[^/]+/samples|rdm/[^/]+/s/[^/]+/samples)(/|$)')


def _version():
    # the source folder has desktop/nour_studio.py; the desktop app only has the page, whose core.js holds the same version
    for p, pat in (
        (os.path.join(config.ROOT, 'desktop', 'nour_studio.py'), r"VERSION = '([^']+)'"),
        (os.path.join(config.WEB, 'js', 'core.js'), r"STUDIO_VERSION = '([^']+)'"),
    ):
        try:
            m = re.search(pat, open(p, encoding='utf-8').read())
            if m:
                return m.group(1)
        except OSError:
            pass
    return '?'


def _checkpoints(cid):
    out = []
    for c, p in cases.case_index().items():
        f = os.path.join(p, 'case.json')
        if c != cid and os.path.isfile(f):
            try:
                if json.load(open(f, encoding='utf-8')).get('checkpointOf') == cid:
                    out.append(c)
            except Exception:
                pass
    return sorted(out)


def _count(d):
    n = lambda sub: (
        len([x for x in os.listdir(os.path.join(d, sub)) if os.path.isdir(os.path.join(d, sub, x))])
        if os.path.isdir(os.path.join(d, sub))
        else 0
    )
    return {'runs': n('runs'), 'monte_carlo': n('mc'), 'rdm': n('rdm'), 'rolling_horizon': n('rh')}


def backup(cid, light=False, checkpoints=True):
    """-> (zip bytes, file name)"""
    if not CASE_ID.match(cid or '') or cid not in cases.case_index():
        raise ValueError('no such case')
    d = cases.case_path(cid)
    rec = json.load(open(os.path.join(d, 'case.json'), encoding='utf-8'))
    cps = _checkpoints(cid) if checkpoints else []
    man = {
        'format': FORMAT,
        'format_version': FORMAT_VERSION,
        'studio': f'Nour OSeMOSYS Studio {_version()}',
        'created': time.strftime('%Y-%m-%d %H:%M:%S'),
        'case': cid,
        'name': rec.get('name'),
        'description': rec.get('description', ''),
        'light': bool(light),
        'contents': _count(d),
        'checkpoints': cps,
        'note': 'Restore with Cases > "Restore from a backup" in Nour OSeMOSYS Studio. Each folder is readable as it is (text, JSON, CSV).',
    }
    buf = io.BytesIO()
    skipped = 0
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for top, sub in [(cid, d)] + [(c, cases.case_path(c)) for c in cps]:
            arc0 = 'case' if top == cid else f'checkpoints/{top}'
            for root, dirs, files in os.walk(sub):
                dirs[:] = [x for x in dirs if x != '__pycache__']
                for f in files:
                    if f.endswith('.tmp') or f in ('STOP', 'process.txt'):
                        continue
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, sub).replace(os.sep, '/')
                    if light and SAMPLE_DIR.search(rel):
                        skipped += 1
                        continue
                    z.write(full, f'{arc0}/{rel}')
        man['skipped_sample_files'] = skipped
        z.writestr('manifest.json', json.dumps(man, indent=1))
    name = (
        re.sub(r'[^\w.-]+', '_', re.sub(r'\.(txt|dat)$', '', rec.get('name') or cid, flags=re.I))[:60]
        + f"_backup_{time.strftime('%Y%m%d-%H%M')}{'_light' if light else ''}.zip"
    )
    return buf.getvalue(), name


def _taken_ids():
    """codes of the runs, Monte Carlo and RDM runs already on this computer (they are found by code)"""
    t = set(os.listdir(config.RUNS)) if os.path.isdir(config.RUNS) else set()
    for c, cp in cases.case_index().items():
        for sub in ('runs', 'mc', 'rdm', 'rh'):
            p = os.path.join(cp, sub)
            if os.path.isdir(p):
                t |= set(os.listdir(p))
    for r in (os.path.join(os.path.dirname(config.RUNS), 'mc'), os.path.join(os.path.dirname(config.RUNS), 'rdm')):
        if os.path.isdir(r):
            t |= set(os.listdir(r))
    return t


def _new_case_id(base):
    base = re.sub(r'[^\w.-]+', '_', base)[:40] or 'case'
    cid, k = base, 2
    have = cases.case_index()
    while cid in have or os.path.exists(os.path.join(config.CASES, cid)):
        cid = f'{base}_{k}'
        k += 1
    return cid


def _fix_json(path, fn):
    if os.path.isfile(path):
        try:
            j = json.load(open(path, encoding='utf-8'))
            fn(j)
            json.dump(j, open(path, 'w', encoding='utf-8'), indent=1)
        except Exception:
            pass


def is_backup(zbytes):
    """a Studio case backup (manifest.json at the top), whatever the button used to open it"""
    try:
        z = zipfile.ZipFile(io.BytesIO(zbytes))
        return 'manifest.json' in z.namelist() and json.loads(z.read('manifest.json')).get('format') == FORMAT
    except Exception:
        return False


def restore(zbytes):
    """POST /api/case/restore (body: a backup zip) -> {ok, id, name, contents, renamed}"""
    try:
        z = zipfile.ZipFile(io.BytesIO(zbytes))
    except zipfile.BadZipFile:
        raise ValueError('this file is not a zip')
    names = z.namelist()
    if any('\\' in n for n in names):  # written by a Windows tool: separators normalised
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z2:
            for n in names:
                if not n.endswith(('/', '\\')):
                    z2.writestr(n.replace('\\', '/'), z.read(n))
        z = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
        names = z.namelist()
    if 'manifest.json' not in names:
        top = [n for n in names if n.endswith('/manifest.json') and n.count('/') == 1]
        if top:  # the backup folder zipped again (unzipped then re-zipped): read it one level down
            pre = top[0][: -len('manifest.json')]
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z2:
                for n in names:
                    if n.startswith(pre) and not n.endswith('/'):
                        z2.writestr(n[len(pre) :], z.read(n))
            z = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
            names = z.namelist()
        elif any(re.search(r'(^|/)genData\.json$', n) for n in names):
            raise ValueError('this zip is a MUIO case, not a Studio backup: use More > "Import a MUIO case (zip)"')
        else:
            raise ValueError('this zip is not a Studio case backup (no manifest.json)')
    man = json.loads(z.read('manifest.json'))
    if man.get('format') != FORMAT:
        raise ValueError('this zip is not a Studio case backup')
    for n in names:  # no absolute paths, no "..": the zip cannot write outside the case
        if n.startswith('/') or re.match(r'^[A-Za-z]:', n) or any(p == '..' for p in re.split(r'[\\/]', n)):
            raise ValueError(f'unsafe path in the zip: {n}')
    taken = _taken_ids()
    renamed = {}
    with tempfile.TemporaryDirectory(dir=config.CASES) as t:
        z.extractall(t)
        tops = [('case', man['case'])] + [
            (f'checkpoints/{c}', c) for c in man.get('checkpoints', []) if os.path.isdir(os.path.join(t, 'checkpoints', c))
        ]
        newid = {}
        for src, old in tops:
            newid[old] = _new_case_id(old if old not in cases.case_index() else old + '_restored')
        for src, old in tops:
            d = os.path.join(t, src)
            for sub in ('runs', 'mc', 'rdm', 'rh'):  # codes already used on this computer get a new one
                p = os.path.join(d, sub)
                if not os.path.isdir(p):
                    continue
                for r in sorted(os.listdir(p)):
                    nr = r
                    if r in taken:
                        k = 2
                        while f'{r}_r{k}' in taken:
                            k += 1
                        nr = f'{r}_r{k}'
                        os.rename(os.path.join(p, r), os.path.join(p, nr))
                        renamed[r] = nr
                    taken.add(nr)
                    for meta in ('meta.json',):
                        _fix_json(os.path.join(p, nr, meta), lambda j: j.__setitem__('case', newid[old]) if j.get('case') else None)

            def fixcase(j, old=old):
                if j.get('checkpointOf') in newid:
                    j['checkpointOf'] = newid[j['checkpointOf']]
                if old == man['case']:
                    j['restored'] = {
                        'from': man.get('name') or old,
                        'backup': man.get('created'),
                        'date': time.strftime('%Y-%m-%d %H:%M:%S'),
                    }
                    if newid[old] != old and not j.get('frozen'):
                        j['name'] = (j.get('name') or old) + ' (restored)'
                j['updated'] = int(time.time() * 1000)

            _fix_json(os.path.join(d, 'case.json'), fixcase)
            shutil.move(d, os.path.join(config.CASES, newid[old]))
    cid = newid[man['case']]
    cases.migrate()  # into the folder of its model
    return {
        'ok': True,
        'id': cid,
        'name': json.load(open(os.path.join(cases.case_path(cid), 'case.json'), encoding='utf-8')).get('name'),
        'contents': man.get('contents'),
        'checkpoints': [newid[c] for c in man.get('checkpoints', []) if c in newid],
        'renamed': renamed,
        'light': man.get('light'),
        'studio': man.get('studio'),
        'created': man.get('created'),
    }
