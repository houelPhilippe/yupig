// Tableaux « grille » de Pandoc / Quarto.
//
// Markdown ne connaît que le tableau à barres verticales, dont la cellule tient
// sur une seule ligne. Les documents du projet emploient la grille de Pandoc,
// qui admet plusieurs lignes par cellule, une ligne de titre, une légende et
// des attributs :
//
//     +-------------+------------------+
//     | Les Acteurs | Bureau Concerné  |
//     +:===========:+:================:+
//     | le Système  | Bureau de Sortie |
//     |             | 2-me ligne       |
//     +-------------+------------------+
//     | Opérateur   |                  |
//     +-------------+------------------+
//     : Les Acteurs {tbl-colwidths="[50, 50]" tbl-align="center" width=80% .bordered .striped}
//
// La barre de `=` ferme la ligne de titre et porte l'alignement des colonnes
// (`:===:` centre) ; la ligne qui commence par « : » porte la légende, puis
// entre accolades la largeur de chaque colonne, celle du tableau entier et sa
// place dans la colonne de texte, et les deux classes d'aspect que
// l'application sait rendre.
//
// `tbl-align` et `width` répondent à `fig-align` et `width` d'une image : le
// tableau porte sa largeur et sa place comme une figure porte les siennes, et
// dans la même syntaxe d'attributs.
//
// `marked` ne connaît pas cette grille et `turndown` ne sait rien des tableaux :
// les deux traductions se font donc ici. `expand` remplace la grille par du HTML
// **avant** `marked` — le HTML produit passe ensuite par l'assainisseur de
// `markdown.js`, comme tout ce qui vient d'un fichier — et `toGrid` fait le
// chemin inverse pour l'enregistrement.

/** Une barre de séparation : `+----+====+`, avec ou sans marques d'alignement. */
const RULE = /^ {0,3}\+[-=:+]+\+[ \t]*$/;
/** Une ligne de cellules. */
const ROW = /^ {0,3}\|/;
/** La ligne de légende qui suit le tableau : « : Légende {attrs} ». */
const CAPTION = /^ {0,3}(?::[ \t]+|Table:[ \t]*)(.*)$/;

/** Les seules classes que l'aspect connaît — le reste est écarté au nettoyage. */
export const CLASSES = ['tbl', 'tbl--bordered', 'tbl--striped'];

/** Une colonne plus étroite ne se lit plus dans la source. */
const MIN = 5;

// ------------------------------------------------------- Markdown → HTML

/**
 * Remplace chaque grille du Markdown par le tableau HTML correspondant.
 *
 * Le travail se fait ligne à ligne pour ne jamais entrer dans un bloc de code :
 * un `+---+` clôturé par des accents graves reste ce qu'il est.
 */
export function expand(markdown) {
  if (!globalThis.marked) return markdown ?? '';

  const lines = String(markdown ?? '').split('\n');
  const out = [];
  let fence = null;

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];

    if (fence) {
      out.push(line);
      if (new RegExp(`^ {0,3}${fence}`).test(line)) fence = null;
      i += 1;
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = opening[1].slice(0, 3);
      out.push(line);
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      let end = i + 1;
      while (end < lines.length && (RULE.test(lines[end]) || ROW.test(lines[end]))) end += 1;

      // La légende suit le tableau ; elle n'est pas obligatoire.
      const legend = end < lines.length ? lines[end].match(CAPTION) : null;
      const html = build(lines.slice(i, end), legend ? legend[1] : null);
      if (html) {
        // Lignes vides autour : `marked` ne laisse passer un bloc HTML tel quel
        // que s'il est détaché du texte qui l'entoure.
        out.push('', html, '');
        i = legend ? end + 1 : end;
        continue;
      }
    }

    out.push(line);
    i += 1;
  }

  return out.join('\n');
}

/** Le tableau HTML, ou `null` si ces lignes n'en forment pas un. */
function build(lines, legend) {
  if (lines.length < 3 || !RULE.test(lines[lines.length - 1])) return null;

  const bounds = [...lines[0]].reduce((acc, c, at) => (c === '+' ? [...acc, at] : acc), []);
  if (bounds.length < 2) return null;

  // Sans ligne de titre, l'alignement se lit sur la barre du haut.
  let align = marks(lines[0], bounds);
  let head = 0;
  const rows = [];
  let current = [];

  for (const line of lines.slice(1)) {
    if (!RULE.test(line)) {
      current.push(line);
      continue;
    }
    if (current.length) {
      rows.push(current);
      current = [];
    }
    // La barre de `=` ferme la ligne de titre et porte l'alignement.
    if (line.includes('=')) {
      head = rows.length;
      align = marks(line, bounds);
    }
  }
  if (current.length) rows.push(current);
  if (!rows.length) return null;

  const spec = attributes(legend);
  const columns = bounds.length - 1;
  const cells = rows.map((row) => split(row, bounds, columns));

  const classes = ['tbl'];
  if (spec.bordered) classes.push('tbl--bordered');
  if (spec.striped) classes.push('tbl--striped');

  const parts = [`<table class="${classes.join(' ')}"`];
  if (spec.rest.length) parts.push(` data-attrs="${quote(spec.rest.join(' '))}"`);
  const style = frame(spec.width, spec.place);
  if (style) parts.push(` style="${style}"`);
  parts.push('>');

  if (spec.caption) parts.push(`<caption>${inline(spec.caption)}</caption>`);
  if (spec.widths?.length === columns) {
    parts.push('<colgroup>');
    for (const w of spec.widths) parts.push(`<col style="width: ${w}%">`);
    parts.push('</colgroup>');
  }

  // L'alignement est porté cellule par cellule, `align` compris : la grille le
  // dit par colonne, mais c'est bien chaque cellule qui le rend — et le garder
  // écrit permet de le rendre au fichier tel qu'il y était.
  const line = (cells, tag) =>
    `<tr>${cells
      .map((cell, i) => {
        const at = align[i] ? ` align="${align[i]}"` : '';
        return `<${tag}${at}>${content(cell)}</${tag}>`;
      })
      .join('')}</tr>`;

  if (head > 0) {
    parts.push('<thead>');
    for (const row of cells.slice(0, head)) parts.push(line(row, 'th'));
    parts.push('</thead>');
  }
  parts.push('<tbody>');
  for (const row of cells.slice(head)) parts.push(line(row, 'td'));
  parts.push('</tbody></table>');

  // Une ligne vide couperait le bloc HTML en deux aux yeux de `marked`, qui
  // rendrait la seconde moitié en texte. Les cellules qui portent des blocs en
  // apportent : on les resserre.
  return parts.join('').replace(/\n{2,}/g, '\n');
}

/** L'alignement de chaque colonne, lu sur les deux-points d'une barre. */
function marks(rule, bounds) {
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const seg = rule.slice(bounds[i] + 1, bounds[i + 1]);
    const left = seg.startsWith(':');
    const right = seg.endsWith(':');
    out.push(left && right ? 'center' : right ? 'right' : left ? 'left' : '');
  }
  return out;
}

/**
 * Découpe les lignes d'une rangée en cellules.
 *
 * Les barres verticales tombent normalement sous les `+` de la barre du haut ;
 * quand ce n'est pas le cas — un tableau écrit à la main, aux colonnes
 * inégales — on se rabat sur un découpage naïf plutôt que de rendre du texte
 * tranché n'importe où.
 */
function split(rowLines, bounds, columns) {
  const parts = Array.from({ length: columns }, () => []);

  for (const line of rowLines) {
    const aligned = bounds.every((at) => line[at] === '|');
    const cut = aligned
      ? Array.from({ length: columns }, (_, i) => line.slice(bounds[i] + 1, bounds[i + 1]))
      : line.replace(/^ {0,3}\|/, '').replace(/\|[ \t]*$/, '').split('|');
    for (let i = 0; i < columns; i++) parts[i].push((cut[i] ?? '').trim());
  }

  // Les lignes vides du haut et du bas ne sont que de la mise en page ; celles
  // du milieu séparent deux paragraphes et comptent.
  return parts.map((lines) => {
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.join('\n');
  });
}

/** Le contenu d'une cellule, rendu par `marked`. */
function content(text) {
  const value = text.trim();
  if (!value) return '';

  // Une liste, un titre, une citation ou plusieurs paragraphes : c'est du bloc,
  // et seul l'analyseur complet sait le lire.
  if (/\n[ \t]*\n/.test(value) || /^[ \t]*([-*+>#]|\d+[.)] |```|~~~)/m.test(value)) {
    return globalThis.marked.parse(value, { gfm: true, breaks: false });
  }
  // Sinon, un retour à la ligne nu n'est pas un saut : Pandoc le lit comme une
  // espace, et une cellule repliée par un autre outil revient donc d'un seul
  // tenant. Seul un vrai saut se voit, dit par la barre oblique inverse de fin
  // de ligne, que `marked` connaît.
  return inline(value).replace(/\n/g, ' ');
}

function inline(text) {
  return globalThis.marked.parseInline(text ?? '');
}

/**
 * Le style qui porte la largeur du tableau et sa place dans la colonne.
 *
 * Les mêmes déclarations que pour une figure : deux marges automatiques
 * centrent, la seule marge gauche pousse à droite, et rien du tout laisse à
 * gauche — le comportement par défaut.
 */
export function frame(width, place) {
  const decls = [];
  if (width) decls.push(`width: ${width}`);
  if (place === 'center') decls.push('margin-left: auto', 'margin-right: auto');
  else if (place === 'right') decls.push('margin-left: auto', 'margin-right: 0');
  return decls.join('; ');
}

/** Échappement d'une valeur d'attribut. */
function quote(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sépare la légende de ses attributs.
 *
 * Ce que l'application ne connaît pas — un identifiant `#tbl-acteurs`, par
 * exemple — est conservé tel quel dans `data-attrs` et réécrit à
 * l'enregistrement : passer par l'éditeur ne doit rien retirer au fichier.
 */
function attributes(legend) {
  const spec = {
    caption: '', bordered: false, striped: false,
    widths: null, width: '', place: 'left', rest: [],
  };
  if (legend === null || legend === undefined) return spec;

  const found = legend.match(/\{([^}]*)\}[ \t]*$/);
  spec.caption = (found ? legend.slice(0, found.index) : legend).trim();
  if (!found) return spec;

  const tokens = found[1].match(/[.#]?[\w-]+(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|\[[^\]]*\]|\S+))?/g);
  for (const token of tokens ?? []) {
    if (token === '.bordered') spec.bordered = true;
    else if (token === '.striped') spec.striped = true;
    else if (/^tbl-colwidths[ \t]*=/.test(token)) {
      spec.widths = (token.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    } else if (/^tbl-align[ \t]*=/.test(token)) {
      spec.place = token.match(/(left|center|right)/i)?.[1].toLowerCase() ?? 'left';
    } else if (/^width[ \t]*=/.test(token)) {
      spec.width = token.match(/\d+(?:\.\d+)?%/)?.[0] ?? '';
    } else spec.rest.push(token);
  }
  return spec;
}

// ------------------------------------------------------- HTML → Markdown

/**
 * Réécrit un tableau du rendu en grille Pandoc.
 *
 * `cellMarkdown` ramène le contenu d'une cellule au Markdown : c'est
 * `markdown.js` qui le fournit, lui seul tenant l'instance de `turndown`.
 *
 * Un tableau à barres verticales lu dans un fichier ressort lui aussi en
 * grille : `turndown` ne sait pas écrire la première forme, et la grille dit
 * tout ce qu'elle dit.
 */
export function toGrid(table, cellMarkdown) {
  const head = [...(table.querySelector('thead')?.querySelectorAll('tr') ?? [])];
  const rows = [...table.querySelectorAll('tr')];
  if (!rows.length) return '';

  const grid = rows.map((row) =>
    [...row.children].map((cell) => breaks(cellMarkdown(cell))),
  );
  const columns = Math.max(...grid.map((row) => row.length));
  for (const row of grid) while (row.length < columns) row.push('');

  const widths = percentages(table, columns);
  const size = sizes(grid, columns);
  const align = alignments(rows[0], columns);

  // Les deux-points ne se posent que sur la barre qui porte l'alignement : celle
  // de « = » quand il y a une ligne de titre, celle du haut sinon.
  const bar = (fill, aligned) =>
    `+${size
      .map((w, i) => {
        const a = aligned ? align[i] : '';
        if (a === 'center') return `:${fill.repeat(Math.max(1, w - 2))}:`;
        if (a === 'right') return `${fill.repeat(Math.max(1, w - 1))}:`;
        if (a === 'left') return `:${fill.repeat(Math.max(1, w - 1))}`;
        return fill.repeat(w);
      })
      .join('+')}+`;

  const out = [bar('-', head.length === 0)];
  rows.forEach((row, r) => {
    for (const line of body(grid[r], size)) out.push(line);
    const last = r === head.length - 1;
    out.push(last ? bar('=', true) : bar('-', false));
  });

  const legend = caption(table, widths);
  if (legend) out.push(legend);
  return out.join('\n');
}

/**
 * Le Markdown d'une cellule, ses sauts de ligne dits par une barre oblique.
 *
 * `turndown` écrit un `<br>` en deux espaces de fin de ligne — la forme
 * ordinaire du Markdown, la seule que la grille ne puisse pas porter : la
 * cellule est complétée d'espaces jusqu'à sa barre, et Pandoc ne voit plus
 * rien de ces deux-là. La barre oblique, elle, survit au remplissage — et au
 * `trim` de la relecture. Sans quoi un saut de ligne voulu se perdrait à la
 * compilation — Pandoc ne lisant, dans un retour à la ligne nu, qu'une espace.
 *
 * Une barre en fin de cellule n'aurait rien à couper : elle s'en va.
 */
function breaks(markdown) {
  let fence = null;

  const lines = markdown.split('\n').map((line) => {
    // Dans un bloc de code, deux espaces ne sont que deux espaces : la barre y
    // paraîtrait telle quelle à la lecture.
    if (fence) {
      if (new RegExp(`^ {0,3}${fence}`).test(line)) fence = null;
      return line.replace(/[ \t]+$/, '');
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = opening[1].slice(0, 3);
      return line.replace(/[ \t]+$/, '');
    }
    const stop = /[ \t]{2,}$/.test(line);
    return line.replace(/[ \t]+$/, '') + (stop ? '\\' : '');
  });

  return lines.join('\n').trim().replace(/\\$/, '');
}

/**
 * Les lignes de texte d'une rangée, cellules mises à la même hauteur.
 *
 * Une ligne de cellule est une ligne de la grille, quelle que soit sa
 * longueur : la source dit alors ce que « Modifier » montre, et une cellule
 * d'une seule ligne se lit d'un seul tenant. C'est la colonne qui s'élargit,
 * jamais le texte qui se coupe — les bords tombent ainsi toujours aux mêmes
 * colonnes.
 */
function body(cells, size) {
  const wrapped = cells.map((cell) => cell.split('\n'));
  const height = Math.max(1, ...wrapped.map((lines) => lines.length));

  const out = [];
  for (let i = 0; i < height; i++) {
    out.push(
      `|${size.map((w, c) => ` ${(wrapped[c][i] ?? '').padEnd(w - 2)} `).join('|')}|`,
    );
  }
  return out;
}

/** Les pourcentages portés par le `<colgroup>`, s'il y en a un. */
function percentages(table, columns) {
  const cols = [...table.querySelectorAll('col')];
  if (cols.length !== columns) return null;

  const out = cols.map((col) => {
    const found = (col.getAttribute('style') ?? '').match(/width:\s*(\d+(?:\.\d+)?)%/);
    return found ? Number(found[1]) : 0;
  });
  return out.every((v) => v > 0) ? out : null;
}

/**
 * La largeur en caractères de chaque colonne dans la source.
 *
 * Une colonne tient sa plus longue ligne, et rien d'autre : aucun budget ne
 * vient la rogner, faute de quoi le texte devrait s'y enrouler et la source ne
 * dirait plus ce que « Modifier » montre. Une grille peut donc être large —
 * c'est le prix de cette correspondance. Ces largeurs ne sont que la mise en
 * page de la source : l'aperçu, lui, suit `tbl-colwidths`.
 */
function sizes(grid, columns) {
  return Array.from({ length: columns }, (_, i) => {
    const texts = grid.map((row) => row[i]);
    const line = Math.max(0, ...texts.flatMap((t) => t.split('\n').map((l) => l.length)));
    return Math.max(MIN, line + 2);
  });
}

/** L'alignement des colonnes, lu sur la première rangée. */
function alignments(row, columns) {
  const cells = [...row.children];
  return Array.from({ length: columns }, (_, i) => cells[i]?.getAttribute('align') ?? '');
}

/** La ligne « : Légende {attrs} », si le tableau a quelque chose à dire. */
function caption(table, widths) {
  const text = table.querySelector('caption')?.textContent.trim() ?? '';
  const classes = table.getAttribute('class') ?? '';

  const style = table.getAttribute('style') ?? '';
  const left = /margin-left:\s*auto/.test(style);
  const right = /margin-right:\s*auto/.test(style);
  const width = style.match(/width:\s*(\d+(?:\.\d+)?%)/);

  const attrs = [];
  const rest = (table.getAttribute('data-attrs') ?? '').trim();
  if (rest) attrs.push(rest);
  if (widths) attrs.push(`tbl-colwidths="[${widths.map((w) => Math.round(w)).join(', ')}]"`);
  // La place à gauche est le comportement par défaut : rien à écrire.
  if (left && right) attrs.push('tbl-align="center"');
  else if (left) attrs.push('tbl-align="right"');
  if (width) attrs.push(`width=${width[1]}`);
  if (/\btbl--bordered\b/.test(classes)) attrs.push('.bordered');
  if (/\btbl--striped\b/.test(classes)) attrs.push('.striped');

  if (!text && !attrs.length) return '';
  return `: ${text}${attrs.length ? `${text ? ' ' : ''}{${attrs.join(' ')}}` : ''}`;
}

// ------------------------------------------------------------- fabrique

/** Un tableau vierge, prêt à être posé dans le document. */
export function element({
  rows = 2,
  columns = 2,
  header = true,
  caption: legend = '',
  widths = null,
  width = '',
  place = 'left',
  bordered = true,
  striped = false,
} = {}) {
  const table = document.createElement('table');
  const classes = ['tbl'];
  if (bordered) classes.push('tbl--bordered');
  if (striped) classes.push('tbl--striped');
  table.className = classes.join(' ');

  const style = frame(width, place);
  if (style) table.setAttribute('style', style);

  if (legend) {
    const node = document.createElement('caption');
    node.textContent = legend;
    table.append(node);
  }

  const share = widths?.length === columns
    ? widths
    : Array.from({ length: columns }, () => Math.round(1000 / columns) / 10);
  const group = document.createElement('colgroup');
  for (const w of share) {
    const col = document.createElement('col');
    col.setAttribute('style', `width: ${w}%`);
    group.append(col);
  }
  table.append(group);

  // Les colonnes ne sont pas alignées d'emblée : sans attribut, la grille
  // n'écrit aucun deux-points, et le menu du tableau les aligne au besoin.
  const line = (tag) => {
    const tr = document.createElement('tr');
    for (let i = 0; i < columns; i++) {
      const cell = document.createElement(tag);
      // Une cellule tout à fait vide ne se laisse pas viser au clic.
      cell.append(document.createElement('br'));
      tr.append(cell);
    }
    return tr;
  };

  if (header) {
    const thead = document.createElement('thead');
    thead.append(line('th'));
    table.append(thead);
  }
  const tbody = document.createElement('tbody');
  for (let i = 0; i < rows; i++) tbody.append(line('td'));
  table.append(tbody);

  return table;
}
