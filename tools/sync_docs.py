"""Put the two documents into the Studio: docs/ and web/data/docs/ get USER_GUIDE.pdf and OSEMOSYS_PARAMETERS.pdf, and
web/data/docs/param_pages.json the PDF page of every parameter, of the worked example, of the results chapter and of the
A-Z list (the Info menu and the "i" next to a parameter open them), read from the LaTeX .aux of the reference.

    python tools/sync_docs.py <folder>   (the folder of the LaTeX documents, compiled with XeLaTeX twice:
                                          user_guide/USER_GUIDE.pdf, parameter_reference/OSEMOSYS_PARAMETERS.pdf and .aux)
"""

import json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'web', 'data', 'docs')
OFFSET = 1  # printed page number -> page of the PDF file (the title page has no number)


def main(tex):
    ref = os.path.join(tex, 'parameter_reference', 'OSEMOSYS_PARAMETERS')
    guide = os.path.join(tex, 'user_guide', 'USER_GUIDE.pdf')
    if not (os.path.isfile(ref + '.pdf') and os.path.isfile(ref + '.aux')):
        print(f'no compiled reference in {tex}: nothing synced')
        return None
    for f in (ref + '.pdf', guide):
        if os.path.isfile(f):
            for d in (OUT, os.path.join(ROOT, 'docs')):
                shutil.copyfile(f, os.path.join(d, os.path.basename(f)))
    aux = open(ref + '.aux', encoding='utf-8', errors='ignore').read()
    lab = re.finditer(r'\\newlabel\{(sec:\w+|ch:\w+|app:\w+)\}\{\{[^}]*\}\{(\d+)\}', aux)
    pages = {(m.group(1)[4:] if m.group(1).startswith('sec:') else m.group(1)): int(m.group(2)) + OFFSET for m in lab}
    json.dump(pages, open(os.path.join(OUT, 'param_pages.json'), 'w', encoding='utf-8', newline='\n'), indent=0)
    print(f'documents synced: {len(pages)} pages in param_pages.json')
    return pages


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
