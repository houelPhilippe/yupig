// Zone d'édition centrale : les onglets, les trois regards, l'enregistrement.
//
// Le Markdown est la seule vérité : c'est lui qui vit dans l'onglet et qui part
// sur le disque. « Modifier » et « Voir » n'en sont que des rendus, obtenus par
// `marked` puis assainis ; ce qu'on y saisit repasse par `turndown` avant de
// revenir au Markdown. Le `<textarea>` et le bloc rendu ne sont donc jamais que
// des affichages, qu'on ne réécrit que lorsqu'ils divergent vraiment — les
// réécrire à chaque rendu ferait sauter le curseur à chaque frappe.

import { el, icon, replace, PATH } from './dom.js';
import * as store from '../store.js';
import { toFragment, toMarkdown, ready } from '../markdown.js';
import { splitFront } from '../frontmatter.js';
import { openExternal, assetUrl } from '../api.js';
import * as code from './code.js';
import * as menu from './menu.js';

const bar = document.getElementById('tabs');
const area = document.getElementById('editor-area');
const rich = document.getElementById('editor-rich');
const empty = document.getElementById('editor-empty');
const saveBtn = document.getElementById('doc-save');

const MODES = [
  { id: 'edit', el: document.getElementById('mode-edit'), path: PATH.pencil },
  { id: 'view', el: document.getElementById('mode-view'), path: PATH.eye },
  { id: 'code', el: document.getElementById('mode-code'), path: PATH.code },
];

// Ce que le `<textarea>` affiche actuellement.
let shownPath = null;
// Ce à partir de quoi le bloc rendu a été bâti : signature d'onglet+mode, et
// le Markdown correspondant. Comparer les deux évite de reconstruire le rendu
// sous les doigts de qui est en train d'y écrire.
let richSig = null;
let richSource = null;
// Vrai dès qu'on a saisi quelque chose dans le rendu. Sans ce témoin, un
// simple passage par « Modifier » pour regarder le document suffirait à le
// faire repasser par `turndown`, ce qui en réécrirait le formatage — listes,
// soulignements, retours à la ligne — sans qu'on ait rien voulu changer.
let richTouched = false;
let timer;

export function render(state) {
  if (state.app !== 'edition') return;

  const tabs = state.edition.tabs;
  const tab = store.activeTab();
  const markdown = store.isMarkdown(tab);
  // Un fichier qui n'est pas du Markdown n'a qu'un regard possible.
  const mode = markdown ? state.edition.mode : 'code';

  bar.hidden = tabs.length === 0;
  replace(bar, tabs.map((t) => tabButton(t, t === tab)));

  for (const m of MODES) {
    m.el.setAttribute('aria-pressed', String(mode === m.id));
    m.el.disabled = !tab || (!markdown && m.id !== 'code');
  }

  empty.hidden = Boolean(tab);
  area.hidden = !tab || mode !== 'code';
  rich.hidden = !tab || mode === 'code';

  if (!tab) {
    shownPath = null;
    richSig = null;
    saveBtn.disabled = true;
    return;
  }

  if (mode === 'code') drawSource(tab);
  else drawRich(tab, mode);

  saveBtn.disabled = !store.isDirty(tab);
}

/** Le Markdown brut dans le `<textarea>`. */
function drawSource(tab) {
  if (shownPath !== tab.path) {
    area.value = tab.content;
    area.scrollTop = 0;
    shownPath = tab.path;
  } else if (area.value !== tab.content) {
    // Le texte a changé ailleurs qu'à la frappe — un passage par « Modifier »,
    // par exemple. On garde la position du curseur.
    const pos = area.selectionStart;
    area.value = tab.content;
    area.setSelectionRange(pos, pos);
  }
}

/** Le rendu, éditable ou non selon le mode. */
function drawRich(tab, mode) {
  const want = mode === 'edit' ? 'true' : 'false';
  // Ne réassigner que si la valeur change vraiment. Dans WebKit, toucher à
  // `contentEditable` reconstruit le contexte d'édition et ramène le
  // défilement en haut : le faire à chaque rendu — donc au moins à chaque
  // battement d'horloge — rendait le document impossible à parcourir.
  if (rich.getAttribute('contenteditable') !== want) {
    rich.setAttribute('contenteditable', want);
  }
  rich.classList.toggle('editor__rich--live', mode === 'edit');

  const sig = `${tab.path}|${mode}`;
  // On ne rebâtit que si l'on change d'onglet ou de mode, ou si le Markdown a
  // bougé ailleurs qu'ici : sinon chaque frappe replacerait le curseur au début.
  if (sig === richSig && tab.content === richSource) return;

  // Changement d'onglet ou de mode : on repart du haut. Une simple mise à jour
  // du texte, elle, doit laisser le lecteur où il en était.
  const keep = sig === richSig ? rich.scrollTop : 0;
  try {
    replace(rich, [toFragment(tab.content, imageResolver(tab))]);
    // Le rendu repart du Markdown, qui ne porte pas le mobilier de l'éditeur :
    // la liste des langages se repose sur chaque bloc de code.
    code.decorate();
  } catch (err) {
    replace(rich, [el('div.hint', {}, String(err.message ?? err))]);
  }
  richSig = sig;
  richSource = tab.content;
  richTouched = false;
  rich.scrollTop = keep;
}

/**
 * Traduit le chemin d'une image, relatif au document, en adresse que la
 * webview sait charger. Le protocole `asset` n'est ouvert qu'au dossier du
 * projet ; un chemin qui en sortirait ne rend rien plutôt qu'une erreur.
 */
export function imageResolver(tab) {
  const { root } = store.state.edition;
  if (!root) return null;

  const at = tab.path.lastIndexOf('/');
  const dir = at < 0 ? '' : tab.path.slice(0, at);

  return (src) => {
    const parts = dir ? dir.split('/') : [];
    for (const seg of src.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg !== '..') {
        parts.push(seg);
      } else if (parts.length > 0) {
        parts.pop();
      } else {
        return null;
      }
    }
    return assetUrl(`${root}/${parts.join('/')}`);
  };
}

function tabButton(tab, active) {
  const dirty = store.isDirty(tab);

  const close = el('span.tab__close', {
    role: 'button',
    tabindex: '0',
    title: 'Fermer',
    // Le clic ne doit pas aussi sélectionner l'onglet qu'on referme.
    onclick: (ev) => {
      ev.stopPropagation();
      requestClose(tab);
    },
    onkeydown: (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        requestClose(tab);
      }
    },
  });
  close.append(icon(PATH.close, { size: 11 }));

  const node = el(
    'button.tab',
    {
      role: 'tab',
      'aria-selected': String(active),
      title: tab.path,
      onclick: () => {
        flush();
        store.selectTab(tab.path);
      },
      // Le clic du milieu ferme un onglet, comme dans un navigateur.
      onauxclick: (ev) => {
        if (ev.button === 1) {
          ev.preventDefault();
          requestClose(tab);
        }
      },
      // Le menu du système n'a rien à proposer ici : on prend la main.
      oncontextmenu: (ev) => {
        ev.preventDefault();
        openMenu(tab, ev.clientX, ev.clientY);
      },
    },
    el('span.tab__name', {}, tab.name),
    dirty ? el('span.tab__dot', { title: 'modifications non enregistrées' }) : null,
    close,
  );
  if (active) node.classList.add('tab--active');
  return node;
}

/** Le menu de l'onglet : ce qu'on peut faire du document ouvert. */
function openMenu(tab, x, y) {
  menu.open(x, y, [
    menu.title(tab.name),
    menu.item('Enregistrer', PATH.save, () => saveTab(tab), !store.isDirty(tab)),
  ]);
}

/** Ferme, en demandant confirmation si le document a été modifié. */
function requestClose(tab) {
  flush();
  if (store.closeTab(tab.path)) return;
  const ok = confirm(
    `« ${tab.name} » a des modifications non enregistrées.\n\nFermer sans enregistrer ?`,
  );
  if (ok) store.closeTab(tab.path, true);
}

/**
 * Ramène au Markdown ce qui vient d'être saisi dans le rendu.
 *
 * La saisie est convertie après une pause dans la frappe ; changer d'onglet,
 * de mode ou enregistrer ne doit pas attendre cette pause, sous peine de
 * perdre les derniers mots.
 *
 * L'en-tête YAML n'entre jamais dans le rendu (`markdown.js` le retire avant
 * `marked`) : `turndown` ne le voit donc pas non plus, et il faut le reposer
 * devant ce qu'il vient de produire — sans quoi la première frappe en
 * « Modifier » effacerait le bloc.
 */
export function flush() {
  clearTimeout(timer);
  if (!richTouched) return;
  const tab = store.activeTab();
  if (!tab || store.state.edition.mode !== 'edit' || rich.hidden) return;
  if (!store.isMarkdown(tab)) return;

  const { head } = splitFront(tab.content);
  const md = head + toMarkdown(rich.innerHTML);
  // Marquer la source avant d'écrire : sinon le rendu se reconstruirait et le
  // curseur repartirait au début.
  richSource = md;
  richTouched = false;
  store.edit(tab.path, md);
}

/** Porte le curseur sur une ligne — appelé depuis le sommaire. */
export function goToLine(line) {
  const tab = store.activeTab();
  if (!tab) return;

  // Hors du mode source, le sommaire fait défiler le rendu jusqu'au titre.
  if (store.state.edition.mode !== 'code' && store.isMarkdown(tab)) {
    const before = tab.content.split('\n').slice(0, line).join('\n');
    const rank = (before.match(/^#{1,6} /gm) ?? []).length;
    const heads = rich.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const target = heads[Math.max(0, rank - 1)];
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }

  const lines = tab.content.split('\n');
  const i = Math.min(Math.max(line - 1, 0), lines.length - 1);
  let offset = 0;
  for (let k = 0; k < i; k++) offset += lines[k].length + 1;

  area.focus();
  area.setSelectionRange(offset, offset + lines[i].length);

  // Amener la ligne en vue : la hauteur de ligne du style suffit tant que le
  // texte ne s'enroule pas. Sur des paragraphes longs la cible reste à
  // quelques lignes près, ce qui laisse le titre visible.
  const lh = parseFloat(getComputedStyle(area).lineHeight) || 20;
  area.scrollTop = Math.max(0, i * lh - area.clientHeight / 3);
}

export function wire() {
  if (!ready()) {
    // Sans les bibliothèques, seul le mode source reste utilisable ; mieux
    // vaut le dire que de laisser deux boutons sans effet.
    store.fail('marked.js ou turndown.js manque dans vendor/ : seul le code Markdown est disponible.');
  }

  for (const m of MODES) {
    m.el.append(icon(m.path, { size: 14 }));
    m.el.addEventListener('click', () => {
      // Quitter « Modifier » convertit d'abord ce qui vient d'être écrit.
      flush();
      store.setMode(m.id);
      // `setMode` a redessiné : la zone visée est en place, on lui donne le
      // clavier. Sans focus, ni les flèches ni « Page suivante » n'agissent
      // sur un div — et `body` est en `overflow:hidden`, donc la page non plus.
      (m.id === 'code' ? area : rich).focus({ preventScroll: true });
    });
  }

  area.addEventListener('input', () => {
    const tab = store.activeTab();
    if (!tab) return;
    store.edit(tab.path, area.value);
    scheduleOutline(tab.path);
  });

  rich.addEventListener('input', () => {
    const tab = store.activeTab();
    if (!tab) return;
    richTouched = true;
    // La conversion HTML → Markdown est trop coûteuse pour chaque touche.
    clearTimeout(timer);
    timer = setTimeout(() => {
      flush();
      store.reoutline(tab.path).catch(() => {});
    }, 400);
  });

  for (const node of [area, rich]) {
    node.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
        ev.preventDefault();
        save();
      }
    });
  }

  // Un lien du rendu ouvre le navigateur du système, jamais la webview :
  // l'y laisser naviguer remplacerait l'application par la page.
  rich.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a[href]');
    if (!a) return;
    ev.preventDefault();
    openExternal(a.getAttribute('href'))?.catch?.(store.fail);
  });

  saveBtn.addEventListener('click', save);
  saveBtn.append(icon(PATH.save, { size: 15 }));
}

function scheduleOutline(path) {
  clearTimeout(timer);
  timer = setTimeout(() => store.reoutline(path).catch(() => {}), 300);
}

function save() {
  const tab = store.activeTab();
  if (tab) saveTab(tab);
}

/**
 * Enregistre un onglet — celui du menu contextuel, qui n'est pas forcément
 * l'onglet à l'écran.
 *
 * Le rendu n'affiche que l'onglet actif : lui seul peut porter une saisie qui
 * n'est pas encore revenue au Markdown, et c'est donc le seul cas où il faut
 * commencer par la convertir.
 */
export function saveTab(tab) {
  if (tab === store.activeTab()) flush();
  if (!store.isDirty(tab)) return;

  // Un enregistrement muet laisse dans le doute : on dit qu'il a eu lieu — et
  // `saveDocument` ne le dit que si le fichier relu porte bien le document.
  store
    .saveDocument(tab.path)
    .then(() => store.notify(`« ${tab.name} » enregistré.`))
    .catch(store.fail);
}
