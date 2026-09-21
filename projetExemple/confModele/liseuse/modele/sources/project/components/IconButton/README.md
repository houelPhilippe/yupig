Bouton compact de 32 px pour les barres de la liseuse : une icône seule ou une icône suivie d'un libellé court.

**Ce que le consommateur fournit.** Un `<button class="lsr-iconbtn">` contenant un `<svg viewBox="0 0 16 16">` (trait 1,5 px, `currentColor`) et, pour une icône seule, un `aria-label` en français. Un bouton à bascule porte `aria-pressed`, un bouton qui ouvre un panneau porte `aria-expanded`.

**À faire**
- Un libellé verbe à l'infinitif ou nom court : « Ouvrir », « Réglages ».
- Laisser l'état pressé s'exprimer par `accent-soft` + bordure `accent` : la couleur ne porte jamais l'état seule (la bordure change aussi).

**À éviter**
- Plus de deux mots dans un libellé.
- Un bouton d'action principale sans libellé : utiliser `lsr-btn` (bordure `rule-strong`) pour les actions qui ne vivent pas dans une barre.
