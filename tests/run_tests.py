"""Run the checks of Nour OSeMOSYS Studio: starts the server on a free port (cases and runs in a temporary folder), then
the browser checks (needs node and Playwright: npm i playwright; npx playwright install chromium).

    python tests/run_tests.py
"""

import os, socket, subprocess, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main():
    port = free_port()
    tmp = tempfile.mkdtemp(prefix='nour_studio_tests_')
    srv = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, 'run_studio.py'), '--port', str(port), '--no-browser', '--runs', os.path.join(tmp, 'runs'), '--cases', os.path.join(tmp, 'cases')],
        cwd=ROOT,
    )
    url = f'http://127.0.0.1:{port}'
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(url + '/api/runs', timeout=2)
                break
            except Exception:
                time.sleep(0.5)
        r = subprocess.run(['node', os.path.join(HERE, 'studio_test.js'), url], cwd=ROOT)
        sys.exit(r.returncode)
    finally:
        srv.terminate()


if __name__ == '__main__':
    main()
