"""Nour OSeMOSYS Studio -> MUIO: export a model (and the results of a run) as a MUIO case, using MUIO's own code.

Usage:
  python muio_bridge.py assess  --storage <MUIO DataStorage folder> --data data.txt --model model.txt
  python muio_bridge.py export  --storage <...> --case NAME --data data.txt --model model.txt --mode full|results
                                [--run <Studio run folder with solution.txt>] [--runname NAME]

full     the case with all its parameters (MUIO's Excel-template import, then the groups the template does not carry:
         time-slice mapping, DaySplit, DaysInDayType, input-to-capacity ratios, user-defined constraints) + the run results
results  the case structure (sets, names) with default parameters ("empty model") + the run results
Results are written by MUIO's own functions (generateCSVfromCBC, generateResultsViewer) from the run's solution, so MUIO
shows them as for its own runs. MUIO cases have ONE region: a full export needs a single-region model that uses only the
parameters MUIO knows (Parameters.json of the MUIO installation). Prints one JSON line with the outcome.
MUIO code: tools/muio_api (Apache-2.0).
"""

import argparse, json, os, re, sys, time, shutil, datetime
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
REGIONS = set()
HANDLED = {'UDCTag'}  # MUIO writes it from its constraints (osy-constraints Tag)
STRUCT = {'YearSplit', 'Conversionls', 'Conversionld', 'Conversionlh', 'DaySplit', 'DaysInDayType', 'DiscountRate'}
BASESETS = {
    'REGION',
    'TECHNOLOGY',
    'COMMODITY',
    'FUEL',
    'EMISSION',
    'STORAGE',
    'YEAR',
    'SEASON',
    'DAYTYPE',
    'DAILYTIMEBRACKET',
    'TIMESLICE',
    'MODE_OF_OPERATION',
    'STORAGEINTRADAY',
    'STORAGEINTRAYEAR',
    'UDC',
    'COMMODITY_TS',  # MUIO 5.7: commodities balanced by time slice, season or year
    'COMMODITY_S',
    'COMMODITY_AN',
    'INPUTxFUEL',
}  # + MUIO pre-processor set


# ------------------------------------------------------------------ GMPL data reader (same rules as the Studio)
def model_dims(model_txt, computed=False):
    src = re.sub(r'#[^\n]*', '', model_txt)
    out = {}
    for m in re.finditer(r'\bparam\s+([A-Za-z_]\w*)\s*\{([^}]*)\}([^;]*);', src):
        if not computed and ':=' in m.group(3):
            continue  # computed inside the model file (e.g. TechnologyBalanceLevel)
        out[m.group(1)] = [
            re.search(r'\bin\s+([A-Za-z_]\w*)', x).group(1) if ' in ' in x else x.strip() for x in m.group(2).split(':')[0].split(',')
        ]
    return out


def parse_data(text, dims):
    sets, params, meta = {}, {}, {'desc': {}, 'setdesc': {}, 'colors': {}}
    for m in re.finditer(r'^#@desc\s+(\S+)\s+(.*)$', text, re.M):
        meta['desc'][m.group(1)] = m.group(2).strip()
    for m in re.finditer(r'^#@setdesc\s+(\S+)\s+(\S+)\s+(.*)$', text, re.M):
        meta['setdesc'].setdefault(m.group(1), {})[m.group(2)] = m.group(3).strip()
    meta['units'] = {'TECHNOLOGY': {}, 'COMMODITY': {}, 'EMISSION': {}, 'STORAGE': {}}
    meta['currency'] = 'M$'
    meta['unitdef'] = ['GW', 'PJ', 'PJ', 'MTon', 'PJ']  # units of the Studio (labels, as in MUIO)
    for m in re.finditer(r'^#@unit\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?', text, re.M):
        k = 'COMMODITY' if m.group(1) == 'FUEL' else m.group(1)
        if k in meta['units']:
            meta['units'][k][m.group(2)] = (m.group(3), m.group(4)) if k == 'TECHNOLOGY' else m.group(3)
    m = re.search(r'^#@currency\s+(\S+)', text, re.M)
    meta['currency'] = m.group(1) if m else 'M$'
    m = re.search(r'^#@unitdefault\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)', text, re.M)
    if m:
        meta['unitdef'] = list(m.groups())
    toks = []
    for n, ln in enumerate(text.splitlines()):
        ln = ln.split('#', 1)[0]
        toks += [(m.group(0).strip('\'"'), n) for m in re.finditer(r":=|\[[^\]]*\]|\(tr\)|[:;,]|'[^']*'|\"[^\"]*\"|[^\s:;,\[\]]+", ln)]
    i = 0
    while i < len(toks):
        k = toks[i][0]
        if k not in ('set', 'param'):
            i += 1
            continue
        j = i + 1
        while j < len(toks) and toks[j][0] != ';':
            j += 1
        a = toks[i + 1 : j]
        i = j + 1
        if not a:
            continue
        if k == 'set':
            if len(a) > 1 and a[1][0].startswith('['):
                continue
            sets[a[0][0]] = [x for x, _ in a[1:] if x not in (':=', ',', ':')]
            continue
        name = a[0][0]
        if name == ':':
            continue
        q, d = 1, None
        if q < len(a) and a[q][0] == 'default':
            d = float(a[q + 1][0])
            q += 2
        P = params.setdefault(name, {'def': d, 'recs': {}})
        if d is not None:
            P['def'] = d
        sl, cols, tr = None, None, False

        def fill(key):
            if sl is None:
                return tuple(key)
            key = list(key)
            return tuple(key.pop(0) if x == '*' else x for x in sl)

        while q < len(a):
            t = a[q][0]
            if t in (':=', ','):
                q += 1
                continue
            if t.startswith('['):
                sl = [x.strip() for x in t[1:-1].split(',')]
                cols = None
                tr = False
                q += 1
                continue
            if t == '(tr)':
                tr = True
                q += 1
                continue
            if t == ':':
                q += 1
                cols = []
                while q < len(a) and a[q][0] != ':=':
                    cols.append(a[q][0])
                    q += 1
                q += 1
                continue
            if cols is not None:
                row = t
                q += 1
                for c in cols:
                    if q >= len(a):
                        break
                    v = a[q][0]
                    q += 1
                    if v != '.':
                        P['recs'][fill([c, row] if tr else [row, c])] = float(v)
                continue
            free = sum(1 for x in sl if x == '*') if sl else len(dims.get(name, [])) or None
            if free:
                key = [a[q + c][0] for c in range(free)]
                v = a[q + free][0]
                q += free + 1
                P['recs'][fill(key)] = float(v)
                continue
            n = a[q][1]
            t2 = []
            while q < len(a) and a[q][1] == n and not a[q][0].startswith('[') and a[q][0] != ':':
                if a[q][0] not in (',', ':='):
                    t2.append(a[q][0])
                q += 1
            if len(t2) >= 2:
                P['recs'][fill(t2[:-1])] = float(t2[-1])
    if 'COMMODITY' not in sets and 'FUEL' in sets:
        sets['COMMODITY'] = sets['FUEL']
    return sets, params, meta


# ------------------------------------------------------------------ MUIO side
def muio(storage):
    os.environ['MUIO_DATA_STORAGE'] = str(Path(storage).resolve())
    sys.path.insert(0, os.path.join(HERE, 'muio_api'))
    for f, empty in (('Duals.json', {}), ('Indicators.json', {})):  # present in MUIO installations; added if missing
        p = Path(storage, f)
        if not p.is_file():
            p.write_text(json.dumps(empty))
    from Classes.Base import Config

    Config.DATA_STORAGE = Path(storage).resolve()
    return Config


def muio_params(storage):
    P = json.load(open(Path(storage, 'Parameters.json'), encoding='utf-8'))
    return {x['name']: dict(x, group=g) for g, arr in P.items() for x in arr}


def assess(storage, data_txt, model_txt):
    dims = model_dims(model_txt)
    sets, params, _ = parse_data(data_txt, dims)
    MP = muio_params(storage) if storage and Path(storage, 'Parameters.json').is_file() else None
    full, reasons = True, []
    if MP is None:
        full = False
        reasons.append('MUIO DataStorage folder not found (it must contain Parameters.json)')
    regs = sets.get('REGION', [])
    if len(regs) != 1:
        full = False
        reasons.append(f'the model has {len(regs)} regions; a MUIO case has one region')
    if MP is not None:
        extra = sorted(
            p
            for p, P in params.items()
            if p not in MP
            and p not in STRUCT
            and p not in HANDLED
            and any(v != (P['def'] if P['def'] is not None else 0) for v in P['recs'].values())
        )
        if extra:
            full = False
            reasons.append('parameters MUIO does not have: ' + ', '.join(extra[:12]) + ('…' if len(extra) > 12 else ''))
        decl = set(dims) - set(MP) - STRUCT - HANDLED - {'CapitalRecoveryFactor', 'PvAnnuity', 'TradeRoute', 'ModelPeriodExogenousEmission'}
        decl = sorted(x for x in decl if not re.match(r'^(BalanceEquality|CapitalRecoveryFactorStorage|PvAnnuityStorage)$', x))
        if decl:
            full = False
            reasons.append(
                'the model file is not a standard MUIO model: it declares parameters MUIO does not have ('
                + ', '.join(decl[:12])
                + ('…' if len(decl) > 12 else '')
                + '); MUIO would solve the case without them'
            )
    src = re.sub(r'#[^\n]*', '', model_txt)
    mset = sorted({m.group(1) for m in re.finditer(r'\bset\s+([A-Za-z_]\w*)\s*;', src)} - BASESETS)
    if mset:
        full = False
        reasons.append('the model file declares sets MUIO does not have: ' + ', '.join(mset))
    xs = sorted(s for s in sets if s not in BASESETS and sets[s])
    if xs:
        full = False
        reasons.append('sets MUIO does not have: ' + ', '.join(xs))
    tr = params.get('TradeRoute', {'recs': {}})['recs']
    if any(v for v in tr.values()):
        full = False
        reasons.append('trade routes (MUIO cases have no trade)')
    return {'full': full, 'results': True, 'reasons': reasons, 'regions': regs}


def sheet_name(label, name):
    s = label.replace(' ', '')
    if s == 'TotalTechnologyModelPeriodActivityUpperLimit':
        s = 'TotalTechnologyPeriodActivityUp'
    if s == 'TotalTechnologyModelPeriodActivityLowerLimit':
        s = 'TotalTechnologyPeriodActivityLo'
    return s[:31]


def write_template(path, sets, params, meta, MP, mode):
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)
    r0 = sets['REGION'][0]
    Y = sets['YEAR']
    desc, sd = meta['desc'], meta['setdesc']
    num = lambda x: int(x) if re.fullmatch(r'-?\d+', str(x)) else x

    def sh(name, header, rows):
        ws = wb.create_sheet(name)
        ws.append(header)
        for r in rows:
            ws.append(r)

    U = meta.get('units') or {}
    ud = meta.get('unitdef') or ['GW', 'PJ', 'PJ', 'MTon', 'PJ']
    tu = lambda t: (U.get('TECHNOLOGY', {}).get(t) or (ud[0], ud[1]))
    sh(
        'TECHNOLOGY',
        ['VALUE', 'DESCRIPTION', 'UNITOFCAPACITY', 'UNITOFACTIVITY'],
        [[t, desc.get(t, t), tu(t)[0] or ud[0], tu(t)[1] or ud[1]] for t in sets.get('TECHNOLOGY', [])],
    )
    level = lambda f: 'Se' if f in sets.get('COMMODITY_S', []) else 'An' if f in sets.get('COMMODITY_AN', []) else 'Ts'  # MUIO's balance levels
    sh(
        'FUEL',
        ['VALUE', 'DESCRIPTION', 'UNIT', 'BALANCE_LEVEL'],
        [[f, desc.get(f, f), U.get('COMMODITY', {}).get(f, ud[2]), level(f)] for f in sets.get('COMMODITY', [])],
    )
    sh(
        'EMISSION',
        ['VALUE', 'DESCRIPTION', 'UNIT'],
        [[e, sd.get('EMISSION', {}).get(e, e), U.get('EMISSION', {}).get(e, ud[3])] for e in sets.get('EMISSION', [])],
    )
    sh(
        'STORAGE',
        ['VALUE', 'DESCRIPTION', 'UNIT'],
        [[s, sd.get('STORAGE', {}).get(s, s), U.get('STORAGE', {}).get(s, ud[4])] for s in sets.get('STORAGE', [])],
    )
    sh('YEAR', ['VALUE'], [[int(y)] for y in Y])
    sh('MODE_OF_OPERATION', ['VALUE'], [[num(m)] for m in sets.get('MODE_OF_OPERATION', ['1'])])
    for sn in ('TIMESLICE', 'SEASON', 'DAYTYPE', 'DAILYTIMEBRACKET'):
        sh(sn, ['VALUE', 'DESCRIPTION'], [[num(x), sd.get(sn, {}).get(x, f'{sn.lower()} {x}')] for x in sets.get(sn, [])])

    def recs(p):
        P = params.get(p)
        return {k: v for k, v in (P['recs'].items() if P else []) if k[0] == r0 or p in ('YearSplit',)}

    def defv(p):
        P = params.get(p)
        return P['def'] if P and P['def'] is not None else MP.get(p, {}).get('default', 0)

    flows = {
        'InputActivityRatio': [],
        'OutputActivityRatio': [],
        'EmissionActivityRatio': [],
        'TechnologyToStorage': [],
        'TechnologyFromStorage': [],
    }
    groups = {}
    for p, info in MP.items():
        if mode != 'full' and p not in ('YearSplit',):
            continue
        R = recs(p)
        if not R and p not in flows:
            continue
        g = info['group']
        d = defv(p)
        name = sheet_name(info['value'], p)
        if g == 'R':
            sh(name, ['REGION', 'VALUE'], [[r0, list(R.values())[0]]] if R else [])
            continue
        if g in ('RT', 'RE', 'RS'):
            col = {'RT': 'TECHNOLOGY', 'RE': 'EMISSION', 'RS': 'STORAGE'}[g]
            sh(name, ['REGION', col, 'VALUE'], [[r0, k[1], v] for k, v in R.items()])
            continue
        if g == 'RYTs':
            sh(name, ['TIMESLICE', 'YEAR', 'VALUE'], [[num(k[0]), int(k[1]), v] for k, v in R.items()])
            continue
        if g == 'RTSM':
            sh(
                name,
                ['REGION', 'TECHNOLOGY', 'STORAGE', 'MODE_OF_OPERATION', 'VALUE'],
                [[r0, k[1], k[2], num(k[3]), v] for k, v in R.items() if v],
            )
            continue
        keycols = {
            'RYT': ['TECHNOLOGY'],
            'RYC': ['FUEL'],
            'RYE': ['EMISSION'],
            'RYS': ['STORAGE'],
            'RYTM': ['TECHNOLOGY', 'MODE_OF_OPERATION'],
            'RYTCM': ['TECHNOLOGY', 'FUEL', 'MODE_OF_OPERATION'],
            'RYTEM': ['TECHNOLOGY', 'EMISSION', 'MODE_OF_OPERATION'],
            'RYTTs': ['TECHNOLOGY', 'TIMESLICE'],
            'RYCTs': ['FUEL', 'TIMESLICE'],
        }.get(g)
        if not keycols:
            continue  # RYDtb, RYSeDt, RYTC, RYCn, RYTCn: written after the import
        rows = {}
        for k, v in R.items():
            rows.setdefault(k[1:-1], {})[k[-1]] = v
        if g in ('RYTCM', 'RYTEM') and p in flows:
            flows[p] = [kk for kk, ys in rows.items() if any(ys.values())]
        sh(
            name,
            ['REGION'] + keycols + [int(y) for y in Y],
            [[r0] + [num(x) for x in kk] + [ys.get(y, d) for y in Y] for kk, ys in rows.items()],
        )
        groups[p] = g
    for p in ('InputActivityRatio', 'OutputActivityRatio', 'EmissionActivityRatio', 'TechnologyToStorage', 'TechnologyFromStorage'):
        if sheet_name(MP[p]['value'], p) not in wb.sheetnames:
            hdr = {
                'TechnologyToStorage': ['REGION', 'TECHNOLOGY', 'STORAGE', 'MODE_OF_OPERATION', 'VALUE'],
                'TechnologyFromStorage': ['REGION', 'TECHNOLOGY', 'STORAGE', 'MODE_OF_OPERATION', 'VALUE'],
                'EmissionActivityRatio': ['REGION', 'TECHNOLOGY', 'EMISSION', 'MODE_OF_OPERATION'] + [int(y) for y in Y],
            }.get(p, ['REGION', 'TECHNOLOGY', 'FUEL', 'MODE_OF_OPERATION'] + [int(y) for y in Y])
            sh(sheet_name(MP[p]['value'], p), hdr, [])
    # the template reader looks the flow sheets up by these exact names
    for p, alias in (
        ('InputActivityRatio', 'InputActivityRatio'),
        ('OutputActivityRatio', 'OutputActivityRatio'),
        ('EmissionActivityRatio', 'EmissionActivityRatio'),
        ('TechnologyToStorage', 'TechnologyToStorage'),
        ('TechnologyFromStorage', 'TechnologyFromStorage'),
    ):
        src = sheet_name(MP[p]['value'], p)
        if alias not in wb.sheetnames:
            ws = wb.copy_worksheet(wb[src])
            ws.title = alias
    wb.save(path)


def patch_case(storage, case, sets, params, meta, MP, mode):
    """groups the Excel template does not carry; written in MUIO's own JSON layout"""
    from Classes.Base.FileClass import File
    from Classes.Case.CaseClass import Case

    cp = Path(storage, case)
    G = File.readFile(cp / 'genData.json')
    r0 = sets['REGION'][0]
    Y = sets['YEAR']
    byname = lambda arr, nk, ik: {str(x[nk]): x[ik] for x in arr}
    se, dt, dtb = byname(G['osy-se'], 'Se', 'SeId'), byname(G['osy-dt'], 'Dt', 'DtId'), byname(G['osy-dtb'], 'Dtb', 'DtbId')
    tech, comm = byname(G['osy-tech'], 'Tech', 'TechId'), byname(G['osy-comm'], 'Comm', 'CommId')
    conv = lambda p: {k[0]: k[1] for k, v in params.get(p, {'recs': {}})['recs'].items() if v}
    ls, ld, lh = conv('Conversionls'), conv('Conversionld'), conv('Conversionlh')
    for ts in G['osy-ts']:  # time slice -> season / day type / day part (Conversionls/ld/lh)
        n = str(ts['Ts'])
        if n in ls and ls[n] in se:
            ts['SE'] = se[ls[n]]
        if n in ld and ld[n] in dt:
            ts['DT'] = dt[ld[n]]
        if n in lh and lh[n] in dtb:
            ts['DTB'] = dtb[lh[n]]
    if mode == 'full':
        for p, key in (('InputToNewCapacityRatio', 'INCR'), ('InputToTotalCapacityRatio', 'ITCR')):
            for k, v in params.get(p, {'recs': {}})['recs'].items():
                if k[0] == r0 and v and k[1] in tech:
                    t = next(x for x in G['osy-tech'] if x['TechId'] == tech[k[1]])
                    t.setdefault(key, [])
                    if comm[k[2]] not in t[key]:
                        t[key].append(comm[k[2]])
        tags = params.get('UDCTag', {'recs': {}})['recs']
        G['osy-constraints'] = []
        for u in sets.get('UDC', []):
            tg = tags.get((r0, u))
            cm = sorted(
                {
                    k[1]
                    for p in ('UDCMultiplierActivity', 'UDCMultiplierNewCapacity', 'UDCMultiplierTotalCapacity')
                    for k, v in params.get(p, {'recs': {}})['recs'].items()
                    if k[0] == r0 and k[2] == u and v
                }
            )
            if tg in (0, 1):
                G['osy-constraints'].append(
                    {
                        'ConId': 'CO_' + re.sub(r'\W', '', u),
                        'Con': u,
                        'Desc': meta['setdesc'].get('UDC', {}).get(u, u),
                        'Tag': int(tg),
                        'CM': [tech[t] for t in cm if t in tech],
                    }
                )
    File.writeFile(G, cp / 'genData.json')
    C = Case(case, G)
    for g in ('RYDtb', 'RYSeDt', 'RYTC', 'RYCn', 'RYTCn'):
        if g in C.jsonPath:
            getattr(C, 'default_' + g)()
    if mode != 'full':  # empty model: keep the time structure (YearSplit) so MUIO's checks pass
        ys = {(k[0], k[1]): v for k, v in params.get('YearSplit', {'recs': {}})['recs'].items()}
        tsn = {x['TsId']: str(x['Ts']) for x in G['osy-ts']}
        path = cp / 'RYTs.json'
        J = File.readFile(path)
        for pidk in J:
            for el in J[pidk]['SC_0']:
                for y in Y:
                    if (tsn.get(el['TsId']), y) in ys:
                        el[y] = ys[(tsn[el['TsId']], y)]
        File.writeFile(J, path)
        return

    def setvals(group, pid, match, recs):
        path = cp / (group + '.json')
        J = File.readFile(path)
        for el in J[pid]['SC_0']:
            k = match(el)
            if k is None:
                continue
            for y in Y:
                v = recs.get(k + (y,))
                if v is not None:
                    el[y] = v
        File.writeFile(J, path)

    pid = lambda p: MP[p]['id']
    inv = lambda d: {v: k for k, v in d.items()}
    seI, dtI, dtbI, tI, cI = inv(se), inv(dt), inv(dtb), inv(tech), inv(comm)
    rec = lambda p: (
        {k[1:]: v for k, v in params.get(p, {'recs': {}})['recs'].items() if k[0] == r0}
        if p not in ('DaySplit', 'DaysInDayType')
        else dict(params.get(p, {'recs': {}})['recs'])
    )
    if 'DaySplit' in MP:
        setvals('RYDtb', pid('DaySplit'), lambda el: (dtbI.get(el['DtbId']),), rec('DaySplit'))
    if 'DaysInDayType' in MP:
        setvals('RYSeDt', pid('DaysInDayType'), lambda el: (seI.get(el['SeId']), dtI.get(el['DtId'])), rec('DaysInDayType'))
    for p in ('InputToNewCapacityRatio', 'InputToTotalCapacityRatio'):
        if p in MP:
            setvals('RYTC', pid(p), lambda el: (tI.get(el['TechId']), cI.get(el['CommId'])), rec(p))
    cons = {c['ConId']: c['Con'] for c in G['osy-constraints']}
    if 'UDCConstant' in MP:
        setvals('RYCn', pid('UDCConstant'), lambda el: (cons.get(el['ConId']),), rec('UDCConstant'))
    for p in ('UDCMultiplierActivity', 'UDCMultiplierNewCapacity', 'UDCMultiplierTotalCapacity'):
        if p in MP:
            setvals('RYTCn', pid(p), lambda el: (tI.get(el['TechId']), cons.get(el['ConId'])), rec(p))


def write_post_data(path, sets, params, r0):
    """data file for MUIO's results post-processing (results-only export): region r0, MUIO layout, the defaults written
    out explicitly (MUIO's reader does not apply data-file defaults)"""
    Y, T = sets['YEAR'], sets.get('TECHNOLOGY', [])
    g = lambda p: params.get(p, {'def': None, 'recs': {}})
    dv = lambda p, d: g(p)['def'] if g(p)['def'] is not None else d
    L = []
    for s in (
        'EMISSION',
        'TECHNOLOGY',
        'FUEL',
        'YEAR',
        'TIMESLICE',
        'MODE_OF_OPERATION',
        'REGION',
        'SEASON',
        'DAYTYPE',
        'DAILYTIMEBRACKET',
        'STORAGE',
    ):
        v = [r0] if s == 'REGION' else sets.get('COMMODITY' if s == 'FUEL' else s, [])
        L.append(f"set {s} := {' '.join(v)} ;")
    dr = g('DiscountRate')['recs'].get((r0,), dv('DiscountRate', 0.05))
    L += [f'param DiscountRate default {dr} := ', f'{r0} {dr} ', ';']
    for p, d in (('OperationalLife', dv('OperationalLife', 1)), ('DiscountRateIdv', dr)):
        R = g(p)['recs']
        L += [
            f'param {p} default {d} : ',
            ' '.join(T) + ' :=',
            r0 + ' ' + ' '.join(str(R.get((r0, t), d) if p != 'OperationalLife' else int(R.get((r0, t), d))) for t in T) + ' ',
            ';',
        ]
    ys = g('YearSplit')['recs']
    L += [f'param YearSplit default 1 : ', ' '.join(Y) + ' :=']
    L += [l + ' ' + ' '.join(str(ys.get((l, y), 0)) for y in Y) + ' ' for l in sets.get('TIMESLICE', [])] + [';']

    def yearly(p, nk):  # [r0, k..., *, *]: years := rows of the last key
        R = {k[1:]: v for k, v in g(p)['recs'].items() if k[0] == r0 and v}
        L.append(f'param {p} default 0 := ')
        groups = {}
        for k, v in R.items():
            groups.setdefault(k[: nk - 1], {}).setdefault(k[nk - 1], {})[k[-1]] = v
        for head, rows in groups.items():
            L.append(f"[{r0},{','.join(head)},*,*]:" if head else f'[{r0},*,*]:')
            L.append(' '.join(Y) + ' :=')
            L.extend(f"{row} {' '.join(str(vals.get(y, 0)) for y in Y)} " for row, vals in rows.items())
        L.append(';')

    yearly('InputActivityRatio', 3)
    yearly('OutputActivityRatio', 3)
    yearly('EmissionActivityRatio', 3)
    yearly('SpecifiedAnnualDemand', 1)
    yearly('AccumulatedAnnualDemand', 1)
    yearly('SpecifiedDemandProfile', 2)
    yearly('ResidualStorageCapacity', 1)
    L.append('end;')
    open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(L) + '\n')


def solution_to_cbc(solution, out, region=None, const=0.0):
    """Studio solution ("name[idx] value") -> CBC solution file, the form MUIO's generateCSVfromCBC reads.
    The objective is written as MUIO reports it: without the constant part (MUIO solves the LP file written by GLPK, which
    leaves the constant out)"""
    st, obj, rows = 'OPTIMAL', 0.0, []
    for ln in open(solution, encoding='utf-8'):
        if ln.startswith('#status'):
            st = ln.split(None, 1)[1].strip()
        elif ln.startswith('#objective'):
            obj = float(ln.split()[1])
        elif ln.startswith('#'):
            continue
        elif ln.strip():
            n, v = ln.rsplit(' ', 1)
            if (
                region
                and '[' in n
                and n.split('[', 1)[1].split(',')[0].rstrip(']') not in (region,)
                and n.split('[', 1)[1].split(',')[0].rstrip(']') in REGIONS
            ):
                continue
            rows.append((n.replace('[', '(').replace(']', ')'), float(v)))
    obj -= const
    with open(out, 'w') as f:
        f.write(f"{'Optimal' if st.startswith('OPTIMAL') else st.title()} - objective value {obj:.8f}\n")
        for i, (n, v) in enumerate(rows):
            f.write(f'{i:>7} {n:<60} {v:>20.10g} {0:>15}\n')
    return st, obj


def export(storage, case, data_txt, model_txt, mode, run=None, runname=None):
    t0 = time.time()
    log = []
    A = assess(storage, data_txt, model_txt)
    if mode == 'full' and not A['full']:
        raise RuntimeError('full export not possible: ' + '; '.join(A['reasons']))
    Config = muio(storage)
    MP = muio_params(storage)
    from Classes.Case.ImportTemplate import ImportTemplate
    from Classes.Case.DataFileClass import DataFile

    dims = model_dims(model_txt)
    sets, params, meta = parse_data(data_txt, dims)
    if len(sets.get('REGION', [])) != 1 and mode == 'results':
        log.append(f"results of region {sets['REGION'][0]} only (MUIO cases have one region)")
    case = re.sub(r'[^\w-]+', '_', case)
    if Path(storage, case).exists():
        raise RuntimeError(f'a MUIO case named {case} already exists in this DataStorage')
    if run:
        st0 = run_status(run)
        if not st0.startswith('OPTIMAL'):
            if mode != 'full':
                raise RuntimeError(f'the run is {st0}: only an optimal run has results to export')
            log.append(f'run not exported: it is {st0} (no optimal solution); the case is exported without results')
            run = None
    try:
        return _export(storage, case, sets, params, meta, MP, mode, run, runname, log, A, t0)
    except Exception:
        shutil.rmtree(Path(storage, case), ignore_errors=True)  # no half-made case left in MUIO
        raise
    finally:
        try:
            os.remove(Path(storage, f'{case}_template.xlsx'))
        except OSError:
            pass


def run_status(run):
    sf = os.path.join(run, 'status.json')
    if os.path.isfile(sf) and json.load(open(sf)).get('solver_status'):
        return json.load(open(sf))['solver_status'].upper()
    for ln in open(os.path.join(run, 'solution.txt'), encoding='utf-8', errors='ignore'):
        if ln.startswith('#status'):
            return ln.split(None, 1)[1].strip().upper()
        if not ln.startswith('#'):
            break
    sf = os.path.join(run, 'status.json')
    return (json.load(open(sf)).get('solver_status') or 'UNKNOWN').upper() if os.path.isfile(sf) else 'UNKNOWN'


def _export(storage, case, sets, params, meta, MP, mode, run, runname, log, A, t0):
    from Classes.Case.ImportTemplate import ImportTemplate
    from Classes.Case.DataFileClass import DataFile

    tpl = f'{case}_template.xlsx'
    write_template(Path(storage, tpl), sets, params, meta, MP, mode)
    r = ImportTemplate(tpl).importProcess(
        {
            'osy-template': tpl,
            'osy-casename': case,
            'osy-currency': meta.get('currency') or 'M$',
            'osy-version': '5.7',
            'osy-desc': f'Exported from Nour OSeMOSYS Studio ({"full model" if mode == "full" else "results only, empty model"})',
            'osy-date': datetime.date.today().isoformat(),
            'osy-data': mode == 'full',
        }
    )
    if r.get('status_code') != 'success':
        raise RuntimeError(f'MUIO import failed: {r}')
    patch_case(storage, case, sets, params, meta, MP, mode)
    log.append('case created')
    if run:
        rn = re.sub(r'[^\w-]+', '_', runname or 'Studio_run')
        D = DataFile(case)
        D.createCaseRun(
            rn,
            {
                'Case': rn,
                'CaseId': 'CS_' + rn,
                'Desc': 'results imported from Nour OSeMOSYS Studio',
                'Runtime': time.strftime('%a %b %d %Y %H:%M'),
                'Scenarios': [{'ScenarioId': 'SC_0', 'Scenario': 'SC_0', 'Desc': 'Base scenario', 'Active': True}],
            },
        )
        D = DataFile(case)
        D.generateDatafile(rn)  # MUIO's own data file for the run
        base = Path(storage, case, 'res', rn)
        r0 = sets['REGION'][0]
        REGIONS.clear()
        REGIONS.update(sets['REGION'])
        if mode != 'full':
            write_post_data(base / 'data_studio.txt', sets, params, r0)
        sf = os.path.join(run, 'status.json')
        const = (json.load(open(sf)).get('objective_constant') or 0.0) if os.path.isfile(sf) else 0.0
        if os.path.isfile(os.path.join(run, 'problem.mps.const')):
            const = float(open(os.path.join(run, 'problem.mps.const')).read() or 0)
        solf = (
            os.path.join(run, 'solution_std.txt')
            if os.path.isfile(os.path.join(run, 'solution_std.txt'))
            else os.path.join(run, 'solution.txt')
        )
        st, obj = solution_to_cbc(solf, base / 'results.txt', r0, const)
        if const:
            log.append(
                f'objective in MUIO: {obj:,.4f} = the Studio objective {obj + const:,.4f} without its constant part {const:,.4f} (MUIO leaves it out)'
            )
        D.generateCSVfromCBC(base / ('data.txt' if mode == 'full' else 'data_studio.txt'), base / 'results.txt', base)
        D.generateResultsViewer(rn)
        log.append(f'run {rn}: {st}, objective {obj}, {len(os.listdir(base / "csv"))} result tables')
    return {'ok': True, 'case': case, 'path': str(Path(storage, case)), 'log': log, 'seconds': round(time.time() - t0, 1), 'assess': A}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('action', choices=['assess', 'export'])
    ap.add_argument('--storage', required=True)
    ap.add_argument('--data', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--case')
    ap.add_argument('--mode', default='full')
    ap.add_argument('--run')
    ap.add_argument('--runname')
    a = ap.parse_args()
    data_txt = open(a.data, encoding='utf-8', errors='ignore').read()
    model_txt = open(a.model, encoding='utf-8', errors='ignore').read()
    try:
        out = (
            assess(a.storage, data_txt, model_txt)
            if a.action == 'assess'
            else export(a.storage, a.case, data_txt, model_txt, a.mode, a.run, a.runname)
        )
    except Exception as e:
        import traceback

        out = {'ok': False, 'error': str(e), 'trace': traceback.format_exc()[-1500:]}
    print('RESULT ' + json.dumps(out))
    if os.environ.get('NOUR_RESULT_FILE'):  # the server also reads the outcome from this file
        open(os.environ['NOUR_RESULT_FILE'], 'w', encoding='utf-8').write(json.dumps(out))
