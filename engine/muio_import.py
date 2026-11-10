"""Import a MUIO case (a backup zip of WebAPP/DataStorage/<case>, or the case folder) into Nour OSeMOSYS Studio.

    python muio_import.py <zip or folder> <out folder>

Uses MUIO's own code (muio_api, Apache-2.0) to write the data files, so the values are exactly those MUIO solves:
  - the base (SC_0 only) -> <out>/data.txt, with the Studio comment lines added:
      descriptions (#@desc, #@setdesc), units and currency (#@unit, #@currency), scenarios (#@scenario, #@sv: for each
      MUIO scenario, the values that differ from the base when MUIO applies it)
  - each run kept in res/<run>/ -> <out>/runs/<run>/: data.txt (as MUIO wrote it), results.json (from MUIO's csv
      results, zeros left out as the Studio does), info.json (objective, scenarios active, run time)
  - <out>/model.txt: the MUIO 5.7 model file; <out>/case.json: name, description, scenarios, runs
Needs pandas (MUIO's code). Writes RESULT {...} on the last line (and NOUR_RESULT_FILE if set)."""

import csv, json, os, re, shutil, sys, tempfile, zipfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from muio_bridge import parse_data, model_dims, muio  # noqa: E402

DEF = os.path.join(HERE, 'muio_api', 'defaults')
LETTER = {
    'r': 'REGION',
    'rr': 'REGION',
    't': 'TECHNOLOGY',
    'f': 'COMMODITY',
    'c': 'COMMODITY',
    'l': 'TIMESLICE',
    'y': 'YEAR',
    'm': 'MODE_OF_OPERATION',
    'e': 'EMISSION',
    's': 'STORAGE',
    'ls': 'SEASON',
    'ld': 'DAYTYPE',
    'lh': 'DAILYTIMEBRACKET',
    'u': 'UDC',
    'yy': 'YEAR',
}


def find_case(root):
    for d, _, files in os.walk(root):
        if 'genData.json' in files:
            return d
    raise ValueError('no MUIO case in this file (genData.json not found)')


def gen(storage, case, name, active):
    from Classes.Case.DataFileClass import DataFile

    D = DataFile(case)
    D.createCaseRun(name, {'Case': name, 'CaseId': 'CS_' + name, 'Desc': 'Nour OSeMOSYS Studio import', 'Runtime': '', 'Scenarios': active})
    D = DataFile(case)
    D.generateDatafile(name)
    return open(Path(storage, case, 'res', name, 'data.txt'), encoding='utf-8').read()


def main(src, out):
    work = tempfile.mkdtemp(prefix='muioimp_')
    os.makedirs(out, exist_ok=True)
    try:
        if os.path.isdir(src):
            root = src
        else:
            root = os.path.join(work, 'zip')
            zipfile.ZipFile(src).extractall(root)
        cdir = find_case(root)
        case = os.path.basename(cdir)
        storage = os.path.join(work, 'DataStorage')
        os.makedirs(storage)
        for f in ('Parameters.json', 'Variables.json'):
            shutil.copy(os.path.join(DEF, f), storage)
        shutil.copytree(cdir, os.path.join(storage, case), ignore=shutil.ignore_patterns('res'))
        os.makedirs(os.path.join(storage, case, 'res'), exist_ok=True)
        gp = os.path.join(storage, case, 'genData.json')
        g0 = json.load(open(gp, encoding='utf-8'))  # cases saved by older MUIO versions
        for k, v in (
            ('osy-indicators', []),
            ('osy-constraints', []),
            ('osy-stg', []),
            ('osy-emis', []),
            ('osy-techGroups', []),
            ('osy-mo', '1'),
        ):
            g0.setdefault(k, v)
        for c in g0.get('osy-comm', []):
            c.setdefault('BalanceLevel', 'Ts')  # MUIO before 5.4: every commodity balanced by time slice
        for t in g0.get('osy-tech', []):
            for k in ('IAR', 'OAR', 'EAR', 'INCR', 'ITCR', 'TG'):
                t.setdefault(k, [])
        for x in g0.get('osy-stg', []):
            x.setdefault('Operation', 'Yearly')
        json.dump(g0, open(gp, 'w', encoding='utf-8'))
        rd = os.path.join(storage, case, 'view', 'resData.json')
        old_res = json.load(open(rd, encoding='utf-8')) if os.path.isfile(rd) else {'osy-cases': []}
        json.dump({'osy-cases': []}, open(rd, 'w')) if os.path.isdir(os.path.dirname(rd)) else None
        muio(storage)
        from Classes.Case.UpdateCaseClass import (
            UpdateCase,
        )  # MUIO's own update: parameters added since the case was saved get their defaults

        for grp in json.load(open(os.path.join(DEF, 'Parameters.json'))):
            gp2 = os.path.join(storage, case, grp + '.json')
            if not os.path.isfile(gp2):
                json.dump({}, open(gp2, 'w'))
        try:
            UpdateCase(case, g0).updateCase()
        except Exception as e:
            raise RuntimeError(f'MUIO could not update this case to version 5.7: {e}')
        G = json.load(open(os.path.join(cdir, 'genData.json'), encoding='utf-8'))
        model = open(os.path.join(DEF, 'model.v.5.7.txt'), encoding='utf-8').read()
        dims = model_dims(model)
        SC = G.get('osy-scenarios') or [{'ScenarioId': 'SC_0', 'Scenario': 'SC_0', 'Desc': 'Base', 'Active': True}]
        sc = lambda sid, act: {'ScenarioId': sid['ScenarioId'], 'Scenario': sid['Scenario'], 'Desc': sid.get('Desc', ''), 'Active': act}
        base_txt = gen(storage, case, '__studio_base', [sc(s, s['ScenarioId'] == 'SC_0') for s in SC])
        bsets, bpar, _ = parse_data(base_txt, dims)
        lines, log = [], []
        # scenarios: what each one changes when MUIO applies it on the base
        for k, s in enumerate([s for s in SC if s['ScenarioId'] != 'SC_0'], 1):
            t = gen(storage, case, f'__studio_s{k}', [sc(x, x['ScenarioId'] in ('SC_0', s['ScenarioId'])) for x in SC])
            _, spar, _ = parse_data(t, dims)
            n = 0
            sid = f'SC_{k}'
            lines.append(f"#@scenario {sid} {s['Scenario'].replace('|', '/')}|{(s.get('Desc') or '').replace('|', '/')}")
            for p, P in spar.items():
                B = bpar.get(p, {'recs': {}, 'def': P.get('def')})
                bd = B.get('def') if B.get('def') is not None else 0.0
                sd_ = P.get('def') if P.get('def') is not None else 0.0
                for key in set(P['recs']) | set(B['recs']):
                    v1, v0 = P['recs'].get(key, sd_), B['recs'].get(key, bd)
                    if v1 != v0 and not (isinstance(v1, float) and isinstance(v0, float) and abs(v1 - v0) <= 1e-12 * max(1, abs(v0))):
                        lines.append(f"#@sv {sid} {p} {' '.join(map(str, key))} {v1!r}")
                        n += 1
            log.append(f"scenario {s['Scenario']} ({s.get('Desc', '')}): {n} values differ from the base")
        # descriptions, names, units, currency
        L = ['# imported from MUIO case ' + case + ' by Nour OSeMOSYS Studio', f"#@currency {G.get('osy-currency') or 'M$'}"]
        for t in G.get('osy-tech', []):
            if t.get('Desc') and t['Desc'] != t['Tech']:
                L.append(f"#@desc {t['Tech']} {t['Desc']}")
            L.append(f"#@unit TECHNOLOGY {t['Tech']} {t.get('CapUnitId') or 'GW'} {t.get('ActUnitId') or 'PJ'}")
        for c in G.get('osy-comm', []):
            if c.get('Desc') and c['Desc'] != c['Comm']:
                L.append(f"#@desc {c['Comm']} {c['Desc']}")
            L.append(f"#@unit COMMODITY {c['Comm']} {c.get('UnitId') or 'PJ'}")
        for e in G.get('osy-emis', []):
            if e.get('Desc'):
                L.append(f"#@setdesc EMISSION {e['Emis']} {e['Desc']}")
            L.append(f"#@unit EMISSION {e['Emis']} {e.get('UnitId') or 'Mt'}")
        for s_ in G.get('osy-stg', []):
            if s_.get('Desc'):
                L.append(f"#@setdesc STORAGE {s_['Stg']} {s_['Desc']}")
            L.append(f"#@unit STORAGE {s_['Stg']} {s_.get('UnitId') or 'PJ'}")
        for key, sn, nm in (
            ('osy-ts', 'TIMESLICE', 'Ts'),
            ('osy-se', 'SEASON', 'Se'),
            ('osy-dt', 'DAYTYPE', 'Dt'),
            ('osy-dtb', 'DAILYTIMEBRACKET', 'Dtb'),
            ('osy-constraints', 'UDC', 'Con'),
        ):
            for x in G.get(key, []) or []:
                if x.get('Desc'):
                    L.append(f"#@setdesc {sn} {x[nm]} {x['Desc']}")
        open(os.path.join(out, 'data.txt'), 'w', encoding='utf-8', newline='\n').write('\n'.join(L + lines) + '\n' + base_txt)
        open(os.path.join(out, 'model.txt'), 'w', encoding='utf-8', newline='\n').write(model)
        # runs kept by MUIO
        runs = []
        byname = {c['Case']: c for c in old_res.get('osy-cases', [])}
        sname = {s['ScenarioId']: s['Scenario'] for s in SC}
        for rn in sorted(os.listdir(os.path.join(cdir, 'res'))) if os.path.isdir(os.path.join(cdir, 'res')) else []:
            rdir = os.path.join(cdir, 'res', rn)
            cdirr = os.path.join(rdir, 'csv')
            if not os.path.isdir(cdirr) or rn.startswith('__studio'):
                continue
            res, obj = {}, None
            for f in sorted(os.listdir(cdirr)):
                if not f.endswith('.csv'):
                    continue
                with open(os.path.join(cdirr, f), encoding='utf-8', errors='ignore') as fh:
                    R = csv.reader(fh)
                    head = next(R, None)
                    if not head:
                        continue
                    name = head[-1].strip() or f[:-4]
                    rows = []
                    for r in R:
                        if not r:
                            continue
                        try:
                            v = float(r[-1])
                        except ValueError:
                            continue
                        if name == 'ObjectiveValue' or f[:-4] == 'ObjectiveValue':
                            obj = v
                            continue
                        if abs(v) > 1e-12:
                            rows.append([x.strip() for x in r[:-1]] + [v])
                if f[:-4] == 'ObjectiveValue':
                    continue
                if re.match(r'^[A-Z][A-Za-z]*\d+[a-z]?_', f[:-4]):
                    name = 'DUAL.' + f[:-4]  # constraint values MUIO keeps (e.g. E8_AnnualEmissionsLimit)
                if rows:
                    res[name] = rows
                res.setdefault('__dims', {})[name] = [LETTER.get(h.strip(), h.strip().upper()) for h in head[:-1]]
            if obj is None and os.path.isfile(os.path.join(rdir, 'results.txt')):
                h = open(os.path.join(rdir, 'results.txt'), encoding='utf-8', errors='ignore').readline()
                m = re.search(r'objective value\s+(-?[\d.eE+]+)', h)
                obj = float(m.group(1)) if m else None
            info = byname.get(rn, {})
            act = [
                sname.get(x['ScenarioId'], x['ScenarioId'])
                for x in info.get('Scenarios', [])
                if x.get('Active') and x['ScenarioId'] != 'SC_0'
            ]
            od = os.path.join(out, 'runs', rn)
            os.makedirs(od, exist_ok=True)
            dims_ = res.pop('__dims', {})
            json.dump(res, open(os.path.join(od, 'results.json'), 'w'))
            if os.path.isfile(os.path.join(rdir, 'data.txt')):
                shutil.copy(os.path.join(rdir, 'data.txt'), os.path.join(od, 'data.txt'))
            st = 'OPTIMAL'
            if os.path.isfile(os.path.join(rdir, 'results.txt')):
                h = open(os.path.join(rdir, 'results.txt'), encoding='utf-8', errors='ignore').readline().lower()
                st = 'OPTIMAL' if h.startswith('optimal') else (h.split(' - ')[0].strip().upper() or 'UNKNOWN')
            json.dump(
                {
                    'name': rn,
                    'objective': obj,
                    'status': st,
                    'scenarios': act,
                    'runtime': info.get('Runtime', ''),
                    'dims': dims_,
                    'variables': {k: len(v) for k, v in res.items()},
                },
                open(os.path.join(od, 'info.json'), 'w'),
                indent=1,
            )
            runs.append({'name': rn, 'objective': obj, 'scenarios': act, 'variables': len(res)})
            log.append(f"run {rn}: {st}, objective {obj}, {len(res)} results, scenarios: base{' + ' + ' + '.join(act) if act else ''}")
        meta = {
            'case': case,
            'description': G.get('osy-desc', ''),
            'version': G.get('osy-version', ''),
            'date': G.get('osy-date', ''),
            'currency': G.get('osy-currency', ''),
            'scenarios': [
                {'id': f'SC_{k}', 'name': s['Scenario'], 'desc': s.get('Desc', '')}
                for k, s in enumerate([s for s in SC if s['ScenarioId'] != 'SC_0'], 1)
            ],
            'runs': runs,
            'log': log,
            'technologies': len(bsets.get('TECHNOLOGY', [])),
            'commodities': len(bsets.get('COMMODITY', [])),
        }
        json.dump(meta, open(os.path.join(out, 'case.json'), 'w'), indent=1)
        return dict(meta, ok=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    try:
        r = main(sys.argv[1], sys.argv[2])
    except Exception as e:
        import traceback

        r = {'ok': False, 'error': f'{type(e).__name__}: {e}', 'trace': traceback.format_exc()[-2500:]}
    if os.environ.get('NOUR_RESULT_FILE'):
        json.dump(r, open(os.environ['NOUR_RESULT_FILE'], 'w'))
    print('RESULT ' + json.dumps(r, default=str))
