Assemblage complet de la liseuse : une grille `lsr-shell` à trois rangées (barre d'outils, corps, barre d'état) dont le corps porte deux colonnes (`lsr-sidebar` de largeur `sidebar-w`, `lsr-main` qui prend le reste).

**Ce que le consommateur fournit.** Un conteneur de hauteur définie (`height: 100%`), les quatre composants `ReaderToolbar`, `ContentsList`, `ReadingPage` et `ProgressBar`, et le panneau `SettingsPanel` posé en absolu au-dessus.

**Sommaire à gauche ou à droite.** Posez `data-toc-side="right"` sur `lsr-shell` (ou sur un parent) pour placer le sommaire à droite ; la grille échange ses zones (`side`, `main`) sans changer l'ordre du balisage. La largeur se règle avec la variable `--toc-w` (défaut : `sidebar-w`). La poignée `lsr-resizer` (`role="separator"`, un bouton placé dans `lsr-shell__body`) se positionne d'elle-même sur le bord intérieur du sommaire.

**À faire**
- Laisser l'utilisateur ajuster la largeur du sommaire entre 200 px et 560 px (60 % de la largeur au plus), à la souris (glisser, double-clic pour réinitialiser), au clavier (flèches, Maj + flèches, Début, Fin) et par un curseur dans les réglages.
- Sous 900 px, passer le sommaire en tiroir par-dessus la lecture, fermé par défaut, du côté choisi.
- Laisser la zone de lecture prendre le focus clavier après l'ouverture d'un document pour que les flèches et la barre d'espace fonctionnent tout de suite.

**À éviter**
- Ajouter une seconde barre latérale : les réglages restent dans un panneau flottant.
