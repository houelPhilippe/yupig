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
import { openExternal, assetUrl, ask } from '../api.js';
import * as code from './code.js';
import * as menu from './menu.js';
import * as fileops from './fileops.js';
import { labelOf } from '../keys.js';

const bar = document.getElementById('tabs');
const area = document.getElementById('editor-area');
// C'est la boîte qui se retire, non la zone de saisie : le calque des marques
// de recherche vit dans la même boîte et doit partir avec elle.
const source = document.getElementById('editor-source');
const rich = document.getElementById('editor-rich');
const empty = document.getElementById('editor-empty');
const saveBtn = document.getElementById('doc-save');
const rebuildBtn = document.getElementById('doc-rebuild');

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
// La valeur du compteur de redessin sur laquelle le rendu a été bâti. La
// comparer permet de refaire le rendu sur demande sans toucher à la règle qui
// l'économise le reste du temps.
let richDraw = null;
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
  // Un fichier qui n'est pas du Markdown n'a qu'un regard possible. Le calcul
  // vit dans le `store` : la barre de recherche doit lire le même.
  const mode = store.mode();

  bar.hidden = tabs.length === 0;
  replace(bar, tabs.map((t) => tabButton(t, t === tab)));

  for (const m of MODES) {
    m.el.setAttribute('aria-pressed', String(mode === m.id));
    m.el.disabled = !tab || (!markdown && m.id !== 'code');
  }

  empty.hidden = Boolean(tab);
  source.hidden = !tab || mode !== 'code';
  rich.hidden = !tab || mode === 'code';

  if (!tab) {
    shownPath = null;
    richSig = null;
    saveBtn.disabled = true;
    rebuildBtn.disabled = true;
    return;
  }

  if (mode === 'code') drawSource(tab);
  else drawRich(tab, mode);

  saveBtn.disabled = !store.isDirty(tab);
  // En « Code Markdown », l'affichage *est* le Markdown : il n'y a rien à
  // réactualiser d'après lui.
  rebuildBtn.disabled = mode === 'code';
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
  const draw = store.state.edition.redraw;
  // On ne rebâtit que si l'on change d'onglet ou de mode, si le Markdown a
  // bougé ailleurs qu'ici, ou si l'on a demandé le redessin : sinon chaque
  // frappe replacerait le curseur au début.
  if (sig === richSig && tab.content === richSource && draw === richDraw) return;

  // Changement d'onglet ou de mode : on repart du haut. Une simple mise à jour
  // du texte comme un redessin demandé, eux, doivent laisser le lecteur où il
  // en était — c'est bien la même page qu'il a sous les yeux.
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
  richDraw = draw;
  richTouched = false;
  rich.scrollTop = keep;
}

/**
 * Traduit le chemin d'une image, relatif au document, en adresse que la
 * webview sait charger. Le protocole `asset` n'est ouvert qu'au dossier du
 * projet ; un chemin qui en sortirait ne rend rien plutôt qu'une erreur.
 *
 * Le chemin se recolle avec le **séparateur de la racine**, et non avec la
 * barre oblique des chemins du document : sous Windows la racine s'écrit
 * « C:\… », et la portée ouverte au protocole `asset` est comparée telle
 * qu'elle a été posée — un chemin qui mêle les deux séparateurs n'y
 * correspond pas, et l'image ne paraissait pas.
 */
export function imageResolver(tab) {
  const { root } = store.state.edition;
  if (!root) return null;

  const at = tab.path.lastIndexOf('/');
  const dir = at < 0 ? '' : tab.path.slice(0, at);
  // Antislash seulement si la racine n'emploie que lui : un chemin Windows
  // écrit à la main peut porter des barres obliques, qui marchent aussi.
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';

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
    return assetUrl([root.replace(/[\\/]+$/, ''), ...parts].join(sep));
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
    menu.item('Enregistrer', PATH.save, () => saveTab(tab), !store.isDirty(tab), labelOf('doc.save')),
    // Passe par le `store` et non par `ui/find.js` : celui-ci importe déjà ce
    // module, et le rappeler d'ici fermerait le cercle.
    menu.item(
      'Rechercher / Remplacer…', PATH.search,
      () => store.toggleFind(true), !store.canFind(), labelOf('find'),
    ),
    menu.separator(),
    // Ce qu'on fait du fichier lui-même : les mêmes quatre entrées que dans le
    // menu de sa ligne de l'arbre — c'est le même fichier.
    ...fileops.entries(tab, flush),
  ]);
}

/**
 * Ferme, en demandant confirmation si le document a été modifié.
 *
 * `api.ask` et non `window.confirm` : cette webview ne montre pas les boîtes du
 * navigateur — l'appel rendait `false` sans rien afficher, et un onglet modifié
 * refusait de se fermer sans dire pourquoi.
 */
async function requestClose(tab) {
  flush();
  if (store.closeTab(tab.path)) return;

  const ok = await ask(
    `« ${tab.name} » a des modifications non enregistrées.\n\nFermer sans enregistrer ?`,
    { title: 'Fermer le document', okLabel: 'Fermer sans enregistrer' },
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

/**
 * Signale que le rendu a été modifié autrement qu'à la frappe.
 *
 * La barre de recherche écrit directement dans le DOM du rendu : sans ce
 * témoin, `flush` tiendrait la saisie pour inexistante et le remplacement ne
 * reviendrait jamais au Markdown.
 */
export function richEdited() {
  richTouched = true;
  flush();
}

/**
 * Refait l'affichage du document d'après son Markdown.
 *
 * Le rendu n'est rebâti que lorsqu'il le faut, sans quoi le curseur repartirait
 * au début à chaque frappe : il peut donc s'écarter de la source, le moteur
 * d'édition n'écrivant pas toujours ce que `turndown` en relira — une liste
 * imbriquée reprise à la main, un collage venu d'ailleurs. Ce bouton remet les
 * deux d'accord, et c'est le Markdown qui a raison.
 *
 * `flush` d'abord : ce qui vient d'être saisi part au Markdown avant que le
 * rendu ne se refasse d'après lui. Sans cela, réactualiser perdrait les
 * derniers mots — ils ne sont encore que dans le DOM.
 */
export function rebuild() {
  flush();
  store.redrawDocument();
}

/**
 * Passe à l'onglet suivant (`1`) ou précédent (`-1`), en bouclant.
 *
 * Même chemin qu'un clic sur l'onglet — `flush` d'abord, sans quoi ce qui vient
 * d'être saisi en « Modifier » resterait dans un rendu qu'on quitte. Le clavier
 * revient ensuite à la zone d'édition : on change d'onglet pour y écrire.
 */
export function cycleTab(step) {
  const { tabs, activePath } = store.state.edition;
  if (tabs.length < 2) return;

  const at = tabs.findIndex((t) => t.path === activePath);
  const next = tabs[(at + step + tabs.length) % tabs.length];
  flush();
  store.selectTab(next.path);
  (store.mode() === 'code' ? area : rich).focus({ preventScroll: true });
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

  // Ctrl+S n'est plus écouté ici : il vit dans la table de `keys.js`, qui presse
  // le bouton d'enregistrement. Garder les deux ferait enregistrer deux fois —
  // et annoncer deux fois.

  // Un lien du rendu ouvre le navigateur du système, jamais la webview :
  // l'y laisser naviguer remplacerait l'application par la page.
  //
  // Un lien interne, lui, ne sort pas du document : il vise un signet posé sur
  // un titre — `[voir](#mon-signet)` — et le clic y porte le regard. Le confier
  // au navigateur n'aurait aucun sens, et laisser la webview suivre l'ancre
  // ferait défiler la page entière plutôt que la zone d'édition.
  rich.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a[href]');
    if (!a) return;
    ev.preventDefault();

    const href = a.getAttribute('href');
    if (href?.startsWith('#')) {
      // `getElementById` chercherait dans toute la page : on reste dans le
      // document, seul endroit où un signet a un sens.
      const id = href.slice(1);
      const target = id
        ? rich.querySelector(`[id="${CSS.escape(id)}"]`)
        : rich.firstElementChild;
      if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else store.notify(`Aucun signet « ${id} » dans ce document.`, 'error');
      return;
    }
    openExternal(href)?.catch?.(store.fail);
  });

  rebuildBtn.addEventListener('click', rebuild);
  rebuildBtn.append(icon(PATH.refresh, { size: 14 }));

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
