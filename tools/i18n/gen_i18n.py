"""Build web/js/i18n_es.js and i18n_ar.js from the translation tables tr/*.tsv (English <TAB> Spanish <TAB> Arabic; {0} = a value kept as it is).
   python tools/i18n/gen_i18n.py"""
import glob, json, re, sys
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
out = sys.argv[1] if len(sys.argv) > 1 else '../../web/js'
es, ar, bad = {}, {}, []
norm = lambda s: re.sub(r'\s+', ' ', s).strip()
ph = lambda s: sorted(re.findall(r'\{\d+\}', s))
for f in sorted(glob.glob('tr/*.tsv')):
    for ln in open(f, encoding='utf-8'):
        ln = ln.rstrip('\n')
        if not ln.strip(): continue
        p = ln.split('\t')
        if len(p) != 3: bad.append((f, ln)); continue
        k, e, a = map(norm, p)
        if not k or k in ('{0}',): continue
        if ph(k) != ph(e) or ph(k) != ph(a): bad.append((f, ln)); continue
        es[k], ar[k] = e, a
fr = {}
for f in sorted(glob.glob('fr/*.tsv')):  # French: English <TAB> French
    for ln in open(f, encoding='utf-8'):
        p = ln.rstrip('\n').split('\t')
        if len(p) != 2 or not p[0].strip(): continue
        k, v = norm(p[0]), norm(p[1])
        if ph(k) != ph(v): bad.append((f, ln)); continue
        fr[k] = v
print('French', len(fr), 'missing', [k for k in es if k not in fr][:10], len([k for k in es if k not in fr]))
NAMES = {'es': 'Spanish', 'ar': 'Arabic', 'fr': 'French'}
for lang, d in (('es', es), ('ar', ar), ('fr', fr)):
    with open(f'{out}/i18n_{lang}.js', 'w', encoding='utf-8') as w:
        w.write(f'/* the Studio in {NAMES[lang]}: English text -> translation ({{0}} = a value kept as it is). Generated from the translation tables; edit them, not this file. */\n')
        w.write(f'I18N.add({json.dumps(lang)}, {json.dumps(d, ensure_ascii=False, indent=0, sort_keys=True)});\n')
print(len(es), 'entries; bad', len(bad)); [print(b) for b in bad[:20]]
