"""Nour OSeMOSYS Studio - desktop application.

Starts the Studio server on this computer (127.0.0.1, a free port) and shows the Studio in its own window
(pywebview: Edge WebView2 on Windows). Closing the window stops everything.

Your work is kept in   <Documents>/Nour OSeMOSYS Studio/
    cases/<case>/        one folder per model: data.txt, model.txt, case.json (names, colours, charts), runs/<run>/
    runs/                runs made without a case
    settings.json        MUIO folder and other settings
(change the place with the environment variable NOUR_STUDIO_HOME)

Command line:
    Nour_OSeMOSYS_Studio [--browser] [--port N] [--home FOLDER]
        --browser   open in the web browser instead of the app window
    Nour_OSeMOSYS_Studio --tool solve_check|muio_bridge|highs_run <args>   (used by the server for the solver steps)
"""

import os, sys, socket, threading, time, runpy, base64, argparse, json, urllib.request, urllib.error

APP = 'Nour OSeMOSYS Studio'
VERSION = '0.22.1'
FROZEN = getattr(sys, 'frozen', False)
BASE = getattr(sys, '_MEIPASS', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # Studio files: web/, engine/, server/
ENGINE = os.path.join(BASE, 'engine')  # the solver steps
EXE_DIR = os.path.dirname(sys.executable) if FROZEN else BASE  # next to the program: solvers/
if BASE not in sys.path:
    sys.path.insert(0, BASE)


def run_tool(name, args):
    """run engine/<name>.py as a script (the server starts the solver steps this way inside the app)"""
    path = os.path.join(ENGINE, name + '.py')
    if not os.path.isfile(path):
        sys.exit(f'unknown tool {name}')
    sys.path.insert(0, ENGINE)
    sys.argv = [path] + args
    for fd, nm in ((1, 'stdout'), (2, 'stderr')):  # windowed app: Python has no stdout, but the handles given by
        if getattr(sys, nm) is None:  # the server (log file / pipe) are there: use them
            try:
                setattr(sys, nm, os.fdopen(fd, 'w', buffering=1, encoding='utf-8', errors='replace'))
            except OSError:
                setattr(sys, nm, open(os.devnull, 'w'))
    runpy.run_path(path, run_name='__main__')


def documents():
    if os.name == 'nt':
        try:
            import ctypes, ctypes.wintypes

            buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:
                return buf.value  # CSIDL_PERSONAL (works with OneDrive)
        except Exception:
            pass
    d = os.path.join(os.path.expanduser('~'), 'Documents')
    return d if os.path.isdir(d) else os.path.expanduser('~')


def free_port(start):
    for p in range(start, start + 50):
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1', p))
                return p
            except OSError:
                continue
    raise RuntimeError('no free port')


def start_server(port, home):
    from server import config, app

    os.environ['NOUR_STUDIO_APP'] = '1'
    config.setup(
        [
            '--port',
            str(port),
            '--no-browser',
            '--runs',
            os.path.join(home, 'runs'),
            '--cases',
            os.path.join(home, 'cases'),
            '--settings',
            os.path.join(home, 'settings.json'),
            '--solvers',
            os.path.join(EXE_DIR, 'solvers'),
        ]
    )
    srv = app.make_server()
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{port}/'
    for _ in range(100):  # wait until it answers
        try:
            urllib.request.urlopen(url + 'api/solvers', timeout=1)
            return url
        except Exception:
            time.sleep(0.1)
    raise RuntimeError('the Studio server did not start')


class Api:
    """functions the page can call in the app window (window.pywebview.api)"""

    def __init__(self):
        self._window = None  # private: pywebview exposes public attributes to the page

    def save_file(self, name, b64):
        import webview

        r = self._window.create_file_dialog(webview.SAVE_DIALOG, directory=documents(), save_filename=name)
        if not r:
            return None
        path = r if isinstance(r, str) else r[0]
        with open(path, 'wb') as f:
            f.write(base64.b64decode(b64))
        return path

    # large files never go through the page in one
    # piece. save_url: the app downloads a file of its own server (a case backup) straight into the file chosen in the dialog.
    def save_url(self, url, name=''):
        import webview, shutil

        if not str(url).startswith('http://127.0.0.1:'):
            return {'error': 'only the Studio server'}
        try:
            resp = urllib.request.urlopen(url, timeout=7200)
        except urllib.error.HTTPError as e:
            try:
                return {'error': json.loads(e.read().decode('utf-8', 'replace')).get('error') or str(e)}
            except Exception:
                return {'error': str(e)}
        fn = resp.headers.get('X-File-Name') or name or 'download'
        r = self._window.create_file_dialog(webview.SAVE_DIALOG, directory=documents(), save_filename=fn)
        if not r:
            resp.close()
            return None
        path = r if isinstance(r, str) else r[0]
        with open(path, 'wb') as f:
            shutil.copyfileobj(resp, f, 1 << 20)
        return {'path': path, 'bytes': os.path.getsize(path)}

    # save_begin / save_chunk / save_end: a large file made in the page (Excel, images, Monte Carlo exports) sent in pieces
    def save_begin(self, name):
        import webview

        r = self._window.create_file_dialog(webview.SAVE_DIALOG, directory=documents(), save_filename=name)
        if not r:
            return None
        path = r if isinstance(r, str) else r[0]
        open(path, 'wb').close()
        self._parts = getattr(self, '_parts', {})
        tok = str(len(self._parts) + 1)
        self._parts[tok] = path
        return tok

    def save_chunk(self, tok, b64):
        with open(self._parts[tok], 'ab') as f:
            f.write(base64.b64decode(b64))
        return True

    def save_end(self, tok):
        return self._parts.pop(tok, None)

    def version(self):
        return VERSION

    def open_browser(self, url):
        """a Studio window in the web browser (linked through the server like an app window)"""
        if not str(url).startswith('http://127.0.0.1:'):
            return None
        import webbrowser

        webbrowser.open(url)
        return True

    def new_window(self, url, title=''):
        """another Studio window (second screen): same server, its own window; linked windows talk through the page"""
        import webview

        if not str(url).startswith('http://127.0.0.1:'):
            return None  # only the Studio's own pages

        def make():  # pywebview creates windows after start only from a thread other than the GUI thread
            api = Api()
            api._window = webview.create_window(
                f'{APP} · {title}' if title else APP, url, js_api=api, width=1400, height=900, min_size=(900, 600), text_select=True
            )

        threading.Thread(target=make, daemon=True).start()
        return True


def main():
    if len(sys.argv) > 2 and sys.argv[1] == '--tool':
        return run_tool(sys.argv[2], sys.argv[3:])
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--browser', action='store_true')
    ap.add_argument('--port', type=int, default=8775)
    ap.add_argument('--home')
    ap.add_argument('--serve-only', action='store_true', help='start the server and wait (tests)')
    a = ap.parse_args()
    home = a.home or os.environ.get('NOUR_STUDIO_HOME') or os.path.join(documents(), APP)
    for sub in ('cases', 'runs'):
        os.makedirs(os.path.join(home, sub), exist_ok=True)
    url = start_server(free_port(a.port), home)
    print(f'{APP} {VERSION}\n  {url}\n  your cases: {os.path.join(home, "cases")}', flush=True)
    if a.serve_only:
        while True:
            time.sleep(3600)
    if not a.browser:
        try:
            import webview

            api = Api()
            api._window = webview.create_window(APP, url, js_api=api, width=1500, height=950, min_size=(1000, 650), text_select=True)
            webview.settings['ALLOW_DOWNLOADS'] = True
            if os.environ.get('NOUR_STUDIO_SELFTEST'):  # build check: page loaded, app functions reachable, then close

                def selftest():
                    time.sleep(6)
                    r = api._window.evaluate_js(
                        "JSON.stringify({srv: LIB.srv, api: !!(window.pywebview && window.pywebview.api && window.pywebview.api.save_file), title: document.title, techs: (typeof G !== 'undefined' && G) ? G.T.length : -1})"
                    )
                    r2 = api._window.evaluate_js(
                        "JSON.stringify({new_window: !!window.pywebview.api.new_window, open_browser: !!window.pywebview.api.open_browser, bus: WIN.ch === null})"
                    )
                    open(os.environ['NOUR_STUDIO_SELFTEST'], 'w').write(f'{r} {r2}')
                    for w in list(webview.windows):
                        w.destroy()

                threading.Thread(target=selftest, daemon=True).start()
            webview.start(private_mode=False, storage_path=os.path.join(home, '.webview'))
            return
        except Exception as e:  # no WebView2 / GUI toolkit: use the browser
            print('app window not available (' + str(e) + '): opening the browser', flush=True)
    import webbrowser

    webbrowser.open(url)
    print('close this window to stop the Studio', flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
