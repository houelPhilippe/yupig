Barre d'outils de 48 px (`bar-h`) sur `chrome` : bascule du sommaire, titre du document avec ses métadonnées, recherche, ouverture d'un fichier, réglages. La recherche ouvre une seconde rangée (`lsr-searchbar`) sous la barre.

**Ce que le consommateur fournit.** Le titre (`<strong>`) et une ligne de métadonnées (`<span>` : nom de fichier, nombre de mots, temps de lecture) ; les boutons sont des `IconButton`. Le titre se tronque avec une ellipse : ne jamais le faire passer à la ligne.

**À faire**
- En dessous de 700 px, ne garder que des boutons icône seule avec `aria-label`.
- Compter le temps de lecture à 230 mots par minute et l'afficher arrondi (« ≈ 6 min »).

**À éviter**
- Ajouter des actions rares (export, impression) dans la barre : elles vont dans le panneau de réglages.
