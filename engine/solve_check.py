"""Solve an OSeMOSYS data file with a given model file (GLPK through swiglpk) to prove the file is valid and feasible.

Usage:  python solve_check.py <model.txt> <data.txt> [--keep] [--show=REGEX ...]   (prints variables whose name matches)
        python solve_check.py <model> <data> --write-mps=FILE           (write the problem for another solver; used by the server)
        python solve_check.py <model> <data> --glpk-solve=SOLFILE [--method=simplex|interior] [--tmlim=SECONDS]
Adds the derived sets that MUIO model files expect from their pre-processor (MODEperTECHNOLOGY, MODExTECHNOLOGYper...,
INPUTx...), only for the sets the model file declares, then builds the LP with GLPK and solves it with GLPK simplex.
Prints: status (OPTIMAL / INFEASIBLE / ...), objective, rows, columns.  Needs: pip install swiglpk
"""

import re, sys, os, tempfile
import swiglpk as g

DIMS = {
    'InputActivityRatio': 5,
    'OutputActivityRatio': 5,
    'EmissionActivityRatio': 5,
    'EmissionToActivityChangeRatio': 5,
    'TechnologyToStorage': 4,
    'TechnologyFromStorage': 4,
    'InputToNewCapacityRatio': 4,
    'InputToTotalCapacityRatio': 4,
    'DiscountRate': 1,
    'DiscountRateIdv': 2,
    'OperationalLife': 2,
}
DEFS = {}


def parse(text):
    """minimal GMPL data reader (same rules as the explorer): sets and the parameters in DIMS"""
    toks = []
    for n, ln in enumerate(text.splitlines()):
        ln = ln.split('#', 1)[0]
        toks += [(m.group(0).strip('\'"'), n) for m in re.finditer(r":=|\[[^\]]*\]|\(tr\)|[:;,]|'[^']*'|\"[^\"]*\"|[^\s:;,\[\]]+", ln)]
    sets, recs, i = {}, {p: [] for p in DIMS}, 0
    while i < len(toks):
        k = toks[i][0]
        if k in ('set', 'param'):
            j = i + 1
            while j < len(toks) and toks[j][0] != ';':
                j += 1
            a = toks[i + 1 : j]
            i = j + 1
            if not a:
                continue
            if k == 'set':
                b = [x for x, _ in a[1:] if x not in (':=', ',', ':') and not x.startswith('[')]
                sets[a[0][0]] = b
                continue
            name = a[0][0]
            if name not in DIMS:
                continue
            q = 1
            if q < len(a) and a[q][0] == 'default':
                DEFS[name] = float(a[q + 1][0])
                q += 2
            sl, cols, tr = None, None, False
            fill = lambda key: key if sl is None else [key.pop(0) if x == '*' else x for x in sl]
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
                        if q < len(a):
                            v = a[q][0]
                            q += 1
                            if v != '.':
                                recs[name].append((fill([c, row] if tr else [row, c]), float(v)))
                    continue
                free = sum(1 for x in sl if x == '*') if sl else DIMS[name]
                key = [a[q + c][0] for c in range(free)]
                v = a[q + free][0]
                q += free + 1
                recs[name].append((fill(key), float(v)))
        else:
            i += 1
    return sets, recs


def derived(model_txt, sets, recs):
    T, F, E, S = sets.get('TECHNOLOGY', []), sets.get('COMMODITY', sets.get('FUEL', [])), sets.get('EMISSION', []), sets.get('STORAGE', [])
    nz = lambda p: [k for k, v in recs[p] if v != 0]
    mt = {t: set() for t in T}
    per = {n: {} for n in ('out', 'in', 'emi', 'emic', 'to', 'from')}
    for p, n, ci in (
        ('OutputActivityRatio', 'out', 2),
        ('InputActivityRatio', 'in', 2),
        ('EmissionActivityRatio', 'emi', 2),
        ('EmissionToActivityChangeRatio', 'emic', 2),
        ('TechnologyToStorage', 'to', 2),
        ('TechnologyFromStorage', 'from', 2),
    ):
        for k in nz(p):
            t, x, m = k[1], k[ci], k[3]
            mt.setdefault(t, set()).add(m)
            per[n].setdefault(x, set()).add((m, t))
    inew, itot = {}, {}
    for k in nz('InputToNewCapacityRatio'):
        inew.setdefault(k[2], set()).add(k[1])
    for k in nz('InputToTotalCapacityRatio'):
        itot.setdefault(k[2], set()).add(k[1])
    has = lambda s: re.search(r'^\s*set\s+' + s + r'\b', model_txt, re.M)
    out = ['', '#### derived sets added by solve_check.py ####']
    if has('MODEperTECHNOLOGY'):
        out += [f"set MODEperTECHNOLOGY[{t}] := {' '.join(sorted(mt.get(t, ())))};" for t in T]
    pairs = lambda s: ' '.join(f'({m},{t})' for m, t in sorted(s))
    for setn, n, idx in (
        ('MODExTECHNOLOGYperFUELout', 'out', F),
        ('MODExTECHNOLOGYperFUELin', 'in', F),
        ('MODExTECHNOLOGYperEMISSION', 'emi', E),
        ('MODExTECHNOLOGYperEMISSIONChange', 'emic', E),
        ('MODExTECHNOLOGYperSTORAGEto', 'to', S),
        ('MODExTECHNOLOGYperSTORAGEfrom', 'from', S),
    ):
        if has(setn):
            out += [f"set {setn}[{x}] := {pairs(per[n].get(x, ()))};" for x in idx]
    if has('INPUTxNEWxCAPACITYperFUEL'):
        out += [f"set INPUTxNEWxCAPACITYperFUEL[{f}] := {' '.join(sorted(inew.get(f, ())))};" for f in F]
    if has('INPUTxTOTALxCAPACITYperFUEL'):
        out += [f"set INPUTxTOTALxCAPACITYperFUEL[{f}] := {' '.join(sorted(itot.get(f, ())))};" for f in F]
    if has('INPUTxFUEL'):
        out += [f"set INPUTxFUEL := {' '.join(sorted(set(inew) | set(itot)))};"]

    # MUIO 5.4 model files: capital recovery factor and present-value annuity are computed by the pre-processor (as run_model.py)
    def pv(p, *k):
        for kk, v in recs[p]:
            if kk == list(k):
                return v
        return DEFS.get(p, 0.0)

    R = sets.get('REGION', [])
    if re.search(r'^\s*param\s+(CapitalRecoveryFactor|PvAnnuity)\b[^;:=]*;', model_txt, re.M):
        bad = [f'{r} {t}' for r in R for t in T if pv('OperationalLife', r, t) <= 0]
        if bad:
            print(
                f'STATUS DATA_ERROR (OperationalLife is missing or 0 for {len(bad)} technologies, e.g. {", ".join(bad[:5])}: '
                'give it in years, or a default, to compute the capital recovery factor)'
            )
            sys.exit(2)
    if re.search(r'^\s*param\s+CapitalRecoveryFactor\b[^;:=]*;', model_txt, re.M):
        out.append('param CapitalRecoveryFactor :=')
        for r in R:
            for t in T:
                i, n = (
                    pv('DiscountRateIdv', r, t)
                    if any(True for _ in recs['DiscountRateIdv']) or 'DiscountRateIdv' in DEFS
                    else pv('DiscountRate', r)
                ), pv('OperationalLife', r, t)
                out.append(f'{r} {t} {round((1 - (1 + i) ** -1) / (1 - (1 + i) ** -n), 4) if i else round(1 / n, 4):.15g}')
        out.append(';')
    if re.search(r'^\s*param\s+PvAnnuity\b[^;:=]*;', model_txt, re.M):
        out.append('param PvAnnuity :=')
        for r in R:
            for t in T:
                i, n = pv('DiscountRate', r), pv('OperationalLife', r, t)
                out.append(f'{r} {t} {round((1 - (1 + i) ** -n) * (1 + i) / i, 4) if i else n:.15g}')
        out.append(';')
    return '\n'.join(out) + '\n'


def to_highs(p):
    """the GLPK problem as a HiGHS model, in full precision and with the objective constant (GLPK's own MPS writer rounds the
    numbers to ~10 digits and drops the constant part of the objective)"""
    import highspy

    inf = highspy.kHighsInf
    nr, nc = g.glp_get_num_rows(p), g.glp_get_num_cols(p)

    def bounds(t, lb, ub):
        return {g.GLP_FR: (-inf, inf), g.GLP_LO: (lb, inf), g.GLP_UP: (-inf, ub), g.GLP_DB: (lb, ub), g.GLP_FX: (lb, lb)}[t]

    keep = [i for i in range(1, nr + 1) if g.glp_get_row_type(p, i) != g.GLP_FR]  # free rows (the objective row) constrain nothing
    newi = {i: k for k, i in enumerate(keep)}
    lp = highspy.HighsLp()
    lp.num_col_ = nc
    lp.num_row_ = len(keep)
    lp.sense_ = highspy.ObjSense.kMaximize if g.glp_get_obj_dir(p) == g.GLP_MAX else highspy.ObjSense.kMinimize
    lp.offset_ = g.glp_get_obj_coef(p, 0)
    cc, cl, cu, names, integ = [], [], [], [], []
    for j in range(1, nc + 1):
        cc.append(g.glp_get_obj_coef(p, j))
        lo, up = bounds(g.glp_get_col_type(p, j), g.glp_get_col_lb(p, j), g.glp_get_col_ub(p, j))
        cl.append(lo)
        cu.append(up)
        names.append(g.glp_get_col_name(p, j))
        integ.append(g.glp_get_col_kind(p, j) != g.GLP_CV)
    rl, ru, rn = [], [], []
    for i in keep:
        lo, up = bounds(g.glp_get_row_type(p, i), g.glp_get_row_lb(p, i), g.glp_get_row_ub(p, i))
        rl.append(lo)
        ru.append(up)
        rn.append(g.glp_get_row_name(p, i))
    ind = g.intArray(nr + 1)
    val = g.doubleArray(nr + 1)
    start, index, value = [0], [], []
    for j in range(1, nc + 1):
        n = g.glp_get_mat_col(p, j, ind, val)
        for k in range(1, n + 1):
            i = ind[k]
            if i in newi:
                index.append(newi[i])
                value.append(val[k])
        start.append(len(index))
    lp.col_cost_ = cc
    lp.col_lower_ = cl
    lp.col_upper_ = cu
    lp.row_lower_ = rl
    lp.row_upper_ = ru
    lp.a_matrix_.format_ = highspy.MatrixFormat.kColwise
    lp.a_matrix_.start_ = start
    lp.a_matrix_.index_ = index
    lp.a_matrix_.value_ = value
    lp.a_matrix_.num_col_ = nc
    lp.a_matrix_.num_row_ = len(keep)
    lp.col_names_ = names
    lp.row_names_ = rn
    if any(integ):
        lp.integrality_ = [highspy.HighsVarType.kInteger if x else highspy.HighsVarType.kContinuous for x in integ]
    return lp


def write_mps(p, path):
    """MPS file for the external solvers; also <path>.const = the constant part of the objective"""
    const = g.glp_get_obj_coef(p, 0)
    try:
        import highspy

        h = highspy.Highs()
        h.setOptionValue('output_flag', False)
        h.passModel(to_highs(p))
        h.writeModel(path)
        how = 'HiGHS writer, full precision'
    except ImportError:
        g.glp_write_mps(p, g.GLP_MPS_FILE, None, path)
        how = 'GLPK writer'
    open(path + '.const', 'w').write(repr(const))
    return how, const


def main():
    model, data = sys.argv[1], sys.argv[2]
    mtxt = open(model, encoding='utf-8', errors='ignore').read()
    dtxt = open(data, encoding='utf-8', errors='ignore').read()
    for p_ in ('InputActivityRatio', 'OutputActivityRatio', 'EmissionActivityRatio'):  # ratios by time slice (vintage model 5.3)
        m_ = re.search(r'^\s*param\s+' + p_ + r'\s*\{([^}]*)\}', re.sub(r'#[^\n]*', '', mtxt), re.M)
        if m_:
            DIMS[p_] = len(m_.group(1).split(':')[0].split(','))
    sets, recs = parse(dtxt)
    body = re.sub(r'^\s*set\s+(MODEper|MODEx|INPUTx)[^;]*;\s*$', '', dtxt, flags=re.M)
    body = re.sub(r'^\s*end;\s*$', '', body, flags=re.M)
    tmp = tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False)
    tmp.write(body + derived(mtxt, sets, recs) + '\nend;\n')
    tmp.close()
    g.glp_term_out(g.GLP_OFF)
    tr = g.glp_mpl_alloc_wksp()
    if g.glp_mpl_read_model(tr, model, 1) or g.glp_mpl_read_data(tr, tmp.name) or g.glp_mpl_generate(tr, None):
        g.glp_term_out(g.GLP_ON)
        tr2 = g.glp_mpl_alloc_wksp()
        g.glp_mpl_read_model(tr2, model, 1) == 0 and g.glp_mpl_read_data(tr2, tmp.name) == 0 and g.glp_mpl_generate(tr2, None)
        print('STATUS MATHPROG_ERROR (model or data rejected by GLPK, see the messages above)')
        sys.exit(2)
    p = g.glp_create_prob()
    g.glp_mpl_build_prob(tr, p)
    nr, nc = g.glp_get_num_rows(p), g.glp_get_num_cols(p)
    opt = lambda k, d=None: next((a.split('=', 1)[1] for a in sys.argv if a.startswith(k + '=')), d)
    if opt('--write-mps'):  # used by the server: write the problem for an external solver
        how, const = write_mps(p, opt('--write-mps'))
        print(f'STATUS GENERATED  rows {nr}  columns {nc}  integer {g.glp_get_num_int(p)}  objective constant {const:.6f}  ({how})')
        os.unlink(tmp.name)
        return
    if opt('--glpk-solve'):  # used by the server: solve with GLPK and write "name value" lines
        tm = opt('--tmlim')
        meth = opt('--method', 'simplex')
        g.glp_term_out(g.GLP_ON)
        st = {
            g.GLP_OPT: 'OPTIMAL',
            g.GLP_FEAS: 'FEASIBLE',
            g.GLP_INFEAS: 'INFEASIBLE',
            g.GLP_NOFEAS: 'INFEASIBLE',
            g.GLP_UNBND: 'UNBOUNDED',
            g.GLP_UNDEF: 'UNDEFINED',
        }
        if meth == 'interior':
            ip = g.glp_iptcp()
            g.glp_init_iptcp(ip)
            rc = g.glp_interior(p, ip)
            status = st.get(g.glp_ipt_status(p), 'UNKNOWN')
            val = g.glp_ipt_col_prim
            obj = g.glp_ipt_obj_val(p)
        else:
            sm = g.glp_smcp()
            g.glp_init_smcp(sm)
            sm.presolve = g.GLP_ON
            if tm:
                sm.tm_lim = int(float(tm) * 1000)
            rc = g.glp_simplex(p, sm)
            status = (
                st.get(g.glp_get_status(p), 'UNKNOWN')
                if rc == 0
                else ('INFEASIBLE (presolve)' if rc == g.GLP_ENOPFS else f'SOLVER_RC_{rc}')
            )
            val = g.glp_get_col_prim
            obj = g.glp_get_obj_val(p)
            if g.glp_get_num_int(p) and status in ('OPTIMAL', 'FEASIBLE'):
                io = g.glp_iocp()
                g.glp_init_iocp(io)
                if tm:
                    io.tm_lim = int(float(tm) * 1000)
                g.glp_intopt(p, io)
                status = st.get(g.glp_mip_status(p), 'UNKNOWN')
                val = g.glp_mip_col_val
                obj = g.glp_mip_obj_val(p)
        with open(opt('--glpk-solve'), 'w') as f:
            f.write(f'#status {status}\n#objective {obj!r}\n#constant {g.glp_get_obj_coef(p, 0)!r}\n')
            for j in range(1, nc + 1):
                v = val(p, j)
                if abs(v) > 1e-12:
                    f.write(f'{g.glp_get_col_name(p, j)} {v!r}\n')
        if status in ('OPTIMAL', 'FEASIBLE') and not g.glp_get_num_int(p):  # shadow prices of the rows
            dual = g.glp_ipt_row_dual if meth == 'interior' else g.glp_get_row_dual
            with open(opt('--glpk-solve') + '.duals', 'w') as f:
                for i in range(1, nr + 1):
                    if g.glp_get_row_type(p, i) == g.GLP_FR:
                        continue
                    d = dual(p, i)
                    if abs(d) > 1e-12:
                        f.write(f'{g.glp_get_row_name(p, i)} {d!r}\n')
        print(f'STATUS {status}  objective {obj:.6f}  rows {nr}  columns {nc}  (GLPK {meth})')
        os.unlink(tmp.name)
        return
    try:
        import highspy  # faster: HiGHS on the MPS written by GLPK

        h = highspy.Highs()
        h.setOptionValue('output_flag', False)
        h.passModel(to_highs(p))
        h.run()
        status = h.modelStatusToString(h.getModelStatus()).upper()
        obj = h.getInfo().objective_function_value
        solver = 'HiGHS'
        show = [a.split('=', 1)[1] for a in sys.argv if a.startswith('--show=')]
        if show and status == 'OPTIMAL':
            sol, lp = h.getSolution().col_value, h.getLp()
            for j, nm in enumerate(lp.col_names_):
                if any(re.search(rx, nm) for rx in show) and abs(sol[j]) > 1e-9:
                    print(f'  {nm} = {sol[j]:.6g}')
    except ImportError:
        parm = g.glp_smcp()
        g.glp_init_smcp(parm)
        parm.presolve = g.GLP_ON
        parm.msg_lev = g.GLP_MSG_OFF
        rc = g.glp_simplex(p, parm)
        st = {
            g.GLP_OPT: 'OPTIMAL',
            g.GLP_FEAS: 'FEASIBLE',
            g.GLP_INFEAS: 'INFEASIBLE',
            g.GLP_NOFEAS: 'INFEASIBLE',
            g.GLP_UNBND: 'UNBOUNDED',
            g.GLP_UNDEF: 'UNDEFINED',
        }
        status = (
            st.get(g.glp_get_status(p), 'UNKNOWN') if rc == 0 else ('INFEASIBLE (presolve)' if rc == g.GLP_ENOPFS else f'SOLVER_RC_{rc}')
        )
        obj = g.glp_get_obj_val(p)
        solver = 'GLPK simplex'
    print(f'STATUS {status}  objective {obj:.6f}  rows {nr}  columns {nc}  ({solver})')
    if '--keep' in sys.argv:
        print('processed data:', tmp.name)
    else:
        os.unlink(tmp.name)


if __name__ == '__main__':
    main()
