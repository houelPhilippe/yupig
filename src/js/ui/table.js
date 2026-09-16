// Tableaux du document : la boîte de dialogue et les actions du menu.
//
// La boîte sert deux usages avec les mêmes champs — décrire un tableau à
// insérer, ou reprendre les propriétés d'un tableau déjà posé. Seules les
// dimensions ne valent qu'à l'insertion : ajouter ou retirer des lignes se fait
// ensuite depuis le menu, où l'on voit ce qu'on touche.
//
// Ce qui est écrit ici finit dans la grille Pandoc de `tables.js` : la légende
// et les largeurs partent dans la ligne « : », les deux classes d'aspect dans
// ses accolades, l'alignement dans les deux-points de la barre de « = ».

import { el, icon, isTab, wireHints, PATH } from './dom.js';
import * as tables from '../tables.js';
import * as store from '../store.js';
import { toMarkdown } from '../markdown.js';
import * as clipboard from './clipboard.js';

const rich = document.getElementById('editor-rich');
const dialog = document.getElementById('table-dialog');
const title = document.getElementById('table-dialog-title');
const closeBtn = document.getElementById('table-dialog-close');
const cancelBtn = document.getElementById('table-cancel');
const applyBtn = document.getElementById('table-insert');
const status = document.getElementById('table-status');

const size = document.getElementById('table-size');
const columnsField = document.getElementById('table-cols');
const rowsField = document.getElementById('table-rows');
const headerSeg = document.getElementById('table-header');
const captionField = document.getElementById('table-caption');
const widthsField = document.getElementById('table-widths');
const widthField = document.getElementById('table-width');
const alignSeg = document.getElementById('table-align');
const borderedSeg = document.getElementById('table-bordered');
const stripedSeg = document.getElementById('table-striped');

const RESTING = 'Le tableau s’écrit en grille Pandoc, cellules sur plusieurs lignes admises.';

/**
 * Du nom français des segments à celui qu'écrit la grille.
 *
 * Ici l'alignement est celui du tableau entier — sa place dans la colonne de
 * texte, comme `fig-align` pour une image. Celui d'une colonne se règle
 * ailleurs : dans le menu du tableau, sur la colonne visée.
 */
const ALIGN = { gauche: 'left', centre: 'center', droite: 'right' };
const SEG = { left: 'gauche', center: 'centre', right: 'droite' };

// Ce qu'on fera du tableau une fois la boîte validée : le poser (`deliver`) ou
// reprendre celui qu'on est en train de modifier (`editing`). Jamais les deux.
let deliver = null;
let editing = null;
let say = () => {};

// ---------------------------------------------------------------- boîte

/** Ouvre la boîte pour un nouveau tableau ; `run` le reçoit à la validation. */
export function open(run) {
  deliver = run;
  editing = null;
  dress();
  fillWidths();
  reveal();
}

/** Ouvre la boîte sur un tableau déjà posé, champs remplis d'après lui. */
export function properties(cell) {
  const table = cell?.closest('table');
  if (!table) return;

  deliver = null;
  editing = table;
  dress();
  read(table);
  reveal();
}

/** Ce que la boîte annonce, selon qu'elle pose un tableau ou le reprend. */
function dress() {
  title.textContent = editing ? 'Propriétés du tableau' : 'Insérer un tableau';
  applyBtn.textContent = editing ? 'Appliquer' : 'Insérer';
  // Les dimensions ne se règlent qu'à la pose : sur un tableau rempli, réduire
  // un nombre de lignes dans un champ ferait disparaître du texte sans le dire.
  size.hidden = Boolean(editing);
}

function reveal() {
  say(RESTING);
  dialog.hidden = false;
  const first = editing ? captionField : columnsField;
  first.focus();
  first.select();
}

function close() {
  dialog.hidden = true;
  deliver = null;
  editing = null;
}

/** Remplit les champs d'après un tableau existant. */
function read(table) {
  const cells = columns(table);

  choose(headerSeg, 'tblhead', table.querySelector('thead') ? 'oui' : 'non');
  captionField.value = table.querySelector('caption')?.textContent.trim() ?? '';

  const share = widthsOf(table);
  widthsField.value = share ? share.join(', ') : equal(cells).join(', ');

  const style = table.getAttribute('style') ?? '';
  widthField.value = String(Math.round(Number(style.match(/width:\s*(\d+(?:\.\d+)?)%/)?.[1] ?? 100)));
  choose(alignSeg, 'tblalign', SEG[placeOf(style)]);
  choose(borderedSeg, 'tblborder', table.classList.contains('tbl--bordered') ? 'oui' : 'non');
  choose(stripedSeg, 'tblstripe', table.classList.contains('tbl--striped') ? 'oui' : 'non');
}

/**
 * La place du tableau, lue sur ses marges.
 *
 * Les deux marges automatiques centrent ; la seule marge gauche pousse à
 * droite ; sinon le tableau reste à gauche. C'est la lecture que fait déjà
 * `tables.js` pour écrire `tbl-align`.
 */
function placeOf(style) {
  const left = /margin-left:\s*auto/.test(style);
  const right = /margin-right:\s*auto/.test(style);
  return left && right ? 'center' : left ? 'right' : 'left';
}

function choose(seg, name, value) {
  for (const input of seg.querySelectorAll(`input[name="${name}"]`)) {
    input.checked = input.value === value;
  }
}

function picked(seg, name) {
  return seg.querySelector(`input[name="${name}"]:checked`)?.value;
}

/** Le nombre demandé, ramené aux bornes du champ. */
function count(field) {
  const min = Number(field.min);
  const max = Number(field.max);
  return Math.min(max, Math.max(min, Math.round(Number(field.value) || min)));
}

/** Le nombre de colonnes d'un tableau, pris sur sa rangée la plus fournie. */
function columns(table) {
  return Math.max(1, ...[...table.querySelectorAll('tr')].map((row) => row.children.length));
}

/** Les pourcentages portés par le `<colgroup>`, s'il y en a un. */
function widthsOf(table) {
  const cols = [...table.querySelectorAll('col')];
  if (!cols.length) return null;
  const out = cols.map((col) => {
    const found = (col.getAttribute('style') ?? '').match(/width:\s*(\d+(?:\.\d+)?)%/);
    return found ? Number(found[1]) : 0;
  });
  return out.every((v) => v > 0) ? out : null;
}

function equal(n) {
  const share = Math.round(1000 / n) / 10;
  return Array.from({ length: n }, () => share);
}

/**
 * Les largeurs saisies, une par colonne.
 *
 * Faute d'en avoir autant que de colonnes, on n'en tient pas compte : une
 * répartition égale vaut mieux qu'une grille qui ne correspond à rien.
 */
function readWidths(n) {
  const parts = widthsField.value
    .split(/[,;]/)
    .map((v) => Number(v.replace(/[%\s]/g, '')))
    .filter((v) => Number.isFinite(v) && v > 0);
  return parts.length === n ? parts : equal(n);
}

/** Réécrit le champ des largeurs en parts égales. */
function fillWidths() {
  widthsField.value = equal(count(columnsField)).join(', ');
}

function submit() {
  const n = editing ? columns(editing) : count(columnsField);
  const width = count(widthField);
  const spec = {
    columns: n,
    rows: count(rowsField),
    header: picked(headerSeg, 'tblhead') === 'oui',
    caption: captionField.value.trim(),
    widths: readWidths(n),
    // Un tableau à pleine largeur n'a pas de largeur à déclarer : c'est ce que
    // fait déjà une table sans style.
    width: width === 100 ? '' : `${width}%`,
    place: ALIGN[picked(alignSeg, 'tblalign')] ?? 'left',
    bordered: picked(borderedSeg, 'tblborder') === 'oui',
    striped: picked(stripedSeg, 'tblstripe') === 'oui',
  };

  const table = editing;
  const run = deliver;
  close();

  if (table) {
    applyTo(table, spec);
    commit();
    return;
  }
  run?.(tables.element(spec));
}

/** Reporte les propriétés de la boîte sur un tableau existant. */
function applyTo(table, spec) {
  const classes = ['tbl'];
  if (spec.bordered) classes.push('tbl--bordered');
  if (spec.striped) classes.push('tbl--striped');
  table.className = classes.join(' ');

  legend(table, spec.caption);
  widths(table, spec.widths);
  header(table, spec.header);
  // Les déclarations viennent de `tables.js`, qui les relit pour écrire
  // `tbl-align` et `width` : une seule écriture, dans les deux sens. Un tableau
  // pleine largeur aligné à gauche n'a plus de style du tout.
  const style = tables.frame(spec.width, spec.place);
  if (style) table.setAttribute('style', style);
  else table.removeAttribute('style');
}

/** Pose, met à jour ou retire la légende. Elle vient toujours en tête. */
function legend(table, text) {
  const found = table.querySelector('caption');
  if (!text) {
    found?.remove();
    return;
  }
  const node = found ?? document.createElement('caption');
  node.textContent = text;
  if (!found) table.prepend(node);
}

/** Réécrit le `<colgroup>`, d'où sortent les `tbl-colwidths` du fichier. */
function widths(table, share) {
  const group = document.createElement('colgroup');
  for (const w of share) {
    const col = document.createElement('col');
    col.setAttribute('style', `width: ${w}%`);
    group.append(col);
  }

  const found = table.querySelector('colgroup');
  if (found) found.replaceWith(group);
  else {
    const caption = table.querySelector('caption');
    if (caption) caption.after(group);
    else table.prepend(group);
  }
}

/** Donne ou retire la ligne de titre, sans toucher au texte des cellules. */
function header(table, wanted) {
  const found = table.querySelector('thead');
  if (Boolean(found) === wanted) return;

  const bodyOf = () => {
    const tbody = table.querySelector('tbody') ?? document.createElement('tbody');
    if (!tbody.parentElement) table.append(tbody);
    return tbody;
  };

  if (wanted) {
    const row = table.querySelector('tr');
    if (!row) return;
    for (const cell of [...row.children]) cell.replaceWith(retag(cell, 'th'));
    const thead = document.createElement('thead');
    thead.append(row);
    // Après la légende et les colonnes, avant le corps : c'est l'ordre qu'un
    // tableau doit garder pour que le rendu soit celui qu'on croit.
    bodyOf().before(thead);
    return;
  }

  const body = bodyOf();
  for (const row of [...found.querySelectorAll('tr')].reverse()) {
    for (const cell of [...row.children]) cell.replaceWith(retag(cell, 'td'));
    body.prepend(row);
  }
  found.remove();
}

/** La même cellule, sous l'autre balise. */
function retag(cell, tag) {
  const out = document.createElement(tag);
  for (const { name, value } of [...cell.attributes]) out.setAttribute(name, value);
  out.append(...cell.childNodes);
  return out;
}

// -------------------------------------------------------------- actions

/** L'alignement de la colonne où l'on a cliqué. */
export function columnAlign(cell) {
  return cell?.getAttribute('align') || 'left';
}

/**
 * Aligne la colonne visée, cellules de titre comprises.
 *
 * La grille ne sait pas aligner une cellule seule : ses deux-points valent pour
 * toute la colonne. On applique donc à toute la colonne ce que le fichier dira
 * de toute façon.
 */
export function alignColumn(cell, align) {
  const table = cell?.closest('table');
  const row = cell?.closest('tr');
  if (!table || !row) return;

  const at = [...row.children].indexOf(cell);
  for (const line of table.querySelectorAll('tr')) {
    line.children[at]?.setAttribute('align', align);
  }
  commit();
}

/**
 * Insère une ligne vide au-dessus ou en dessous de celle où l'on a cliqué.
 *
 * Une grille n'a qu'une ligne de titre : demandée depuis l'en-tête, la nouvelle
 * ligne se pose dans les deux cas en tête du corps — elle ne peut aller ni
 * avant le titre, ni en faire un second.
 */
export function insertRow(cell, where) {
  const table = cell?.closest('table');
  const row = cell?.closest('tr');
  if (!table || !row) return;

  const fresh = blank(table, row);

  if (row.closest('thead')) {
    const body = table.querySelector('tbody');
    if (body) body.prepend(fresh);
    else row.after(fresh);
  } else if (where === 'above') {
    row.before(fresh);
  } else {
    row.after(fresh);
  }

  place(fresh.querySelector('td'));
  commit();
}

/**
 * Insère une colonne vide à gauche ou à droite de celle où l'on a cliqué.
 *
 * La nouvelle colonne prend sa part de la largeur ; les autres se resserrent
 * d'autant et gardent entre elles les proportions qu'elles avaient. Elle
 * reprend l'alignement de la colonne visée : une colonne apparue au milieu de
 * colonnes centrées ne doit pas trancher.
 */
export function insertColumn(cell, where) {
  const table = cell?.closest('table');
  const row = cell?.closest('tr');
  if (!table || !row) return;

  const at = [...row.children].indexOf(cell) + (where === 'right' ? 1 : 0);
  const align = cell.getAttribute('align');
  const before = widthsOf(table) ?? equal(columns(table));

  for (const line of table.querySelectorAll('tr')) {
    // La ligne de titre porte des `th`, le corps des `td`.
    const node = document.createElement(line.closest('thead') ? 'th' : 'td');
    if (align) node.setAttribute('align', align);
    // Une cellule tout à fait vide ne se laisse pas viser au clic.
    node.append(document.createElement('br'));

    const next = line.children[at];
    if (next) next.before(node);
    else line.append(node);
  }

  const n = before.length + 1;
  const share = before.map((w) => Math.round((w * (n - 1) * 10) / n) / 10);
  share.splice(at, 0, Math.round(1000 / n) / 10);
  widths(table, share);

  place(row.children[at]);
  commit();
}

/**
 * Une rangée vierge, alignée comme celle qu'on lui donne pour modèle.
 *
 * Ses cellules portent un `<br>` : une cellule tout à fait vide ne se laisse
 * pas viser au clic.
 */
function blank(table, model) {
  const cells = model ? [...model.children] : [];
  const row = document.createElement('tr');

  for (let i = 0; i < columns(table); i++) {
    const node = document.createElement('td');
    const align = cells[i]?.getAttribute('align');
    if (align) node.setAttribute('align', align);
    node.append(document.createElement('br'));
    row.append(node);
  }
  return row;
}

/**
 * Retire la rangée où l'on a cliqué.
 *
 * La dernière rangée ne s'en va pas : un tableau sans rangée ne s'écrit pas en
 * grille, et ce n'est de toute façon pas ce qu'on demande — pour cela il y a
 * « Supprimer le tableau », juste en dessous dans le même menu.
 *
 * C'est bien la rangée visée qui part, et elle seule — la première du corps ne
 * monte pas prendre la place d'une ligne de titre retirée : un titre ne se
 * décide pas par accident. Un tableau qui n'en a plus s'écrit, se relit et se
 * rend : sa barre du haut porte alors l'alignement que portait celle de « = ».
 *
 * Le `<thead>` vidé s'en va avec sa dernière rangée, sans quoi sa barre de
 * « = » se poserait sur rien. Il peut en porter plusieurs : un fichier décide
 * du rang de cette barre, et `tables.js` en fait autant de rangées de titre.
 */
export function deleteRow(cell) {
  const table = cell?.closest('table');
  const row = cell?.closest('tr');
  if (!table || !row) return;

  const rows = [...table.querySelectorAll('tr')];
  if (rows.length < 2) return;

  // Où porter le curseur ensuite : la rangée suivante, ou la précédente quand
  // on retire la dernière. Il se pose avant la suppression, tant que les deux
  // voisines sont encore là.
  const at = rows.indexOf(row);
  const next = rows[at + 1] ?? rows[at - 1];

  const head = row.closest('thead');
  row.remove();
  if (head && !head.querySelector('tr')) head.remove();

  place(next?.firstElementChild);
  commit();
}

/**
 * Retire la colonne où l'on a cliqué, ligne de titre comprise.
 *
 * La largeur qu'elle occupait revient aux autres, au prorata de ce qu'elles
 * avaient : c'est l'inverse exact de l'insertion, si bien qu'insérer puis
 * retirer rend les proportions de départ. La dernière colonne ne s'en va pas,
 * pour la même raison que la dernière rangée.
 */
export function deleteColumn(cell) {
  const table = cell?.closest('table');
  const row = cell?.closest('tr');
  if (!table || !row) return;

  const at = [...row.children].indexOf(cell);
  const n = columns(table);
  if (at < 0 || n < 2) return;

  // Un `<colgroup>` qui ne compte pas ses colonnes ne décrit plus le tableau :
  // on repart de parts égales plutôt que d'écrire des largeurs décalées d'un
  // rang — c'est ce que fait déjà la boîte quand on lui en saisit trop peu.
  const found = widthsOf(table);
  const before = found?.length === n ? found : equal(n);

  for (const line of table.querySelectorAll('tr')) line.children[at]?.remove();

  const rest = before.filter((_, i) => i !== at);
  const total = rest.reduce((a, b) => a + b, 0);
  widths(table, total > 0 ? whole(rest.map((w) => round((w * 100) / total))) : equal(rest.length));

  // La colonne suivante a pris la place de celle qui part ; à droite du
  // tableau, c'est la précédente qui est désormais la dernière.
  place(row.children[at] ?? row.children[at - 1]);
  commit();
}

/**
 * Copie le tableau dans le presse-papiers.
 *
 * Deux formes, pour deux collages : la grille Pandoc en texte — celle même qui
 * part dans le fichier, donc exacte —, et le tableau en HTML, que « Modifier »
 * et les autres traitements de texte recollent en tableau plutôt qu'en lignes
 * de barres et de tirets.
 *
 * Les images de la forme HTML repartent avec leur chemin relatif : c'est
 * `data-src` qui passe dans `src`, faute de quoi le collage emporterait
 * l'adresse `asset:`, qui ne veut rien dire hors de cette machine.
 *
 * Rend vrai quand quelque chose est bien parti : la coupe s'en sert pour savoir
 * si elle peut retirer le tableau.
 */
export async function copy(cell) {
  const table = cell?.closest('table');
  if (!table) return false;

  const grid = toMarkdown(table.outerHTML).trim();

  const clone = table.cloneNode(true);
  for (const node of clone.querySelectorAll('.chrome')) node.remove();
  for (const img of clone.querySelectorAll('img[data-src]')) {
    img.setAttribute('src', img.getAttribute('data-src'));
  }

  // Les deux formes et leur repli vivent dans `ui/clipboard.js` : c'est le seul
  // endroit qui sache écrire dans le presse-papiers.
  try {
    await clipboard.write(grid, clone.outerHTML);
  } catch (err) {
    store.fail(err);
    return false;
  }
  store.notify('Tableau copié.');
  return true;
}

/**
 * Coupe le tableau : la copie, puis le retrait.
 *
 * Dans cet ordre, et pas l'inverse : si le presse-papiers refuse, le tableau
 * reste où il est. Une coupe qui efface sans avoir copié perdrait le tableau.
 */
export async function cut(cell) {
  if (await copy(cell)) remove(cell);
}

/** Retire le tableau du document. */
export function remove(cell) {
  const table = cell?.closest('table');
  if (!table) return;
  table.remove();
  commit();
}

// ---------------------------------------------------- largeurs à la souris

/** Tolérance, en pixels, autour d'une bordure saisissable. */
const EDGE = 4;
/** Une colonne plus étroite n'a plus de place pour son texte. */
const FLOOR = 5;

let sizing = null;

/**
 * La bordure sous le pointeur, s'il y en a une à saisir.
 *
 * Seule la première ligne les porte : c'est la rangée des titres, celle qu'on
 * regarde pour juger des largeurs, et la limiter évite qu'un clic destiné au
 * texte parte en glissement au milieu du tableau.
 */
function grip(ev) {
  // En lecture seule il n'y a rien à redimensionner : ni le curseur ne change,
  // ni le glissement ne commence.
  if (!rich.isContentEditable) return null;

  const cell = ev.target.closest?.('th, td');
  if (!cell || !rich.contains(cell)) return null;

  const table = cell.closest('table.tbl');
  const row = cell.closest('tr');
  if (!table || !row || row !== table.querySelector('tr')) return null;

  const box = cell.getBoundingClientRect();
  const at = [...row.children].indexOf(cell);
  const last = at === row.children.length - 1;

  // Le bord droit de la dernière cellule est celui du tableau : le tirer
  // change la largeur du tableau, pas le partage entre deux colonnes.
  if (Math.abs(ev.clientX - box.right) <= EDGE) {
    return { table, at, kind: last ? 'table' : 'between' };
  }
  if (at > 0 && Math.abs(ev.clientX - box.left) <= EDGE) {
    return { table, at: at - 1, kind: 'between' };
  }
  return null;
}

/** Le curseur annonce la bordure avant qu'on ne la saisisse. */
function hover(ev) {
  rich.classList.toggle('editor__rich--sizing', Boolean(grip(ev)));
}

function startSizing(ev) {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;

  const found = grip(ev);
  if (!found) return;
  // Sans cela le glissement poserait le curseur et étendrait une sélection.
  ev.preventDefault();

  const { table, at, kind } = found;
  const host = table.parentElement;
  const style = getComputedStyle(host);
  // La largeur du tableau se dit en part de la colonne de texte ; celle d'une
  // colonne, en part du tableau. Les deux mesures sont prises maintenant : le
  // glissement les fera bouger.
  const room = host.getBoundingClientRect().width
    - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const width = table.getBoundingClientRect().width;

  sizing = {
    table,
    at,
    kind,
    share: widthsOf(table) ?? equal(columns(table)),
    startX: ev.clientX,
    width,
    room,
    start: (width / room) * 100,
    place: placeOf(table.getAttribute('style') ?? ''),
  };

  rich.setPointerCapture(ev.pointerId);
  document.body.classList.add('is-resizing');
}

function moveSizing(ev) {
  const { table, at, kind, share, startX } = sizing;

  if (kind === 'table') {
    const width = Math.min(100, Math.max(FLOOR, sizing.start + ((ev.clientX - startX) / sizing.room) * 100));
    const style = tables.frame(width >= 100 ? '' : `${round(width)}%`, sizing.place);
    if (style) table.setAttribute('style', style);
    else table.removeAttribute('style');
    return;
  }

  // Les deux colonnes voisines se partagent une place fixe : ce que l'une
  // gagne, l'autre le perd, et le total ne bouge pas.
  const pair = share[at] + share[at + 1];
  const moved = ((ev.clientX - startX) / sizing.width) * 100;
  const left = Math.min(pair - FLOOR, Math.max(FLOOR, share[at] + moved));

  const next = [...share];
  next[at] = round(left);
  next[at + 1] = round(pair - left);
  widths(table, next);
}

function endSizing(ev) {
  if (!sizing) return;
  const { table, kind } = sizing;

  if (rich.hasPointerCapture(ev.pointerId)) rich.releasePointerCapture(ev.pointerId);
  document.body.classList.remove('is-resizing');
  sizing = null;

  // Le fichier ne porte que des entiers : on s'y range à la fin du geste,
  // plutôt que d'écrire une largeur qui changerait toute seule au rechargement.
  if (kind === 'table') {
    const style = table.getAttribute('style') ?? '';
    const found = style.match(/width:\s*(\d+(?:\.\d+)?)%/);
    if (found) table.setAttribute('style', tables.frame(`${Math.round(Number(found[1]))}%`, placeOf(style)));
  } else {
    const share = widthsOf(table);
    if (share) widths(table, whole(share));
  }
  commit();
}

const round = (value) => Math.round(value * 10) / 10;

/** Des pourcentages entiers dont la somme reste ronde. */
function whole(share) {
  if (!share.length) return share;
  const out = share.map((w) => Math.max(FLOOR, Math.round(w)));
  const drift = 100 - out.reduce((a, b) => a + b, 0);
  out[out.length - 1] = Math.max(FLOOR, out[out.length - 1] + drift);
  return out;
}

// ------------------------------------------------- déplacement au clavier

/**
 * La cellule où se trouve le curseur, s'il y en a une.
 *
 * Un bloc de code dans une cellule garde ses propres touches — la tabulation y
 * indente — d'où le `pre` dans le sélecteur : s'il se trouve entre la cellule
 * et le curseur, c'est lui qui est visé, et le tableau s'efface.
 */
function cellAt() {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;

  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;

  const found = node?.closest('pre, th, td');
  if (!found || found.tagName === 'PRE' || !rich.contains(found)) return null;
  return found;
}

/**
 * Passe à la cellule suivante, ou à la précédente.
 *
 * Après la dernière, une rangée s'ajoute — c'est ce que fait tout traitement de
 * texte, et c'est la seule suite qu'une tabulation puisse avoir là. Avant la
 * première, il n'y a rien : le curseur reste où il est.
 */
function step(cell, back) {
  const table = cell.closest('table');
  const cells = [...table.querySelectorAll('th, td')];
  const at = cells.indexOf(cell);
  if (at < 0) return;

  const target = cells[at + (back ? -1 : 1)];
  if (target) {
    // Le contenu est pris en entier, comme dans un traitement de texte : ce
    // qu'on frappe ensuite remplace la cellule, et une flèche suffit à s'y
    // replacer.
    place(target, 'whole');
    return;
  }

  if (back) {
    // Avant la première cellule, on sort du tableau par le haut plutôt que de
    // rester sans issue.
    let above = table.previousElementSibling;
    if (!above) {
      above = el('p', {}, el('br'));
      table.before(above);
      commit();
    }
    place(above, 'end');
    return;
  }

  const rows = [...table.querySelectorAll('tr')];
  const row = blank(table, rows[rows.length - 1]);
  (table.querySelector('tbody') ?? table).append(row);
  commit();
  place(row.firstElementChild, 'whole');
}

/**
 * Porte le curseur dans un nœud : au début, à la fin, ou sur tout son contenu.
 */
function place(node, mode = 'start') {
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  if (mode === 'start') range.collapse(true);
  else if (mode === 'end') range.collapse(false);

  rich.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  node.scrollIntoView?.({ block: 'nearest' });
}

/** Renvoie au Markdown ce que l'on vient de changer. */
function commit() {
  rich.dispatchEvent(new Event('input', { bubbles: true }));
}

export function wire() {
  say = wireHints(dialog, status, () => RESTING);

  // Redimensionnement des colonnes à la souris, sur les bordures de la
  // première ligne. Les trois événements vivent sur le bloc rendu : la capture
  // du pointeur suit le glissement même quand il sort du tableau.
  // Tabulation : de cellule en cellule, comme dans un traitement de texte.
  rich.addEventListener('keydown', (ev) => {
    if (!isTab(ev) || !rich.isContentEditable) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // La liste des langages d'un bloc de code garde ses touches.
    if (ev.target.closest?.('.chrome')) return;

    const cell = cellAt();
    if (!cell) return;

    ev.preventDefault();
    step(cell, ev.shiftKey);
  });

  rich.addEventListener('pointerdown', startSizing);
  rich.addEventListener('pointermove', (ev) => (sizing ? moveSizing(ev) : hover(ev)));
  rich.addEventListener('pointerup', endSizing);
  rich.addEventListener('pointercancel', endSizing);

  closeBtn.append(icon(PATH.close, { size: 13 }));
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  applyBtn.addEventListener('click', submit);

  // Changer le nombre de colonnes rend les largeurs incohérentes : on les
  // remet à parts égales plutôt que de les ignorer en silence à l'insertion.
  columnsField.addEventListener('change', fillWidths);

  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) close();
  });
  dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
    // Entrée vaut le bouton principal, sauf sur les deux boutons du pied qui
    // ont chacun leur propre sens.
    if (ev.key === 'Enter' && !ev.target.closest('.modal__foot')) {
      ev.preventDefault();
      submit();
    }
  });
}
