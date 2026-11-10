"""Build the desktop app.  python build_app.py [--data <data.txt shown the first time>] [--name NAME] [--no-installer]
1. stage/: web/ (the page, with the example data or the data file given), solvers/ (CBC from PuLP, if installed)
2. PyInstaller -> dist/Nour_OSeMOSYS_Studio/  (Nour_OSeMOSYS_Studio.exe + its files: web/, engine/; copy the folder anywhere and run)
3. Windows + Inno Setup installed: installer/Nour_OSeMOSYS_Studio_Setup_<version>.exe
"""

import os, sys, shutil, subprocess, argparse, glob, zipfile, json, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STAGE = os.path.join(HERE, 'stage')
sys.path.insert(0, HERE)
from nour_studio import VERSION

ap = argparse.ArgumentParser()
ap.add_argument('--data')
ap.add_argument('--name')
ap.add_argument('--no-installer', action='store_true')
a = ap.parse_args()

shutil.rmtree(STAGE, ignore_errors=True)
os.makedirs(os.path.join(STAGE, 'solvers'))
shutil.copytree(os.path.join(ROOT, 'web'), os.path.join(STAGE, 'web'))  # the page, its files, chart libraries (offline)
if a.data:  # another example shown the first time
    shutil.copy(a.data, os.path.join(STAGE, 'web', 'data', 'example.txt'))
    t = open(a.data, encoding='utf-8').read()
    json.dump(
        {
            'name': a.name or os.path.splitext(os.path.basename(a.data))[0],
            'version': 'app ' + VERSION,
            'md5': hashlib.md5(t.encode()).hexdigest()[:8],
            'note': 'embedded',
        },
        open(os.path.join(STAGE, 'web', 'data', 'example_meta.json'), 'w'),
    )
for d in glob.glob(os.path.join(ROOT, 'engine', '**', '__pycache__'), recursive=True):
    shutil.rmtree(d, ignore_errors=True)
# CBC: the executable shipped with PuLP (pip install pulp), if present
try:
    import pulp

    cbc = pulp.apis.PULP_CBC_CMD().path
    if cbc and os.path.isfile(cbc):
        shutil.copy(cbc, os.path.join(STAGE, 'solvers', 'cbc' + ('.exe' if os.name == 'nt' else '')))
        print('CBC bundled:', cbc)
except Exception as e:
    print('CBC not bundled (pip install pulp to include it):', e)
subprocess.check_call(
    [
        sys.executable,
        '-m',
        'PyInstaller',
        '--noconfirm',
        '--clean',  # no cache: a changed icon or file always reaches the program
        '--distpath',
        os.path.join(HERE, 'dist'),
        '--workpath',
        os.path.join(HERE, 'build'),
        os.path.join(HERE, 'nour_studio.spec'),
    ]
)
out = os.path.join(HERE, 'dist', 'Nour_OSeMOSYS_Studio')
shutil.copytree(os.path.join(STAGE, 'solvers'), os.path.join(out, 'solvers'), dirs_exist_ok=True)
for p in (os.path.join(HERE, 'README_APP.txt'), os.path.join(ROOT, 'engine', 'muio_api', 'LICENSE_MUIO_Apache-2.0.txt')):
    if os.path.isfile(p):
        shutil.copy(p, out)
print('app folder:', out)
if os.name == 'nt' and not a.no_installer:
    iscc = shutil.which('iscc') or next(iter(glob.glob(r'C:\Program Files*\Inno Setup *\ISCC.exe')), None)
    if iscc:
        subprocess.check_call([iscc, f'/DMyVersion={VERSION}', os.path.join(HERE, 'installer.iss')])
        print('installer in', os.path.join(HERE, 'installer'))
    else:
        print('Inno Setup not found: no installer (the app folder works as it is; https://jrsoftware.org/isinfo.php)')
zp = os.path.join(HERE, 'dist', f'Nour_OSeMOSYS_Studio_{VERSION}_{"windows" if os.name == "nt" else sys.platform}.zip')
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    for r, _, fs in os.walk(out):
        for f in fs:
            z.write(os.path.join(r, f), os.path.relpath(os.path.join(r, f), os.path.dirname(out)))
print('portable zip:', zp)
