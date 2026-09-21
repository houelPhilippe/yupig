#!/usr/bin/env python3
r"""
generate_book.py
-----------------
Construit un PDF "book" (avec parties \part{} + chapitres \chapter{}) à partir
d'une structure YAML de type :

chapters:
  - part: '**VERSION NOMINALE**'
    files:
      - ./filesLOT01/fichier1.md
      - ./filesLOT01/fichier2.md
  - part: '**GESTION du TRANSIT**'
    files:
      - ./filesLOT07/fichier1.md
      ...

Usage :
    python generate_book.py book_structure.yaml output.pdf [defaults.yaml]

Pandoc lui-même n'a pas de notion native "part/chapters" (contrairement à
Quarto) : ce script génère un petit fichier temporaire par partie contenant
un bloc LaTeX brut "\part{...}", puis appelle pandoc avec la liste complète
des fichiers (diviseurs + chapitres) dans l'ordre.
"""

import sys
import subprocess
import tempfile
import pathlib
import re
import yaml


FRONT_MATTER_RE = re.compile(r'^---\r?\n(.*?\r?\n)---\r?\n', re.DOTALL)
H1_RE = re.compile(r'^#[ \t]+\S', re.MULTILINE)


def ensure_h1_from_title(src_path: pathlib.Path, tmpdir: pathlib.Path) -> str:
    r"""Si le fichier n'a pas de titre de niveau 1 (# ...) mais possède une
    métadonnée YAML 'title', injecte '# <title>' juste après le bloc de
    front matter, dans une copie temporaire (le fichier source n'est jamais
    modifié). Sinon, retourne le chemin original tel quel."""
    text = src_path.read_text(encoding='utf-8')

    fm_match = FRONT_MATTER_RE.match(text)
    front_matter_block = fm_match.group(0) if fm_match else ''
    body = text[len(front_matter_block):]

    if H1_RE.search(body):
        return str(src_path)  # déjà un H1 : on ne touche à rien

    title = None
    if fm_match:
        try:
            meta = yaml.safe_load(fm_match.group(1)) or {}
            title = meta.get('title')
        except yaml.YAMLError:
            title = None

    if not title:
        print(f"⚠️  Attention : aucun H1 et aucune métadonnée 'title' dans "
              f"{src_path} — le chapitre n'aura pas de titre.",
              file=sys.stderr)
        return str(src_path)

    new_text = front_matter_block + f"\n# {title}\n\n" + body
    out_path = tmpdir / (src_path.stem + "__h1" + src_path.suffix)
    out_path.write_text(new_text, encoding='utf-8')
    return str(out_path)


def clean_part_title(title: str) -> str:
    """Retire les ** de mise en gras Markdown et échappe les caractères LaTeX
    sensibles minimaux (&, %, _, #) pour éviter de casser la compilation."""
    title = title.strip()
    title = re.sub(r'^\*\*(.*)\*\*$', r'\1', title)
    for char in ['&', '%', '_', '#']:
        title = title.replace(char, '\\' + char)
    return title


def extract_title_and_abstract(index_path: pathlib.Path):
    r"""Lit le front matter YAML de index.md et retourne (title, abstract).
    'abstract-title' dans le fichier source est utilisé comme contenu du
    résumé (variable pandoc 'abstract', rendue dans \begin{abstract}...)."""
    text = index_path.read_text(encoding='utf-8')
    fm_match = FRONT_MATTER_RE.match(text)
    if not fm_match:
        print(f"⚠️  Attention : {index_path} n'a pas de bloc YAML "
              f"(--- ... ---) exploitable.", file=sys.stderr)
        return None, None
    try:
        meta = yaml.safe_load(fm_match.group(1)) or {}
    except yaml.YAMLError as e:
        print(f"⚠️  Attention : YAML invalide dans {index_path} : {e}",
              file=sys.stderr)
        return None, None
    title = meta.get('title')
    abstract = meta.get('abstract-title')
    return title, abstract


def build_input_list(parts: list, tmpdir: pathlib.Path) -> list:
    r"""Crée un fichier \part{...} par partie et retourne la liste ordonnée
    complète des fichiers à passer à pandoc (diviseurs + chapitres)."""
    input_files = []
    for i, part in enumerate(parts, start=1):
        title = clean_part_title(part['part'])
        part_file = tmpdir / f"__part_{i:02d}.md"
        part_file.write_text(
            f'```{{=latex}}\n\\part{{{title}}}\n```\n',
            encoding='utf-8'
        )
        input_files.append(str(part_file))

        for chapter_file in part['files']:
            chapter_path = pathlib.Path(chapter_file)
            if not chapter_path.exists():
                print(f"⚠️  Attention : fichier introuvable : {chapter_file}",
                      file=sys.stderr)
                input_files.append(chapter_file)
                continue
            input_files.append(ensure_h1_from_title(chapter_path, tmpdir))

    return input_files


def main():
    if len(sys.argv) < 3:
        print("Usage : python generate_book.py <structure.yaml> <sortie.pdf> "
              "[defaults.yaml]")
        sys.exit(1)

    structure_path = pathlib.Path(sys.argv[1])
    output_pdf = sys.argv[2]
    defaults_file = sys.argv[3] if len(sys.argv) > 3 else "defaults.yaml"

    data = yaml.safe_load(structure_path.read_text(encoding='utf-8'))
    parts = data['chapters']  # liste des parties

    # --- Titre / résumé de la page de garde, extraits de index.md --------
    metadata_args = []
    index_key = data.get('index')
    if index_key:
        index_path = pathlib.Path(index_key)
        if not index_path.exists():
            print(f"⚠️  Attention : index introuvable : {index_key} — "
                  f"titre/résumé de page de garde ignorés.", file=sys.stderr)
        else:
            title, abstract = extract_title_and_abstract(index_path)
            if title:
                metadata_args += ["--metadata", f"title={title}"]
            if abstract:
                metadata_args += ["--metadata", f"abstract={abstract}"]

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = pathlib.Path(tmp)
        input_files = build_input_list(parts, tmpdir)

        cmd = (["pandoc"] + input_files + metadata_args +
               ["--defaults", defaults_file, "-o", output_pdf])

        print("Commande générée :")
        print(" ".join(cmd))
        print()

        result = subprocess.run(cmd)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
