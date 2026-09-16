// Listes du Markdown : où commence et finit celle que l'on a sous le curseur,
// si elle est aérée, comment la resserrer ou l'aérer — et le retrait, qui n'est
// qu'une affaire de quatre espaces en tête de ligne.
//
// Ce module ne connaît ni le DOM ni l'état : il reçoit des lignes et en rend,
// comme `find.js`, `anchors.js` et `keys.js`.
//
// **Une liste est aérée quand une ligne vide la traverse.** C'est la règle de
// CommonMark comme de Pandoc, et non un effet d'affichage : la ligne vide fait
// passer le contenu de chaque entrée en paragraphe, et l'espacement s'en
// ressent à la compilation, en HTML comme en PDF. Aérer, c'est donc poser une
// ligne vide devant chaque entrée ; serrer, c'est la retirer.
//
// Toutes les lignes vides ne s'en vont pas pour autant : celle qui sépare deux
// paragraphes d'une même entrée porte du sens, et les fondre changerait le
// texte. Seules partent celles qui précèdent une entrée.
//
// **Le retrait, c'est quatre espaces** — la mesure qu'une entrée de liste
// demande pour s'imbriquer sous celle qui la précède. Devant un paragraphe
// ordinaire, ces mêmes quatre espaces en font un bloc de code indenté : c'est
// Markdown qui le dit, et ce module ne fait qu'écrire ce qu'on lui demande.

/** Ce qui ouvre une entrée : sa marque, et le retrait qui la précède. */
const ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]+/;

/** Le retrait d'un cran, tel qu'il s'écrit. */
export const STEP = '    ';

/** L'entrée qu'ouvre cette ligne, s'il y en a une. */
export function itemAt(line) {
  const found = ITEM.exec(line ?? '');
  return found ? { indent: found[1].length } : null;
}

/** La ligne appartient-elle au corps d'une liste ? */
function belongs(line) {
  if (!line || !line.trim()) return false;
  // Une entrée, ou la suite indentée d'une entrée.
  return Boolean(itemAt(line)) || /^[ \t]/.test(line);
}

/**
 * La liste qui contient la ligne de rang `at` : ses bornes, et le retrait de
 * ses entrées de premier rang.
 *
 * Elle s'étend tant que les lignes lui appartiennent. Une ligne vide ne la
 * coupe pas à elle seule — c'est elle qui fait l'aération — mais deux à la
 * suite ferment la liste, comme chez Pandoc.
 *
 * Rend `null` là où il n'y a pas de liste : un bloc indenté sans entrée n'en
 * est pas une, et le menu n'a alors rien à proposer.
 */
export function bounds(lines, at) {
  if (!belongs(lines[at])) return null;

  let from = at;
  while (from > 0) {
    if (belongs(lines[from - 1])) {
      from -= 1;
    } else if (!lines[from - 1].trim() && from >= 2 && belongs(lines[from - 2])) {
      from -= 2;
    } else {
      break;
    }
  }

  let to = at;
  while (to < lines.length - 1) {
    if (belongs(lines[to + 1])) {
      to += 1;
    } else if (!lines[to + 1].trim() && belongs(lines[to + 2])) {
      to += 2;
    } else {
      break;
    }
  }

  const indents = [];
  for (let i = from; i <= to; i++) {
    const item = itemAt(lines[i]);
    if (item) indents.push(item.indent);
  }
  if (!indents.length) return null;

  return { from, to, base: Math.min(...indents) };
}

/** Une ligne vide au milieu, et la liste respire. */
export function isLoose(lines, from, to) {
  for (let i = from + 1; i < to; i++) if (!lines[i].trim()) return true;
  return false;
}

/** Une ligne vide devant chaque entrée de premier rang, sauf la première. */
export function spread(lines, from, to, base) {
  const out = [];
  for (let i = from; i <= to; i++) {
    const item = itemAt(lines[i]);
    if (item && item.indent === base && out.length && out[out.length - 1].trim()) out.push('');
    out.push(lines[i]);
  }
  return out;
}

/**
 * Retire les lignes vides qui séparent deux entrées.
 *
 * Celles qui séparent deux paragraphes d'une même entrée restent : la liste
 * demeure alors aérée, et c'est juste — une entrée à deux paragraphes ne peut
 * pas se dire autrement.
 */
export function tighten(lines, from, to) {
  const out = [];
  for (let i = from; i <= to; i++) {
    if (!lines[i].trim() && i < to && itemAt(lines[i + 1])) continue;
    out.push(lines[i]);
  }
  return out;
}

/** Quatre espaces de plus en tête de chaque ligne — les vides restent vides. */
export function indent(lines) {
  return lines.map((line) => (line.trim() ? STEP + line : line));
}

/** Jusqu'à quatre espaces en moins, ou la tabulation qui en tient lieu. */
export function outdent(lines) {
  return lines.map((line) => line.replace(/^(?:\t| {1,4})/, ''));
}

/** Y a-t-il un retrait à réduire ? Sinon l'entrée du menu s'éteint. */
export function indented(lines) {
  return lines.some((line) => line.trim() && /^[ \t]/.test(line));
}
