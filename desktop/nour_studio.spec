# PyInstaller spec of Nour OSeMOSYS Studio (one folder).  Build with build_app.py (or: pyinstaller --noconfirm nour_studio.spec)
# Takes from the Studio folder: web/ (staged by build_app.py in stage/web, with the example data), engine/, server/ (imported)
import os, sys
from PyInstaller.utils.hooks import collect_all, collect_submodules

HERE = os.path.abspath(SPECPATH); ROOT = os.path.dirname(HERE); STAGE = os.path.join(HERE, 'stage')
WEB = os.path.join(STAGE, 'web') if os.path.isdir(os.path.join(STAGE, 'web')) else os.path.join(ROOT, 'web')
datas = [(WEB, 'web'), (os.path.join(ROOT, 'engine'), 'engine')]
binaries, hidden = [], []
# the engine steps run inside the app with runpy, so PyInstaller cannot see what they import: list it
for pkg in ('highspy', 'swiglpk', 'openpyxl', 'webview', 'clr_loader', 'pythonnet', 'bottle', 'proxy_tools'):   # pythonnet / clr_loader: the Edge WebView2 window on Windows
    try:
        d, b, h = collect_all(pkg); datas += d; binaries += b; hidden += h
    except Exception as e: print('skip', pkg, e)
notest = lambda n: '.tests' not in n and '.testing' not in n and 'conftest' not in n
hidden += collect_submodules('pandas', filter=notest) + collect_submodules('numpy', filter=notest) + collect_submodules('werkzeug', filter=notest) + collect_submodules('scipy', filter=notest)
hidden += ['clr', 'http.server', 'csv', 'uuid', 'glob', 'tempfile', 'gzip', 'xml.etree.ElementTree', 'json', 'argparse', 'runpy', 'mimetypes',
           'server', 'server.app', 'server.config', 'server.util', 'server.cases', 'server.solvers', 'server.muio', 'server.montecarlo', 'server.rdm', 'server.backup', 'server.web', 'server.bus', 'server.models',
           'mc', 'mc_dist', 'mc_links', 'rdm', 'rdm_export', 'derived', 'muio_bridge']   # engine modules the server imports
ico = os.path.join(HERE, 'icon.ico'); ico = ico if os.path.isfile(ico) else None

a = Analysis([os.path.join(HERE, 'nour_studio.py')], pathex=[ROOT, os.path.join(ROOT, 'engine')], binaries=binaries, datas=datas, hiddenimports=hidden,
             excludes=['tkinter', 'matplotlib', 'IPython', 'boto3', 'pytest', 'pandas.tests', 'numpy.tests', 'numpy.f2py.tests', 'scipy.tests'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='Nour_OSeMOSYS_Studio', console=False, icon=ico, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='Nour_OSeMOSYS_Studio')
