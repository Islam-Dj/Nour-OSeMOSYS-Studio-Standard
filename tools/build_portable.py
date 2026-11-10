"""Make the single-file Studio page (opens by double click, no server needed to look at a model):

    python tools/build_portable.py [--data <data.txt>] [--name NAME] [--version V] [--out Nour_OSeMOSYS_Studio.html]

Puts web/index.html, its style sheets (fonts as data), its scripts (in the same order) and the texts it reads
(the built-in MUIO model file and the example data, or the data file given) into one HTML file.
"""

import argparse, base64, hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')


def read(*p):
    return open(os.path.join(WEB, *p), encoding='utf-8').read()


def css_inline(rel):
    """a style sheet with its url(...) files put in as data"""
    css = read(rel)
    base = os.path.dirname(os.path.join(WEB, rel))

    def data(m):
        f = os.path.normpath(os.path.join(base, m.group(1)))
        if not os.path.isfile(f):
            return m.group(0)
        mime = {'.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png'}.get(
            os.path.splitext(f)[1], 'application/octet-stream'
        )
        return f'url(data:{mime};base64,{base64.b64encode(open(f, "rb").read()).decode()})'

    return re.sub(r'url\(\s*["\']?(?!data:)([^"\')]+)["\']?\s*\)', data, css)


def safe(text, what):
    if re.search(r'</script', text, re.I):
        raise SystemExit(f'{what} contains "</script": cannot be put in the page')
    return text


def build(data=None, name=None, version=None, out=None):
    html = read('index.html')
    ex = json.loads(read('data', 'examples', 'examples.json'))
    for x in ex:
        x['text'] = read('data', 'examples', x['file'])
    if data:  # another model shown first
        dtext = open(data, encoding='utf-8').read()
        ex.insert(
            0,
            {
                'id': 'X',
                'file': os.path.basename(data),
                'name': name or os.path.splitext(os.path.basename(data))[0],
                'description': 'embedded data file',
                'check': [],
                'text': dtext,
            },
        )
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', lambda m: f'<style>\n{css_inline(m.group(1))}\n</style>', html)
    pages = read('data', 'docs', 'param_pages.json') if os.path.isfile(os.path.join(WEB, 'data', 'docs', 'param_pages.json')) else '{}'
    texts = (
        f'<script type="application/json" id="param-pages">{safe(pages, "the pages of the reference")}</script>\n'
        f'<script type="text/plain" id="muio-model">{safe(read("data", "builtin_model.txt"), "the model file")}</script>\n'
        f'<script type="application/json" id="examples-data">{safe(json.dumps(ex), "the examples")}</script>\n'
    )
    first = True

    def js(m):
        nonlocal first
        s = (
            '<!-- texts read by the page (in the server version they are files in web/data) -->\n' + texts if first else ''
        ) + f'<script>\n{safe(read(m.group(1)), m.group(1))}\n</script>'
        first = False
        return s

    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    out = out or os.path.join(ROOT, 'Nour_OSeMOSYS_Studio.html')
    open(out, 'w', encoding='utf-8', newline='\n').write(html)
    print(out, round(len(html) / 1e6, 2), 'MB')
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data')
    ap.add_argument('--name')
    ap.add_argument('--version')
    ap.add_argument('--out')
    a = ap.parse_args()
    build(a.data, a.name, a.version, a.out)
