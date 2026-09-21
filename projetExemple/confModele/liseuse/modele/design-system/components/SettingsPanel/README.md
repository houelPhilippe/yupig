Panneau flottant (`raised`, bordure `rule-strong`, ombre `shadow-popover`, coin `radius-lg`) qui regroupe les réglages de lecture : thème, police, taille, interligne, largeur, affichage, styles du document.

**Ce que le consommateur fournit.** Un `<section class="lsr-panel">` positionné sous la barre d'outils (à droite) ; chaque réglage est un `<fieldset class="lsr-field">` avec sa `<legend>`. Choix exclusifs : `lsr-seg` (boutons `aria-pressed`). Valeurs continues : `lsr-range` avec la valeur affichée en `lsr-field__value`. Thèmes : `lsr-swatch` avec `data-theme` sur le bouton pour qu'il s'affiche dans les couleurs du thème qu'il désigne.

**À faire**
- Appliquer chaque réglage immédiatement, sans bouton « Appliquer », et le mémoriser côté lecteur.
- Fermer le panneau avec Échap ou un clic à l'extérieur, et rendre le focus au bouton qui l'a ouvert.

**À éviter**
- Deux panneaux ouverts en même temps.
- Une largeur supérieure à `panel-w` : sous 380 px, le panneau prend la largeur de l'écran moins les gouttières.
