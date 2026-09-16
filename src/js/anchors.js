// Signets : les identifiants que porte un titre, et les liens qui les visent.
//
// Un signet s'écrit dans la syntaxe d'attributs de Pandoc — `## Titre
// {#mon-signet}` —, la même que celle d'une image ou d'un tableau. C'est donc
// un format que d'autres outils lisent : en HTML il devient l'ancre du titre,
// et un lien `[voir](#mon-signet)` y mène, en HTML comme en PDF.
//
// Ce module ne connaît ni le DOM ni l'état : il lit du Markdown et rend des
// données, comme `find.js`. Les deux boîtes — « Signet » et « Lien » — s'en
// servent, et chacune décide ensuite de ce qu'elle en fait.

import { splitFront } from './frontmatter.js';

/** La forme d'une ligne de titre : ses dièses, son texte, ses attributs. */
const HEADING = /^(#{1,6})\s+(.*)$/;

/** Le bloc d'attributs en fin de titre, d'où sort le signet. */
const ATTRS = /\s*\{([^}]*)\}\s*$/;

/** Un identifiant, où qu'il se trouve dans un bloc d'attributs. */
const MARK = /(?:^|\s)#([^\s}]+)/;

/**
 * Ce qui fait qu'une paire d'accolades est un bloc d'attributs, et non du texte.
 *
 * Pandoc n'y admet que trois formes : un `#signet`, une `.classe`, un
 * `clé=valeur`. Sans cette exigence, un titre comme « Le champ {nom} » verrait
 * ses accolades prises pour des attributs : le mot disparaîtrait du rendu et
 * irait se ranger dans `data-attrs`, alors qu'il fait partie du titre.
 */
const ATTR_LIKE = /(?:^|\s)[#.][^\s}]|[\w-]+\s*=/;

/**
 * Lit un bloc d'attributs en fin de chaîne : `… {#signet .classe}`.
 *
 * `null` quand il n'y en a pas, ou quand les accolades ne portent rien — elles
 * appartiennent alors au texte, comme n'importe quel autre caractère. `at` dit
 * où le bloc commence : de quoi retirer exactement ce qu'on a lu.
 *
 * `attrs` est rendu tel quel, non découpé : une valeur entre guillemets —
 * `key="a b"` — survit ainsi d'un bloc.
 *
 * C'est aussi ce que lit `markdown.js` sur l'arbre rendu, où le bloc vit dans le
 * dernier nœud de texte du titre : une seule lecture de cette syntaxe, pour que
 * le rendu et la source ne puissent pas en avoir deux idées différentes.
 */
export function readAttrs(text) {
  const block = String(text ?? '').match(ATTRS);
  if (!block) return null;

  // Des accolades collées à un crochet fermant sont celles d'un span —
  // `## [texte]{.underline}` —, pas le bloc d'attributs du titre : les prendre
  // pour lui retirerait le soulignement du rendu et le rangerait dans
  // `data-attrs`. Le bloc du titre, lui, se sépare du texte par une espace.
  if (block[0].startsWith('{') && String(text)[block.index - 1] === ']') return null;

  const inner = block[1];
  // Des accolades qui ne portent aucune des trois formes de Pandoc ne sont pas
  // un bloc d'attributs : elles appartiennent au texte.
  if (!ATTR_LIKE.test(inner)) return null;

  const mark = inner.match(MARK);
  const attrs = (mark
    ? inner.slice(0, mark.index) + inner.slice(mark.index + mark[0].length)
    : inner
  ).trim().replace(/\s+/g, ' ');

  return { id: mark?.[1] ?? null, attrs, at: block.index };
}

/**
 * Découpe un titre en son texte et ses attributs.
 *
 * Rendu séparément parce que les deux se règlent séparément : on change le
 * signet sans toucher au texte, et l'on renomme le titre sans perdre son
 * signet.
 */
export function readHeading(line) {
  const found = String(line ?? '').match(HEADING);
  if (!found) return null;

  const level = found[1].length;
  const whole = found[2];
  const block = readAttrs(whole);
  if (!block) return { level, text: whole.trim(), id: null, attrs: '' };

  return { level, text: whole.slice(0, block.at).trim(), id: block.id, attrs: block.attrs };
}

/**
 * Réécrit une ligne de titre avec le signet donné — `null` le retire.
 *
 * Ce que la ligne portait d'autre entre accolades survit : une classe ou une
 * clé que l'application ne sait pas lire ne doit pas disparaître parce qu'on a
 * touché au signet.
 */
export function writeHeading(line, id) {
  const read = readHeading(line);
  if (!read) return line;

  const parts = [];
  if (id) parts.push(`#${id}`);
  if (read.attrs) parts.push(read.attrs);

  const suffix = parts.length ? ` {${parts.join(' ')}}` : '';
  return `${'#'.repeat(read.level)} ${read.text}${suffix}`;
}

/**
 * Les titres du document, dans l'ordre, avec le rang de leur ligne.
 *
 * L'en-tête YAML est sauté — il n'y a pas de titre dedans, et son `---` de
 * fermeture n'en est pas un — ainsi que l'intérieur des blocs de code, où un
 * dièse est du code et non un titre. C'est la même lecture que celle de
 * `files::outline` côté Rust, faite ici parce que le sommaire ne porte pas les
 * signets.
 *
 * `line` compte depuis zéro : c'est un indice dans le tableau des lignes, celui
 * dont on a besoin pour réécrire la ligne.
 */
export function headingsIn(markdown) {
  const src = String(markdown ?? '');
  const { head } = splitFront(src);
  // Autant de lignes que l'en-tête en occupe : les titres qui suivent gardent
  // ainsi le rang qu'ils ont dans le fichier entier.
  const skip = head ? head.split('\n').length - 1 : 0;

  const lines = src.split('\n');
  const out = [];
  let fence = null;

  for (let i = skip; i < lines.length; i++) {
    const line = lines[i];

    // Les clôtures d'un bloc de code, accents graves ou tildes. La clôture qui
    // ferme doit être au moins aussi longue que celle qui a ouvert.
    const rail = line.match(/^\s*(`{3,}|~{3,})/);
    if (rail) {
      if (!fence) fence = rail[1][0].repeat(rail[1].length);
      else if (rail[1][0] === fence[0] && rail[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;

    const read = readHeading(line);
    if (read && read.text) out.push({ ...read, line: i });
  }
  return out;
}

/**
 * Tous les identifiants que le document porte, titres ou non.
 *
 * Pandoc admet un bloc d'attributs ailleurs que sur un titre : la liste des
 * cibles possibles ne se réduit donc pas aux titres. Les blocs de code en sont
 * exclus — un `{#exemple}` montré dans du code n'est pas une cible.
 */
export function idsIn(markdown) {
  const src = String(markdown ?? '');
  const lines = src.split('\n');
  const out = [];
  let fence = null;

  for (const line of lines) {
    const rail = line.match(/^\s*(`{3,}|~{3,})/);
    if (rail) {
      if (!fence) fence = rail[1][0].repeat(rail[1].length);
      else if (rail[1][0] === fence[0] && rail[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;

    for (const found of line.matchAll(/\{([^}]*)\}/g)) {
      const mark = found[1].match(MARK);
      if (mark) out.push(mark[1]);
    }
  }
  return [...new Set(out)];
}

/**
 * Un identifiant tiré du texte d'un titre.
 *
 * Les accents sont dépliés puis retirés — `Référence` donne `reference` : un
 * identifiant sans accent traverse sans encombre les outils qui liront le
 * fichier, et l'ancre d'une adresse en est d'autant plus lisible. Tout ce qui
 * n'est ni lettre ni chiffre devient un tiret, et l'identifiant commence par
 * une lettre, comme Pandoc l'exige.
 */
export function slug(text) {
  const flat = String(text ?? '')
    .normalize('NFD')
    // Les diacritiques que la décomposition vient de détacher.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // Pandoc fait commencer un identifiant par une lettre : on retire donc ce
    // qui précède la première.
    .replace(/^[^a-z]+/, '');

  // Un titre tout en chiffres ou en ponctuation ne donne rien : mieux vaut un
  // nom quelconque qu'un signet vide, qui ne serait pas une cible.
  return flat || 'titre';
}

/**
 * Le même identifiant, rendu unique parmi ceux déjà pris.
 *
 * Deux signets identiques ne sont pas une cible mais deux : le lien mènerait au
 * premier, quel que soit celui qu'on visait.
 */
export function unique(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${base}-${n}`;
    if (!used.has(next)) return next;
  }
}

/** Un identifiant acceptable : la même règle que l'assainisseur du rendu. */
export function valid(id) {
  const value = String(id ?? '');
  return value.length > 0 && value.length <= 128
    && /^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u.test(value);
}
