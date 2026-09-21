// Boîte de choix du projet : les projets connus, et la création d'un projet
// neuf sur un dossier existant.
//
// C'est la porte d'entrée de « Édition » : elle s'ouvre au démarrage qui rend
// la main à cette coque, et chaque fois qu'on y vient sans projet. Rien n'y est
// construit par concaténation de HTML — les noms et les chemins viennent du
// disque de l'utilisateur et ne passent que par `textContent`.

import { el, icon, PATH, wireHints } from './dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import * as format from '../format.js';

const dialog = document.getElementById('projects-dialog');
const closeBtn = document.getElementById('projects-dialog-close');
const cancelBtn = document.getElementById('projects-cancel');
const list = document.getElementById('projects-list');
const status = document.getElementById('projects-status');

const pathField = document.getElementById('project-new-path');
const nameField = document.getElementById('project-new-name');
const browseBtn = document.getElementById('project-new-browse');
const createBtn = document.getElementById('project-new-create');
const adoptBtn = document.getElementById('project-adopt');

/** Le dossier désigné pour le projet à créer, tant qu'il n'est pas créé. */
let pending = null;

/** Écrit dans la barre d'état ; posé par `wireHints`. */
let say = () => {};

/** Le texte de repos de la barre : ce qu'il reste à faire. */
function resting() {
  if (!store.state.edition.root) return 'Choisissez un projet, ou créez-en un.';
  return `Projet ouvert : ${store.state.edition.root}`;
}

/** Ce qui, changeant, oblige à redessiner la liste. */
let seen = null;

export function render(state) {
  const { picker, projects, root } = state.edition;
  dialog.hidden = !picker;
  if (!picker) {
    seen = null;
    return;
  }

  // La collecte de fond notifie toutes les minutes : rebâtir la liste à chaque
  // fois retirerait le clavier de la ligne où il se trouve, et effacerait
  // l'explication du champ survolé.
  const sig = `${root}|${projects.map((p) => `${p.root}\u0001${p.opened}`).join('\u0000')}`;
  if (sig === seen) return;
  seen = sig;

  // Fermer n'a de sens que s'il reste quelque chose à l'écran derrière : sans
  // projet ouvert, l'éditeur n'a rien à montrer — on le dit plutôt que de
  // laisser le bouton mener à une page vide.
  cancelBtn.textContent = root ? 'Fermer' : 'Plus tard';

  list.replaceChildren(
    ...(projects.length === 0
      ? [el('p.projects__empty', {}, 'Aucun projet pour l’instant.')]
      : projects.map((p) => line(p, root))),
  );

  createBtn.disabled = !pending;
  say(resting());
}

/** Une ligne de la liste : le projet, et de quoi le retirer. */
function line(p, openRoot) {
  const current = p.root === openRoot;

  const open = el(
    'button.projects__open',
    {
      type: 'button',
      // Un dossier disparu ne s'ouvre pas ; la ligne reste pour qu'on
      // puisse la retirer.
      disabled: !p.available,
      'aria-current': current ? 'true' : null,
      title: p.root,
      onclick: () => choose(p),
    },
    el('span.projects__mark', {}, icon(PATH.folder, { size: 15 })),
    el(
      'span.projects__text',
      {},
      el('span.projects__name', {}, p.name),
      el('span.projects__path', {}, p.root),
    ),
    el('span.projects__when', {}, when(p)),
  );

  const forget = el(
    'button.projects__forget.btn.btn-ghost.btn-icon',
    {
      type: 'button',
      title: 'Retirer de la liste',
      'aria-label': `Retirer « ${p.name} » de la liste`,
      onclick: () => forgetOne(p),
    },
    icon(PATH.close, { size: 13 }),
  );

  return el('div.projects__row', { 'data-missing': !p.available || null }, open, forget);
}

/** Ce que la ligne dit de sa date, à droite. */
function when(p) {
  if (!p.available) return 'introuvable';
  return p.opened ? format.relative(p.opened) : 'jamais ouvert';
}

/**
 * Un changement de projet referme tous les onglets : on ne le fait pas sous
 * les doigts de quelqu'un dont un document n'est pas enregistré.
 */
async function mayLeave() {
  if (!store.hasUnsaved()) return true;
  return api.ask(
    'Des documents ne sont pas enregistrés.\n' +
      'Changer de projet fermera leurs onglets et perdra ces modifications.\n\n' +
      'Continuer ?',
    { title: 'Changer de projet', okLabel: 'Continuer' },
  );
}

async function choose(p) {
  if (p.root === store.state.edition.root) {
    store.closePicker();
    return;
  }
  if (!(await mayLeave())) return;
  try {
    await store.chooseProject(p.root);
    store.notify(`Projet « ${p.name} » ouvert.`);
  } catch (err) {
    store.fail(err);
    // Le dossier a pu disparaître depuis que la liste a été dressée.
    await store.openPicker();
  }
}

async function forgetOne(p) {
  const ok = await api.ask(
    `Retirer « ${p.name} » de la liste ?\n\nLe dossier et ses fichiers ne sont pas touchés.`,
    { title: 'Retirer le projet', okLabel: 'Retirer' },
  );
  if (!ok) return;
  try {
    await store.forgetProject(p.root);
  } catch (err) {
    store.fail(err);
  }
}

export function wire() {
  closeBtn.append(icon(PATH.close, { size: 13 }));
  say = wireHints(dialog, status, resting);

  closeBtn.addEventListener('click', () => store.closePicker());
  cancelBtn.addEventListener('click', () => store.closePicker());

  // Un clic sur le voile ferme, un clic dans la boîte non — comme les autres.
  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) store.closePicker();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && store.state.edition.picker) {
      ev.preventDefault();
      store.closePicker();
    }
  });

  browseBtn.addEventListener('click', browse);
  nameField.addEventListener('input', () => {
    createBtn.disabled = !pending;
  });
  createBtn.addEventListener('click', create);
  adoptBtn.addEventListener('click', adopt);
}

/** Désigne le dossier du projet à créer, et propose son nom. */
async function browse() {
  try {
    const path = await api.pickProjectDir();
    if (!path) return;
    pending = path;
    pathField.value = path;
    // Le nom du dossier fait un nom de projet convenable ; on le propose
    // plutôt que de laisser un champ vide, et il reste modifiable.
    if (!nameField.value.trim()) nameField.value = baseName(path);
    createBtn.disabled = false;

    // Dire tout de suite ce que « Créer » fera de ce dossier-là : un dossier
    // qui porte déjà un témoin s'ouvrira au lieu de se créer, et le savoir
    // avant de presser vaut mieux que de l'apprendre par une question.
    const already = await api.projectNameAt(path);
    say(
      !already
        ? `Le projet sera créé sur « ${path} ».`
        : `« ${path} » est déjà le projet « ${already} » : « Créer » proposera de l’ouvrir.`,
    );
  } catch (err) {
    store.fail(err);
  }
}

async function create() {
  if (!pending || !(await mayLeave())) return;
  const name = nameField.value.trim() || baseName(pending);
  createBtn.disabled = true;
  try {
    // Un dossier qui porte déjà un témoin n'est pas à créer une seconde fois :
    // c'est le même projet, qu'on l'ait retiré de la liste ou qu'il vienne
    // d'ailleurs. On propose donc de l'ouvrir — ce qui le remet dans la liste
    // avec son nom et sa date d'origine — plutôt que de refuser sans issue.
    // Le témoin, lui, n'est pas réécrit : c'est ce qui fait qu'un projet
    // partagé reste le même projet partout.
    const already = await api.projectNameAt(pending);
    if (already) {
      const ok = await api.ask(
        `Ce dossier est déjà le projet « ${already} ».\n\n`
          + 'L’ouvrir ? Il retrouve sa place dans la liste, avec son nom et sa date de création.',
        { title: 'Dossier déjà projet', okLabel: 'Ouvrir' },
      );
      if (!ok) {
        createBtn.disabled = false;
        return;
      }
      await store.chooseProject(pending);
      pending = null;
      pathField.value = '';
      nameField.value = '';
      store.notify(`Projet « ${already} » ouvert.`);
      return;
    }

    await store.createProject(pending, name);
    pending = null;
    pathField.value = '';
    nameField.value = '';
    store.notify(`Projet « ${name} » créé.`);
  } catch (err) {
    store.fail(err);
    createBtn.disabled = false;
  }
}

/** Ouvre un projet que la liste ne connaît pas : un dossier venu d'ailleurs. */
async function adopt() {
  if (!(await mayLeave())) return;
  try {
    const path = await api.pickProjectDir();
    if (!path) return;
    await store.chooseProject(path);
    store.notify('Projet ouvert.');
  } catch (err) {
    store.fail(err);
  }
}

/** Le dernier segment d'un chemin, quel que soit le séparateur. */
function baseName(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
