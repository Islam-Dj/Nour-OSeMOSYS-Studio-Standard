"""Solve an MPS file with HiGHS (highspy) and write the Studio solution file.  python highs_run.py problem.mps solution.txt '{"option": value}'

when the interior point without crossover stops with status Unknown ("no progress", badly scaled model: on the
a CLEWs model with coefficients from 3e-7 to 3e+5), the step no longer gives up: it solves again AT ONCE, in the same
process (the model is already read), with the dual simplex, which needs no crossover. On that model: interior point
~300 s then Unknown, interior point + crossover ~300 s, dual simplex ~50 s, same optimum. The old way (the Studio started the
whole solve again from scratch with crossover on) cost the full interior-point time twice.
If the simplex also fails, the interior-point point is kept only when it is near-optimal (primal-dual objective error and
relative primal infeasibility below 1e-4) and marked NEAR-OPTIMAL; otherwise the status stays Unknown (not a solution)."""

import highspy, json, sys, time

mps, sol, opts = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
h = highspy.Highs()
for k, v in opts.items():
    h.setOptionValue(k, v)
kobj = None
h.readModel(mps)
t0 = time.time()
h.run()
st = h.modelStatusToString(h.getModelStatus()).upper()
info = h.getInfo()
# HiPO (the parallel interior point of HiGHS 1.15, solver = hipo; needs the package highspy-extras) reported the a national model
# model (feasible, coefficients 2e-7 ... 1e5) INFEASIBLE after 5 iterations: an infeasibility from HiPO is checked at once
# with the dual simplex before it is believed
# (HiGHS 1.15: solver = ipm also means HiPO when highspy-extras is installed, so the check covers ipm too)
if opts.get('solver') in ('hipo', 'ipm') and st in ('INFEASIBLE', 'UNBOUNDED OR INFEASIBLE'):
    print(
        f"HiGHS: the interior point ({opts.get('solver')}) ended {st} after {time.time() - t0:.0f} s; checking with the dual simplex (HiPO can stop wrongly on badly scaled models)...",
        flush=True,
    )
    h.clearSolver()
    h.setOptionValue('solver', 'simplex')
    h.run()
    st = h.modelStatusToString(h.getModelStatus()).upper()
    info = h.getInfo()
    print(f"HiGHS: dual simplex {st}.", flush=True)
ipm_nox = opts.get('solver', 'choose') == 'ipm' and str(opts.get('run_crossover', 'on')) != 'on'
if st == 'UNKNOWN' and ipm_nox:
    keep = None
    if info.primal_solution_status == 2 and info.primal_dual_objective_error < 1e-4 and info.max_relative_primal_infeasibility < 1e-4:
        keep = (h.getSolution(), info.objective_function_value)
    print(
        f"HiGHS: the interior point stopped with status Unknown after {time.time() - t0:.0f} s (badly scaled model, "
        f"primal-dual objective error {info.primal_dual_objective_error:.1e}). Solving again with the dual simplex "
        f"(model already read, no crossover needed)...",
        flush=True,
    )
    h.clearSolver()
    h.setOptionValue('solver', 'simplex')
    h.setOptionValue('run_crossover', 'on')
    h.run()
    st = h.modelStatusToString(h.getModelStatus()).upper()
    info = h.getInfo()
    if st == 'OPTIMAL':
        print("HiGHS: dual simplex optimal.", flush=True)
    elif keep is not None:
        print("HiGHS: the dual simplex did not finish; keeping the interior-point point (near-optimal).", flush=True)
        h.setSolution(keep[0])
        st = 'NEAR-OPTIMAL'
        kobj = keep[1]
lp = h.getLp()
S = h.getSolution()
info = h.getInfo()
obj = kobj if st == 'NEAR-OPTIMAL' else info.objective_function_value
with open(sol, 'w') as f:
    f.write(f"#status {st}\n#objective {obj!r}\n")
    if info.primal_solution_status or st == 'NEAR-OPTIMAL':
        x = S.col_value
        for j, n in enumerate(lp.col_names_):
            if abs(x[j]) > 1e-9:
                f.write(f"{n} {x[j]!r}\n")
if info.dual_solution_status:  # shadow prices (row duals): "constraint[index] value"
    y = S.row_dual
    with open(sol + '.duals', 'w') as f:
        for i, n in enumerate(lp.row_names_):
            if abs(y[i]) > 1e-12:
                f.write(f"{n} {y[i]!r}\n")
print("HiGHS status", st, "objective", obj)
