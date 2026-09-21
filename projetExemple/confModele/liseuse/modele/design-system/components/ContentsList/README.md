Sommaire latéral construit à partir des titres `h1` à `h4` du document ouvert. L'entrée de la section en cours porte `aria-current="location"` : fond `accent-soft`, texte `accent-ink`, graisse 600.

**Ce que le consommateur fournit.** Une liste `<ol>` d'ancres `<a data-level="0..3" style="--lvl:N">` ; le niveau 0 est le niveau de titre le plus haut présent dans le document (un document qui commence à `h2` n'est pas décalé). Si aucun titre n'existe, afficher `lsr-toc__empty` avec une consigne.

**À faire**
- Faire défiler la liste pour garder l'entrée courante visible.
- Fermer le sommaire après un choix quand il s'affiche en tiroir (moins de 900 px).

**À éviter**
- Numéroter les entrées : la numérotation appartient au document, pas à la liseuse.
- Signaler l'entrée courante par un liseré : c'est le fond `accent-soft` et la graisse qui portent l'état.
