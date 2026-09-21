# Liseuse

- `liseuse.html` : la liseuse, un seul fichier autonome (à ouvrir dans un navigateur, puis « Ouvrir » ou glisser-déposer un document HTML).
- `exemple-document.html` : document de test.
- `design-system/` : fichiers du design system (README, tokens.json, components/bundle.css, un dossier par composant).
- `sources/` : sources de fabrication.
  - `reader.template.html` : gabarit de la liseuse (HTML, JS, CSS propre à la page).
  - `project/` : design system (source unique de `bundle.css` et `tokens.json`).
  - `gen_tokens.py` : génère `project/tokens.json` et `reader-tokens.css` depuis `palette.json`.
  - `contrast.py` : vérifie les contrastes WCAG de la palette.
  - `build_ds.py` : génère les aperçus et README des composants.
  - `build_reader.py` : assemble `reader.html` (gabarit + jetons + `bundle.css` + document d'exemple).

Ordre de reconstruction : `python3 contrast.py && python3 gen_tokens.py && python3 build_ds.py && python3 build_reader.py`
