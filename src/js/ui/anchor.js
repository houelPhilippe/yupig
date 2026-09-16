// Boîte du signet d'un titre.
//
// Un signet est l'identifiant que porte un titre : `## Titre {#mon-signet}`,
// la syntaxe d'attributs de Pandoc. Il ne se voit pas dans le document — c'est
// une cible, pas du texte : en HTML il devient l'ancre du titre, et un lien
// `[voir](#mon-signet)` y mène, en HTML comme en PDF.
//
// La boîte ne pose rien elle-même : elle rend l'identifiant choisi à
// l'appelant, qui seul sait où l'écrire — sur le nœud du titre dans le rendu,
// sur sa ligne dans la source. C'est le partage qu'ont déjà la boîte du
// shortcode et celle du tableau.

import { icon, wireHints, PATH } from './dom.js';
import { slug, unique, valid } from '../anchors.js';

const dialog = document.getElementById('anchor-dialog');
const heading = document.getElementById('anchor-dialog-title');
const closeBtn = document.getElementById('anchor-dialog-close');
const cancelBtn = document.getElementById('anchor-cancel');
const applyBtn = document.getElementById('anchor-apply');
const removeBtn = document.getElementById('anchor-remove');
const status = document.getElementById('anchor-status');
const field = document.getElementById('anchor-id');
const suggestBtn = document.getElementById('anchor-suggest');

let deliver = null;
let subject = null;
let say = () => {};

/**
 * Ouvre la boîte sur un titre.
 *
 * `subject` décrit le titre sans dire où il est : son texte, le signet qu'il
 * porte déjà, et les identifiants déjà pris dans le document — de quoi en
 * proposer un qui ne soit pas un doublon. `run` reçoit l'identifiant retenu, ou
 * `null` si l'on retire le signet.
 */
export function open(about, run) {
  subject = about;
  deliver = run;

  field.value = about.id ?? propose();
  // Retirer n'a de sens que s'il y a quelque chose à retirer.
  removeBtn.disabled = !about.id;
  heading.textContent = about.id ? 'Signet du titre' : 'Poser un signet';
  applyBtn.textContent = about.id ? 'Appliquer' : 'Poser';

  refresh();
  dialog.hidden = false;
  field.focus();
  field.select();
}

function hide() {
  dialog.hidden = true;
  deliver = null;
  subject = null;
}

/** Un identifiant tiré du texte du titre, unique dans le document. */
function propose() {
  if (!subject) return '';
  return unique(slug(subject.text), subject.taken ?? []);
}

/** L'identifiant saisi est-il utilisable ? */
function usable(id) {
  if (!valid(id)) return false;
  // Le signet qu'il porte déjà n'est pas un doublon de lui-même.
  return id === subject?.id || !(subject?.taken ?? []).includes(id);
}

/**
 * Ce que la barre d'état montre : la ligne exacte qui partira dans le fichier,
 * ou ce qui empêche de l'écrire.
 *
 * C'est aussi le texte de repos de la barre — celui qu'elle retrouve quand on
 * quitte un champ : sans cela, l'explication du champ l'effacerait en partant.
 */
function preview() {
  if (!subject) return '';
  const id = field.value.trim();

  if (!id) return 'Sans identifiant, le titre n’a pas de signet — « Retirer » le lui ôte.';
  if (!valid(id)) {
    return 'Un identifiant commence par une lettre ou un chiffre, et ne porte ni espace ni accolade.';
  }
  if (!usable(id)) {
    return `« ${id} » est déjà pris ailleurs dans le document : un lien ne saurait auquel des deux mener.`;
  }
  return `${'#'.repeat(subject.level)} ${subject.text} {#${id}}`;
}

function refresh() {
  applyBtn.disabled = !usable(field.value.trim());
  say(preview());
}

function submit() {
  const id = field.value.trim();
  if (!usable(id)) return;

  const run = deliver;
  hide();
  run?.(id);
}

function drop() {
  const run = deliver;
  hide();
  run?.(null);
}

export function wire() {
  say = wireHints(dialog, status, preview);

  closeBtn.append(icon(PATH.close, { size: 13 }));
  closeBtn.addEventListener('click', hide);
  cancelBtn.addEventListener('click', hide);
  applyBtn.addEventListener('click', submit);
  removeBtn.addEventListener('click', drop);

  field.addEventListener('input', refresh);
  suggestBtn.addEventListener('click', () => {
    field.value = propose();
    field.focus();
    refresh();
  });

  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) hide();
  });
  dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      hide();
    }
    if (ev.key === 'Enter' && !ev.target.closest('.modal__foot')) {
      ev.preventDefault();
      submit();
    }
  });
}
