// Boîte de dialogue « Paramètres du projet » : la mise en page du document.
//
// Les réglages accompagnent le dossier ouvert, pas l'application — deux projets
// peuvent demander deux mises en page différentes. Ils sont appliqués par des
// variables CSS portées par la racine, ce qui évite d'aller poser un style sur
// chaque paragraphe du rendu.

import { icon, PATH } from './dom.js';
import * as store from '../store.js';

const button = document.getElementById('project-settings');
const dialog = document.getElementById('project-dialog');
const closeBtn = document.getElementById('project-dialog-close');
const alignSeg = document.getElementById('align-seg');
const leadingSeg = document.getElementById('leading-seg');
const ringSeg = document.getElementById('ring-seg');

/** L'alignement demandé, traduit en valeur CSS. */
const ALIGN = { gauche: 'left', justifie: 'justify' };

let applied = null;

export function render(state) {
  if (state.app !== 'edition') return;

  const { project, dialogOpen, root } = state.edition;

  // Sans projet ouvert, il n'y a pas de réglages à modifier.
  button.disabled = !root;
  dialog.hidden = !dialogOpen;

  const sig = `${project.align}|${project.lineHeight}|${project.showOutline}`;
  if (sig !== applied) {
    applied = sig;
    const css = document.documentElement.style;
    css.setProperty('--doc-align', ALIGN[project.align] ?? 'left');
    // L'interligne est stocké en centièmes : 165 vaut 1,65.
    css.setProperty('--doc-leading', String(project.lineHeight / 100));
    // Le liseré se retire par son épaisseur : une règle de moins à écrire, et
    // la feuille de style garde la couleur et la place du trait.
    css.setProperty('--doc-ring', project.showOutline === false ? '0' : '2px');
  }

  if (!dialogOpen) return;
  check(alignSeg, 'align', project.align);
  check(leadingSeg, 'leading', String(project.lineHeight));
  check(ringSeg, 'ring', project.showOutline === false ? '0' : '1');
}

function check(seg, name, value) {
  for (const input of seg.querySelectorAll(`input[name="${name}"]`)) {
    input.checked = input.value === value;
  }
}

export function wire() {
  button.append(icon(PATH.sliders, { size: 14 }));
  closeBtn.append(icon(PATH.close, { size: 13 }));

  button.addEventListener('click', () => store.toggleProjectDialog(true));
  closeBtn.addEventListener('click', () => store.toggleProjectDialog(false));

  // Un clic sur le voile ferme, un clic dans la boîte non.
  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) store.toggleProjectDialog(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && store.state.edition.dialogOpen) {
      ev.preventDefault();
      store.toggleProjectDialog(false);
    }
  });

  alignSeg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'align') return;
    store.saveProjectSettings({ align: ev.target.value }).catch(store.fail);
  });

  leadingSeg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'leading') return;
    store.saveProjectSettings({ lineHeight: Number(ev.target.value) }).catch(store.fail);
  });

  ringSeg.addEventListener('change', (ev) => {
    if (ev.target.name !== 'ring') return;
    store.saveProjectSettings({ showOutline: ev.target.value === '1' }).catch(store.fail);
  });
}
