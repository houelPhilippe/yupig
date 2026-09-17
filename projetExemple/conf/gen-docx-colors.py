#!/usr/bin/env python3
"""Genere dans conf/reference.docx les styles de caractere utilises par la
sortie Word pour les surlignements et les couleurs de texte.

Le writer DOCX de Pandoc ignore l'attribut style= des spans Markdown
( [texte]{style="background-color: Yellow;"} ). conf/filtre.lua le convertit
donc en custom-style=, qui pointe vers un style de caractere Word -- seul
mecanisme qui preserve le gras / le code / les liens imbriques dans le span.
Ce script cree ces styles, en scannant les .md pour ne definir que les
couleurs reellement employees.

    python3 conf/gen-docx-colors.py        # depuis la racine du projet

Idempotent : les styles precedemment generes (styleId prefixe « Coul ») sont
remplaces. A relancer apres l'introduction d'une nouvelle couleur.
"""
import glob, re, shutil, sys, zipfile

REFERENCE = 'conf/reference.docx'
SOURCES   = 'files*/*.md'

# Couleurs CSS nommees -> hexadecimal (celles du corpus + les usuelles).
CSS = {
    'black':'000000','white':'FFFFFF','red':'FF0000','green':'008000',
    'blue':'0000FF','yellow':'FFFF00','olive':'808000','orange':'FFA500',
    'purple':'800080','gray':'808080','grey':'808080','silver':'C0C0C0',
    'maroon':'800000','navy':'000080','teal':'008080','aqua':'00FFFF',
    'cyan':'00FFFF','fuchsia':'FF00FF','magenta':'FF00FF','lime':'00FF00',
    'pink':'FFC0CB','brown':'A52A2A','gold':'FFD700','indigo':'4B0082',
    'violet':'EE82EE','salmon':'FA8072','lightsalmon':'FFA07A',
    'lightyellow':'FFFFE0','lightgreen':'90EE90','lightblue':'ADD8E6',
    'lightgray':'D3D3D3','lightgrey':'D3D3D3','lightcyan':'E0FFFF',
    'lightpink':'FFB6C1','royalblue':'4169E1','steelblue':'4682B4',
    'darkblue':'00008B','darkgreen':'006400','darkred':'8B0000',
    'forestgreen':'228B22','darkorange':'FF8C00','orangered':'FF4500','tomato':'FF6347',
    'khaki':'F0E68C','beige':'F5F5DC','ivory':'FFFFF0','wheat':'F5DEB3',
    'plum':'DDA0DD','orchid':'DA70D6','turquoise':'40E0D0',
}

def hex_of(name):
    if re.fullmatch(r'[0-9a-f]{6}', name):
        return name.upper()
    return CSS.get(name)

def style_name(fg, bg):
    """Doit reproduire exactement docx_color_style() de conf/filtre.lua."""
    if fg and bg: return f'Texte {fg} fond {bg}'
    if fg:        return f'Texte {fg}'
    if bg:        return f'Fond {bg}'
    return None

def scan():
    """{(fg, bg)} rencontres dans les sources Markdown."""
    found, unknown = set(), set()
    for path in glob.glob(SOURCES):
        for decl in re.findall(r'style="([^"]*)"', open(path, encoding='utf-8').read()):
            fg = bg = None
            for prop, val in re.findall(r'([\w-]+)\s*:\s*([^;]+)', decl):
                val = val.strip().lstrip('#').lower()
                if prop.lower() == 'color': fg = val
                elif prop.lower() == 'background-color': bg = val
            if not (fg or bg):
                continue
            for c in (fg, bg):
                if c and hex_of(c) is None: unknown.add(c)
            found.add((fg, bg))
    return found, unknown

def build_style(fg, bg):
    name = style_name(fg, bg)
    sid  = 'Coul' + re.sub(r'[^0-9A-Za-z]', '', name)
    rpr  = ''
    if fg: rpr += f'<w:color w:val="{hex_of(fg)}"/>'
    if bg: rpr += f'<w:shd w:val="clear" w:color="auto" w:fill="{hex_of(bg)}"/>'
    return name, (
        f'<w:style w:type="character" w:customStyle="1" w:styleId="{sid}">'
        f'<w:name w:val="{name}"/><w:basedOn w:val="Policepardfaut"/>'
        f'<w:uiPriority w:val="1"/><w:qFormat/>'
        f'<w:rPr>{rpr}</w:rPr></w:style>')

def main():
    combos, unknown = scan()
    combos = {c for c in combos
              if all(hex_of(x) is not None for x in c if x)}
    if unknown:
        print('couleurs CSS inconnues (ignorees), a ajouter dans CSS :',
              ', '.join(sorted(unknown)), file=sys.stderr)

    zin = zipfile.ZipFile(REFERENCE)
    items = [(i, zin.read(i.filename)) for i in zin.infolist()]
    zin.close()

    out = []
    for info, data in items:
        if info.filename == 'word/styles.xml':
            xml = data.decode('utf-8')
            # Purge des styles generes lors d'un passage precedent.
            xml = re.sub(r'<w:style [^>]*w:styleId="Coul[^"]*".*?</w:style>', '',
                         xml, flags=re.S)
            styles = sorted(build_style(*c) for c in combos)
            xml = xml.replace('</w:styles>',
                              ''.join(s for _, s in styles) + '</w:styles>', 1)
            data = xml.encode('utf-8')
            print(f'{len(styles)} styles de caractere ecrits :')
            for name, _ in styles: print('   ', name)
        out.append((info, data))

    tmp = REFERENCE + '.tmp'
    z = zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED)
    for info, data in out: z.writestr(info, data)
    z.close()
    shutil.copyfile(tmp, REFERENCE)
    import os; os.remove(tmp)
    print('->', REFERENCE)

if __name__ == '__main__':
    main()
