// Barre d'état, en pied de fenêtre : la version de l'application à gauche, la
// sorte du document ouvert à droite, et — en « Code Markdown » seulement — la
// ligne et la colonne où se trouve le curseur.
//
// La position ne passe pas par l'état : elle change à chaque flèche du clavier,
// et la faire transiter par `store.emit` redessinerait tout le document pour
// deux nombres. Ce module l'écrit donc lui-même dans son coin de page, sur les
// événements de la zone de saisie. `render`, lui, ne s'occupe que de ce qui
// vient bien de l'état — l'application à l'écran, l'onglet, le mode.

import * as store from '../store.js';
import * as api from '../api.js';

const bar = document.getElementById('statusbar');
const versionLabel = document.getElementById('status-version');
const kindLabel = document.getElementById('status-kind');
const positionLabel = document.getElementById('status-position');
const area = document.getElementById('editor-area');

/**
 * Le nom courant de chaque sorte de fichier, par extension.
 *
 * Les extensions sont celles que `files.rs` ouvre — la table ne dit pas ce qui
 * s'ouvre, elle ne fait que le nommer. Ce qu'elle ne connaît pas se dit par son
 * extension en capitales : « TOML » vaut mieux que « Fichier », et une
 * extension de plus côté Rust n'oblige pas à revenir ici.
 */
const KINDS = {
  md: 'Markdown', markdown: 'Markdown', mdown: 'Markdown',
  txt: 'Texte', text: 'Texte',
  rst: 'reStructuredText', adoc: 'AsciiDoc', asciidoc: 'AsciiDoc',
  org: 'Org', tex: 'LaTeX',
  html: 'HTML', htm: 'HTML', css: 'CSS',
  js: 'JavaScript', mjs: 'JavaScript',
  json: 'JSON', toml: 'TOML', yaml: 'YAML', yml: 'YAML', xml: 'XML', csv: 'CSV',
  rs: 'Rust', py: 'Python', sh: 'Shell', sql: 'SQL',
  ini: 'INI', conf: 'Configuration', log: 'Journal',
};

export function render(state) {
  // La barre appartient à « Édition » : « Veille » ne montre pas de fichier.
  if (state.app !== 'edition') {
    bar.hidden = true;
    return;
  }

  // Elle reste là sans document ouvert, ce qu'elle ne faisait pas : ce qui la
  // faisait se retirer, c'est qu'elle n'apprenait alors rien — la version y
  // étant toujours, ce n'est plus le cas.
  bar.hidden = false;

  const tab = store.activeTab();
  kindLabel.hidden = !tab;
  if (!tab) {
    positionLabel.hidden = true;
    return;
  }

  kindLabel.textContent = kindOf(tab.name);
  kindLabel.title = tab.path;

  // Seule la source a des lignes : le rendu n'en montre pas, et ce qu'on y
  // compterait ne correspondrait à rien de ce que le fichier porte.
  positionLabel.hidden = store.mode() !== 'code';
  if (!positionLabel.hidden) position();
}

/** La sorte du fichier, telle qu'elle s'annonce en pied de fenêtre. */
function kindOf(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return KINDS[ext] ?? (ext ? ext.toUpperCase() : 'Fichier');
}

/**
 * La ligne et la colonne du curseur dans la source.
 *
 * Les deux comptent depuis 1, comme les dit un éditeur de texte et comme les
 * nomme le sommaire. La colonne se mesure en caractères depuis le début de la
 * ligne logique — celle que le fichier porte, non celle que le repli dessine à
 * l'écran : c'est la ligne du fichier qu'un message d'erreur d'outil de
 * compilation désignera.
 */
function position() {
  const text = area.value;
  const at = area.selectionStart;

  // On parcourt sans découper : le texte peut peser quelques méga-octets, et
  // ce calcul se refait à chaque frappe — un `slice` y taillerait une copie du
  // document à chaque lettre.
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) line += 1;
  // `lastIndexOf` ramène son point de départ à zéro s'il est négatif : sans ce
  // garde-fou, un curseur au tout début d'un document commençant par un saut
  // de ligne trouverait ce saut et se dirait en colonne zéro.
  const bol = at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1;

  positionLabel.textContent = `Ligne ${line}, colonne ${at - bol + 1}`;
}

/** Remet la position à jour si elle est à l'écran. */
function refresh() {
  if (!positionLabel.hidden && !bar.hidden) position();
}

export function wire() {
  // La version ne change pas d'une session à l'autre : une seule lecture au
  // démarrage. Si l'API venait à la refuser, la place reste vide — une barre
  // d'état n'est pas un endroit où signaler une panne.
  api.appVersion().then((v) => {
    versionLabel.textContent = `Version ${v}`;
  }).catch(() => {});

  // `selectionchange` couvre tout ce qui déplace le curseur, la souris comme
  // les flèches ; les trois autres sont là parce que sa portée aux champs de
  // saisie n'est pas également acquise d'un moteur à l'autre. Les poser tous
  // ne coûte rien : la mise à jour ne fait qu'écrire deux nombres.
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === area) refresh();
  });
  for (const name of ['input', 'click', 'keyup']) area.addEventListener(name, refresh);
}
