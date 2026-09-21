# Éditeur Markdown — contexte projet

Application de bureau **Rust + Tauri 2**, autonome et hors ligne, à l'aspect
« Modernist » repris de la maquette
`modele/Tableau de bord Veille (autonome).html` (aplats, angles vifs, accent
rouge `#ec3013`, police Archivo).

Elle s'appelle **« Éditeur Markdown »** : c'est l'écriture des documents d'un
projet qui en est le sujet. L'agrégateur de flux RSS/Atom, qui fut le point de
départ, y reste — en **option**, une seconde fenêtre sur le même projet. Le
nom vit dans `productName` de `tauri.conf.json` pour le paquet, et dans `TITLE`
de `ui/shell.js` pour le bandeau et la fenêtre ; l'`identifier`, lui, ne bouge
pas (`fr.phl.veille`) — c'est de lui que dépend `app_data_dir`, donc la base et
tout ce qu'elle retient.

## Décisions structurantes

| Décision | Raison |
|---|---|
| Frontend HTML/CSS/JS **sans bundler** (`frontendDist: "../src"`) | La maquette est déjà du HTML/CSS ; ajouter Node/Vite ferait porter une chaîne de build à une interface qui n'en a pas besoin. Aucun `package.json` dans ce dépôt. |
| `marked` et `turndown` **versionnés** dans `src/vendor/` | La CSP interdit toute origine externe : pas de CDN possible. Ce sont des builds UMD autonomes, servis tels quels — cela ne réintroduit donc pas de chaîne de build. Voir `src/vendor/README.md` pour les versions et la mise à jour. |
| **SQLite** (`rusqlite`, feature `bundled`) dans `app_data_dir` | L'app doit rester lisible hors ligne et survivre aux redémarrages ; SQLite embarqué évite toute dépendance système. |
| `Arc<Db>` avec `std::sync::Mutex` | Aucun verrou n'est conservé au travers d'un `.await` : les méthodes de `db.rs` prennent le verrou et rendent des données possédées. Ne pas remplacer par un mutex asynchrone sans raison. |
| Polices **embarquées** (`src/assets/fonts/*.woff2`) | Archivo est extrait de la maquette. Pas de requête vers Google Fonts : la CSP interdit les origines externes. |
| Texte des flux **nettoyé côté Rust** (`fetch::clean`) | Le contenu vient de tiers ; il traverse l'IPC en texte brut et le frontend n'utilise que `textContent`. Ne jamais introduire d'`innerHTML` sur des données de flux. |

## Où se trouve quoi

```
modele/     la maquette de référence — lecture seule, ne pas modifier
src/        frontend servi tel quel (index.html, styles/, js/, vendor/)
src-tauri/  cœur Rust
docs/       ARCHITECTURE.md — flux de données et conventions
```

L'application abrite **deux coques** que le lanceur de l'en-tête permute :
« Édition » (rédaction des documents d'un projet — arbre des fichiers à
gauche, onglets et zone de saisie au centre, sommaire ou bloc YAML à droite) et
« Veille » (le lecteur de flux). Les deux vivent dans la même page et le même
`state` ; `ui/shell.js` masque celle qui n'est pas à l'écran.

« Édition » vient **en tête**, et c'est là qu'on arrive : l'ordre de la table
`APPS` est celui du menu, et son premier terme sert de recours quand l'état
nomme une coque inconnue — une base neuve comme une valeur d'une version plus
ancienne. La coque qu'on a quittée est retrouvée au lancement suivant
(`settings.app`) : seule celle qu'on n'a jamais choisie est « Édition ».

Le **bandeau** de la barre du haut porte le nom de l'application et non celui
de la coque : il n'y en a qu'une, et « Veille » n'en est qu'une fenêtre. Ce
qu'on regarde se voit assez — l'entrée cochée du lanceur, les outils de la
barre, la page elle-même. Le titre de la **fenêtre**, lui, nomme la coque quand
ce n'est pas celle d'où l'on écrit : « Veille — Éditeur Markdown », contre
« Éditeur Markdown » tout court.

Un dossier ne s'ouvre plus directement : **c'est un projet que l'on ouvre**.
Un projet est un dossier qui porte un témoin — `.veille/projet.json`, où vivent
son nom et sa date de création. Le témoin est dans le dossier et non en base :
c'est ce qui fait qu'un projet copié sur une autre machine, ou partagé, y est
le même projet sous le même nom — la même raison qui fait écrire les liens
d'images en relatif. La base, elle, ne retient que les chemins déjà ouverts
**sur cette machine** et la date de leur dernière ouverture : `projects`. Le
nom ne s'y recopie pas, sans quoi un projet renommé mentirait dans la liste.

La boîte des projets est la porte d'entrée de « Édition » : elle s'ouvre au
démarrage qui rend la main à cette coque, et à chaque passage vers elle sans
projet ouvert — jamais devant « Veille », qu'une question sur les projets ne
concerne pas. On y choisit un projet, on en crée un sur un dossier existant, ou
l'on désigne un dossier venu d'ailleurs. L'application **ne crée pas de
dossier** : elle pose un projet sur ce qui est déjà là. Un dossier sans témoin
est refusé à l'ouverture plutôt qu'adopté en silence — on a pu simplement
désigner le mauvais. Un projet retiré de la liste ne perd ni son dossier, ni son
témoin, ni sa mise en page : le retirer n'est pas le détruire — et comme le
témoin reste, **le désigner de nouveau l'ouvre au lieu de le créer** : la boîte
le dit dès qu'on a choisi le dossier, puis le propose, et le projet retrouve sa
place dans la liste avec son nom et sa date d'origine. Réécrire le témoin lui
ferait perdre l'un et l'autre, et un projet partagé ne serait plus le même
partout. C'est `project_name_at` qui le dit à l'interface, laquelle ne lit
jamais le texte d'une erreur pour décider de sa conduite.

L'éditeur porte trois regards sur un même document — « Modifier » (texte mis
en forme), « Voir » (rendu en lecture seule), « Code Markdown » (la source).
**Le Markdown est la seule vérité** : c'est lui qui vit dans l'onglet et part
sur le disque ; les deux autres vues ne sont que des rendus, reconvertis par
`turndown` uniquement si l'on y a réellement saisi quelque chose — sans ce
garde-fou, un simple aperçu réécrirait le formatage du fichier. Un document
s'ouvre dans « Modifier » : c'est ce garde-fou qui le permet sans risque, et
l'on vient y écrire plutôt que lire du Markdown.

Les largeurs des volets latéraux vivent dans deux variables CSS de `:root`
(`--files-width`, `--outline-width`), pas dans un style posé sur les volets :
`--files-width` cale aussi la tête de la barre du haut, si bien que
redimensionner le volet gauche réaligne les onglets sans code supplémentaire.
Les poignées sont posées en absolu **par-dessus** la bordure, pour n'occuper
aucune place dans la rangée et ne pas fausser cet alignement. Le volet des fichiers
ne doit sa largeur qu'à sa poignée : il porte donc `min-width: 0`, sans quoi le
plus long des noms imposerait sa mesure au volet et l'on ne pourrait plus le
resserrer — le nom, lui, s'abrège, ce qui demande la même levée sur la boîte qui
le porte.

Le poussoir **« Focus »** de la barre du haut retire les deux volets d'un coup
pour ne laisser que le document, et les ramène : `data-focus` posé sur la
racine, comme `data-theme`, et la feuille de style fait le reste — tête de la
barre comprise, qui cesse alors de réserver la largeur du volet gauche. Le
bouton ne porte que son pictogramme — dans une barre déjà chargée, le mot
n'apprenait rien que l'infobulle ne dise mieux, elle qui annonce ce que le
prochain clic fera ; le nom, lui, reste dans l'`aria-label`. Le pictogramme ne
change pas d'un état à l'autre, seul l'accent le dit enfoncé. Poser
et retirer l'attribut se fait par `toggleAttribute` : un `delete` sur `dataset`
lève une exception en mode strict — donc dans tout module — si l'objet le
refuse, et une vue qui lève emporte le rendu de toutes celles qui la suivent.

Le **zoom du document** est du même bois : `--doc-zoom` multiplie la taille de
base des deux surfaces d'édition — le rendu et la source —, et les tailles
qu'elles portent à l'intérieur se disent en `em` pour la suivre. C'est donc la
taille du *texte* qui change, non l'échelle de la page : les volets, la barre
du haut et le mobilier de l'éditeur gardent la leur, et une image donnée à
90 % de la colonne reste à 90 % de la colonne. Les deux crans de la barre du
haut et Ctrl + molette sur la zone d'édition posent la même valeur — un clic
sur elle revient à 100 %. Elle vit dans les réglages de l'application et non
dans ceux du projet : c'est un confort de lecture, le même quel que soit le
dossier ouvert, et la molette ne l'écrit en base qu'une fois retombée au repos.

Le rendu n'est **rebâti que lorsqu'il le faut** — changement d'onglet ou de
mode, Markdown qui bouge ailleurs qu'ici : le refaire à chaque frappe
replacerait le curseur au début. Il peut donc s'écarter de la source, le moteur
d'édition n'écrivant pas toujours ce que `turndown` en relira. Le bouton
**« Réactualiser »** de la barre du haut remet les deux d'accord, et c'est le
Markdown qui a raison. Il passe par un **compteur** dans l'état
(`state.edition.redraw`) et non par un appel direct à la vue : `editor.js` le
compare à celui sur lequel son rendu a été bâti, et `ui/find.js` le met dans sa
propre signature — sans quoi les intervalles de la dernière recherche
resteraient sur des nœuds sortis de la page, et plus rien ne se peindrait. Ce
qui vient d'être saisi part au Markdown **avant** le redessin (`flush`), sans
quoi réactualiser perdrait les derniers mots. Le bouton s'éteint en « Code
Markdown », où l'affichage *est* le Markdown.

La barre **« Rechercher / Remplacer »** (Ctrl+F, Ctrl+H, ou le menu de
l'onglet) cherche dans **ce que le mode montre** : la source en « Code
Markdown », le texte rendu en « Modifier ». C'est la règle à retenir — on
cherche ce qu'on a sous les yeux, si bien que « le **mot** juste » se trouve en
tapant « le mot juste » d'un côté et « **mot** » de l'autre. Elle se retire en
« Voir », qui ne se modifie pas.

Les occurrences du rendu sont peintes par `CSS.highlights`, qui **n'ajoute
aucun nœud**. Ce n'est pas un raffinement : `turndown` est réglé pour supprimer
le mobilier d'éditeur *avec son contenu* (`service.remove`), donc une
surbrillance posée en `<mark class="chrome">` et oubliée avant une conversion
mangerait le texte du fichier. Hors du DOM, il n'y a rien à nettoyer et rien à
perdre.

Le `<textarea>` de la source n'offre pas cette ressource : son intérieur n'est
atteignable ni par `CSS.highlights` ni par aucun sélecteur, et sa sélection ne
se peint pas tant que le clavier est dans le champ de recherche. Les marques y
passent donc par un **calque posé dessous** (`.editor__backdrop`), qui rejoue le
texte entier en glyphes transparents — seuls ses aplats se voient, sous le texte
réel de la zone de saisie. Les deux couches doivent alors se superposer au pixel
près : tout ce qui décide de la position d'un caractère — police, corps,
interligne, marge intérieure, repli des lignes, `tab-size` — se déclare **une
seule fois**, pour les deux, et le calque reprend en largeur le `clientWidth` de
la zone, qui rétrécit quand sa barre de défilement paraît. Le `<mark>` y porte
`color: transparent` explicitement : la feuille du navigateur lui donne sinon sa
propre couleur, et les glyphes du calque reparaîtraient en double.

Dans le rendu, la recherche travaille sur un **texte à plat** reconstruit à
chaque fois : les nœuds de texte dans l'ordre, le mobilier `chrome` écarté, et
un saut de ligne intercalé entre deux blocs — sans lui, la fin d'un paragraphe
et le début du suivant se toucheraient et « finDébut » deviendrait une
occurrence possible. « Tout remplacer » y refait cette carte à chaque tour et
repart après ce qui vient d'être écrit : c'est ce qui l'arrête quand le
remplacement contient ce qu'on cherche — « a » par « aa ». Le moteur lui-même
— correspondance, casse, mot entier, expression régulière, `$1` — vit dans
`src/js/find.js`, sans DOM ni état.

Le langage d'un bloc de code vit dans la classe `language-…` de son `<code>` :
c'est de là que `turndown` tire le mot qui suit les accents graves. La liste
déroulante posée en haut à droite du bloc n'est qu'une vue sur cette classe.
Elle porte la classe **`chrome`** — du mobilier d'éditeur, reposé après chaque
rendu et retiré par `markdown.js` avant toute conversion : rien de ce qui la
compose ne part dans le fichier.

Dans un bloc de code, `ui/code.js` prend la main sur trois touches, que le
moteur d'édition traiterait autrement : Entrée y pose un saut de ligne (et non
une coupure de bloc), Tabulation indente comme dans un éditeur de texte —
Majuscule pour désindenter, la sélection décalant les lignes entières —, et
Ctrl+Entrée sort du bloc par le bas, sans quoi un bloc en fin de document
serait sans issue. Hors d'un bloc de code, Ctrl+Entrée pose un **saut de page**
(`{{< pagebreak >}}`), sans passer par la boîte des shortcodes : `ui/code.js`
traite la frappe avant l'écouteur des raccourcis, qui ne reprend pas une frappe
déjà traitée — les deux sens ne se contrarient donc pas. L'indentation est une vraie tabulation : c'est la frappe
même, et `tab-size` dit sur quelle colonne elle tombe.

Un bloc de code a son **menu contextuel** — « Supprimer le bloc de code » —, dans
« Modifier » comme dans « Code Markdown », selon la règle des liens : le `<pre>`
sous le pointeur d'un côté, le bloc dont les clôtures entourent le curseur de
l'autre (`sourceCodeAt`, une clôture ne se fermant que par le même caractère, au
moins aussi long). Le bloc part avec ses clôtures et son langage ; dans la
source, la ligne vide qui le suivait aussi, pour ne pas en laisser deux.

`src/js/markdown.js` assainit **toute** sortie de `marked` avant insertion :
`marked` n'assainit plus rien depuis sa v5 et la webview expose `__TAURI__`,
donc l'accès au disque. Ne jamais insérer sa sortie brute dans le DOM.

**Annuler et rétablir** portent sur le **Markdown** du document, non sur le
DOM. C'est la seule chose que toutes les mutations ont en commun : une frappe,
une commande du menu, un collage, un champ du bloc YAML, un remplacement — tout
passe par `store.edit`, donc tout s'annule, sans qu'aucune commande ait à se
savoir annulable. La pile du moteur d'édition ne le pourrait pas : elle ignore
tout ce que `table.js` ou `image.js` écrivent directement dans l'arbre, et une
commande annulée à moitié rendrait un document que `turndown` ne saurait plus
relire. Revenir en arrière, c'est donc **réactualiser l'affichage sur un
Markdown antérieur** : le compteur `redraw` s'en charge, comme pour le bouton «
Réactualiser » — dans la source le curseur reste où il était, dans le rendu il
est perdu comme à chaque redessin.

Les frappes qui se suivent ne font qu'un pas. Trois conditions pour se joindre
au précédent : qu'il existe, que lui aussi soit une frappe, et qu'il soit tout
frais. Un changement se dit frappe **à sa taille** — une lettre, deux au plus ;
au-delà, c'est une commande. Sans cette mesure, un tableau inséré dans la
foulée d'un mot s'annulerait avec lui, et le premier mot tapé après le tableau
ramènerait le tableau avec lui.

**Couper, copier, coller** (`ui/clipboard.js`) tiennent en deux règles. *Ce
qu'on copie part en Markdown* : la forme `text/plain` du presse-papiers porte
le Markdown de la sélection — exactement ce que le fichier porterait —, la
forme `text/html` va aux traitements de texte, qui recollent du texte mis en
forme. C'est déjà ce que fait la copie d'un tableau, qui passe désormais par le
même `clipboard.write` : les deux formes et leur repli — le texte seul, quand
le moteur refuse la paire — ne s'écrivent qu'une fois. Seule la copie d'une
image garde le sien, n'ayant ni texte ni HTML à donner mais des octets. *Ce
qu'on colle passe par le Markdown* : le HTML venu d'ailleurs est ramené au
Markdown par `turndown`, puis relu par `marked` avant d'entrer dans le rendu —
rien ne s'installe donc dans le document que le fichier ne sache porter, et une
image collée y gagne au passage son adresse `asset:` d'affichage. Le texte
brut, lui, **est lu comme du Markdown** : coller du Markdown dans « Modifier »
en montre aussitôt la traduction. Un éditeur de texte met souvent aussi du HTML
dans le presse-papiers — ses couleurs de syntaxe, en `<div>` et `<span>` — que
`turndown` rendrait en Markdown échappé : ce HTML n'est retenu que s'il porte
une vraie mise en forme (`formatted`, dans `ui/clipboard.js`), sinon c'est le
texte qui fait foi. Le prix est connu — « 2. rue du Port » ouvre une liste
numérotée —, d'où **« Coller en texte brut »** (Ctrl+Maj+V), qui pose le texte
tel quel et lit pour cela le presse-papiers, comme l'entrée du menu. Dans un bloc de
code, le texte est du texte : la conversion y sèmerait des échappements.

Les trois commandes ont deux portes — la frappe et l'entrée de menu — et une
seule lecture de la sélection : les événements `copy`, `cut` et `paste` sont
interceptés, si bien que Ctrl+C et « Copier » mettent rigoureusement la même
chose dans le presse-papiers. Le collage du menu fait exception sur un point, et
c'est le seul : aucun script ne sait déclencher un collage, il lui faut lire le
presse-papiers lui-même — une permission, que le moteur peut refuser. La frappe,
elle, ne la demande jamais. La sélection s'écrit par le moteur d'édition
(`insertText`, `insertHTML`, `delete`) et non à la main : c'est ce qui garde
l'historique d'annulation. Une coupe copie **avant** d'effacer : si le
presse-papiers refuse, le texte reste où il est — c'est la même règle pour un
tableau et pour une image, qui ont chacun leur « Couper » dans leur menu.

Le document ne porte que du **Markdown** : `turndown` ne garde aucune balise
telle quelle. Gras, italique, code inline et barré se disent nativement ; les
petites capitales, le souligné, la couleur du texte et la surbrillance passent
par le **span à attributs de Pandoc** — `[texte]{.smallcaps}`,
`[texte]{.underline}`, `[texte]{style="color: #ec3013"}`,
`[texte]{style="background-color: #fdf0a4"}`. Les deux classes sont celles que
Pandoc connaît lui-même : elles survivent à la compilation, en HTML comme en
PDF ; une classe inventée ne rendrait rien sans feuille de style à soi. Le HTML
en ligne, lui, a été écarté : d'autres outils ne le rendent pas. Ne pas l'y
ramener.

Une **ligne vide** voulue ne s'obtient ni par deux retours à la ligne —
Markdown les ramène à une séparation de blocs, et le blanc disparaît à la
compilation — ni par `<br>`, qui est du HTML en ligne. C'est un paragraphe qui
ne porte qu'une **espace insécable** : le fichier l'écrit `&nbsp;`, que l'on
voit dans la source, et CommonMark comme Pandoc la lisent, si bien que la ligne
blanche paraît en HTML comme en PDF. Le rendu, lui, porte le caractère, qu'on
ne voit pas — c'est bien une ligne vide. Le passage au Markdown se fait par
`blankReplacement` et non par une règle : `turndown` tient pour vide tout nœud
dont le texte n'est que du blanc, et en JavaScript l'insécable en est — aucune
règle ne serait donc consultée pour ce paragraphe.

Le même menu porte les blocs — les six niveaux de titre et le paragraphe qui
les défait, la citation, les listes à puces, numérotées et à cocher, et la
ligne horizontale, la note de bas de page. La ligne s'écrit `***` et non `---` : trois tirets sous un
paragraphe en feraient un titre souligné, et en tête de fichier le début d'un
bloc YAML. La citation, elle, **contient** le bloc au lieu de le remplacer :
sa marque se pose devant la ligne entière, et un titre cité reste un titre. Dans le rendu, les
commandes natives du moteur d'édition s'en chargent ; dans la source, c'est une
marque en tête de ligne, que `prefixLines` pose et relève. La liste à cocher
est celle du GFM (`- [ ] texte`) : `marked` en fait une vraie case, seule
balise `<input>` que l'assainisseur laisse passer, et un clic la coche — c'est
l'**attribut** `checked` qui est posé, le seul qui survive à la relecture du
HTML par `turndown`.

Une liste est **serrée** ou **aérée**, et le menu la fait passer de l'une à
l'autre. Ce n'est pas un effet d'affichage : en CommonMark comme chez Pandoc,
une ligne vide entre deux entrées fait passer leur contenu en paragraphe, et
l'espacement s'en ressent à la compilation, en HTML comme en PDF. Aérer, c'est
donc poser cette ligne vide ; serrer, c'est la retirer. Les deux vues disent la
même chose de deux façons — la ligne vide dans la source, le `<p>` dans le
rendu — et `markdown.js` traduit dans les deux sens. La ligne vide qui sépare
deux paragraphes d'une **même** entrée, elle, ne s'en va pas : elle porte du
sens, et les fondre changerait le texte — une entrée à deux paragraphes ne peut
pas se dire serrée.

`turndown` ne sait pas écrire une liste aérée : sa règle ramène toujours une
entrée à une seule fin de ligne, et l'aération se perdait donc au premier
aller-retour. La règle est reprise en entier dans `markdown.js` — préfixe et
indentation compris — pour lui ajouter la ligne vide, et pour vider les lignes
que son indentation remplissait de blancs. Deux espaces en fin de ligne, eux,
restent : c'est un saut de ligne.

Le **retrait** — « Augmenter », « Réduire » — ajoute ou retire **quatre
espaces** en tête des lignes que la sélection touche. C'est la mesure qu'une
entrée de liste demande pour s'imbriquer sous celle qui la précède : dans le
rendu, où il n'y a pas de lignes, les deux commandes changent donc le rang des
entrées que la sélection touche, ce que ces mêmes quatre espaces diront une
fois le Markdown écrit. La première entrée d'une liste ne s'imbrique pas — une
sous-liste est le contenu d'une entrée, et il n'y en a pas au-dessus d'elle.
Devant un paragraphe ordinaire, ces quatre espaces en font un **bloc de code
indenté** : c'est Markdown qui le dit, et la commande écrit ce qu'on lui
demande — d'où son retrait aux seules entrées de liste dans le rendu, qui ne le
montrerait pas comme tel.

**Entrée dans une liste** du rendu ne s'en remet pas au moteur d'édition : dans
une liste aérée il coupait le paragraphe au lieu de créer une entrée, et dans
une liste à cocher la case ne suivait pas. `ui/listedit.js` prend donc la
frappe dès que le curseur est dans une entrée : il la coupe au curseur — ce qui
suit part dans une nouvelle entrée, sous-listes comprises, avec une case
décochée ou un paragraphe si la liste en porte —, et sur une entrée vide il
sort d'un rang : une sous-entrée remonte, une entrée de premier rang devient un
paragraphe entre les deux moitiés de la liste, la numérotée gardant son compte
par `start`. Majuscule+Entrée reste un saut de ligne. Le module tient aussi
`nest` et `unnest`, que le retrait du menu lui emprunte : la frappe et la
commande déplacent une entrée de la même façon.

Le moteur — bornes de la liste sous le curseur, aération, retrait — vit dans
`src/js/lists.js`, sans DOM ni état, comme `find.js`, `anchors.js` et
`keys.js`.

Un **signet** est l'identifiant que porte un titre — `## Titre {#mon-signet}`,
la syntaxe d'attributs de Pandoc, la même que celle d'une image ou d'un tableau.
Il ne se voit pas dans le document : c'est une cible, pas du texte. `marked` n'en
sait rien et laisserait les accolades dans le titre — `liftHeadings` les relève
donc sur l'arbre rendu, et la règle `titre` de `turndown` les réécrit. Elle est
écrite en entier plutôt que de laisser `turndown` faire les dièses : celle de la
bibliothèque ne saurait pas où poser les accolades, qui viennent **après** le
texte du titre. Le relevé se fait sur le **dernier nœud de texte** du titre et
non sur son `textContent` : réécrire celui-ci aplatirait le gras, le code et les
spans qu'un titre peut porter. La syntaxe elle-même n'est lue qu'**une fois** :
`readAttrs`, dans `anchors.js`, sert au rendu comme à la source — deux lectures
finiraient par en avoir deux idées différentes. Des accolades **collées à un
crochet fermant** n'y sont pas lues : `## [texte]{.underline}` est un span qui
termine le titre, non son bloc d'attributs — les confondre retirait le
soulignement du rendu et réécrivait le titre en `\[texte\] {.underline}`.

La commande **« Lien »** écrit toujours `[texte](cible)` : ce qui change d'une
sorte à l'autre, c'est la cible — une **URL**, un **fichier** du disque écrit en
relatif au document comme une image, un **ID** déjà posé, ou un **titre** du
document. Un titre sans signet en reçoit un au passage : un lien vers un titre
qui n'en a pas dépendrait de l'identifiant que l'outil de compilation lui
inventerait, et ceux de Pandoc, de Quarto et de GitHub ne s'accordent pas.
Le moteur — lecture d'une ligne de titre, écriture d'un signet, identifiant tiré
d'un texte, unicité — vit dans `src/js/anchors.js`, sans DOM ni état, comme
`find.js`.

Les deux commandes **lisent ce que le mode montre**, comme la barre de
recherche : le nœud du titre en « Modifier », sa ligne en « Code Markdown ». Ce
n'est pas une commodité — faire correspondre un rang de ligne à un nœud du rendu
se tromperait sur un titre cité ou logé dans une cellule. Le titre visé est
relevé **avant** l'ouverture de la boîte : celle-ci donne le clavier à son
champ, et la sélection du document est alors perdue.

Un clic sur un lien interne du rendu ne part pas dans le navigateur et ne laisse
pas la webview suivre l'ancre — elle ferait défiler la page entière : le clic
porte le regard sur le signet visé, dans la zone d'édition.

Un lien a son **menu contextuel** — « Modifier les propriétés… », « Supprimer
le lien » —, dans « Modifier » comme dans « Code Markdown », et selon la même
règle : le nœud `<a>` sous le pointeur d'un côté, le `[texte](cible)` sous le
curseur de l'autre. Les propriétés rouvrent la boîte du lien sur ce qu'il
porte, sa cible décidant de la sorte cochée ; ce qu'on valide remplace le lien
au lieu d'en ajouter un. Supprimer retire la cible et **garde le texte** : c'est
le lien qu'on défait, pas ce qu'on lit. Dans le rendu, le texte n'est réécrit
que s'il a changé, sans quoi le gras ou le code qu'il porte s'aplatirait.

Les **notes de bas de page** sont celles de Pandoc : l'appel `[^1]` au fil du
texte, la définition `[^1]: …` en fin de document. Attention au piège : une
définition a la forme d'une définition de lien, et `marked` la retirerait du
rendu — la note disparaîtrait du fichier au premier aller-retour. `markdown.js`
la désamorce donc **avant** l'analyse (`expandFootnotes`), en remplaçant l'appel
de tête par la balise qu'il aurait de toute façon ; les appels du texte, eux,
sont relevés après (`liftFootnotes`), faute de quoi `turndown` échapperait leurs
crochets. Dans le rendu, l'appel et le numéro de sa définition portent la même balise,
`<sup class="fn">` ; une définition se reconnaît à sa place — elle **ouvre** son
bloc, suivie de « : ». `ui/footnote.js` en tire trois gestes : le pointeur sur
un appel montre la note dans une bulle, un clic sur l'appel porte le curseur au
début du texte de la note, un clic sur le numéro de la note le ramène juste
après son (premier) appel. La bulle vit dans `document.body`, hors du document,
et copie les nœuds déjà assainis de la note ; la cible d'un saut se signale par
`CSS.highlights` — rien de tout cela n'entre dans ce que `turndown` relit.

`marked` ne connaît pas plus ce span que les attributs d'une image :
`markdown.js` le relit lui-même sur l'arbre rendu (`liftSpans`) et le réécrit à
l'enregistrement — en ne gardant du `style` que les deux couleurs que les
pastilles savent poser, pour qu'une police venue d'un texte collé ne s'installe
pas dans le fichier. Les seuls `<span>` du rendu sont donc les siens et ceux des
shortcodes. Le texte d'un span peut porter sa propre mise en forme —
``[Arrivée (`IE507`)]{.underline}`` — : `marked` en a fait des balises, et le
crochet ouvrant n'est alors plus dans le même nœud de texte que `]{…}`.
`liftSplitSpans` les recoud parmi les enfants d'un même élément, balises
comprises ; la règle de `turndown`, qui écrit le contenu converti et non le
texte, les réécrit sans rien perdre. En sortie HTML, Quarto rend ces attributs ; en PDF, il les ignore.

Légende, taille et alignement d'une image s'écrivent dans la **syntaxe
d'attributs de Pandoc / Quarto** — `![légende](img.svg){fig-align="center"
width=90%}` — et non en HTML : c'est un format que d'autres outils lisent.
`marked` ne la connaît pas, `markdown.js` la relit donc lui-même sur l'arbre
rendu (`liftFigures`) et la réécrit à l'enregistrement. Dans l'aperçu, ces
trois attributs deviennent une `<figure>`.

Une image insérée s'écrit en **lien relatif au document** (`files::link_from`),
pour que le projet reste déplaçable et partageable. L'aperçu, lui, ne peut pas
charger un chemin relatif — il se résoudrait contre l'origine de la webview :
l'image passe donc par le protocole `asset`, dont la portée est ouverte au seul
dossier du projet à son ouverture. La balise porte les deux : `src` pour
l'affichage, `data-src` pour le chemin qui repart dans le fichier. **Ne jamais
laisser `turndown` écrire le `src`** — il y mettrait l'adresse `asset:`, qui ne
veut rien dire hors de cette machine.

Un chemin d'image peut porter des **espaces** — `![…](img/Traitement de la
Sortie.svg)` —, que Pandoc lit et CommonMark non : `marked` laissait toute la
ligne en texte, et `turndown` la réécrivait en crochets échappés à la première
frappe. `expandImagePaths` met donc l'adresse entre chevrons **avant** `marked`,
pour la seule lecture, hors code et hors image à titre. Et comme `marked` encode
l'adresse qu'il rend (`%20`, lettres accentuées), `data-src` en garde la forme
décodée (`filePath`) : c'est le nom du fichier, celui que l'aperçu résout et que
la règle `image` réécrit tel qu'il était.

Un tableau s'écrit en **grille Pandoc** — barres de `+---+`, barre de `=` sous
la ligne de titre, et une ligne `: Légende {tbl-colwidths="[50, 50]"
tbl-align="center" width=80% .bordered .striped}` : c'est la seule forme qui admette plusieurs lignes dans une même
cellule, et d'autres outils la lisent. `marked` ne la connaît pas et `turndown`
ne sait rien des tableaux : `src/js/tables.js` fait les deux traductions —
`expand` remplace la grille par du HTML **avant** `marked`, `toGrid` la réécrit
à l'enregistrement. Ce qu'un fichier porte en plus des trois attributs connus
survit dans `data-attrs`. `tbl-align` et `width` répondent au `fig-align` et au
`width` d'une image — le tableau porte sa place et sa largeur comme une figure
porte les siennes ; l'alignement d'une **colonne**, lui, vit dans les
deux-points de la barre de `=`. Un tableau à barres verticales lu dans un fichier
ressort donc lui aussi en grille, la seule forme que l'application sache écrire.
À la lecture, `marked` le rend de lui-même, mais en `<table>` nu : or l'aspect
et la mise en page d'un tableau dans le rendu tiennent à la classe `tbl`, que la
grille reçoit de `tables.js`. `liftPipeTables` la lui donne, sans quoi il ne se
présentait pas comme un tableau.

La grille écrite dans le fichier est **à l'image de ce que montre
« Modifier »** : une ligne de cellule y est une ligne de la grille, quelle que
soit sa longueur, et une cellule d'une seule ligne se lit d'un seul tenant.
C'est la colonne qui s'élargit — une grille peut donc être large, et c'est le
prix de cette correspondance. Aucun budget de largeur ne vient la rogner : le
texte s'y enroulerait, et la source ne dirait plus ce qu'on a sous les yeux.
Les bords, eux, tombent toujours aux mêmes colonnes, la cellule étant complétée
d'espaces jusqu'à sa barre.

Un saut de ligne dans une cellule se dit donc par une **barre oblique
inverse** en fin de ligne, et non par les deux espaces qu'écrit `turndown` :
ce remplissage les avale, si bien qu'ils ne se distinguent plus de lui — ni
pour Pandoc, ni pour la relecture, qui rogne chaque ligne. `breaks`, dans
`tables.js`, fait la traduction à l'écriture ; `marked` connaît la barre
d'elle-même. Dans un bloc de code, elle ne se pose pas : elle y paraîtrait
telle quelle. Et un retour à la ligne nu, qu'un fichier venu d'ailleurs peut
porter, reste ce que Pandoc en fait : une **espace**, non un saut.

L'alignement d'une colonne se pose sur l'attribut `align` de chaque cellule, et
la cellule ne le transmet à ce qu'elle contient que par **héritage** — or un
héritage cède devant la moindre déclaration. La justification du texte courant
s'arrête donc au bord d'une cellule (`app.css`), sans quoi une cellule au
contenu en blocs — un titre en gras, que `marked` enveloppe dans un `<p>` —
resterait à gauche dans une colonne centrée.

**Copier un tableau** met deux formes dans le presse-papiers : la grille en
texte — celle même qui part dans le fichier, donc exacte — et le tableau en
HTML, que « Modifier » et les traitements de texte recollent en tableau plutôt
qu'en lignes de barres et de tirets. Les images de la forme HTML repartent avec
leur chemin relatif, `data-src` recopié dans `src` : sans cela le collage
emporterait l'adresse `asset:`, qui ne veut rien dire ailleurs. **Supprimer une
ligne ou une colonne** ne touche jamais la dernière — un tableau sans rangée ne
s'écrit pas en grille, et c'est « Supprimer le tableau » qu'on veut alors ; les
deux commandes s'effacent du menu quand il n'en reste qu'une. C'est la rangée
visée qui part, et elle seule : la première du corps ne monte pas prendre la
place d'une ligne de titre retirée — un titre ne se décide pas par accident, et
une grille qui n'en a plus se relit, sa barre du haut portant alors
l'alignement que portait celle de « = ». Le `<thead>` vidé s'en va avec sa
dernière rangée, sans quoi sa barre de « = » se poserait sur rien ; il peut en
porter plusieurs, puisque c'est le fichier qui décide du rang de cette barre.
La largeur d'une colonne retirée revient aux autres au prorata, l'exact inverse
de l'insertion.

Le **bloc YAML** en tête du document — `title`, `subtitle`, `photo`,
`abstract-title`, `toc-depth` — ne vit que dans la source : il n'entre jamais
dans le rendu, `markdown.js` le retirant avant `marked`, dont le `---` de
fermeture se lirait sinon comme un soulignement de titre. `turndown` ne le voit
donc pas non plus : `editor.js` le repose devant ce qu'il produit, sans quoi la
première frappe en « Modifier » effacerait le bloc. `src/js/frontmatter.js` le
lit et le réécrit ; comme pour les shortcodes, ce n'est pas un analyseur YAML —
une passe sur les lignes de premier niveau — et ce qu'un fichier porte en plus
des cinq clés connues, ordre compris, survit intact. Le bloc n'a de sens qu'au
tout début du fichier : il s'y écrit toujours, quel que soit le point
d'insertion.

Les deux moitiés du sélecteur du volet droit ne portent que leur
**pictogramme**, comme le poussoir « Focus » : le volet est étroit, et le mot
n'y apprend rien que l'infobulle ne dise mieux ; le nom reste dans l'`aria-
label`. « Propriétés » reprend le pictogramme des réglages, le même que
l'entrée « Propriétés du document » du menu contextuel — c'est la même chose,
elle doit se reconnaître d'un endroit à l'autre. Les icônes sont posées par
`ui/aside.js` et non écrites dans `index.html` : le balisage ne dessine pas, et
`PATH` est le seul endroit qui tienne les tracés. Le sélecteur ne s'étire plus
sur la tête du volet : il garde sa largeur et se cale à droite, et la gauche
porte en toutes lettres l'intitulé du contenu affiché — « Sommaire » ou
« Propriétés » —, que `ui/aside.js` écrit d'après l'état.

Ses cinq champs vivent dans le **volet droit**, qui porte donc deux contenus —
le sommaire et eux — que le sélecteur de sa tête relaie (`ui/aside.js`, et
`state.edition.aside`). Aucun des deux ne connaît l'autre : chacun se retire
quand l'état ne le désigne pas, et le sélecteur n'appartient qu'au volet. Il
n'y a rien à valider dans ces champs : celui qu'on quitte écrit dans la source,
comme les propriétés d'une image — mais seulement si sa valeur a bougé, sans
quoi une simple visite marquerait le document modifié.

Une **barre d'état** court en pied de fenêtre, sous les deux volets comme sous
le document : ce qu'elle dit vaut du fichier entier et non d'un volet. Ce qui
parle du document est calé **à droite**, loin des volets, là où le regard ne va
que lorsqu'il la cherche — la sorte du document, et la position du curseur.
Celle-ci ne se dit qu'en « Code Markdown » : c'est la seule vue qui ait des
lignes, et un rang compté dans le rendu ne désignerait rien de ce que le
fichier porte. À **gauche** se tient la **version de l'application**, seule
chose de la barre qui ne parle pas du fichier : elle ne bouge jamais, et de ce
côté-là elle ne déplace rien. Elle vient de Tauri (`api.appVersion`, soit
`version` de `tauri.conf.json`) et non d'une constante du frontend — c'est la
même que le paquet Windows et la release du tag, et rien n'est à tenir à jour
à deux endroits. La barre ne paraît qu'en « Édition », mais elle **y reste
sans document ouvert** : ce qui la faisait autrefois se retirer, c'est qu'elle
n'apprenait alors rien — la version y étant toujours, ce n'est plus le cas.
Les deux nombres ne passent **pas**
par l'état : ils changent à chaque flèche du clavier, et les faire transiter
par `store.emit` redessinerait tout le document pour deux chiffres —
`ui/status.js` les écrit donc lui-même, sur les événements de la zone de
saisie. Ils se disent en chiffres de même chasse, sans quoi « Ligne 9 » et
« Ligne 10 » n'ayant pas la même largeur, toute la barre — calée à droite —
tressaillirait à chaque frappe.

Les boîtes du navigateur — `alert`, `confirm`, `prompt` — **ne paraissent pas**
dans cette webview : l'appel rend aussitôt `false` ou `null` sans que rien ne
s'affiche, si bien que la commande se trouve annulée en silence et que
l'application semble sourde. Une question fermée passe donc par `api.ask`, la
boîte du système que sert le greffon de dialogue — le même qui ouvre déjà les
sélecteurs de fichiers, à quoi s'ajoute la permission `dialog:allow-ask`. Une
ligne à saisir passe par `ui/prompt.js`, notre propre boîte : le greffon ne sait
poser que des questions fermées. Elle rend une **promesse** plutôt qu'un
rappel, pour que l'appelant s'écrive dans l'ordre où il se lit ; et ce qui
l'ouvre depuis le document doit faire son `flush` **avant**, la boîte prenant le
clavier. Ne jamais revenir aux boîtes du navigateur.

Une commande qui touche au disque **dit qu'elle a abouti** : renommer, dupliquer
et supprimer posent chacune leur message. Sans cela, une suppression réussie ne
se distinguait pas d'une suppression annulée — l'arbre change, mais on n'a pas
forcément le fichier sous les yeux.

**Créer** un document ou un dossier se fait par trois portes qui donnent sur
les mêmes deux entrées (`fileops.newEntries`) : le bouton « + » de la tête du
volet et le clic droit sur son fond, qui visent la **racine**, et le menu d'un
dossier de l'arbre, qui vise **ce** dossier. Un document neuf est vide, prend
l'extension `.md` si le nom n'en porte pas, et s'ouvre dans un onglet : on
vient d'y écrire, pas de le regarder dans l'arbre. Le dossier qui le reçoit se
déplie, sans quoi il n'y paraîtrait pas. Un nom déjà pris est refusé plutôt
qu'écrasé, comme pour un renommage ; c'est un nom et non un chemin, et
`files::create_file` comme `files::create_dir` passent par `files::resolve`.

Un fichier du projet porte quatre commandes — **« Renommer », « Copier le
nom », « Dupliquer », « Supprimer »** — et deux portes : le menu de son onglet,
celui de sa ligne dans l'arbre. C'est le même fichier des deux côtés, donc les
mêmes commandes : elles vivent dans `ui/fileops.js`, que les deux menus
reprennent telle quelle. Le module est une **feuille** — il ne connaît ni
l'éditeur ni l'arbre —, et c'est pourquoi le `flush` lui arrive par son
appelant plutôt que par un `import` : l'éditeur le charge, il ne peut donc pas
le charger en retour. Renommer en a besoin — l'onglet est désigné par son
chemin, le changer refait l'affichage, et ce qui n'est encore que dans le rendu
s'en irait avec l'ancien nom. Le message de « Dupliquer » nomme la
copie et pas seulement le geste : elle prend sa place dans l'ordre
alphabétique de l'arbre, parfois loin de l'original, et son nom est ce qu'il
faut pour la retrouver.

`src-tauri/src/files.rs` est le **seul** endroit qui touche au disque de
l'utilisateur — hors la destination d'une compilation, où `pandoc.rs` ouvre le
dossier de la page et `resources.rs` copie les ressources. Le frontend n'y envoie que des chemins relatifs à la racine du
projet, et `files::resolve` refuse tout ce qui en sortirait — composant `..`
comme lien symbolique. Ne pas contourner cette fonction.

La boîte des **paramètres du projet** tient sur **trois colonnes**, quatre
sujets — **01 Affichage** (justification, interligne, contour), **02 Mise en
page** (les espacements), **03 Pandoc** (la compilation), et **04 Gestion des
modèles** (d'où `conf/` tient ses fichiers), rangé **sous « 02 »** : une
quatrième colonne resserrait tout, à commencer par Pandoc et ses lignes de
commande. Les deux groupes de la colonne du milieu sont une **pile**
(`.settings__stack`) et non deux cases de la grille — les rangées d'une grille
s'alignent sur la plus haute, et « 04 » décollerait de « 02 » dès qu'une autre
colonne serait plus longue qu'elle. Le tout à la manière des
sections d'une revue : un filet épais au-dessus, un numéro à l'accent, un titre
et une phrase qui dit de quoi il s'agit, puis les champs. Pas de cartes : le
modèle est fait d'aplats et de traits. « Affichage » porte aussi le **retour à la
ligne dans le code Markdown** (`wrapSource`, actif par défaut) : retiré, une
ligne longue défile à l'horizontale. Il passe par `--source-wrap`, lue par la
règle qui tient ensemble la zone de saisie et le calque de la recherche — le
repli est de ce qui doit se déclarer une seule fois pour les deux —, et le
calque reprend alors aussi la hauteur utile de la zone, que la barre
horizontale réduit.

Elle porte enfin les **ascenseurs** (`showScrollbars`, affichés par défaut) —
ceux des deux volets et des deux surfaces d'édition, qui se retirent ensemble.
Le contenu défile toujours, molette, clavier et sélection compris : seul le
rail cesse de se dessiner, et la place qu'il prenait revient au texte. C'est le
seul réglage du projet qui passe par un **attribut** de la racine
(`data-scrollbars="hidden"`, comme `data-theme` et `data-focus`) et non par une
variable CSS : il faut deux déclarations dans deux syntaxes — `scrollbar-width`,
la propriété standard que WebKitGTK n'a apprise que tard, et
`::-webkit-scrollbar`, qui couvre la webview de Linux comme celle de Windows —,
et une même valeur ne saurait servir les deux. Les volets y sont désignés sous
`#body-edition` : la même classe porte le volet des fils de « Veille », qui ne
se règle pas par projet.

Sous 1100 px, Pandoc passe sous les deux
autres, sur toute la largeur ; sous 720 px, tout s'empile — mieux vaut défiler
que serrer les champs à l'illisible. Les réglages s'enregistrent d'eux-mêmes :
le pied de la boîte le dit, et son bouton ne fait que fermer. Sous le titre, le
chemin du projet dit lequel on est en train de régler. Les espacements
s'affichent en vrai tableau — un filet par rangée, le champ fondu dans sa
cellule, une mesure réglée à l'accent contre la valeur du modèle grisée.

La colonne **« Pandoc »** est la plus large — elle porte des lignes de
commande. Son groupe
**« Compilation HTML »** porte le répertoire de destination et le **modèle de
commande**, écrit une fois pour tout le projet avec des variables à la place de
ce qui change d'un document à l'autre : `pandoc {fichier} … -o {sortie}`, où
`{fichier}` est le document relatif à la racine du projet et `{sortie}` la
destination suivie du même chemin en `.html`. Ces réglages sont **propres au
projet**, comme la mise en page : la commande nomme ses fichiers — filtre,
modèle, bibliothèque. Le groupe **« Compilation PDF »**, en dessous, porte les
deux mêmes champs pour le PDF (`pandoc {fichier} --defaults=conf/defaults-single.yaml
-o {sortie}`) : mêmes variables, une seule légende sous les deux groupes, et
`{sortie}` n'y change que d'extension. Le groupe **« Compilation Word »** fait
de même pour le `.docx` (`pandoc {fichier} --defaults=conf/defaults-docx.yaml
--resource-path={dossier} -o {sortie}`) : `--resource-path` y compte, Pandoc
lancé depuis la racine devant trouver les images, écrites en relatif au
document, pour les embarquer. La **page d'accueil** — `index.md`, à la
racine du projet seulement — a son propre modèle HTML
(`pandoc index.md … --template=conf/modele-accueil.template.html …`) : elle ne
se bâtit pas sur le gabarit des chapitres.

**Un champ vide vaut le défaut de ce champ**, et non celui du voisin : l'accueil
laissé vide prend le gabarit d'accueil, non le modèle des chapitres. Et ces
défauts nomment les fichiers de `conf/` — filtre, modèles, bibliothèque,
configurations —, la disposition que `projetExemple` porte : un projet neuf
compile donc complètement sans qu'on ait rien réglé, là où un Pandoc nu rendait
une page sans gabarit ni table des matières. Un projet bâti autrement écrit ses
propres commandes ; c'est à quoi les champs servent.

Ces fichiers de `conf/` — filtre, gabarits, préambules, bibliothèque,
configurations — viennent d'un **modèle**, et le groupe « 04 Gestion des
modèles » dit lequel. Un modèle est un dossier de `confModele/`, à la racine du
projet : `confModele/liseuse`, `confModele/DSFR-Douanes`… Les modèles vivent
**dans le projet** et non dans l'application, comme les fichiers qu'ils
portent — un projet copié sur une autre machine emporte ainsi les siens, la
même raison qui fait vivre le nom d'un projet dans son témoin. L'appliquer,
c'est **recouvrir** `conf/` : les fichiers du modèle y sont copiés au même
chemin, par-dessus ceux de même nom, et ce que `conf/` porte en plus y reste —
rien n'est effacé, et un modèle se réapplique donc sans perdre ce qu'on y avait
ajouté. Un fichier déjà identique est recopié **quand même**, à la différence
des ressources d'une compilation : appliquer un modèle, c'est demander que
`conf/` redevienne ce que le modèle dit, y compris sur un fichier modifié
depuis. La base ne retient que le **nom** du modèle (`modele`, dans
`project_settings`, une clé nue comme `align`), non ses fichiers : de quoi dire
lequel est en vigueur et le réappliquer, et la ligne s'en va quand il n'y en a
pas. À la **création d'un projet**, l'application pose d'abord dans le dossier les
modèles qu'elle **porte elle-même** — `confModele/` est une ressource du paquet
(`bundle.resources` de `tauri.conf.json`, prise dans `projetExemple/confModele`)
—, puis applique `liseuse` à `conf/`. Un projet neuf a ainsi de quoi compiler et
de quoi changer d'habillage sans rien aller chercher, fût-il le premier de la
machine. Deux garde-fous, parce qu'un projet se pose sur un dossier qui existe
déjà : un modèle dont le dossier est **déjà là** n'est pas recouvert — les
modèles du projet sont à lui —, et un `conf/` qui porte **déjà quelque chose**
est laissé intact : le dossier adopté peut être un projet réglé de longue date,
et poser le modèle par défaut dessus remplacerait son filtre et ses gabarits
sans rien demander. Le modèle s'applique alors à la main, depuis la boîte, qui
prévient. Rien de tout cela ne peut faire échouer une création : ressources
absentes ou `conf/` garni, le projet se crée. Côté Rust, `src-tauri/src/modeles.rs` ; l'interface ne
désigne qu'un **nom**, jamais un chemin, et `files::resolve` garde la règle
comme partout ailleurs. La liste des modèles se relit sur le disque à chaque
ouverture de la boîte, et non en base : c'est le dossier qui décide, et un
modèle posé à la main doit y paraître sans que rien ait à être tenu à jour.

Le choix du modèle se fait en un seul endroit, `pandoc::template_for`, que
l'aperçu emprunte comme la compilation — il reçoit pour cela tous les champs à
l'écran. Côté Rust c'est `ProjectSettings.pandoc`,
les lignes `pandoc.htmlDest`, `pandoc.htmlCommand`, `pandoc.htmlIndexCommand`,
`pandoc.pdfDest`, `pandoc.pdfCommand`, `pandoc.docxDest` et `pandoc.docxCommand`
de `project_settings` — toutes sous le préfixe `pandoc.`, retirées ensemble
avant d'être réécrites —, rangées sur une seule ligne et
retirées de la base quand on les vide. À la **création d'un projet**, les quatre modèles de
commande — HTML, accueil, PDF, Word — sont **écrits** dans leurs champs
(`pandoc::fill_commands`). Ils valaient déjà par défaut ; écrits, ils se voient
dans la boîte et se modifient sans avoir à les retrouver, et ce qui partira se
lit sans ouvrir l'aperçu. Un champ déjà rempli n'est pas remplacé — la base
garde les réglages d'un projet retiré de la liste —, et les destinations
restent vides : personne ne peut les deviner. Les champs
s'enregistrent **peu après la frappe** et à la fermeture de la boîte, non au
seul `change` : fermer la boîte par sa croix ou Échap pendant qu'on tape ne le
déclenche pas, et la commande saisie se perdait — la compilation prenait alors
la commande par défaut, sans filtre ni modèle.

**« Compiler en HTML »**, **« Compiler en PDF »** et **« Compiler en Word »**
sont trois commandes du fichier, qui ne diffèrent que par le format (`pandoc::Format`) : modèle et
destination lus, modèle par défaut, extension de `{sortie}`. Elles vivent dans
`ui/fileops.js`, donc dans le menu de l'onglet comme dans celui de la ligne de
l'arbre, éteintes hors Markdown. Tout se joue dans `src-tauri/src/pandoc.rs`, en
trois règles :

- **Le modèle est lu en base par Rust**, jamais reçu du frontend : l'interface
  ne désigne que le document et le format (`compile_document(path, format)`, résolu par
  `files::resolve`). Et son premier mot doit nommer `pandoc`, seul ou par son
  chemin. La commande ne devient donc pas une porte ouverte sur n'importe quel
  exécutable depuis une webview qui expose `__TAURI__`.
- **Il est découpé en arguments avant que les variables ne soient remplacées**,
  et lancé **sans shell**, depuis la racine du projet : un chemin à espaces
  reste un seul argument, et rien de ce qu'un nom de fichier contient ne
  s'interprète. Des guillemets regroupent, sans échappement.
- **Une seule lecture du modèle.** L'aperçu des paramètres appelle
  `pandoc_preview` au lieu de refaire le calcul en JavaScript : il ne peut
  pas montrer autre chose que ce qui partira. `src/js/pandoc.js` ne tient plus
  que la légende des variables, dont les noms doivent rester ceux de
  `Vars::value`. Un modèle vide vaut `DEFAULT_HTML_COMMAND`,
  `DEFAULT_HTML_INDEX_COMMAND` pour l'accueil, `DEFAULT_PDF_COMMAND` ou
  `DEFAULT_DOCX_COMMAND`, côté Rust : c'est `default_command`, qui reçoit le
  document autant que le format, qui les départage.

Un cadre posé au pointeur — les menus contextuels, la bulle d'une note — est
**mesuré au large avant d'être calé** : `place`, dans `ui/menu.js`, le pose au
coin haut-gauche, relève sa taille, puis le ramène dans la fenêtre. La largeur
d'un élément en `position: fixed` se calcule sur la place qui lui reste à droite
de son bord gauche : posé d'abord au pointeur, près du bord droit, il replie ses
colonnes et coupe ses intitulés, et la mesure prise sur ce repli est justement
assez étroite pour l'y maintenir au recalage — le menu reste désorganisé, plus
haut que large, et ce qui déborde par le bas devient hors d'atteinte. Les trois
cadres qui se posent ainsi passent par la même fonction plutôt que d'en recopier
le calcul.

Le **menu de l'application** — le bouton « hamburger » en tête de la barre
du haut, F10 — porte ce qui vaut pour le projet ou l'application entière :
**« Compiler le projet en HTML »**, **« … en PDF »**, **« … en Word »**,
« Paramètres du projet », « Quitter »
(Ctrl+Q). Il vit dans `ui/appmenu.js` et reprend le cadre de `ui/menu.js`, posé
sous le bouton. La compilation du projet prend les documents que
**`conf/bibliotheque.yaml`** nomme — et non tous les `.md` du dossier, qui en
porte des milliers : chaque clé qui finit par `href` (`href`, `messages-href`)
désigne une page, dont le document est le même chemin en `.md`. Ils partent
dans l'ordre du fichier, celui des lots, **sauf `index.md` à la racine** — la
page d'accueil, qui a son propre modèle. `src-tauri/src/library.rs` fait la
lecture, une passe sur les lignes comme `resources.rs` ; un document nommé mais
absent est signalé au journal sans arrêter la série. Les documents se
compilent un par un comme ceux d'un dossier : la série est la même,
`compileSeries` dans `ui/fileops.js`. « Paramètres du projet » presse le bouton
du volet, comme un raccourci de la barre. **« Compiler un book (PDF) »** ne
compile pas une série mais **un seul PDF** pour tout le projet, parties et
chapitres compris : Pandoc ne connaissant ni `\part` ni `\chapter`, c'est un
script du projet qui assemble les documents — `conf/generate_book.py` sur
`conf/book_structure.yaml`, avec `conf/defaults-book.yaml` — et n'appelle Pandoc
qu'une fois. Ces trois chemins sont **fixes**, et il n'y a donc pas de modèle de
commande à régler : seuls le répertoire de destination et le nom du PDF viennent
des paramètres du projet (`pandoc.bookDest`, `pandoc.bookFile` — un nom, non un
chemin). Le programme lancé n'en est pas plus ouvert qu'ailleurs : `python3`, ce
script-là, et rien d'autre ; script et structure passent par `files::resolve`.
Côté Rust, `pandoc::plan_book` et la commande `compile_book`, qui rendent tous
deux au journal ce que le script et Pandoc écrivent. « Quitter » pose une seule question
pour les documents modifiés, puis passe par Rust (`quit_app`).

Le même menu ouvre la **liseuse** — un serveur local sur les pages compilées du
projet, et le navigateur dessus. Pourquoi un serveur : ouvertes en `file://`,
les pages sont autant d'origines distinctes pour le navigateur, qui **oublie**
d'une page à l'autre les réglages du lecteur — thème, taille du texte ; servies
en `http://127.0.0.1`, elles n'en font qu'une, et ces réglages tiennent. Ce
n'est pas l'application qui sert : c'est un **script du projet**, à sa racine —
`Ouvrir-la-liseuse.bat` sous Windows, `ouvrir-la-liseuse.sh` ailleurs, l'un le
pendant de l'autre. Le script se double-clique aussi hors de l'application,
c'est sa raison d'être ; l'application ne fait que le lancer, en lui passant
**ce qu'il doit servir** : le répertoire de la compilation HTML
(`pandoc.htmlDest`) et le port, en arguments — le script n'a donc rien à
deviner, et la liseuse montre exactement ce que la compilation vient d'écrire.
Les règles sont celles du book : programme fixe (`cmd` ou `bash`, ce script-là
et rien d'autre), chemin passé par `files::resolve`, aucun shell.

L'application **tient ce serveur** : l'entrée du menu bascule — « Ouvrir la
liseuse », « Arrêter la liseuse » —, changer de projet l'arrête, et quitter
aussi, par `RunEvent::Exit` plutôt que par `quit_app` : la croix de la fenêtre
ne passe pas par « Quitter ». C'est pourquoi le script Unix **remplace** son
shell par le serveur (`exec`) : le processus tenu *est* le serveur, et
l'arrêter l'arrête vraiment — sans quoi Python resterait derrière, le port
pris. Sous Windows, où `exec` n'existe pas, `cmd` reste le parent de Python :
c'est l'arbre entier qu'on arrête (`taskkill /T`). L'entrée dit ce que le
prochain clic fera, et cela ne se devine pas — un serveur a pu s'arrêter tout
seul, le port étant pris ou Python absent : `ui/appmenu.js` le demande à Rust
avant de poser le menu, seul lui tenant le processus. Ce que le serveur écrit —
une ligne par requête — ne va nulle part : le journal est celui des
compilations.

Un **dossier** de l'arbre a aussi son menu — en HTML, en PDF ou en Word —, qui compile **un par un** les
documents Markdown qu'il contient — lui seul, sans ses sous-dossiers : ce qu'on
voit sous lui en le dépliant (`files::markdown_in`, dans l'ordre de l'arbre).
Les ressources ne sont copiées qu'au premier document (`compile_document` reçoit
`resources: false` pour les suivants) : tous visent la même destination. Un
échec n'arrête pas la série ; le journal dit lequel et pourquoi, le toast fait
le compte. Les documents ouverts et modifiés font l'objet d'une seule question
pour toute la série.

Avant Pandoc, et **en HTML seulement**, les **ressources** que liste `conf/resources.yaml` partent vers le
répertoire de destination, au même chemin — une page compilée pointe vers ses
images et ses PDF en relatif, ils doivent donc l'y attendre. Un PDF ou un document Word embarque ses images,
que Pandoc lit dans le projet : rien n'est copié. Deux formes
d'entrée : un motif (`resources/pdf/*.*`) prend les fichiers du dossier **sans**
ses sous-dossiers, un chemin (`filesLOT04/img`) prend le dossier entier.
**Seule la liste** est copiée : le commentaire du fichier parle de dossiers
copiés d'office par un autre outil, l'application ne les ajoute pas — `conf/`
n'a rien à faire dans `htdocs`. `src-tauri/src/resources.rs` fait une passe sur
les lignes, non une analyse YAML ; chaque source passe par `files::resolve`, les
liens symboliques ne sont pas suivis, et un fichier déjà à jour — même taille,
copie pas plus ancienne — n'est pas recopié. Une ressource manquante ou une
copie en échec n'arrête pas la compilation : elle figure dans les
avertissements du message, avec le compte des fichiers copiés et à jour.

Pandoc lit le fichier **sur le disque** : un document modifié propose d'être
enregistré avant de compiler, plutôt que de l'être d'office ou de compiler une
version qu'on n'a plus sous les yeux. Le dossier de la page produite est créé
s'il manque — c'est la seule écriture de `pandoc.rs` hors de `files.rs`, la
page elle-même étant l'œuvre de Pandoc. Pandoc tourne dans `spawn_blocking`.

Un **journal de compilation** s'ouvre en bas de l'écran, au-dessus de la barre
d'état, quand la compilation part : Rust lui envoie ses lignes à mesure par
l'événement `compile:log` — une par entrée de ressources, la commande lancée,
puis ce que Pandoc écrit, **au fil de l'eau** (sa sortie d'erreur est lue ligne
à ligne, sa sortie ordinaire dans un fil à part, faute de quoi Pandoc
bloquerait sur un tampon plein). Un échec y part aussi, d'où qu'il vienne. Le
journal reste ouvert à la fin, pour qu'on lise ce que Pandoc a dit, et se
referme à la main ; le **toast** ne dit que l'issue et y renvoie. Pendant qu'elle
tourne, la compilation **se voit** par trois repères : l'état de la tête du
journal, en accent, qui compte les documents et les secondes ; une barre
d'avancement sur son bord haut — la part faite d'une série (`journal.progress`),
un trait qui va et vient pour un document seul ; et une **pastille** dans la
tête de la barre du haut, qui tourne et compte, visible journal fermé comme
devant « Veille » — un clic rouvre le journal. Elle ne dit que le compte : la
tête de barre a la largeur du volet des fichiers, l'infobulle dit le reste. Comme la
barre d'état, `ui/journal.js` écrit ses lignes lui-même, sans `store.emit` :
elles arrivent par dizaines pendant une copie. Une seule compilation à la
fois. Sa hauteur se règle par une **poignée couchée sur son bord haut** — ou les
flèches haut et bas —, sur le modèle de celles des volets : elle vit dans
`--journal-height`, sur la racine, et part au lâcher dans les réglages de
l'application (`journalHeight`, `0` pour « jamais redimensionné »), bornée
entre 90 px et 70 % de la fenêtre.

Le groupe **« Mise en page »** des paramètres du projet règle l'espace
au-dessus et au-dessous de chaque sorte de bloc : les six niveaux de titre
séparément, le paragraphe, les listes à puces et numérotées, le bloc de code,
le shortcode, l'image, le tableau. Les mesures sont en **pixels à 100 % de zoom** — des
entiers, comme l'interligne, lisibles tels quels dans la table clé/valeur — et
passent par `--doc-px` pour suivre le zoom du document comme le fait le texte.

Entre deux blocs, l'écart est la **somme** de l'« après » du premier et de
l'« avant » du second, comme dans un traitement de texte — et non la plus
grande des deux, ce que donnerait CSS livré à lui-même : deux marges verticales
qui se touchent y fusionnent, et un réglage plus petit que celui du voisin ne
changeait alors rien à l'écran. Chaque bloc ne porte donc qu'une **marge
haute**, où il ajoute à son « avant » l'« après » du bloc qui le précède, que
celui-ci lui passe par `--doc-prev-after` (`X + *`). Les valeurs par défaut sont
calées sur cette règle pour redonner l'aspect du modèle : 8 avant un titre et
16 après un paragraphe font les 24 d'autrefois.

Une seule table les nomme : `SPACING`, dans `ui/project.js`. Elle porte
l'intitulé, la racine de la clé et les deux valeurs par défaut ; les champs de
la boîte, les clés qui partent en base et les variables
`--doc-space-<bloc>-<bord>` s'en déduisent. La feuille de style **ne déclare
aucune de ces mesures** : elle ne fait que les consommer, sans quoi les valeurs
par défaut vivraient en deux endroits et l'un des deux finirait par mentir. Les
lignes de la grille ne sont donc pas non plus dans `index.html` — un
`<div>` vide y attend, et `ui/project.js` le remplit. En ajouter une ne demande
qu'une ligne dans la table et une règle dans `app.css`.

Les variables se posent **quelle que soit l'application à l'écran**, avant toute
autre condition du rendu : une variable absente ne vaut pas la mesure du modèle,
elle vaut zéro — lier leur pose à « Édition » ferait qu'un chemin rendant la
main plus tôt priverait le document de toutes ses mesures d'un coup.

Côté Rust, c'est une **table dans la table** : `ProjectSettings.spacing`, une
ligne par valeur sous le préfixe `space.` de `project_settings`. Le vocabulaire
n'y est pas — Rust ne vérifie que la forme, un nom alphanumérique et une valeur
bornée, de sorte qu'un espacement de plus ne demande ni champ, ni colonne, ni
migration. Un réglage **rendu à sa valeur par défaut quitte la base** : les
lignes `space.%` sont effacées avant d'être réécrites, faute de quoi la ligne
resterait à couvrir la feuille de style — le réglage serait revenu dans la
boîte, mais pas dans le document. Un champ vide dans la grille, c'est cela : la
clé s'en va, et non un zéro qui serait un espacement nul.

Les **raccourcis clavier** vivent tous dans une table, `src/js/keys.js`, sans
DOM ni état — comme `find.js` et `anchors.js`. Elle donne pour chacun sa
combinaison, son intitulé et sa portée ; `ui/keys.js` s'en sert pour agir, les
menus pour l'écrire à droite de l'intitulé, les infobulles de la barre du haut
pour l'annoncer. Un raccourci qui ne serait écrit qu'à un seul de ces trois
endroits finirait par mentir aux deux autres — c'est la raison d'être de la
table, et pourquoi ni `index.html` ni les modules ne nomment une frappe.

Il n'y a **qu'un écouteur**, posé sur le document. Les boîtes gardent seulement
leurs touches propres — Échap pour se fermer, Entrée pour valider — et la
tabulation reste à `table.js` et `code.js`, où elle ne veut pas dire la même
chose qu'ailleurs. Une frappe déjà traitée (`defaultPrevented`) n'est pas reprise,
et tant qu'une boîte est à l'écran le clavier lui appartient.

Trois frappes de la table ne sont pas à nous : Ctrl+X, Ctrl+C et Ctrl+V, que le
moteur d'édition traite déjà mieux — un collage ne se déclenche de toute façon
pas par script. Elles y figurent quand même, marquées `native`, pour que les
menus les annoncent : les nommer ailleurs ferait mentir la table. `ui/keys.js`
s'efface devant elles ; ce qu'elles emportent reste à `ui/clipboard.js`.

**Un raccourci de la barre du haut presse son bouton** au lieu d'appeler la
fonction qu'il déclenche : la touche et le clic font ainsi exactement la même
chose, état éteint compris — un bouton désactivé ne reçoit pas de clic, donc le
raccourci n'agit pas, et il n'y a pas deux conditions à tenir d'accord. Les
commandes du document, elles, passent par `format.command`, la même porte que les
entrées du menu.

Trois choses ont décidé du choix des touches :

- **Les chiffres se lisent sur `code`, les lettres sur `key`.** Sur un AZERTY, la
  rangée des chiffres demande la majuscule : « Ctrl+1 » y arrive avec `key`
  valant « & », d'où `code` — `Digit1`, indépendant de la disposition. Pour une
  lettre c'est l'inverse : `code` nomme la place de la touche sur un clavier
  américain, où le « A » d'un AZERTY se présente comme `KeyQ`.
- **La majuscule ne compte pas pour le zoom** : sur un clavier français, « + » ne
  s'obtient qu'avec elle. Ctrl et l'une des quatre touches — `+`, `=`, celle du
  pavé numérique — valent le même cran.
- **La famille de l'insertion est en Alt**, non en Ctrl+Alt : sous Windows,
  Ctrl+Alt *est* AltGr, dont un clavier français a besoin pour @ et #. Une frappe
  où AltGr est enfoncée ne déclenche donc rien.

On passe d'un onglet à l'autre par **Ctrl+Tab** et Ctrl+Maj+Tab, en bouclant, et
non par la tabulation seule : elle indente déjà un bloc de code et fait passer
de cellule en cellule dans un tableau, et le changement d'onglet doit marcher en
pleine frappe. Il suit le chemin d'un clic sur l'onglet — `flush` d'abord.

Ni Ctrl+Maj+I, ni Ctrl+Maj+J, ni Ctrl+Maj+C : ce sont les outils de développement
de la webview. Ils ne répondent pas dans un paquet de distribution, mais ils
répondent sous `cargo tauri dev`, et un raccourci qui ne marche que chez
l'utilisateur ne se laisse pas essayer.

Les **thèmes** (clair, sombre, gris foncé) ne sont qu'un autre jeu de jetons :
`ui/theme.js` pose `data-theme` sur la racine et `tokens.css` redéfinit les
couleurs. Aucune vue n'a à connaître le thème — et rien dans `app.css` ne porte
de couleur en dur, ce qui est la condition pour que cela tienne. Le choix vit
dans les réglages, donc dans SQLite ; il est aussi noté dans `localStorage`,
pour que la fenêtre s'ouvre déjà dans le bon thème sans attendre le premier
aller-retour avec Rust.

`src/styles/tokens.css` est **extrait de la maquette** : c'est le système de
design (jetons + classes `.btn`, `.input`, `.tag`, `.seg`, `.field`…). Le
modifier change l'aspect de toute l'application. `src/styles/app.css` n'ajoute
que la mise en page propre au tableau de bord.

## Conventions

- **Langue** : interface, commentaires et messages d'erreur en français.
  Les identifiants de code restent en anglais quand c'est l'usage (`feed_id`).
- Serde sérialise en **camelCase** vers le frontend (`feedId`, `lastSync`) ;
  les colonnes SQL restent en `snake_case`.
- Une commande Tauri est **mince** : validation, appel à `db`/`fetch`, retour
  d'un type de `models.rs`. La logique vit dans `db.rs` et `fetch.rs`.
- Toute mutation côté frontend passe par une action de `store.js`, qui
  recharge via `refresh()` et notifie les vues. Les vues ne s'appellent pas
  entre elles.
- Le DOM se construit avec `el()` de `ui/dom.js`, jamais par concaténation de
  chaînes HTML.

## Commandes

```bash
cargo tauri dev                  # lancement en développement
cargo tauri build                # paquet de distribution
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

## État d'avancement

Fait : projets — boîte de choix au lancement, création sur un dossier
existant, liste des projets connus, retrait de la liste ; schéma SQLite et
migrations, collecte RSS/Atom avec cache conditionnel,
détection automatique de flux, import/export OPML, recherche plein texte,
filtres, favoris, volet de lecture, rafraîchissement périodique, vignettes
illustrées par la photo du flux, première page complète conforme au modèle,
réordonnancement des fils par glisser-déposer et renommage depuis le volet.
Pour « Édition » : insertion d'images et de tableaux en grille Pandoc, avec un
menu contextuel par tableau — propriétés, copie, alignement de la colonne
visée, insertion de lignes et de colonnes, suppression d'une ligne, d'une
colonne ou du tableau — le redimensionnement des
colonnes à la souris sur les bordures de la première ligne, et l'insertion de
blocs de code au langage choisi sur le bloc, et de shortcodes Quarto
(`{{< pagebreak >}}`, `{{< include … >}}`, `{{< meta … >}}`) — une seule boîte
pour les trois, où le fichier à inclure se choisit sur le disque et la
propriété à reprendre parmi celles du bloc YAML — la même boîte relit un
shortcode déjà posé, depuis son menu contextuel, qui sait aussi le retirer.
Bloc YAML en tête du document, par les champs « Propriétés » du volet droit ;
changement du fichier d'une image depuis ses propriétés. Menu de mise en
forme : niveaux de titre et paragraphe, listes à puces, numérotées et à
cocher, bascule minuscules/majuscules. Recherche et remplacement dans le
document, en source comme dans le rendu, avec casse, mot entier et expression
régulière. Couper, copier, coller — dans le menu contextuel de la zone
d'édition, et un « Couper » de plus dans ceux du tableau et de l'image ;
annulation et rétablissement de tout ce qui touche au document ; Entrée qui
prolonge une liste — aérée ou à cocher comprises — et en sort sur une entrée
vide ; Ctrl+Tab d'un onglet à l'autre ; liste serrée
ou aérée, et retrait des lignes ou des entrées de liste ; insertion d'une
ligne vide.
Zoom du document, aux crans de la barre du haut comme
à Ctrl + molette ; poussoir « Focus », qui retire les deux volets ;
réactualisation de l'affichage d'après le Markdown ; groupe « Mise en page »
des paramètres du projet — espace avant et après chaque sorte de bloc, blocs de
code compris. Signet sur un titre, et commande « Lien » à quatre sortes de cible
— URL, fichier, signet, titre du document —, et menu contextuel d'un lien pour
en modifier les propriétés ou le retirer. Raccourcis clavier sur l'ensemble des
commandes, annoncés dans les menus et les infobulles. Menu contextuel sur l'onglet et sur
un fichier de l'arbre — enregistrer, renommer, copier le nom, dupliquer,
supprimer —, barre d'état en pied de fenêtre, thème clair/sombre/gris.

Compilation d'un document en HTML ou en PDF par Pandoc, depuis le menu de
l'onglet ou de l'arbre, d'après la destination et le modèle de commande réglés
pour chaque format dans les paramètres du projet. Liseuse ouverte sur les pages
compilées depuis le menu de l'application, par le script du projet. Gestion des
modèles de configuration : `conf/` garni d'un dossier de `confModele/`, et
`liseuse` posé à la création d'un projet.

À faire : écran de réglages détaillés, purge automatique. Pour « Édition » :
compilation vers d'autres formats que HTML et PDF ;
renommage d'un projet depuis la liste.

Le glisser-déposer du volet est bâti sur les événements de pointeur, pas sur
l'API HTML5 `dragstart` : celle-ci est irrégulière dans la webview WebKitGTK.
Il ne déplace un fil qu'à l'intérieur de sa catégorie — `reorder_feeds` ne
touche qu'aux positions ; changer un fil de catégorie passe par le renommage,
qui porte le nom et la catégorie.
