Liseuse est l'interface de lecture de documents HTML : une barre d'outils, un sommaire généré depuis les titres, une zone de lecture sobre et une barre de progression. Elle s'adresse à des lecteurs de documentation technique (spécifications, guides, dossiers) qui veulent lire longtemps sans fatigue et se repérer vite. Tout est écrit en français, en HTML et CSS ; le seul JavaScript nécessaire est celui de la page qui l'utilise.

## Principes

- Le document passe avant l'interface : la zone de lecture est le seul endroit où le contraste est maximal (`ink` sur `page`), l'interface reste sur `chrome`, un cran plus discret.
- Une seule couleur d'accent, `accent`, pour ce qui est actif ou cliquable. Elle ne porte jamais un état seule : un état actif change aussi de bordure ou de graisse.
- Des angles francs : `radius-sm` (2 px) pour le code, `radius-md` (4 px) pour les contrôles, `radius-lg` (8 px) pour le seul panneau flottant. Pas de carte ombrée dans l'interface courante ; l'ombre `shadow-popover` est réservée au panneau de réglages.
- Le sommaire, la recherche et la progression sont des outils de repérage, pas des décors : chaque repère (entrée courante, occurrence, repère de section) correspond à une position réelle dans le document.

## Couleurs et thèmes

Trois thèmes ont les mêmes noms de jetons : `light` (Clair), `sepia` (Sépia), `dark` (Sombre). Le premier thème (`light`) est la valeur de repli.

- Fonds : `page` pour la zone de lecture et les champs, `chrome` pour la barre d'outils, le sommaire et la barre d'état, `raised` pour le panneau de réglages, `code-bg` pour le code, les citations et les en-têtes de tableau.
- Texte : `ink` pour le texte courant, `ink-muted` pour les métadonnées et les légendes, `accent-ink` pour les liens et l'entrée courante du sommaire. Sur un fond `accent`, le texte est `on-accent`.
- Sélection et survol : `accent-soft`. Recherche : `mark` pour toutes les occurrences, `mark-active` pour la courante (avec un contour `ink` de 2 px), texte `on-mark`.
- Filets : `rule` pour les séparations décoratives, `rule-strong` pour la bordure de tout contrôle.
- Focus clavier : anneau `focus` de 2 px, décalage 2 px, sur tous les contrôles.

Toutes les paires texte/fond de ces règles atteignent 4,5:1 dans les trois thèmes, et les bordures de contrôles et l'anneau de focus 3:1.

## Typographie

- Interface : `font-sans` (IBM Plex Sans), styles `ui-title` (titre du document), `ui-label` (boutons, sommaire), `ui-caption` (barre d'état), `ui-overline` (intitulés de groupes en capitales).
- Lecture : le texte courant est `read-body` en sans par défaut ; l'utilisateur peut passer à `read-body-serif` (Source Serif 4) ou à la police mono (IBM Plex Mono). Les titres du document restent en sans quelle que soit la police choisie.
- Le code est toujours en `read-code` (mono), y compris quand la police de lecture est une serif.
- La ligne de lecture se règle en `em`, pas en `ch` : 30 em (étroite), 38 em (moyenne, par défaut), 48 em (large). Cela garde 60 à 75 caractères par ligne à toutes les tailles.

## Espacement et disposition

- Gouttière minimale de 16 px (`space-4`) à toutes les largeurs.
- Barre d'outils : `bar-h` (48 px). Sommaire : `sidebar-w` (296 px par défaut), à gauche ou à droite au choix du lecteur (`data-toc-side`), redimensionnable de 200 à 560 px par la poignée `lsr-resizer` (variable `--toc-w`) ; fermé par défaut sous 900 px où il s'affiche en tiroir, du côté choisi. Panneau de réglages : `panel-w` (340 px), largeur de l'écran moins les gouttières en dessous de 380 px.
- Marges de la zone de lecture : `space-5` en haut et en bas, `space-6` à `space-7` sur les côtés, `space-8` sous la dernière ligne.

## Composants

`IconButton` (bouton de barre), `ReaderToolbar` (barre d'outils et recherche), `ContentsList` (sommaire), `ProgressBar` (progression et barre d'état), `SettingsPanel` (réglages, dont la position et la largeur du sommaire), `ReadingPage` (typographie du document) et `ReaderShell` (assemblage). Tous sont écrits en HTML et CSS avec le préfixe `lsr-` : le consommateur copie le balisage de l'aperçu et charge `bundle.css` après `tokens.css`.

## Iconographie

Les icônes sont de petits SVG en ligne, 16 × 16 px, trait de 1,5 px, extrémités arrondies, `stroke="currentColor"` : sommaire, recherche, fichier, réglages, flèches, fermer. Elles héritent la couleur du texte du bouton. Aucun émoji, aucune icône pleine. Une icône seule porte toujours un `aria-label` en français.

## Contenu et ton

- Les libellés sont en français, à l'infinitif ou en nom court : « Ouvrir », « Réglages », « Rechercher dans le document ».
- Les valeurs utilisent la virgule décimale et l'espace insécable avant l'unité : « 1,65 », « 17 px », « 42 % ».
- Un message d'erreur dit ce qui s'est passé et quoi faire : « Ce fichier ne contient pas de HTML lisible. Choisissez un fichier .html ou .htm. »
