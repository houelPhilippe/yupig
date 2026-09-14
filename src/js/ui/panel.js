// Volet « Gérer les fils » : ajout, groupement par catégorie, renommage,
// réordonnancement par glisser-déposer, suppression, cadence de
// rafraîchissement.

import { el, icon, replace, PATH } from './dom.js';
import * as store from '../store.js';

const panel = document.getElementById('panel');
const list = document.getElementById('panel-list');
const seg = document.getElementById('refresh-seg');
const thumbSeg = document.getElementById('thumb-seg');
const reservedSeg = document.getElementById('reserved-seg');

// Ligne en cours d'édition — un état de vue, pas de données. Le garder ici
// plutôt que dans `store` évite qu'une collecte de fond, qui redessine tout,
// efface la saisie en cours. `focus` retient le champ à réactiver après un
// redessin. { id, name, cat, focus }
let editing = null;

// Glissement en cours. Tant qu'il dure on ne redessine pas : remplacer les
// noeuds sous le pointeur romprait la capture et figerait la ligne.
let drag = null;
let deferred = null;

export function render(state) {
  if (drag) {
    deferred = state;
    return;
  }

  panel.hidden = !state.panelOpen;
  if (!state.panelOpen) return;

  // Un fil supprimé pendant l'édition n'a plus de ligne à éditer.
  if (editing && !state.feeds.some((f) => f.id === editing.id)) editing = null;

  // Catégories dans l'ordre d'apparition des fils, comme le rail.
  const cats = [...new Set(state.feeds.map((f) => f.cat))];

  const groups = cats.map((cat) => {
    const feeds = state.feeds.filter((f) => f.cat === cat);
    return el(
      'div.group',
      {},
      el(
        'div.group__head',
        {},
        el('h6', {}, cat),
        el('span.group__count', {}, String(feeds.length)),
      ),
      ...feeds.map((f) => (editing?.id === f.id ? editRow(f, cats) : row(f, state, feeds))),
    );
  });

  if (groups.length === 0) {
    groups.push(el('div.hint', {}, 'Aucun fil suivi. Collez une adresse ci-dessus, ou importez un OPML.'));
  } else {
    groups.push(el('div.hint', {}, 'Un fil retiré emporte ses articles ; les favoris disparaissent avec lui.'));
  }

  replace(list, groups);
  restoreFocus();

  const current = String(state.settings.refreshMinutes);
  for (const input of seg.querySelectorAll('input[name="freq"]')) {
    input.checked = input.value === current;
  }

  // Les deux réglages d'affichage reflètent ce qui est persisté.
  check(thumbSeg, 'thumb', state.settings.showThumbnails);
  check(reservedSeg, 'reserved', state.settings.showReservedTile);
}

function check(seg, name, on) {
  for (const input of seg.querySelectorAll(`input[name="${name}"]`)) {
    input.checked = input.value === (on ? '1' : '0');
  }
}

// ------------------------------------------------------------ ligne de fil

function row(f, state, siblings) {
  const name = el(
    'button.feed-row__name',
    {
      title: f.lastError ?? f.name,
      onclick: () => store.selectFeed(f.id).catch(store.fail),
    },
    f.name,
    el('span.feed-row__url', {}, f.url),
  );
  if (state.feedId === f.id) name.style.color = 'var(--color-accent-700)';

  const status = f.ok
    ? el('span.feed-row__unread', {}, String(f.unread))
    : el('span.tag.tag-outline', { style: 'font-size:10px;padding:1px 6px', title: f.lastError ?? 'collecte en échec' }, 'ERR');

  const rename = el('button.btn.btn-ghost.btn-icon', {
    title: 'Renommer ce fil',
    onclick: () => startEdit(f),
  });
  rename.append(icon(PATH.pencil, { size: 14 }));

  const remove = el('button.btn.btn-ghost.btn-icon', {
    title: 'Retirer ce fil',
    onclick: () => store.removeFeed(f.id).catch(store.fail),
  });
  remove.append(icon(PATH.trash, { size: 14 }));

  // Seul le grip déclenche le glissement : le reste de la ligne garde ses
  // clics. Un groupe d'un seul fil n'a rien à réordonner.
  const grip = el('span.feed-row__grip', {
    title: siblings.length > 1 ? 'Glisser pour réordonner' : null,
    'aria-hidden': 'true',
  });
  grip.append(icon(PATH.grip, { size: 14 }));

  const node = el(
    'div.feed-row',
    {},
    grip,
    el('span.mono.mono--row', {}, f.mono),
    name,
    status,
    rename,
    remove,
  );
  node.dataset.feedId = String(f.id);

  if (siblings.length > 1) {
    grip.addEventListener('pointerdown', (ev) => startDrag(ev, node));
  } else {
    grip.classList.add('feed-row__grip--idle');
  }
  return node;
}

// --------------------------------------------------------------- renommage

function startEdit(f) {
  editing = { id: f.id, name: f.name, cat: f.cat, focus: 'name' };
  store.emit();
}

function cancelEdit() {
  editing = null;
  store.emit();
}

function commitEdit() {
  if (!editing) return;
  const { id, name, cat } = editing;
  // Le coeur Rust refuse les champs vides ; ne pas l'appeler pour rien.
  if (!name.trim() || !cat.trim()) return;
  editing = null;
  store.renameFeed(id, name, cat).catch(store.fail);
}

/** La ligne en mode édition : nom, catégorie, et les deux issues. */
function editRow(f, cats) {
  const keys = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commitEdit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelEdit();
    }
  };

  const name = el('input.input.feed-edit__input', {
    value: editing.name,
    'aria-label': 'Nom du fil',
    onfocus: () => { editing.focus = 'name'; },
    oninput: (ev) => { editing.name = ev.target.value; },
    onkeydown: keys,
  });

  // Les catégories déjà en place sont proposées : c'est le moyen de ranger
  // un fil ailleurs sans risquer une variante orthographique.
  const listId = `cats-${f.id}`;
  const cat = el('input.input.feed-edit__input', {
    value: editing.cat,
    list: listId,
    'aria-label': 'Catégorie',
    placeholder: 'Catégorie',
    onfocus: () => { editing.focus = 'cat'; },
    oninput: (ev) => { editing.cat = ev.target.value; },
    onkeydown: keys,
  });

  const options = el('datalist', { id: listId }, ...cats.map((c) => el('option', { value: c })));

  return el(
    'div.feed-row.feed-row--editing',
    {},
    el('span.mono.mono--row', {}, f.mono),
    el(
      'div.feed-edit',
      {},
      name,
      cat,
      options,
      el(
        'div.feed-edit__actions',
        {},
        el('button.btn.btn-primary', { style: 'height:26px;font-size:11px', onclick: commitEdit }, 'Enregistrer'),
        el('button.btn.btn-secondary', { style: 'height:26px;font-size:11px', onclick: cancelEdit }, 'Annuler'),
      ),
    ),
  );
}

/** Rend le curseur au champ qu'un redessin vient de remplacer. */
function restoreFocus() {
  if (!editing) return;
  const inputs = list.querySelectorAll('.feed-edit__input');
  const field = inputs[editing.focus === 'cat' ? 1 : 0];
  if (!field || field === document.activeElement) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

// ---------------------------------------------------- glisser-déposer

// Le glissement se fait aux événements de pointeur plutôt qu'à l'API
// HTML5 `dragstart` : celle-ci est irrégulière dans la webview WebKitGTK
// utilisée sous Linux, et ne donnerait pas l'aperçu du déplacement.
//
// Il reste borné à la catégorie : `reorder_feeds` ne touche qu'aux
// positions, jamais au classement. Changer un fil de catégorie se fait par
// le renommage, qui porte les deux champs.
function startDrag(ev, node) {
  if (ev.button !== 0 && ev.pointerType === 'mouse') return;
  if (editing) return;

  const group = node.parentElement;
  const rows = [...group.querySelectorAll('.feed-row')];
  const from = rows.indexOf(node);
  if (from < 0 || rows.length < 2) return;

  ev.preventDefault();
  const rects = rows.map((r) => r.getBoundingClientRect());
  drag = { node, rows, rects, from, to: from, startY: ev.clientY, height: rects[from].height };

  node.classList.add('feed-row--dragging');
  list.classList.add('panel__list--dragging');
  node.setPointerCapture(ev.pointerId);
  node.addEventListener('pointermove', onDragMove);
  node.addEventListener('pointerup', endDrag);
  node.addEventListener('pointercancel', endDrag);
}

function onDragMove(ev) {
  if (!drag) return;
  const { rows, rects, from, height } = drag;
  const dy = ev.clientY - drag.startY;
  drag.node.style.transform = `translateY(${dy}px)`;

  // Cible : la ligne la plus éloignée dont le milieu a été franchi.
  const centre = rects[from].top + rects[from].height / 2 + dy;
  let to = from;
  for (let i = 0; i < rects.length; i++) {
    if (i === from) continue;
    const mid = rects[i].top + rects[i].height / 2;
    if (i < from && centre < mid) to = Math.min(to, i);
    if (i > from && centre > mid) to = Math.max(to, i);
  }
  drag.to = to;

  // Les lignes franchies s'écartent, pour montrer la place qui se libère.
  for (let i = 0; i < rows.length; i++) {
    if (i === from) continue;
    let shift = 0;
    if (i > from && i <= to) shift = -height;
    if (i < from && i >= to) shift = height;
    rows[i].style.transform = shift ? `translateY(${shift}px)` : '';
  }
}

function endDrag(ev) {
  if (!drag) return;
  const { node, rows, from, to } = drag;

  node.removeEventListener('pointermove', onDragMove);
  node.removeEventListener('pointerup', endDrag);
  node.removeEventListener('pointercancel', endDrag);
  if (node.hasPointerCapture(ev.pointerId)) node.releasePointerCapture(ev.pointerId);

  node.classList.remove('feed-row--dragging');
  list.classList.remove('panel__list--dragging');
  for (const r of rows) r.style.transform = '';

  const ids = rows.map((r) => Number(r.dataset.feedId));
  drag = null;

  if (from !== to && ev.type === 'pointerup') {
    store.reorderFeeds(globalOrder(ids, from, to)).catch(store.fail);
    deferred = null;
    return;
  }

  // Rien n'a bougé : on rejoue le redessin retenu pendant le glissement.
  if (deferred) {
    const state = deferred;
    deferred = null;
    render(state);
  }
}

/**
 * L'ordre complet des fils après déplacement de `from` vers `to` dans un
 * groupe. Les fils des autres catégories gardent leur rang : seules les
 * places occupées par le groupe sont redistribuées.
 */
function globalOrder(groupIds, from, to) {
  const moved = groupIds.slice();
  moved.splice(to, 0, ...moved.splice(from, 1));

  const inGroup = new Set(groupIds);
  let k = 0;
  return store.state.feeds.map((f) => (inGroup.has(f.id) ? moved[k++] : f.id));
}
