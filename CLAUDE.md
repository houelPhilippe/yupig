# Tableau de bord Veille — contexte projet

Application de bureau **Rust + Tauri 2** qui reprend le modèle de maquette
`modele/Tableau de bord Veille (autonome).html` : un agrégateur de flux
RSS/Atom, autonome et hors ligne, à l'aspect « Modernist » (aplats, angles
vifs, accent rouge `#ec3013`, police Archivo).

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

L'application abrite désormais **deux coques** que le lanceur de l'en-tête
permute : « Veille » (le lecteur de flux) et « Édition » (rédaction des
documents d'un projet — arbre des fichiers à gauche, onglets et zone de saisie
au centre, sommaire ou bloc YAML à droite). Les deux vivent dans la même page et le même
`state` ; `ui/shell.js` masque celle qui n'est pas à l'écran.

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
serait sans issue. L'indentation est une vraie tabulation : c'est la frappe
même, et `tab-size` dit sur quelle colonne elle tombe.

`src/js/markdown.js` assainit **toute** sortie de `marked` avant insertion :
`marked` n'assainit plus rien depuis sa v5 et la webview expose `__TAURI__`,
donc l'accès au disque. Ne jamais insérer sa sortie brute dans le DOM.

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

Les **notes de bas de page** sont celles de Pandoc : l'appel `[^1]` au fil du
texte, la définition `[^1]: …` en fin de document. Attention au piège : une
définition a la forme d'une définition de lien, et `marked` la retirerait du
rendu — la note disparaîtrait du fichier au premier aller-retour. `markdown.js`
la désamorce donc **avant** l'analyse (`expandFootnotes`), en remplaçant l'appel
de tête par la balise qu'il aurait de toute façon ; les appels du texte, eux,
sont relevés après (`liftFootnotes`), faute de quoi `turndown` échapperait leurs
crochets.

`marked` ne connaît pas plus ce span que les attributs d'une image :
`markdown.js` le relit lui-même sur l'arbre rendu (`liftSpans`) et le réécrit à
l'enregistrement — en ne gardant du `style` que les deux couleurs que les
pastilles savent poser, pour qu'une police venue d'un texte collé ne s'installe
pas dans le fichier. Les seuls `<span>` du rendu sont donc les siens et ceux des
shortcodes. En sortie HTML, Quarto rend ces attributs ; en PDF, il les ignore.

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

Ses cinq champs vivent dans le **volet droit**, qui porte donc deux contenus —
le sommaire et eux — que le sélecteur de sa tête relaie (`ui/aside.js`, et
`state.edition.aside`). Aucun des deux ne connaît l'autre : chacun se retire
quand l'état ne le désigne pas, et le sélecteur n'appartient qu'au volet. Il
n'y a rien à valider dans ces champs : celui qu'on quitte écrit dans la source,
comme les propriétés d'une image — mais seulement si sa valeur a bougé, sans
quoi une simple visite marquerait le document modifié.

`src-tauri/src/files.rs` est le **seul** endroit qui touche au disque de
l'utilisateur. Le frontend n'y envoie que des chemins relatifs à la racine du
projet, et `files::resolve` refuse tout ce qui en sortirait — composant `..`
comme lien symbolique. Ne pas contourner cette fonction.

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

Fait : schéma SQLite et migrations, collecte RSS/Atom avec cache conditionnel,
détection automatique de flux, import/export OPML, recherche plein texte,
filtres, favoris, volet de lecture, rafraîchissement périodique, vignettes
illustrées par la photo du flux, première page complète conforme au modèle,
réordonnancement des fils par glisser-déposer et renommage depuis le volet.
Pour « Édition » : insertion d'images et de tableaux en grille Pandoc, avec un
menu contextuel par tableau — propriétés, alignement de la colonne visée,
insertion de lignes et de colonnes, suppression — le redimensionnement des
colonnes à la souris sur les bordures de la première ligne, et l'insertion de
blocs de code au langage choisi sur le bloc, et de shortcodes Quarto
(`{{< pagebreak >}}`, `{{< include … >}}`, `{{< meta … >}}`) — une seule boîte
pour les trois, où le fichier à inclure se choisit sur le disque et la
propriété à reprendre parmi celles du bloc YAML — la même boîte relit un
shortcode déjà posé, depuis son menu contextuel, qui sait aussi le retirer.
Bloc YAML en tête du document, par les champs « Propriétés » du volet droit ;
changement du fichier d'une image depuis ses propriétés. Menu de mise en
forme : niveaux de titre et paragraphe, listes à puces, numérotées et à
cocher, bascule minuscules/majuscules. Zoom du document, aux crans de la barre du haut comme
à Ctrl + molette ; poussoir « Focus », qui retire les deux volets. Menu contextuel sur l'onglet et sur
un fichier de l'arbre, thème clair/sombre/gris.

À faire : écran de réglages détaillés, purge automatique. Pour « Édition » :
création et suppression de fichiers (seuls la lecture et l'enregistrement
existent).

Le glisser-déposer du volet est bâti sur les événements de pointeur, pas sur
l'API HTML5 `dragstart` : celle-ci est irrégulière dans la webview WebKitGTK.
Il ne déplace un fil qu'à l'intérieur de sa catégorie — `reorder_feeds` ne
touche qu'aux positions ; changer un fil de catégorie passe par le renommage,
qui porte le nom et la catégorie.
