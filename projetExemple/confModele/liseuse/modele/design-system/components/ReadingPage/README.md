Typographie du document lu, portée par la classe `lsr-doc` : titres `h1` à `h6`, paragraphes, listes, liens, code (`code`, `pre`, `kbd`), citations, notes (`aside`, `.note`), tableaux, images, figures, filets, occurrences de recherche (`mark.lsr-hit`).

**Ce que le consommateur fournit.** Le HTML du document, déjà assaini (aucun script, aucun gestionnaire `on…`), dans un élément `<article class="lsr-doc">`. Les réglages de l'utilisateur passent par trois variables CSS : `--read-size` (px), `--read-leading` (sans unité) et `--read-font` (`var(--font-sans)`, `var(--font-serif)` ou `var(--font-mono)`). La largeur de ligne se règle sur l'élément lui-même en `em` : `max-width: 30em` (étroite), `38em` (moyenne), `48em` (large).

**À faire**
- Garder une ligne de 60 à 75 caractères : c'est la largeur moyenne, pas la largeur de l'écran.
- Retirer les couleurs, fonds et polices en ligne du document quand l'utilisateur choisit « Styles ignorés » : c'est ce qui rend les trois thèmes lisibles.

**À éviter**
- Justifier le texte : l'alignement reste à gauche.
- Lire un tableau large en le réduisant : il défile horizontalement dans son propre conteneur.
