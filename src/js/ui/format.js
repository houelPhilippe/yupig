// Menu contextuel de mise en forme, au clic droit dans la zone d'édition.
//
// Le document est du Markdown, et rien que du Markdown. Gras, italique, code
// inline et barré s'y disent nativement ; les petites capitales, la couleur du
// texte et la surbrillance passent par le **span à attributs de Pandoc** —
// `[texte]{.smallcaps}`, `[texte]{style="color: …"}` — que Quarto lit. Jamais
// de HTML en ligne : `turndown` n'en garde rien, et d'autres outils ne le
// rendraient pas.
//
// Chaque entrée est un poussoir : elle applique la mise en forme, et la retire
// si la sélection la porte déjà. Le menu montre l'état au moment où il s'ouvre.
//
// Le menu sert les deux modes de saisie : dans « Modifier » il agit sur le
// document rendu, dans « Code Markdown » il encadre le texte sélectionné avec
// la syntaxe correspondante — et la retire au second passage.

import { el, icon, replace, PATH } from './dom.js';
import * as store from '../store.js';
import * as api from '../api.js';
import { imageResolver } from './editor.js';
import { toMarkdown } from '../markdown.js';
import * as image from './image.js';
import * as table from './table.js';
import * as code from './code.js';
import * as shortcode from './shortcode.js';
import * as frontmatter from './frontmatter.js';

const rich = document.getElementById('editor-rich');
const area = document.getElementById('editor-area');

/**
 * Chaque action sait se dire de plusieurs façons :
 * - `md` : la marque Markdown, quand elle encadre la sélection des deux côtés ;
 * - `wrap` : les deux textes à poser de part et d'autre, quand ils diffèrent —
 *   les petites capitales s'écrivent `[texte]{.smallcaps}` ;
 * - `cmd` : la commande d'édition native, qui bascule déjà correctement, y
 *   compris quand la sélection ne couvre qu'une partie du texte formaté ;
 * - `make` / `match` : à fabriquer et à reconnaître nous-mêmes, faute de
 *   commande native.
 */
const ACTIONS = [
  {
    id: 'gras',
    label: 'Gras',
    md: '**',
    cmd: 'bold',
    match: (n) => n.nodeName === 'STRONG' || n.nodeName === 'B',
  },
  {
    id: 'italique',
    label: 'Italique',
    md: '*',
    cmd: 'italic',
    match: (n) => n.nodeName === 'EM' || n.nodeName === 'I',
  },
  {
    id: 'code',
    label: 'Code inline',
    md: '`',
    make: () => document.createElement('code'),
    match: (n) => n.nodeName === 'CODE',
  },
  {
    id: 'barre',
    label: 'Barré',
    md: '~~',
    cmd: 'strikeThrough',
    match: (n) => ['DEL', 'S', 'STRIKE'].includes(n.nodeName),
  },
  {
    // Le span à attributs de Pandoc, que Quarto rend en petites capitales —
    // du Markdown, là où le HTML en ligne d'autrefois n'en était pas.
    id: 'capitales',
    label: 'Petites capitales',
    wrap: ['[', ']{.smallcaps}'],
    make: () => el('span.smallcaps'),
    match: (n) => n.nodeName === 'SPAN' && n.classList.contains('smallcaps'),
  },
  {
    // `.underline` est, comme `.smallcaps`, une classe que Pandoc connaît de
    // lui-même : elle souligne aussi bien en HTML qu'en PDF.
    id: 'souligne',
    label: 'Souligné',
    wrap: ['[', ']{.underline}'],
    make: () => el('span.underline'),
    match: (n) => n.nodeName === 'SPAN' && n.classList.contains('underline'),
  },
];

/** Teintes de surbrillance : elles doivent se distinguer entre elles. */
const HIGHLIGHTS = [
  ['#fdf0a4', 'Jaune'],
  ['#cdeccd', 'Vert'],
  ['#cfe2f7', 'Bleu'],
  ['#ffd9d2', 'Rose'],
  ['#eae7e7', 'Gris'],
];

/** Couleurs de texte : l'accent de la maquette, puis de quoi nuancer. */
const INKS = [
  ['#ec3013', 'Rouge'],
  ['#ae1800', 'Rouge sombre'],
  ['#1c4f8f', 'Bleu'],
  ['#1f6b3a', 'Vert'],
  ['#7d7979', 'Gris'],
  ['#201e1d', 'Noir'],
];

/**
 * L'absence de couleur, proposée au bout des deux rangées.
 *
 * Recliquer la couleur en vigueur la retire déjà, mais cela suppose de savoir
 * laquelle c'est — ce que le mode source ne permet pas de deviner. Cette
 * pastille retire quelle que soit la couleur posée.
 */
const NONE = [null, 'Sans couleur'];

/** Les deux propriétés que les pastilles savent poser. */
const INK = 'color';
const BACK = 'background-color';

/**
 * Les blocs que le menu sait poser : les six niveaux de titre, et le
 * paragraphe qui les défait.
 *
 * `md` est la marque de début de ligne, `carried` la reconnaît sur une ligne
 * qui la porte déjà. Les six titres ne diffèrent que par leur niveau : ils se
 * fabriquent plutôt que de s'écrire six fois.
 */
const HEADINGS = Array.from({ length: 6 }, (_, i) => {
  const level = i + 1;
  return {
    tag: `h${level}`,
    label: `Titre ${level}`,
    badge: `H${level}`,
    md: `${'#'.repeat(level)} `,
    carried: new RegExp(`^#{${level}} `),
  };
});

const BLOCKS = [
  ...HEADINGS,
  // Aucune marque : le paragraphe est ce qui reste quand on retire les autres.
  { tag: 'p', label: 'Paragraphe', badge: '¶', md: '', carried: null },
];

/**
 * Les trois listes.
 *
 * La liste à cocher est une liste à puces dont chaque entrée porte une case —
 * `- [ ] texte`, la forme du GFM que `marked` rend en case cochable. D'où le
 * `(?!…)` de la liste à puces : les deux ne doivent pas se reconnaître l'une
 * dans l'autre.
 */
const LISTS = [
  {
    id: 'ul',
    label: 'Liste à puces',
    badge: '•',
    cmd: 'insertUnorderedList',
    md: '- ',
    carried: /^[-*+] (?!\[[ xX]\] )/,
  },
  {
    id: 'ol',
    label: 'Liste numérotée',
    badge: '1.',
    cmd: 'insertOrderedList',
    md: (rank) => `${rank}. `,
    carried: /^\d+[.)] /,
  },
  {
    id: 'task',
    label: 'Liste à cocher',
    badge: '✓',
    cmd: 'insertUnorderedList',
    md: '- [ ] ',
    carried: /^[-*+] \[[ xX]\] /,
  },
];

/** Le marqueur de bloc qu'une ligne porte déjà — titre, puce, numéro, case. */
const BLOCK_MARK = /^(#{1,6} |[-*+] (\[[ xX]\] )?|\d+[.)] )/;

let menu = null;
// Le point d'insertion relevé à l'ouverture du menu. Une boîte de dialogue
// donne le focus à ses champs, et la sélection du document est alors perdue :
// sans ce relevé, un tableau irait se poser en fin de document plutôt qu'à
// l'endroit où l'on a cliqué.
let saved = null;

function styled(tag, style) {
  const node = document.createElement(tag);
  node.setAttribute('style', style);
  return node;
}

// ------------------------------------------------------------------ menu

export function wire() {
  // Sans cela les commandes natives produisent des `<span style=…>` au lieu de
  // `<b>`, `<i>`, `<s>` — que `turndown` ne saurait pas ramener au Markdown.
  try {
    document.execCommand('styleWithCSS', false, false);
  } catch {
    // Moteur qui refuse la commande : les balises restent l'usage par défaut.
  }

  for (const host of [rich, area]) {
    host.addEventListener('contextmenu', (ev) => {
      // Une image a son propre menu : propriétés, actualisation, copie. Il
      // vaut aussi en lecture seule, où l'on peut copier sans modifier.
      const img = host === rich ? ev.target.closest?.('img') : null;
      if (img && rich.contains(img)) {
        ev.preventDefault();
        close();
        image.open(img, ev.clientX, ev.clientY);
        return;
      }

      // Le menu du système ne propose rien d'utile ici ; on prend la main,
      // mais seulement là où l'on sait écrire.
      if (!writable()) return;
      ev.preventDefault();
      image.close();
      shortcode.close();

      // Un shortcode a le sien : ses propriétés, ou son retrait. Il ne vaut
      // que dans le rendu — dans la source, le shortcode n'est que du texte,
      // et c'est le menu de mise en forme qui s'ouvre.
      const mark = host === rich ? ev.target.closest?.('span.shortcode') : null;
      if (mark && rich.contains(mark)) {
        close();
        shortcode.open(mark, ev.clientX, ev.clientY);
        return;
      }

      // La cellule visée, s'il y en a une : le menu porte alors une colonne de
      // plus, celle du tableau.
      const cell = host === rich ? ev.target.closest?.('th, td') : null;
      open(ev.clientX, ev.clientY, cell && rich.contains(cell) ? cell : null);
    });
  }

  // Une case de liste à cocher se coche d'un clic. C'est l'attribut qu'on
  // pose, et non la seule propriété : `turndown` relit le HTML de la zone, où
  // seule une case dont l'attribut est écrit ressort cochée.
  rich.addEventListener('click', (ev) => {
    const box = ev.target.closest?.('input[type="checkbox"]');
    if (!box || !rich.contains(box) || !rich.isContentEditable) return;

    ev.preventDefault();
    if (box.hasAttribute('checked')) box.removeAttribute('checked');
    else box.setAttribute('checked', '');
    box.checked = box.hasAttribute('checked');
    commit();
  });

  // Un clic ailleurs, une touche d'échappement, un redimensionnement : le
  // menu s'en va.
  document.addEventListener('mousedown', (ev) => {
    if (menu && !menu.contains(ev.target)) close();
    if (!ev.target.closest?.('.ctx')) image.close();
  });
  document.addEventListener('keydown', (ev) => {
    if (menu && ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  window.addEventListener('resize', () => {
    close();
    image.close();
  });
}

/** La zone visée accepte-t-elle qu'on y écrive ? */
function writable() {
  const tab = store.activeTab();
  if (!tab) return false;
  const mode = store.isMarkdown(tab) ? store.state.edition.mode : 'code';
  return mode === 'edit' || mode === 'code';
}

/** Vrai quand on édite la source Markdown plutôt que le rendu. */
function onSource() {
  return store.state.edition.mode === 'code' || !store.isMarkdown(store.activeTab());
}

function close() {
  menu?.remove();
  menu = null;
}

function open(x, y, cell = null) {
  close();
  const source = onSource();
  saved = capture();

  menu = el('div.ctx', {
    role: 'menu',
    // Décisif : sans cela le `mousedown` sur un bouton retirerait le focus à
    // la zone d'édition, et la sélection — ce sur quoi on travaille —
    // disparaîtrait avant même que l'action ne s'exécute.
    onmousedown: (ev) => ev.preventDefault(),
  });

  const ink = activeColor(INK, source);
  const back = activeColor(BACK, source);

  // Deux colonnes : ce qui met en forme le texte à gauche, ce qui insère
  // quelque chose dans le document à droite. Le menu reste ainsi court, et les
  // deux familles ne se confondent pas dans une seule liste.
  const format = el(
    'div.ctx__col',
    {},
    [
      el('div.ctx__title', {}, 'Format du texte'),
      ...ACTIONS.map((a) => item(a.label, sample(a), isActive(a, source), () => apply(a, source))),
      el('div.ctx__sep'),
      el('div.ctx__title', {}, 'Surbrillance'),
      swatches([...HIGHLIGHTS, NONE], back, (color) => paint(BACK, color, source)),
      el('div.ctx__title', {}, 'Couleur du texte'),
      swatches([...INKS, NONE], ink, (color) => paint(INK, color, source)),
      el('div.ctx__sep'),
      // Une commande, pas un poussoir : elle transforme le texte au lieu de
      // l'encadrer, et n'a donc pas d'état à montrer.
      item('Basculer Min/Maj', el('span.ctx__mark', {}, 'Aa'), false, () => toggleCase(source)),
      // « Effacer la mise en forme » repose sur `removeFormat`, qui n'agit que
      // sur le document rendu : il n'a rien à faire en mode source.
      source ? null : item('Effacer la mise en forme', null, false, strip),
    ],
  );

  // Ce qui porte sur le bloc entier, et non sur ce qui est sélectionné : un
  // titre, un paragraphe, une liste prennent la ligne — d'où leur colonne.
  const block = el(
    'div.ctx__col',
    {},
    [
      el('div.ctx__title', {}, 'Paragraphe'),
      ...BLOCKS.map((b) =>
        item(b.label, badge(b.badge), blockActive(b, source), () => applyBlock(b, source)),
      ),
      // La citation contient le bloc au lieu de le remplacer : un titre cité
      // reste un titre. Elle a donc sa propre bascule, et non une entrée de
      // plus dans la liste ci-dessus.
      item('Citation', badge('>'), quoteActive(source), () => applyQuote(source)),
      el('div.ctx__sep'),
      el('div.ctx__title', {}, 'Listes'),
      ...LISTS.map((l) =>
        item(l.label, badge(l.badge), listActive(l, source), () => applyList(l, source)),
      ),
    ],
  );

  const insert = el(
    'div.ctx__col',
    {},
    el('div.ctx__title', {}, 'Insertion'),
    item('Insérer une image…', pictogram(PATH.image), false, () => insertImage(source)),
    item('Insérer un tableau…', pictogram(PATH.table), false, () => insertTable(source)),
    item('Insérer un bloc de code', pictogram(PATH.code), false, () => insertCode(source)),
    item('Insérer une ligne horizontale', pictogram(PATH.rule), false, () => insertRule(source)),
    item('Insérer une note de bas de page', badge('¹'), false, () => insertFootnote(source)),
    item('Insérer un shortcode…', pictogram(PATH.braces), false, () => insertShortcode(source)),
    el('div.ctx__sep'),
    el('div.ctx__title', {}, 'Document'),
    // Rien ne se pose ici au point d'insertion : l'entrée porte le volet droit
    // sur les propriétés du document, qui s'écrivent en tête du fichier, dans
    // son bloc YAML.
    item('Propriétés du document', pictogram(PATH.sliders), false, () => frontmatter.reveal()),
  );

  // Le tableau n'ouvre pas un menu à lui : la mise en forme du texte reste
  // utile dans une cellule, elle ne doit pas disparaître au motif qu'on est
  // dans un tableau.
  replace(menu, [el('div.ctx__cols', {}, format, block, insert, source ? null : tableMenu(cell))]);

  // Poser d'abord au pointeur : un élément en `position: fixed` sans décalage
  // s'afficherait un instant en bas de page avant d'être recalé.
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.append(menu);

  // Puis corriger : la taille du menu n'est connue qu'une fois dans le document.
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
}

/** La colonne « Tableau » du menu, quand le clic est tombé dans une cellule. */
function tableMenu(cell) {
  if (!cell) return null;
  const align = table.columnAlign(cell);

  const alignment = (label, path, value) =>
    item(label, pictogram(path), align === value, () => table.alignColumn(cell, value));

  return el('div.ctx__col', {}, [
    el('div.ctx__title', {}, 'Tableau'),
    item('Propriétés du tableau…', pictogram(PATH.sliders), false, () => table.properties(cell)),
    el('div.ctx__sep'),
    el('div.ctx__title', {}, 'Alignement de la colonne'),
    alignment('Gauche', PATH.alignLeft, 'left'),
    alignment('Centré', PATH.alignCenter, 'center'),
    alignment('Droite', PATH.alignRight, 'right'),
    el('div.ctx__sep'),
    item('Insérer une ligne au-dessus', pictogram(PATH.rowAbove), false,
      () => table.insertRow(cell, 'above')),
    item('Insérer une ligne en dessous', pictogram(PATH.rowBelow), false,
      () => table.insertRow(cell, 'below')),
    item('Insérer une colonne à gauche', pictogram(PATH.columnLeft), false,
      () => table.insertColumn(cell, 'left')),
    item('Insérer une colonne à droite', pictogram(PATH.columnRight), false,
      () => table.insertColumn(cell, 'right')),
    el('div.ctx__sep'),
    item('Supprimer le tableau', pictogram(PATH.trash), false, () => table.remove(cell)),
  ]);
}

function item(label, preview, active, run) {
  const node = el(
    'button.ctx__item',
    {
      // Un poussoir, pas une commande : l'état compte autant que l'intitulé.
      role: 'menuitemcheckbox',
      'aria-checked': String(active),
      onclick: () => {
        close();
        // L'action peut être asynchrone — le sélecteur de fichier l'est.
        Promise.resolve(run()).catch(store.fail);
      },
    },
    preview ?? el('span.ctx__mark'),
    el('span', {}, label),
  );
  if (active) node.classList.add('ctx__item--on');
  return node;
}

/** L'aperçu à gauche de l'intitulé : « A » mis en forme comme l'action. */
function sample(action) {
  const mark = el('span.ctx__mark', {}, 'A');
  const style = {
    gras: 'font-weight:800',
    italique: 'font-style:italic',
    code: 'font-family:ui-monospace,monospace',
    barre: 'text-decoration:line-through',
    capitales: 'font-variant:small-caps',
    souligne: 'text-decoration:underline',
  }[action.id];
  if (style) mark.setAttribute('style', style);
  return mark;
}

/** Un court texte dans la case d'aperçu : « H1 », « ¶ », « 1. »… */
function badge(text) {
  return el('span.ctx__mark', {}, text);
}

/** Une icône dans la case d'aperçu, pour les entrées qui n'ont pas de « A ». */
function pictogram(path) {
  const mark = el('span.ctx__mark');
  mark.append(icon(path, { size: 13 }));
  return mark;
}

function swatches(list, current, run) {
  return el(
    'div.ctx__swatches',
    {},
    ...list.map(([color, name]) => {
      // `current` vaut `null` quand on sait qu'aucune couleur n'est posée, et
      // `undefined` quand on ne peut pas le savoir — en mode source. La
      // pastille « sans couleur » ne s'allume que dans le premier cas.
      const on = color === null ? current === null : color === current;
      const node = el('button.ctx__swatch', {
        title: on && color ? `${name} — cliquer pour retirer` : name,
        'aria-label': name,
        'aria-pressed': String(on),
        style: color ? `background:${color}` : null,
        onclick: () => {
          close();
          run(color);
        },
      });
      if (!color) node.classList.add('ctx__swatch--none');
      if (on) node.classList.add('ctx__swatch--on');
      return node;
    }),
  );
}

// ------------------------------------------------------------------ état

/** La sélection porte-t-elle déjà cette mise en forme ? */
function isActive(action, source) {
  if (source) return sourceWrapper(action) !== null;
  if (action.cmd) {
    try {
      return document.queryCommandState(action.cmd);
    } catch {
      return false;
    }
  }
  return ancestor(action.match) !== null;
}

/** L'état d'une commande native, quand le moteur veut bien le dire. */
function queryState(command) {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

/** La première ligne non vide que touche la sélection de la source. */
function currentLine() {
  const { selectionStart: a, selectionEnd: b, value } = area;
  const from = value.lastIndexOf('\n', a - 1) + 1;
  const stop = value.indexOf('\n', b);
  const to = stop < 0 ? value.length : stop;
  return value.slice(from, to).split('\n').find((line) => line.trim()) ?? '';
}

/** Le bloc où se trouve le curseur est-il déjà celui-ci ? */
function blockActive(block, source) {
  if (source) {
    // Sous la citation : un titre cité reste un titre.
    const line = currentLine().replace(QUOTES, '');
    // Le paragraphe, c'est l'absence de marque : il n'en a pas à reconnaître.
    return block.carried ? block.carried.test(line) : !BLOCK_MARK.test(line);
  }
  return ancestor((n) => n.nodeName === block.tag.toUpperCase()) !== null;
}

/** La sélection est-elle déjà dans une liste de ce type ? */
function listActive(list, source) {
  if (source) return list.carried.test(currentLine().replace(QUOTES, ''));
  if (list.id === 'task') return ancestor(isTaskItem) !== null;

  const inList = queryState(list.cmd);
  // Une liste à cocher est aussi une liste à puces : la seconde ne s'allume
  // que lorsque les cases n'y sont pas.
  return list.id === 'ul' ? inList && ancestor(isTaskItem) === null : inList;
}

const isTaskItem = (n) => n.nodeName === 'LI' && n.querySelector('input[type="checkbox"]') !== null;

/**
 * La couleur en vigueur sur la sélection.
 *
 * `null` : aucune, et on en est sûr. `undefined` : impossible à dire — en mode
 * source la couleur est une syntaxe dans le texte, pas un état du document.
 */
function activeColor(property, source) {
  if (source) return undefined;
  const found = ancestor(colorMatch(property));
  return found ? declaredColor(found, property) : null;
}

/** La valeur que le style d'un nœud donne à cette propriété. */
function declaredColor(node, property) {
  const found = (node.getAttribute('style') ?? '')
    .match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return found ? found[1].trim().toLowerCase() : null;
}

/**
 * Reconnaît le span qui porte cette propriété.
 *
 * Les deux-points sont précédés du début ou d'un point-virgule : sans cela,
 * `color` se retrouverait dans `background-color`.
 */
function colorMatch(property) {
  const re = new RegExp(`(^|;)\\s*${property}\\s*:`);
  return (n) => n.nodeName === 'SPAN' && re.test(n.getAttribute('style') ?? '');
}

/** Le premier ancêtre de la sélection qui satisfait `match`, sans sortir du rendu. */
function ancestor(match) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (!rich.contains(node)) return null;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;

  while (node && node !== rich) {
    if (node.nodeType === Node.ELEMENT_NODE && match(node)) return node;
    node = node.parentNode;
  }
  return null;
}

/**
 * Les bornes du marqueur autour de la sélection du `<textarea>`, s'il y est.
 *
 * On regarde des deux côtés : la sélection peut englober les marques
 * (`**mot**` pris en entier) ou seulement ce qu'elles encadrent.
 */
function sourceWrapper(action) {
  const [before, after] = marks(action);
  const { selectionStart: a, selectionEnd: b, value } = area;
  if (a === b) return null;

  const inner = value.slice(a, b);
  if (
    inner.length >= before.length + after.length
    && inner.startsWith(before)
    && inner.endsWith(after)
  ) {
    return { from: a, to: b, before, after };
  }
  if (a >= before.length
    && value.slice(a - before.length, a) === before
    && value.slice(b, b + after.length) === after) {
    return { from: a - before.length, to: b + after.length, before, after };
  }
  return null;
}

/**
 * Les deux textes que l'action pose de part et d'autre de la sélection.
 *
 * La plupart des marques Markdown encadrent symétriquement (`**mot**`) ; le
 * span à attributs de Pandoc, non (`[mot]{.smallcaps}`).
 */
function marks(action) {
  return action.wrap ?? [action.md, action.md];
}

// ------------------------------------------------------------- application

function apply(action, source) {
  if (source) return toggleSource(action);

  // La commande native bascule d'elle-même, et sait défaire une mise en forme
  // que la sélection ne recouvre qu'en partie — ce qu'un simple déballage
  // d'élément ne saurait pas faire.
  if (action.cmd) {
    rich.focus({ preventScroll: true });
    document.execCommand(action.cmd);
    commit();
    return;
  }

  const found = ancestor(action.match);
  if (found) unwrap(found);
  else wrapRich(action.make());
}

/** Enveloppe la sélection du rendu dans `node`. */
function wrapRich(node) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

  const range = sel.getRangeAt(0);
  // Hors de la zone d'édition, on ne touche à rien.
  if (!rich.contains(range.commonAncestorContainer)) return;

  try {
    range.surroundContents(node);
  } catch {
    // `surroundContents` refuse une sélection qui coupe un élément en deux ;
    // on extrait alors le contenu pour le replacer dans le nouvel élément.
    node.append(range.extractContents());
    range.insertNode(node);
  }

  // Garder la sélection sur ce qu'on vient de former : on enchaîne souvent
  // deux mises en forme sur le même mot, et il faut pouvoir la relever.
  const after = document.createRange();
  after.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(after);

  commit();
}

/** Remplace un élément par son contenu — le poussoir qui se relève. */
function unwrap(node) {
  const parent = node.parentNode;
  if (!parent) return;

  const first = node.firstChild;
  const last = node.lastChild;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);

  // Reposer la sélection sur le texte libéré, pour que le poussoir puisse être
  // rabaissé aussitôt sans avoir à resélectionner.
  if (first && last) {
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // Recoller les nœuds de texte voisins : sans quoi une bascule répétée
  // fragmenterait le document en morceaux de plus en plus petits.
  parent.normalize();
  commit();
}

/**
 * Change le bloc : un titre, ou le paragraphe qui le défait.
 *
 * Dans le rendu, `formatBlock` s'en charge — il sait remplacer le bloc qui
 * porte le curseur, et plusieurs à la fois si la sélection les traverse. Dans
 * la source, c'est une marque en tête de ligne.
 */
function applyBlock(block, source) {
  if (source) return prefixLines(block.md, block.carried);

  rich.focus({ preventScroll: true });
  document.execCommand('formatBlock', false, `<${block.tag}>`);
  commit();
}

/**
 * Pose une liste — à puces, numérotée, à cocher.
 *
 * La liste à cocher n'a pas de commande native : c'est une liste à puces dont
 * on garnit les entrées. Si la sélection est déjà dans une liste à puces, on
 * ne la repose pas — la commande la retirerait.
 */
function applyList(list, source) {
  if (source) return prefixLines(list.md, list.carried);

  rich.focus({ preventScroll: true });
  if (list.id !== 'task') {
    document.execCommand(list.cmd);
    commit();
    return;
  }

  if (!queryState('insertUnorderedList')) document.execCommand('insertUnorderedList');
  toggleBoxes();
  commit();
}

/**
 * Garnit de cases les entrées de liste que la sélection touche — ou les leur
 * retire, si toutes en portent déjà : le poussoir se relève.
 */
function toggleBoxes() {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;

  const range = sel.getRangeAt(0);
  let node = range.commonAncestorContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;

  const list = node?.closest('ul');
  if (!list || !rich.contains(list)) return;

  const items = [...list.querySelectorAll('li')].filter((li) => range.intersectsNode(li));
  if (!items.length) return;

  if (items.every(isTaskItem)) {
    for (const li of items) li.querySelector('input[type="checkbox"]').remove();
    return;
  }
  for (const li of items.filter((x) => !isTaskItem(x))) {
    // L'espace sépare la case du texte : sans lui, les deux se collent au
    // retour dans le Markdown.
    li.prepend(document.createTextNode(' '));
    li.prepend(checkbox());
  }
}

function checkbox(checked = false) {
  const box = document.createElement('input');
  box.setAttribute('type', 'checkbox');
  if (checked) box.setAttribute('checked', '');
  return box;
}

/**
 * Bascule la citation.
 *
 * Elle contient le bloc au lieu de le remplacer : un titre cité reste un
 * titre, et la marque se pose donc devant la ligne entière, marque de bloc
 * comprise.
 */
function applyQuote(source) {
  if (source) return prefixLines('> ', QUOTE, true);

  rich.focus({ preventScroll: true });
  const found = ancestor((n) => n.nodeName === 'BLOCKQUOTE');
  if (found) unwrap(found);
  else {
    document.execCommand('formatBlock', false, '<blockquote>');
    commit();
  }
}

/** La sélection est-elle déjà citée ? */
function quoteActive(source) {
  if (source) return QUOTE.test(currentLine());
  return ancestor((n) => n.nodeName === 'BLOCKQUOTE') !== null;
}

/** La marque de citation, et la suite qu'elle forme quand on en empile. */
const QUOTE = /^> /;
const QUOTES = /^(?:> )+/;

/**
 * Pose une marque en tête de chaque ligne que la sélection touche — et la
 * retire si toutes la portent déjà.
 *
 * Les lignes vides sont laissées telles quelles : une marque seule ne dit
 * rien. La marque qu'une ligne portait déjà s'en va d'abord — un titre devient
 * une puce sans garder son dièse — mais jamais sa citation : `quoting` dit si
 * l'on pose la citation elle-même, ou un bloc **dans** la citation.
 */
function prefixLines(mark, carried, quoting = false) {
  const tab = store.activeTab();
  if (!tab) return;

  const { selectionStart: a, selectionEnd: b, value } = area;
  const from = value.lastIndexOf('\n', a - 1) + 1;
  const stop = value.indexOf('\n', b);
  const to = stop < 0 ? value.length : stop;

  const lines = value.slice(from, to).split('\n');
  const filled = lines.filter((line) => line.trim());
  // Un titre cité est un titre : sa marque se juge sous la citation.
  const bared = (line) => (quoting ? line : line.replace(QUOTES, ''));
  const already =
    filled.length > 0 && Boolean(carried) && filled.every((line) => carried.test(bared(line)));

  let rank = 0;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    if (quoting) return already ? line.replace(QUOTE, '') : `> ${line}`;

    const quotes = line.match(QUOTES)?.[0] ?? '';
    const bare = line.slice(quotes.length).replace(BLOCK_MARK, '');
    if (already) return `${quotes}${bare}`;
    rank += 1;
    return `${quotes}${typeof mark === 'function' ? mark(rank) : mark}${bare}`;
  });

  const text = out.join('\n');
  const next = value.slice(0, from) + text + value.slice(to);
  area.value = next;
  area.setSelectionRange(from, from + text.length);
  area.focus({ preventScroll: true });
  store.edit(tab.path, next);
  store.reoutline(tab.path).catch(() => {});
}

/**
 * Pose une couleur, de texte ou de fond.
 *
 * Elle s'écrit dans le span à attributs de Pandoc, comme les petites
 * capitales — `[texte]{style="color: #ec3013"}` — et non en HTML en ligne :
 * c'est du Markdown, que d'autres outils lisent. En sortie HTML, Quarto rend
 * l'attribut ; en PDF, il l'ignore.
 */
function paint(property, color, source) {
  if (source) {
    // « Sans couleur » retire le span quelle que soit la couleur posée ; les
    // autres pastilles posent la leur.
    if (color === null) return stripSourceSpan();
    return toggleSource({ wrap: ['[', `]{style="${property}: ${color}"}`] });
  }

  const found = ancestor(colorMatch(property));
  if (color === null) {
    // Rien à retirer : on ne touche pas au document pour autant.
    return found ? unwrap(found) : undefined;
  }
  if (found) {
    // Même couleur : le poussoir se relève. Une autre : on la remplace, plutôt
    // que d'empiler un second span autour du premier.
    if (declaredColor(found, property) === color) return unwrap(found);
    found.setAttribute('style', `${property}: ${color}`);
    return commit();
  }

  return wrapRich(styled('span', `${property}: ${color}`));
}

/**
 * Retire, dans la source, le span à attributs qui porte un style autour de la
 * sélection.
 *
 * `toggleSource` ne sait défaire qu'une paire identique à celle qu'il
 * poserait ; ici la couleur posée est quelconque, on reconnaît donc le span à
 * sa seule forme. Les accolades qui ne portent pas de `style` — celles des
 * petites capitales — sont laissées où elles sont.
 */
function stripSourceSpan() {
  const tab = store.activeTab();
  if (!tab) return;

  const { selectionStart: a, selectionEnd: b, value } = area;
  if (a === b) return;

  let from;
  let to;
  let inner;

  // La sélection englobe le span.
  const whole = value.slice(a, b).match(/^\[([\s\S]*)\]\{[^{}]*style\s*=[^{}]*\}$/);
  if (whole) {
    [from, to, inner] = [a, b, whole[1]];
  } else {
    // Ou bien il l'encadre.
    const tail = value.slice(b).match(/^\]\{[^{}]*style\s*=[^{}]*\}/);
    if (value[a - 1] !== '[' || !tail) return;
    from = a - 1;
    to = b + tail[0].length;
    inner = value.slice(a, b);
  }

  const next = value.slice(0, from) + inner + value.slice(to);
  area.value = next;
  area.setSelectionRange(from, from + inner.length);
  area.focus({ preventScroll: true });
  store.edit(tab.path, next);
  store.reoutline(tab.path).catch(() => {});
}

/**
 * Bascule la casse de la sélection : en capitales, ou en bas de casse si elle
 * y est déjà tout entière.
 *
 * Ce n'est pas une mise en forme — rien n'est ajouté autour du texte, c'est le
 * texte lui-même qui change. Le balisage qu'il porte est laissé en place : on
 * ne touche qu'aux nœuds de texte, un mot en gras au milieu de la sélection le
 * reste donc.
 */
function toggleCase(source) {
  if (source) return caseInSource();

  const sel = window.getSelection();
  if (!sel?.rangeCount || sel.isCollapsed) return;

  const range = sel.getRangeAt(0);
  if (!rich.contains(range.commonAncestorContainer)) return;

  const parts = textParts(range);
  if (!parts.length) return;

  const up = !isUpper(range.toString());
  for (const { node, from, to } of parts) {
    const slice = node.data.slice(from, to);
    node.data = node.data.slice(0, from) + turn(slice, up) + node.data.slice(to);
  }

  // Reposer la sélection sur le texte transformé : la casse se rebascule ainsi
  // d'un second passage, sans avoir à resélectionner.
  const first = parts[0];
  const last = parts[parts.length - 1];
  const after = document.createRange();
  after.setStart(first.node, first.from);
  after.setEnd(last.node, Math.min(last.node.data.length, last.to));
  sel.removeAllRanges();
  sel.addRange(after);

  commit();
}

const turn = (text, up) => (up ? text.toLocaleUpperCase('fr') : text.toLocaleLowerCase('fr'));

/** Un texte déjà tout en capitales — celui qui n'en porte aucune ne l'est pas. */
function isUpper(text) {
  return text === text.toLocaleUpperCase('fr') && text !== text.toLocaleLowerCase('fr');
}

/** Les morceaux de nœuds de texte que la sélection recouvre, dans l'ordre. */
function textParts(range) {
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  const out = [];

  // Une sélection tenant dans un seul nœud ne fait pas entrer le promeneur :
  // son point de départ est alors le nœud lui-même.
  const start = range.commonAncestorContainer;
  const nodes = start.nodeType === Node.TEXT_NODE ? [start] : [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);

  for (const node of nodes) {
    if (!range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    if (to > from) out.push({ node, from, to });
  }
  return out;
}

/** La même bascule, sur la sélection du `<textarea>`. */
function caseInSource() {
  const tab = store.activeTab();
  if (!tab) return;

  const { selectionStart: a, selectionEnd: b, value } = area;
  if (a === b) return;

  const slice = value.slice(a, b);
  const turned = turn(slice, !isUpper(slice));
  const next = value.slice(0, a) + turned + value.slice(b);

  area.value = next;
  area.setSelectionRange(a, a + turned.length);
  area.focus({ preventScroll: true });
  store.edit(tab.path, next);
  store.reoutline(tab.path).catch(() => {});
}

/** Retire la mise en forme de la sélection du rendu. */
function strip() {
  rich.focus({ preventScroll: true });
  // `removeFormat` est déprécié mais reste le seul moyen simple de défaire une
  // mise en forme qui chevauche plusieurs éléments.
  document.execCommand('removeFormat');
  commit();
}

/** Pose ou retire la syntaxe autour de la sélection du `<textarea>`. */
function toggleSource(action) {
  const tab = store.activeTab();
  if (!tab) return;

  const { selectionStart: a, selectionEnd: b, value } = area;
  if (a === b) return;

  const found = sourceWrapper(action);
  let next;
  let from;
  let to;

  if (found) {
    const inner = value.slice(found.from + found.before.length, found.to - found.after.length);
    next = value.slice(0, found.from) + inner + value.slice(found.to);
    from = found.from;
    to = found.from + inner.length;
  } else {
    const [before, after] = marks(action);
    next = value.slice(0, a) + before + value.slice(a, b) + after + value.slice(b);
    from = a + before.length;
    to = b + before.length;
  }

  area.value = next;
  area.setSelectionRange(from, to);
  area.focus({ preventScroll: true });
  store.edit(tab.path, next);
  store.reoutline(tab.path).catch(() => {});
}

// -------------------------------------------------------------- insertion

/**
 * Choisit une image et l'insère au point d'insertion.
 *
 * Le lien écrit dans le document est **relatif** au fichier ouvert, calculé
 * côté Rust : le projet peut être déplacé ou partagé sans que l'image se
 * perde. L'aperçu, lui, a besoin d'une adresse `asset:` — d'où les deux
 * chemins portés par la balise.
 */
async function insertImage(source) {
  const tab = store.activeTab();
  if (!tab) return;

  const file = await api.pickImage();
  if (!file) return;

  const link = await api.fileLink(tab.path, file);
  // Un texte de remplacement par défaut vaut mieux que rien : il reste
  // modifiable, et un lecteur d'écran ne bute pas sur une image muette.
  const alt = link.split('/').pop().replace(/\.[^.]+$/, '');

  if (source) {
    insertSource(`![${alt}](${link})`);
    return;
  }

  const img = document.createElement('img');
  img.setAttribute('alt', alt);
  img.setAttribute('data-src', link);
  const resolve = imageResolver(tab);
  const url = resolve?.(link);
  if (url) img.setAttribute('src', url);
  insertRich(img);
}

/**
 * Insère un tableau, décrit dans sa boîte.
 *
 * Le tableau est bâti en DOM dans les deux cas : en mode source, c'est
 * `toMarkdown` qui le ramène à la grille Pandoc — la même conversion que
 * l'enregistrement, plutôt qu'une seconde écriture de la grille ici.
 */
function insertTable(source) {
  table.open((node) => {
    if (!source) {
      insertBlock(node, node.querySelector('th, td'));
      return;
    }
    // Une grille commence en début de ligne et se détache du texte : on ne
    // pose que les retours qui manquent devant le point d'insertion.
    insertSource(`${fresh()}${toMarkdown(node.outerHTML)}\n\n`);
  });
}

/**
 * Insère un bloc de code, vide et sans langage.
 *
 * Le langage se choisit ensuite dans la liste posée sur le bloc : c'est un
 * réglage qu'on voit mieux devant son code qu'avant de l'avoir écrit.
 */
function insertCode(source) {
  if (source) {
    const lead = fresh();
    // Le curseur sur la ligne vide, entre les deux clôtures.
    insertSource(`${lead}\`\`\`\n\n\`\`\`\n\n`, lead.length + 4);
    return;
  }
  const node = code.element();
  insertBlock(node, node.querySelector('code'));
  code.decorate();
}

/**
 * Insère une ligne horizontale.
 *
 * Elle s'écrit `***` plutôt que `---` : trois tirets sous un paragraphe en
 * feraient un titre souligné, et en tête de fichier le début d'un bloc YAML.
 * Les trois étoiles ne se confondent avec rien.
 */
function insertRule(source) {
  if (source) {
    insertSource(`${fresh()}***\n\n`);
    return;
  }
  insertBlock(document.createElement('hr'));
}

/**
 * Insère une note de bas de page, dans la syntaxe de Pandoc.
 *
 * L'appel — `[^3]` — se pose au point d'insertion ; sa définition —
 * `[^3]: …` — va en fin de document, là où Pandoc l'attend, et le curseur l'y
 * suit pour qu'on écrive la note dans la foulée. Le numéro est le premier
 * libre : Pandoc renumérote à la compilation, seule leur unicité compte.
 */
function insertFootnote(source) {
  const tab = store.activeTab();
  if (!tab) return;

  const label = freeFootnote(tab.content);
  if (source) {
    const { selectionStart: a, selectionEnd: b, value } = area;
    const body = value.slice(0, a) + `[^${label}]` + value.slice(b);
    // La définition se détache de ce qui précède, sans empiler de lignes vides.
    const gap = body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
    const next = `${body}${gap}[^${label}]: `;

    area.value = next;
    area.setSelectionRange(next.length, next.length);
    area.focus({ preventScroll: true });
    store.edit(tab.path, next);
    store.reoutline(tab.path).catch(() => {});
    return;
  }

  insertRich(footnoteMark(label));

  const definition = el('p', {}, footnoteMark(label), document.createTextNode(': '));
  rich.append(definition);

  const at = document.createRange();
  at.selectNodeContents(definition);
  at.collapse(false);
  rich.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(at);
  definition.scrollIntoView({ block: 'nearest' });
  commit();
}

/** Le premier numéro de note qu'aucune note ne porte déjà. */
function freeFootnote(markdown) {
  const used = [...String(markdown ?? '').matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
  return used.length ? Math.max(...used) + 1 : 1;
}

const footnoteMark = (label) => el('sup.fn', {}, String(label));

/**
 * Insère un shortcode.
 *
 * Les trois passent par la même boîte : c'est elle qui sait lequel attend un
 * fichier du projet, lequel une propriété du bloc YAML, et qui rend le texte
 * tout fait — avec la place qu'il prend, au fil du texte ou en bloc.
 */
function insertShortcode(source) {
  shortcode.insert((text, block) => write(source, text, block));
}

/**
 * Pose un shortcode, en bloc ou au fil du texte, selon ce qu'il est.
 *
 * Ni `marked` ni `turndown` ne voient quoi que ce soit dans `{{< … >}}` : les
 * accolades restent du texte, et l'espace après le `<` empêche d'y lire une
 * balise. Un shortcode traverse donc le rendu intact.
 *
 * Dans le rendu, il est posé d'emblée dans la balise que `liftShortcodes` lui
 * donnerait de toute façon à la relecture : sans elle, il paraîtrait en texte
 * ordinaire jusqu'au prochain rendu, et deux shortcodes de même nature — un
 * `include` et un `pagebreak` — ne se ressembleraient pas à l'écran. La balise
 * ne part pas dans le fichier : `turndown` la déplie sur son seul texte.
 */
function write(source, text, block) {
  if (source) {
    const lead = block ? fresh() : '';
    insertSource(`${lead}${text}${block ? '\n\n' : ''}`);
    return;
  }

  const node = el('span.shortcode', {}, text);
  // Seul dans son paragraphe, le shortcode se montre centré entre deux tirets :
  // c'est ce que la feuille de style fait de tout bloc de cette forme.
  if (block) insertBlock(el('p', {}, node));
  else insertRich(node);
}

/** Les retours qui manquent devant le point d'insertion pour ouvrir un bloc. */
function fresh() {
  const before = area.value.slice(0, area.selectionStart);
  if (!before || before.endsWith('\n\n')) return '';
  return before.endsWith('\n') ? '\n' : '\n\n';
}

/**
 * Pose un bloc entre deux blocs du rendu, jamais dans un paragraphe.
 *
 * Un tableau glissé au milieu d'un `<p>` en sortirait à la première relecture
 * du HTML : on remonte donc jusqu'au bloc de premier rang et on l'insère
 * après lui. Un paragraphe vide le suit, sans quoi il n'y aurait aucun endroit
 * où écrire sous un tableau qui termine le document.
 */
function insertBlock(node, caret = null) {
  const range = target();
  let anchor = null;

  if (range) {
    let at = range.commonAncestorContainer;
    if (at.nodeType !== Node.ELEMENT_NODE) at = at.parentElement;
    while (at && at.parentElement && at.parentElement !== rich) at = at.parentElement;
    if (at?.parentElement === rich) anchor = at;
  }

  if (anchor) anchor.after(node);
  else rich.append(node);

  const after = el('p', {}, el('br'));
  node.after(after);

  // Le curseur là où l'on va écrire : la première cellule d'un tableau, le
  // texte d'un bloc de code.
  if (caret) {
    const at = document.createRange();
    at.selectNodeContents(caret);
    at.collapse(true);
    rich.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(at);
  }
  commit();
}

/** La sélection dans le rendu, ou à défaut celle relevée à l'ouverture du menu. */
function capture() {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  return rich.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

function target() {
  return capture() ?? saved;
}

/** Pose un nœud au point d'insertion du rendu. */
function insertRich(node) {
  const range = target();

  if (!range) {
    // Sans point d'insertion connu, l'image va en fin de document plutôt que
    // de se perdre.
    rich.append(node);
  } else {
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  commit();
}

/**
 * Pose du texte au point d'insertion de la source.
 *
 * `caret` dit où laisser le curseur dans ce qu'on vient d'écrire — au bout par
 * défaut, mais un bloc de code veut qu'on reprenne la frappe entre ses deux
 * clôtures, pas après.
 */
function insertSource(text, caret = text.length) {
  const tab = store.activeTab();
  if (!tab) return;

  const { selectionStart: a, selectionEnd: b, value } = area;
  const next = value.slice(0, a) + text + value.slice(b);
  area.value = next;
  area.setSelectionRange(a + caret, a + caret);
  area.focus({ preventScroll: true });
  store.edit(tab.path, next);
  store.reoutline(tab.path).catch(() => {});
}

/** Renvoie au Markdown ce que la mise en forme vient de changer. */
function commit() {
  rich.dispatchEvent(new Event('input', { bubbles: true }));
}
