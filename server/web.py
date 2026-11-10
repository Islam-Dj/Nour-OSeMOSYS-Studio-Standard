"""HTTP routes: the page and its files (web/), and the API used by the page (same URLs as before the restructure)."""

import http.server, json, mimetypes, os, re, shutil
from urllib.parse import urlparse, parse_qs
from . import config, cases, solvers, muio, montecarlo, rdm, backup, bus, models

try:  # rolling horizon: in the master Studio only (the standard edition does not ship it)
    from . import rolling
except ImportError:
    rolling = None
from .util import reveal

TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
}
STATIC = re.compile(r'^/(css|js|fonts|lib|data|img)/[\w./-]+$')


def static_file(p):
    """web/<p> if it exists and is inside web/"""
    f = os.path.realpath(os.path.join(config.WEB, p.lstrip('/')))
    return f if f.startswith(os.path.realpath(config.WEB) + os.sep) and os.path.isfile(f) else None


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype='application/json'):
        b = body if isinstance(body, bytes) else (json.dumps(body) if not isinstance(body, str) else body).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(b)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # the page gave up waiting (e.g. a timed-out check) or was closed

    def do_OPTIONS(self):
        self.send(204, b'')

    def send_file(self, fp, fn, ctype, remove=False):
        """a file from disk, in 1 MB pieces (the robust-decision packages can be large)"""
        try:
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(os.path.getsize(fp)))
            self.send_header('Content-Disposition', f'attachment; filename="{fn}"')
            self.send_header('X-File-Name', fn)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            with open(fp, 'rb') as f:
                while True:
                    b = f.read(1 << 20)
                    if not b:
                        break
                    self.wfile.write(b)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            if remove:
                try:
                    os.remove(fp)
                except OSError:
                    pass

    def do_GET(self):
        p = urlparse(self.path).path.rstrip('/') or '/'
        if p in ('/', '/index.html'):
            page = config.PAGE or os.path.join(config.WEB, 'index.html')
            return (
                self.send(200, open(page, 'rb').read(), 'text/html; charset=utf-8')
                if os.path.isfile(page)
                else self.send(404, 'web/index.html not found', 'text/plain')
            )
        if STATIC.match(p):  # page files; /lib/*.js = chart libraries for offline use
            f = static_file(p)
            if not f:
                return self.send(404, 'not found', 'text/plain')
            return self.send(
                200,
                open(f, 'rb').read(),
                TYPES.get(os.path.splitext(f)[1].lower()) or mimetypes.guess_type(f)[0] or 'application/octet-stream',
            )
        if p == '/api/bus':
            q = parse_qs(urlparse(self.path).query)
            return self.send(200, bus.get(int((q.get('since') or ['0'])[0]), min(25.0, float((q.get('wait') or ['20'])[0]))))
        if p == '/api/solvers':
            return self.send(200, solvers.detect())
        if p == '/api/muio':
            return self.send(200, muio.muio_info())
        if p == '/api/runs':
            return self.send(200, solvers.run_list())
        if p == '/api/cases':
            return self.send(200, cases.case_list())
        if p == '/api/groups':
            return self.send(200, cases.groups())
        if p == '/api/folders':
            return self.send(200, cases.folders_get())
        if p == '/api/models':
            return self.send(200, models.listing())
        m = re.match(r'^/api/model/([\w.-]+)$', p)
        if m:
            try:
                r = models.get(m.group(1))
            except ValueError as e:
                return self.send(400, {'error': str(e)})
            return self.send(200, r) if r else self.send(404, {'error': 'no such model file'})
        if p == '/api/rdm':
            return self.send(200, rdm.rdm_list())
        if p == '/api/rh':
            return self.send(200, rolling.rh_list() if rolling else [])
        m = re.match(r'^/api/rh/([\w.-]+)$', p)
        if m and rolling:
            s = rolling.rh_get(m.group(1))
            return self.send(200, s) if s else self.send(404, {'error': 'no such rolling-horizon run'})
        m = re.match(r'^/api/rdm/([\w.-]+)$', p)
        if m:
            s = rdm.rdm_get(m.group(1))
            return self.send(200, s) if s else self.send(404, {'error': 'no such RDM run'})
        if p == '/api/mc/catalog':
            return self.send(200, montecarlo.catalogue())
        if p == '/api/mc':
            return self.send(200, montecarlo.mc_list())
        m = re.match(r'^/api/mc/([\w.-]+)/download$', p)
        if m:
            try:
                b, fn = montecarlo.mc_download(m.group(1), (parse_qs(urlparse(self.path).query).get('f') or [''])[0])
            except ValueError as e:
                return self.send(404, str(e), 'text/plain')
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Content-Disposition', f'attachment; filename="{fn}"')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(b)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            return
        m = re.match(r'^/api/mc/([\w.-]+)$', p)
        if m:
            s = montecarlo.mc_get(m.group(1))
            return self.send(200, s) if s else self.send(404, {'error': 'no such Monte Carlo run'})
        m = re.match(r'^/api/rdm/([\w.-]+)/package$', p)
        if m:  # the full package of a robust-decision run (every drawn value, metrics, kept results, data files if asked)
            q = parse_qs(urlparse(self.path).query)
            try:
                fp, fn = rdm.rdm_package(
                    m.group(1),
                    data=(q.get('data') or ['0'])[0] == '1',
                    strategies=(q.get('strategies') or [''])[0],
                    futures=(q.get('futures') or [''])[0],
                    raw=(q.get('raw') or ['1'])[0] != '0',
                )
            except Exception as e:
                return self.send(404, {'error': str(e)})
            return self.send_file(fp, fn, 'application/zip', remove=True)
        m = re.match(r'^/api/case/([\w.-]+)/backup$', p)
        if m:  # the whole case as one zip
            q = parse_qs(urlparse(self.path).query)
            try:
                b, fn = backup.backup(m.group(1), light=(q.get('light') or ['0'])[0] == '1', checkpoints=(q.get('cp') or ['1'])[0] != '0')
            except ValueError as e:
                return self.send(404, {'error': str(e)})
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Content-Disposition', f'attachment; filename="{fn}"')
            self.send_header('X-File-Name', fn)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(b)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            return
        m = re.match(r'^/api/case/([\w.-]+)$', p)
        if m:
            try:
                c = cases.case_get(m.group(1))
            except ValueError as e:
                return self.send(400, {'error': str(e)})
            return self.send(200, c) if c else self.send(404, {'error': 'no such case'})
        m = re.match(r'^/api/run/([\w.-]+)(?:/(\w+))?(?:/([\w.-]+))?$', p)
        if m:
            rid, what, arg = m.groups()
            d = cases.run_dir(rid)
            if not os.path.isdir(d):
                return self.send(404, {'error': 'no such run'})
            if what in (None, 'status'):
                return self.send(200, solvers.run_info(d, rid, what is None))
            if what == 'var' and arg:
                return self.send(200, solvers.run_var(d, arg))
            if what == 'file' and arg in ('data.txt', 'model.txt', 'log.txt'):
                return self.send(200, open(os.path.join(d, arg), 'rb').read(), 'text/plain; charset=utf-8')
        self.send(404, {'error': 'not found'})

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get('Content-Length') or 0)
        if u.path == '/api/case/restore':  # a case backup zip
            try:
                return self.send(200, backup.restore(self.rfile.read(n)))
            except Exception as e:
                return self.send(200, {'ok': False, 'error': str(e)})
        if u.path == '/api/muio/import':  # the zip of a MUIO case, as it is
            try:
                zb = self.rfile.read(n)
                if backup.is_backup(zb):
                    return self.send(200, dict(backup.restore(zb), studio_backup=True))  # a Studio backup given here is restored
                return self.send(200, muio.import_case(zb, (parse_qs(u.query).get('name') or [''])[0]))
            except Exception as e:
                return self.send(200, {'ok': False, 'error': str(e)})
        body = json.loads(self.rfile.read(n) or b'{}')
        if u.path == '/api/bus':
            return self.send(200, bus.post(body))
        if u.path == '/api/run':
            return self.send(200, solvers.start_run(body))
        if u.path == '/api/folders':
            try:
                return self.send(200, {'ok': cases.folders_put(body)})
            except (ValueError, OSError) as e:
                return self.send(400, {'ok': False, 'error': str(e)})
        m = re.match(r'^/api/model/([\w.-]+)(/delete)?$', u.path)
        if m:
            try:
                return self.send(200, models.delete(m.group(1)) if m.group(2) else models.put(m.group(1), body))
            except (ValueError, OSError) as e:
                return self.send(400, {'ok': False, 'error': str(e)})
        m = re.match(r'^/api/case/([\w.-]+)(/delete|/reveal)?$', u.path)
        if m:
            try:
                if m.group(2) == '/delete':
                    shutil.rmtree(cases.case_path(m.group(1)), ignore_errors=True)
                    return self.send(200, {'ok': True})
                if m.group(2) == '/reveal':
                    return self.send(200, reveal(cases.case_path(m.group(1))))
                return self.send(200, {'ok': cases.case_put(m.group(1), body)})
            except (ValueError, OSError) as e:
                return self.send(400, {'ok': False, 'error': str(e)})
        if rolling and (u.path.startswith('/api/rh/') or u.path == '/api/rh'):
            try:
                return self.send(200, rolling.rh_post(u.path, body))
            except Exception as e:
                import traceback

                return self.send(200, {'ok': False, 'error': str(e), 'trace': traceback.format_exc()[-1200:]})
        if u.path.startswith('/api/rdm'):
            try:
                return self.send(200, rdm.rdm_post(u.path, body))
            except Exception as e:
                import traceback

                return self.send(200, {'ok': False, 'error': str(e), 'trace': traceback.format_exc()[-1200:]})
        if u.path.startswith('/api/mc'):
            try:
                return self.send(200, montecarlo.mc_post(u.path, body))
            except Exception as e:
                import traceback

                return self.send(200, {'ok': False, 'error': str(e), 'trace': traceback.format_exc()[-1200:]})
        if u.path == '/api/convert':  # data of another model file -> master data
            try:
                import convert

                src = body.get('model') or convert.legacy_master_source(body['master'])  # no model file: a master case made before 0.7
                txt, rep = convert.convert(body['data'], src, body['master'])
                return self.send(200, {'ok': True, 'data': txt, 'report': rep})
            except Exception as e:
                return self.send(200, {'ok': False, 'error': f'{type(e).__name__}: {e}'})
        if u.path == '/api/muio/config':
            return self.send(200, muio.config_storage(body))
        if u.path == '/api/muio/assess':
            return self.send(200, muio.assess(body))
        if u.path == '/api/muio/export':
            return self.send(200, muio.export(body))
        m = re.match(r'^/api/run/([\w.-]+)/(stop|delete)$', u.path)
        if m:
            return self.send(200, solvers.stop_run(m.group(1), m.group(2) == 'delete'))
        self.send(404, {'error': 'not found'})
