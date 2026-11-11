import os

"""Small helpers shared by the server modules."""
import json, os, subprocess, sys, time
from . import config

NOWIN = {'creationflags': 0x08000000} if os.name == 'nt' else {}  # no console window for the solver processes on Windows


def tool(name):
    """command that runs one engine step (solve_check, muio_bridge, highs_run, mc) with this Python or inside the app"""
    return [sys.executable, '--tool', name] if config.FROZEN else [sys.executable, os.path.join(config.ENGINE, name + '.py')]


def read_json(path, default=None):
    return json.load(open(path, encoding='utf-8')) if os.path.isfile(path) else ({} if default is None else default)


# a run whose status file cannot be read (left empty when the run was interrupted) stays in the lists, marked, instead of
# making the whole list fail
UNREADABLE = {'state': 'failed', 'stage': 'interrupted: its status file could not be read'}


def read_run_json(path, bad=None):
    """status.json / meta.json of a run: {} if missing; `bad` (or {}) if it cannot be read after a few tries (the file
    may be being replaced at that moment)"""
    if not os.path.isfile(path):
        return {}
    for _ in range(3):
        try:
            return json.load(open(path))
        except (ValueError, OSError):
            time.sleep(0.05)
    return dict(bad or {})


def settings(**kw):
    s = json.load(open(config.SETTINGS)) if os.path.isfile(config.SETTINGS) else {}
    if kw:
        s.update(kw)
        json.dump(s, open(config.SETTINGS, 'w'), indent=1)
    return s


def reveal(path):
    """show a folder in the file manager of this computer"""
    if not os.path.isdir(path):
        return {'ok': False, 'error': 'folder not found'}
    try:
        if os.name == 'nt':
            os.startfile(path)
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', path])
        else:
            subprocess.Popen(['xdg-open', path])
        return {'ok': True, 'path': path}
    except Exception as e:
        return {'ok': False, 'error': str(e), 'path': path}


# Windows limits a path to 260 characters unless it is written in the long form \\?\C:\... A deep work folder, a long
# case name and a long variable name went past it ("No such file or directory" on results\TotalAnnualTechnologyActivityByMode.csv).
def longp(p):
    """the path in Windows' long form (no 260-character limit); unchanged elsewhere"""
    if os.name != 'nt' or not p or str(p).startswith('\\\\?\\'):
        return p
    a = os.path.abspath(p)
    return '\\\\?\\UNC\\' + a[2:] if a.startswith('\\\\') else '\\\\?\\' + a


def shortp(p):
    """the ordinary form of a path (for a working folder and for other programs)"""
    if os.name != 'nt' or not p:
        return p
    p = str(p)
    return '\\\\' + p[8:] if p.startswith('\\\\?\\UNC\\') else p[4:] if p.startswith('\\\\?\\') else p
