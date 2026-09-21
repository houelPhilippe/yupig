Barre d'état de bas d'écran : une piste de progression cliquable et une ligne « section courante » / « position ». Les repères verticaux (`lsr-progress__tick`) marquent le début de chaque section de niveau 1 et 2 ; ce sont des informations, pas de la décoration.

**Ce que le consommateur fournit.** La progression en pourcentage dans la variable CSS `--p` du conteneur, la liste des positions de repères (en %), le fil d'Ariane de la section courante et un texte de position : « 42 % · ≈ 4 min restantes » en défilement, « Page 6 / 14 » en mode pages.

**À faire**
- Donner à la piste `role="slider"`, `aria-valuenow` et la gestion des flèches gauche/droite.
- Écrire « fin du document » plutôt que « 0 min restante ».

**À éviter**
- Animer le remplissage pendant un défilement : la progression suit le doigt ou la molette sans transition.
