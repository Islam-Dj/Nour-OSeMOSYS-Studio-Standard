"""Start the Studio server:  python run_studio.py [--port 8775] [--runs FOLDER] [--cases FOLDER] [--no-browser]
Then open http://127.0.0.1:8775 (opened for you unless --no-browser). Only listens on 127.0.0.1 (this computer).
Needs Python 3.10+, pip install swiglpk (and highspy for HiGHS; numpy, scipy for Monte Carlo; pandas 2, openpyxl for MUIO export)."""

import http.server, threading, webbrowser
from . import config


class Server(http.server.ThreadingHTTPServer):
    # the page loads about 50 files at once, from one or more windows: the default queue of 5 waiting connections was
    # too short (on Windows a full queue refuses the connection, and the file is missing from the page)
    request_queue_size = 128


def make_server(port=None):
    from .web import Handler

    return Server(('127.0.0.1', port or config.PORT), Handler)


def main(argv=None):
    config.setup(argv)
    from .solvers import detect
    from . import cases

    try:
        n = cases.migrate()
        if n:
            print(f'  {n} case(s) moved into the folder of their model (cases/<model>/<case>)', flush=True)
    except Exception as e:
        print('  could not group the cases by model:', e, flush=True)
    srv = make_server()
    url = f'http://127.0.0.1:{config.PORT}/'
    print(
        f'Nour OSeMOSYS Studio - server\n  open {url}\n  runs are kept in {config.RUNS}\n  cases in {config.CASES}\n  solvers found: '
        + ', '.join(s['name'] for s in detect()['solvers'])
        + '\n  close this window to stop the server',
        flush=True,
    )
    if not config.NO_BROWSER:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    srv.serve_forever()
