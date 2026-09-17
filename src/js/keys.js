// Raccourcis clavier : la table, et de quoi reconnaître une frappe.
//
// Cette table est le **seul** endroit qui les nomme. Elle donne pour chacun sa
// combinaison, son intitulé et sa portée ; `ui/keys.js` s'en sert pour agir, les
// menus et les infobulles de la barre du haut pour se l'annoncer. Un raccourci
// qui ne serait écrit qu'à un seul de ces trois endroits finirait par mentir aux
// deux autres.
//
// Ce module ne connaît ni le DOM ni l'état : il lit un événement clavier et rend
// des données, comme `find.js` et `anchors.js`.
//
// ## Ce qui a guidé le choix des touches
//
// **Les chiffres se lisent sur `code`, les lettres sur `key`.** Sur un clavier
// AZERTY, la rangée des chiffres demande la majuscule : « Ctrl+1 » y arrive avec
// `key` valant « & ». C'est donc `code` — `Digit1`, indépendant de la
// disposition — qui dit le chiffre. Pour une lettre c'est l'inverse : `code`
// nomme la place de la touche sur un clavier américain, où le « A » d'un AZERTY
// se présente comme `KeyQ` ; seul `key` dit la lettre qu'on a sous le doigt, et
// c'est elle que le moyen mnémotechnique désigne.
//
// **La famille de l'insertion est en Alt** et non en Ctrl+Alt : sous Windows,
// Ctrl+Alt *est* AltGr, dont un clavier français a besoin pour @ et #. Alt seul
// laisse ces caractères tranquilles, et donne des lettres qui se retiennent —
// Alt+I pour une image, Alt+T pour un tableau.
//
// **Ni Ctrl+Maj+I, ni Ctrl+Maj+J, ni Ctrl+Maj+C** : ce sont les outils de
// développement de la webview. Ils ne répondent pas dans un paquet de
// distribution, mais ils répondent sous `cargo tauri dev`, et un raccourci qui
// ne marche que chez l'utilisateur ne se laisse pas essayer.

/** Portées : ce qui n'a de sens que devant une coque, et ce qui vaut partout. */
const VEILLE = 'veille';
const EDITION = 'edition';
const BOTH = 'both';

/**
 * Les raccourcis, dans l'ordre où ils se lisent.
 *
 * - `combo` : la frappe, sous la forme canonique de `comboOf`.
 * - `label` : ce que la commande fait, tel que le menu l'écrit déjà.
 * - `scope` : la coque concernée.
 * - `button` : l'identifiant du bouton que le raccourci **presse**. Passer par
 *   le bouton plutôt que par la fonction qu'il appelle est ce qui garantit que
 *   les deux fassent exactement la même chose — son état éteint compris.
 * - `editor` : vrai pour les commandes du document, qui n'agissent que lorsque
 *   la frappe a lieu dans une des deux surfaces d'édition. Ailleurs, Ctrl+B
 *   n'aurait rien à mettre en gras.
 * - `native` : la frappe appartient au moteur d'édition, qui la traite déjà. La
 *   table la nomme pour que les menus et les infobulles l'annoncent — sans quoi
 *   ils l'écriraient eux-mêmes, et la table cesserait d'être le seul endroit qui
 *   nomme les frappes —, mais `ui/keys.js` s'efface devant elle.
 */
export const KEYS = [
  // ------------------------------------------------ barre du haut, « Édition »
  { id: 'mode.edit', combo: 'ctrl+1', label: 'Modifier', scope: EDITION, button: 'mode-edit' },
  { id: 'mode.view', combo: 'ctrl+2', label: 'Voir', scope: EDITION, button: 'mode-view' },
  { id: 'mode.code', combo: 'ctrl+3', label: 'Code Markdown', scope: EDITION, button: 'mode-code' },
  { id: 'doc.save', combo: 'ctrl+s', label: 'Enregistrer', scope: EDITION, button: 'doc-save' },
  // D'un onglet à l'autre, comme dans un navigateur. Ctrl et non Tab seule : la
  // tabulation indente un bloc de code et passe de cellule en cellule dans un
  // tableau, et le passage d'un onglet doit marcher en pleine frappe.
  { id: 'tab.next', combo: 'ctrl+tab', label: 'Onglet suivant', scope: EDITION },
  { id: 'tab.prev', combo: 'ctrl+shift+tab', label: 'Onglet précédent', scope: EDITION },
  {
    id: 'doc.rebuild',
    combo: 'ctrl+shift+a',
    label: 'Réactualiser l’affichage',
    scope: EDITION,
    button: 'doc-rebuild',
  },
  { id: 'zoom.in', combo: 'ctrl+plus', label: 'Agrandir le document', scope: EDITION, button: 'zoom-in' },
  { id: 'zoom.out', combo: 'ctrl+minus', label: 'Réduire le document', scope: EDITION, button: 'zoom-out' },
  { id: 'zoom.reset', combo: 'ctrl+0', label: 'Revenir à 100 %', scope: EDITION, button: 'zoom-level' },
  { id: 'focus', combo: 'f9', label: 'Masquer les volets', scope: EDITION, button: 'focus-toggle' },
  { id: 'projects', combo: 'ctrl+shift+p', label: 'Projets', scope: EDITION, button: 'project-open' },
  {
    id: 'project.settings',
    // La virgule des préférences, la même que partout ailleurs.
    combo: 'ctrl+,',
    label: 'Paramètres du projet',
    scope: EDITION,
    button: 'project-settings',
  },
  { id: 'tree.refresh', combo: 'alt+r', label: 'Actualiser l’arborescence', scope: EDITION, button: 'project-refresh' },

  // -------------------------------------------------- barre du haut, « Veille »
  { id: 'sync', combo: 'ctrl+shift+s', label: 'Tout synchroniser', scope: VEILLE, button: 'sync-all' },
  { id: 'feed.add', combo: 'ctrl+shift+n', label: 'Ajouter un fil', scope: VEILLE, button: 'open-panel' },

  // ----------------------------------------------------------- les deux coques
  { id: 'theme', combo: 'ctrl+shift+t', label: 'Thème de l’application', scope: BOTH, button: 'theme-open' },
  { id: 'launcher', combo: 'ctrl+shift+e', label: 'Changer d’application', scope: BOTH, button: 'launcher-open' },
  // F10 ouvre le menu d'une application de bureau, et Ctrl+Q la quitte : ce
  // sont les frappes qu'on essaie d'abord.
  { id: 'app.menu', combo: 'f10', label: 'Menu', scope: BOTH, button: 'app-menu' },
  { id: 'app.quit', combo: 'ctrl+q', label: 'Quitter', scope: BOTH },

  // ---------------------------------------------------- document : mise en forme
  { id: 'format.gras', combo: 'ctrl+b', label: 'Gras', scope: EDITION, editor: true },
  { id: 'format.italique', combo: 'ctrl+i', label: 'Italique', scope: EDITION, editor: true },
  // Le moteur d'édition poserait un `<u>` de lui-même, que `turndown` déplie :
  // le souligné serait perdu à l'enregistrement. On prend donc la touche.
  { id: 'format.souligne', combo: 'ctrl+u', label: 'Souligné', scope: EDITION, editor: true },
  { id: 'format.barre', combo: 'ctrl+shift+x', label: 'Barré', scope: EDITION, editor: true },
  { id: 'format.code', combo: 'ctrl+shift+m', label: 'Code inline', scope: EDITION, editor: true },
  { id: 'format.capitales', combo: 'ctrl+shift+k', label: 'Petites capitales', scope: EDITION, editor: true },

  // ----------------------------------------------------------- document : blocs
  { id: 'block.h1', combo: 'ctrl+shift+1', label: 'Titre 1', scope: EDITION, editor: true },
  { id: 'block.h2', combo: 'ctrl+shift+2', label: 'Titre 2', scope: EDITION, editor: true },
  { id: 'block.h3', combo: 'ctrl+shift+3', label: 'Titre 3', scope: EDITION, editor: true },
  { id: 'block.h4', combo: 'ctrl+shift+4', label: 'Titre 4', scope: EDITION, editor: true },
  { id: 'block.h5', combo: 'ctrl+shift+5', label: 'Titre 5', scope: EDITION, editor: true },
  { id: 'block.h6', combo: 'ctrl+shift+6', label: 'Titre 6', scope: EDITION, editor: true },
  { id: 'block.p', combo: 'ctrl+shift+0', label: 'Paragraphe', scope: EDITION, editor: true },
  { id: 'block.quote', combo: 'ctrl+shift+q', label: 'Citation', scope: EDITION, editor: true },
  { id: 'list.ol', combo: 'ctrl+shift+7', label: 'Liste numérotée', scope: EDITION, editor: true },
  { id: 'list.ul', combo: 'ctrl+shift+8', label: 'Liste à puces', scope: EDITION, editor: true },
  { id: 'list.task', combo: 'ctrl+shift+9', label: 'Liste à cocher', scope: EDITION, editor: true },

  // ------------------------------------------------------- document : annuler
  // L'annulation porte sur le **Markdown** du document, non sur le DOM : c'est
  // pourquoi elle est à nous et non au moteur d'édition, dont la pile ignore
  // tout ce que les commandes écrivent directement dans l'arbre.
  { id: 'undo', combo: 'ctrl+z', label: 'Annuler', scope: EDITION, editor: true },
  { id: 'redo', combo: 'ctrl+y', label: 'Rétablir', scope: EDITION, editor: true },
  // La frappe des éditeurs de texte, à côté de celle des traitements de texte :
  // les deux rétablissent. C'est la première des deux que les menus annoncent.
  { id: 'redo', combo: 'ctrl+shift+z', label: 'Rétablir', scope: EDITION, editor: true },

  // -------------------------------------------------- document : presse-papiers
  // Les trois frappes du presse-papiers sont celles du moteur d'édition. La
  // table les nomme pour que les menus les écrivent — c'est sa raison d'être —,
  // mais `ui/keys.js` les laisse passer, d'où `native` : aucun script ne sait
  // déclencher un collage, et pour la coupe comme pour la copie le moteur fait
  // mieux que nous, l'historique d'annulation compris. Ce qu'elles mettent dans
  // le presse-papiers ne leur échappe pas pour autant : `ui/clipboard.js`
  // intercepte les événements, et la frappe y met donc la même chose que
  // l'entrée du menu.
  { id: 'clip.cut', combo: 'ctrl+x', label: 'Couper', scope: EDITION, editor: true, native: true },
  { id: 'clip.copy', combo: 'ctrl+c', label: 'Copier', scope: EDITION, editor: true, native: true },
  { id: 'clip.paste', combo: 'ctrl+v', label: 'Coller', scope: EDITION, editor: true, native: true },
  // Celle-ci est à nous : le collage lit le texte comme du Markdown, et il faut
  // une porte pour le poser tel quel. La majuscule, comme ailleurs pour « coller
  // sans mise en forme ».
  { id: 'clip.plain', combo: 'ctrl+shift+v', label: 'Coller en texte brut', scope: EDITION, editor: true },

  // ------------------------------------------------------- document : insertion
  // Le lien garde Ctrl+K, que tout le monde essaie d'abord ; le reste de la
  // famille est en Alt, où les lettres se retiennent.
  { id: 'insert.link', combo: 'ctrl+k', label: 'Insérer un lien…', scope: EDITION, editor: true },
  { id: 'insert.image', combo: 'alt+i', label: 'Insérer une image…', scope: EDITION, editor: true },
  { id: 'insert.table', combo: 'alt+t', label: 'Insérer un tableau…', scope: EDITION, editor: true },
  { id: 'insert.code', combo: 'alt+c', label: 'Insérer un bloc de code', scope: EDITION, editor: true },
  { id: 'insert.rule', combo: 'alt+h', label: 'Insérer une ligne horizontale', scope: EDITION, editor: true },
  // « B » comme blanc : le « v » de vide est déjà celui du collage.
  { id: 'insert.blank', combo: 'alt+b', label: 'Insérer une ligne vide', scope: EDITION, editor: true },
  { id: 'insert.footnote', combo: 'alt+n', label: 'Insérer une note de bas de page', scope: EDITION, editor: true },
  { id: 'insert.shortcode', combo: 'alt+q', label: 'Insérer un shortcode…', scope: EDITION, editor: true },
  // Le saut de page se pose sans passer par la boîte des shortcodes : c'est le
  // plus fréquent des trois, et Ctrl+Entrée est la frappe qu'un traitement de
  // texte lui donne. Dans un bloc de code, `ui/code.js` garde la frappe pour
  // sortir du bloc — il la traite avant nous, et `ui/keys.js` ne reprend pas
  // une frappe déjà traitée.
  {
    id: 'insert.pagebreak',
    combo: 'ctrl+enter',
    label: 'Insérer un saut de page',
    scope: EDITION,
    editor: true,
  },
  { id: 'anchor', combo: 'alt+s', label: 'Signet du titre…', scope: EDITION, editor: true },
  { id: 'frontmatter', combo: 'alt+p', label: 'Propriétés du document', scope: EDITION, editor: true },

  // ------------------------------------------------------ document : rechercher
  { id: 'find', combo: 'ctrl+f', label: 'Rechercher', scope: EDITION, editor: true },
  { id: 'replace', combo: 'ctrl+h', label: 'Remplacer', scope: EDITION, editor: true },
];

/**
 * Par identifiant, pour que `labelOf` n'ait pas à parcourir la table.
 *
 * Une commande peut avoir deux frappes — « Rétablir » en a deux, l'une venue
 * des traitements de texte et l'autre des éditeurs. C'est la première qui
 * s'annonce : les menus n'en écrivent qu'une, et ce n'est pas à l'ordre des
 * lignes de la table d'en décider autrement.
 */
const BY_ID = new Map();
for (const key of KEYS) if (!BY_ID.has(key.id)) BY_ID.set(key.id, key);

/** Par frappe : deux portées peuvent se partager une combinaison. */
const BY_COMBO = new Map();
for (const key of KEYS) {
  if (!BY_COMBO.has(key.combo)) BY_COMBO.set(key.combo, []);
  BY_COMBO.get(key.combo).push(key);
}

/**
 * La touche d'un événement, sous une forme qui ne dépende pas de la disposition
 * du clavier.
 *
 * Les chiffres viennent de `code` et les lettres de `key` : voir l'en-tête du
 * module. Le pavé numérique compte comme la rangée des chiffres — c'est la même
 * intention sous le doigt.
 */
function keyOf(ev) {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(ev.code ?? '');
  if (digit) return digit[1];

  // Les deux touches du zoom, quelle que soit la façon dont le clavier les
  // nomme. Sur un AZERTY, « + » demande la majuscule et partage sa touche avec
  // « = » ; le pavé numérique en a une à lui. Les quatre valent le même cran,
  // comme dans un navigateur.
  if (ev.code === 'NumpadAdd' || ev.key === '+' || ev.key === '=') return 'plus';
  if (ev.code === 'NumpadSubtract' || ev.key === '-' || ev.key === '_') return 'minus';

  return String(ev.key ?? '').toLowerCase();
}

/**
 * La frappe, sous forme canonique : `ctrl+shift+a`.
 *
 * `metaKey` compte comme `ctrl` : la touche Commande d'un Mac joue ce rôle, et
 * les intitulés n'ont pas à s'en soucier.
 *
 * Rend `null` lorsque AltGr est enfoncée : sur un clavier français elle sert à
 * écrire @, # ou €, et certaines plateformes la font passer pour Ctrl+Alt. Un
 * raccourci ne doit pas se déclencher là où l'on tape un caractère.
 */
export function comboOf(ev) {
  if (ev.getModifierState?.('AltGraph')) return null;

  const key = keyOf(ev);

  const parts = [];
  if (ev.ctrlKey || ev.metaKey) parts.push('ctrl');
  if (ev.altKey) parts.push('alt');
  // La majuscule ne compte pas pour les deux touches du zoom : sur un clavier
  // français, « + » ne s'obtient qu'avec elle. L'exiger ou l'interdire ferait
  // dépendre le raccourci de la disposition du clavier.
  if (ev.shiftKey && key !== 'plus' && key !== 'minus') parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/** Comment une combinaison s'écrit à l'écran. */
const SHOWN = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Maj',
  plus: '+',
  minus: '−',
  ',': ',',
  escape: 'Échap',
  enter: 'Entrée',
  tab: 'Tab',
};

/** `ctrl+shift+a` devient `Ctrl+Maj+A`. */
export function show(combo) {
  return String(combo ?? '')
    .split('+')
    // Une combinaison qui *contient* « + » a son signe écrit `plus` : découper
    // sur le « + » ne peut donc pas le couper en deux.
    .map((part) => SHOWN[part] ?? part.toUpperCase())
    .join('+');
}

/** L'intitulé de frappe d'une commande, ou `''` si elle n'en a pas. */
export function labelOf(id) {
  const found = BY_ID.get(id);
  return found ? show(found.combo) : '';
}

/**
 * Une infobulle qui annonce son raccourci : « Enregistrer (Ctrl+S) ».
 *
 * Une seule écriture de cette forme, pour que les boutons dont l'infobulle est
 * fixe dans `index.html` et ceux qui la réécrivent à chaque rendu — « Focus »,
 * qui dit ce que le prochain clic fera — l'annoncent de la même façon.
 */
export function hint(id, text) {
  const keys = labelOf(id);
  return keys ? `${text} (${keys})` : text;
}

/**
 * La commande qu'une frappe désigne, dans la coque où l'on est.
 *
 * Une même combinaison peut servir deux coques — elle n'y a jamais le même
 * sens, et l'une n'est pas à l'écran quand l'autre l'est.
 */
export function match(combo, app) {
  const found = BY_COMBO.get(combo);
  if (!found) return null;
  return found.find((k) => k.scope === BOTH || k.scope === app) ?? null;
}
