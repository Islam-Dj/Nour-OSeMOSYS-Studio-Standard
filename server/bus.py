"""Messages between the Studio windows (linked windows: case, region, year, selection).

Every window posts what it changes (POST /api/bus) and waits for the others' messages (GET /api/bus?since=N, answered
as soon as there is something new, or after 20 s). Works for app windows and browser windows alike, on one computer."""

import threading, time

_cond = threading.Condition()
_msgs = []
_seq = 0
KEEP = 200


def post(msg):
    global _seq
    with _cond:
        _seq += 1
        _msgs.append((_seq, time.time(), msg))
        del _msgs[:-KEEP]
        _cond.notify_all()
        return {'ok': True, 'seq': _seq}


def get(since, wait=20.0):
    end = time.time() + wait
    with _cond:
        while True:
            new = [{'seq': s, **m} for s, t, m in _msgs if s > since]
            if new or since > _seq:
                return {'seq': _seq, 'msgs': new}
            left = end - time.time()
            if left <= 0:
                return {'seq': _seq, 'msgs': []}
            _cond.wait(left)
