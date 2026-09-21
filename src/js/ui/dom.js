// Fabriques d'éléments. Tout passe par `textContent` : le contenu vient de
// flux tiers, il ne doit jamais être interprété comme du balisage.

export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * `el('button.chip', { 'aria-pressed': 'true', onclick }, 'Tous')`
 * — le sélecteur porte la balise, les classes, et rien d'autre.
 */
export function el(selector, attrs = {}, ...children) {
  const [tag, ...classes] = selector.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
  }
  return node;
}

/** Icône trait, au gabarit du modèle : 24×24, contour, sans remplissage. */
export function icon(path, { size = 15, width = 2, fill = 'none' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', fill);
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', width);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

export const PATH = {
  check: 'M20 6 9 17l-5-5',
  star: 'm12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L3.6 9.8l6.5-.9z',
  book: 'M2 4h7a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2zM22 4h-7a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  pencil: 'M4 20h4L19.5 8.5a2.6 2.6 0 0 0-4-4L4 16z',
  grip: 'M4 9h16M4 15h16',
  caretRight: 'm9 18 6-6-6-6',
  caretDown: 'm6 9 6 6 6-6',
  caretUp: 'm6 15 6-6 6 6',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  close: 'M18 6 6 18M6 6l12 12',
  // Menu de l'application : les trois traits du « hamburger ».
  menu: 'M4 6h16M4 12h16M4 18h16',
  // Quitter : l'interrupteur.
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M8 3v5h7',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  code: 'm8 18-6-6 6-6M16 6l6 6-6 6',
  // Compiler : le document part vers une page — une flèche qui sort d'un cadre.
  compile: 'M14 4h6v16H4V4h3M8 12h9M13 8l4 4-4 4',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  sliders: 'M4 7h16M4 12h16M4 17h16M9 5v4M15 10v4M7 15v4',
  // Le sommaire : des marques de rang à gauche, le texte des titres à droite.
  outline: 'M4 6h3M10 6h10M4 12h3M10 12h10M4 18h3M10 18h10',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 10.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4',
  copy: 'M9 9h10v12H9zM5 15V3h10v2',
  // Dupliquer : la copie, plus le signe de ce qui s'ajoute. Sans lui, les deux
  // entrées voisines du menu — « Copier le nom », « Dupliquer » — porteraient
  // le même dessin.
  duplicate: 'M9 9h10v12H9zM5 15V3h10v2M14 12v6M11 15h6',
  // Le retrait : les lignes du texte, et le chevron qui dit de quel côté elles
  // vont. La première et la dernière ne bougent pas — c'est le corps qui se
  // décale, et l'immobile fait voir le mouvement.
  indent: 'M3 5h18M3 19h18M10 10h11M10 14h11M3 9l3 3-3 3',
  outdent: 'M3 5h18M3 19h18M10 10h11M10 14h11M6 9l-3 3 3 3',
  // Une liste serrée, une liste aérée : c'est l'écart entre les traits qui le
  // dit, et un trait de plus le rend lisible au premier coup d'œil.
  listTight: 'M4 7h16M4 11h16M4 15h16M4 19h16',
  listLoose: 'M4 6h16M4 12h16M4 18h16',
  // Revenir sur ses pas, et repartir : une flèche qui rebrousse chemin.
  undo: 'M9 14 4 9l5-5M4 9h10a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a5 5 0 0 0 0 10h3',
  // Les deux compagnons de la copie : les ciseaux pour la coupe, la planchette
  // pour le collage.
  cut: 'M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  paste: 'M8 5V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
  // Le signet d'un titre : un marque-page, et non un maillon — c'est une cible
  // qu'on pose, pas un lien qu'on suit.
  bookmark: 'M6 3h12v18l-6-4.5L6 21z',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  alignLeft: 'M4 6h16M4 12h9M4 18h13',
  alignCenter: 'M4 6h16M8 12h8M6 18h12',
  alignRight: 'M4 6h16M11 12h9M7 18h13',
  rowAbove: 'M4 13h16v7H4zM12 4v6M9 7h6',
  rowBelow: 'M4 4h16v7H4zM12 20v-6M9 17h6',
  columnLeft: 'M13 4h7v16h-7zM4 12h6M7 9v6',
  columnRight: 'M4 4h7v16H4zM20 12h-6M17 9v6',
  // La rangée ou la colonne visée, barrée. Les deux insertions se disent par
  // un plus posé à côté de la case ; une suppression ne peut pas s'en tenir là
  // — un moins à côté d'une case ne dit pas *laquelle* s'en va, alors que la
  // barre le dit sans mot.
  rowRemove: 'M3 9h18v6H3zM4 19 20 5',
  columnRemove: 'M9 3v18h6V3zM5 4 19 20',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  contrast: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 3v18',
  // Saut de page : le bas d'une page, le haut de la suivante, et le pointillé
  // qui les sépare.
  pagebreak: 'M6 3v6h12V3M6 21v-6h12v6M3 12h2M9 12h2M13 12h2M19 12h2',
  braces: 'M8 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1',
  rule: 'M3 12h18M6 7h12M6 17h12',
  // La ligne vide : deux blocs, et rien entre eux — l'exact contraire de la
  // ligne horizontale, qui met un trait là où celle-ci laisse du blanc.
  blank: 'M4 6h16M4 18h16',
  expand: 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5',
  contract: 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  // La liseuse : l'écran où se lisent les pages compilées. Ni le livre — pris
  // par le book — ni l'œil, qui dit déjà le mode « Voir ».
  liseuse: 'M3 5h18v11H3zM8 20h8M12 16v4',
  // L'arrêter : le carré plein de tous les lecteurs.
  stop: 'M6 6h12v12H6z',
};

export function replace(container, nodes) {
  container.replaceChildren(...nodes);
}

/**
 * La touche de tabulation, quelle que soit la façon dont le moteur la nomme.
 *
 * Sous GTK, Maj+Tabulation n'arrive pas comme Tabulation : le clavier envoie le
 * keysym `ISO_Left_Tab`, et selon la version de la webview `key` en garde le
 * nom au lieu de « Tab » — la touche paraît alors sans effet, alors que la
 * même sans Majuscule marche. On interroge donc aussi `code`, qui ne dépend ni
 * de la disposition du clavier ni des modificateurs.
 */
export function isTab(ev) {
  return ev.key === 'Tab' || ev.key === 'ISO_Left_Tab' || ev.code === 'Tab' || ev.keyCode === 9;
}

/**
 * Fait passer les explications des champs d'une boîte dans sa barre d'état.
 *
 * Chaque `.modal__field` porte son texte dans `data-hint` : il paraît au survol
 * comme à la saisie, et la barre revient à son texte de repos quand on quitte
 * le champ. Les explications ne sont ainsi plus posées sous les zones de
 * saisie — la boîte reste courte et tout se lit au même endroit.
 *
 * Renvoie de quoi écrire dans la barre, pour ce que le champ ne dit pas.
 */
export function wireHints(dialog, status, resting = () => '') {
  const say = (text) => {
    status.textContent = text;
  };

  for (const field of dialog.querySelectorAll('.modal__field[data-hint]')) {
    const hint = field.dataset.hint;
    field.addEventListener('mouseenter', () => say(hint));
    field.addEventListener('mouseleave', () => say(resting()));
    // `focusin` plutôt que `focus` : celui-ci ne remonte pas depuis le champ
    // jusqu'au bloc qui porte l'explication.
    field.addEventListener('focusin', () => say(hint));
    field.addEventListener('focusout', () => say(resting()));
  }
  return say;
}
