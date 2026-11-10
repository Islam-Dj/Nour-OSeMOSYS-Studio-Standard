"""Where things are: the Studio folders, the work folders (runs, cases, Monte Carlo) and the settings file.

Layout of the Studio folder (ROOT):
    web/      the page (index.html, css/, js/, fonts/, lib/, data/)
    engine/   the solver steps run as separate processes (solve_check, highs_run, derived, mc, mc_dist, muio_bridge, muio_api/)
    server/   this package
    solvers/  optional solver executables (cbc, highs)
The work folders default to ROOT/runs, ROOT/cases, ROOT/mc; the desktop app puts them in Documents.
"""

import os, sys, argparse

FROZEN = getattr(sys, 'frozen', False)  # inside the desktop app (PyInstaller): engine steps run as "<app> --tool <name>"
ROOT = getattr(sys, '_MEIPASS', None) or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
ENGINE = os.path.join(ROOT, 'engine')
if ENGINE not in sys.path:
    sys.path.insert(0, ENGINE)  # mc, mc_dist, derived are also imported by the server

# set by setup()
PORT = 8775
RUNS = CASES = MCROOT = SOLVERS = SETTINGS = PAGE = None
NO_BROWSER = False


def parser():
    ap = argparse.ArgumentParser(description='Nour OSeMOSYS Studio - local server (listens on 127.0.0.1 only)')
    ap.add_argument('--port', type=int, default=8775)
    ap.add_argument('--runs', default=None, help='folder of the runs made without a case (default <root>/runs)')
    ap.add_argument(
        '--cases', default=None, help='folder of the cases (one folder per model: data, model file, runs); default <root>/cases'
    )
    ap.add_argument('--page', default=None, help='serve this single HTML file instead of web/index.html')
    ap.add_argument('--settings', default=None)
    ap.add_argument('--solvers', default=None)
    ap.add_argument('--no-browser', action='store_true')
    return ap


def setup(argv=None):
    global PORT, RUNS, CASES, MCROOT, SOLVERS, SETTINGS, PAGE, NO_BROWSER
    a = parser().parse_args(argv)
    PORT = a.port
    NO_BROWSER = a.no_browser
    RUNS = os.path.abspath(a.runs or os.path.join(ROOT, 'runs'))
    os.makedirs(RUNS, exist_ok=True)
    CASES = os.path.abspath(a.cases or os.path.join(ROOT, 'cases'))
    os.makedirs(CASES, exist_ok=True)
    MCROOT = os.path.join(os.path.dirname(RUNS), 'mc')
    SOLVERS = os.path.abspath(a.solvers or os.path.join(ROOT, 'solvers'))
    SETTINGS = os.path.abspath(a.settings or os.path.join(ROOT, 'studio_settings.json'))
    PAGE = a.page if a.page and os.path.isfile(a.page) else None
    return a
