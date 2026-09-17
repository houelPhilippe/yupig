// Conversion Markdown ↔ HTML pour l'éditeur, et garde-fou de rendu.
//
// `marked` (Markdown → HTML) et `turndown` (HTML → Markdown) sont embarqués
// dans `vendor/` : la CSP interdit toute origine externe.
//
// `marked` n'assainit plus sa sortie depuis sa v5, et la webview expose
// `__TAURI__` — donc l'accès au disque. Un fichier Markdown venu d'ailleurs
// (dépôt cloné, pièce jointe) contenant `<img onerror=…>` s'exécuterait avec
// ces droits. Rien de ce que produit `marked` n'entre donc dans le DOM sans
// passer par `clean`, qui rebâtit l'arbre à partir d'une liste blanche.

import { expand, toGrid, CLASSES } from './tables.js';
import { splitFront } from './frontmatter.js';
import { readAttrs } from './anchors.js';

/** Balises conservées, et pour chacune les attributs tolérés. */
/** L'espace insécable, et la façon dont le fichier l'écrit. */
export const NBSP = '\u00a0';
export const BLANK = '&nbsp;';

const ALLOWED = {
  p: [], br: [], hr: [],
  // Un titre peut porter un signet — `## Titre {#mon-signet}`, la syntaxe
  // d'attributs de Pandoc. `data-attrs` garde au passage ce que l'application
  // ne sait pas lire, pour le rendre au fichier intact, comme pour un tableau.
  h1: ['id', 'data-attrs'], h2: ['id', 'data-attrs'], h3: ['id', 'data-attrs'],
  h4: ['id', 'data-attrs'], h5: ['id', 'data-attrs'], h6: ['id', 'data-attrs'],
  strong: [], b: [], em: [], i: [], u: [], s: [], strike: [], del: [], ins: [],
  // `sup` porte l'appel de note — `[^1]` — dont la classe dit qu'il en est un.
  sup: ['class'], sub: [], small: [], mark: [],
  blockquote: [], ul: [], ol: ['start'], li: [],
  // La case d'une liste de tâches — `- [ ] texte`, que `marked` rend ainsi.
  // `disabled` n'est pas repris : la case doit rester cliquable.
  input: ['type', 'checked'],
  dl: [], dt: [], dd: [],
  pre: ['class'], code: ['class'],
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  // Légende, taille et alignement d'une image : Markdown n'en dit rien, la
  // figure HTML les porte toutes les trois.
  figure: ['style'],
  figcaption: [],
  // La grille de Pandoc porte plus qu'un tableau : une légende, la largeur de
  // chaque colonne, et deux classes d'aspect. `data-attrs` garde au passage ce
  // que l'application ne sait pas lire, pour le rendre au fichier intact.
  table: ['class', 'data-attrs', 'style'],
  caption: [], colgroup: [], col: ['style'],
  thead: [], tbody: [], tfoot: [], tr: [],
  th: ['colspan', 'rowspan', 'align'],
  td: ['colspan', 'rowspan', 'align'],
  // Les `<span>` du rendu sont tous bâtis ici : celui d'un shortcode, et celui
  // d'un span à attributs de Pandoc — petites capitales par sa classe, couleur
  // et surbrillance par son `style`, filtré plus bas.
  span: ['class', 'style'], div: [],
};

/**
 * Les classes que la feuille de style connaît, par balise.
 *
 * Une classe n'est pas ici décorative au hasard : elle commande un aspect. On
 * ne garde donc que celles-là, plutôt qu'une chaîne venue du fichier. Les
 * `language-…` d'un bloc de code font exception : leur nom n'est pas connu
 * d'avance, et `pre`/`code` les laissent passer.
 */
/**
 * Les classes d'un span à attributs de Pandoc que l'application sait rendre —
 * celles que Pandoc connaît lui-même, et qui traversent donc la compilation.
 */
const SPAN_CLASSES = ['smallcaps', 'underline'];

const KEEP_CLASSES = {
  table: CLASSES,
  span: ['shortcode', ...SPAN_CLASSES],
  sup: ['fn'],
};

/**
 * Une adresse acceptable dans un `href` ou un `src`.
 *
 * Les caractères de contrôle sont retirés avant l'examen : une tabulation
 * glissée dans « javascript: » donne une adresse que le navigateur suit et
 * qu'une comparaison naïve laisserait passer. Les `data:` ne sont tolérés que
 * pour des images — un SVG chargé par `<img>` n'exécute pas ses scripts.
 */
function safeUrl(value) {
  const v = value.replace(/[\u0000-\u0020]/g, '').toLowerCase();
  if (v.startsWith('data:')) return v.startsWith('data:image/');
  return !/^(javascript|vbscript|file|blob):/.test(v);
}

/** Propriétés de style tolérées : de quoi colorer, et poser une figure. */
const STYLE_PROPS =
  /^(color|background-color|width|margin|margin-left|margin-right|text-align)$/;

/**
 * Valeurs tolérées : une couleur hexadécimale, un `rgb()`/`rgba()`, ou un
 * mot-clé. Tout ce qui porte des parenthèses hors `rgb()` est écarté, ce qui
 * suffit à barrer `url(…)`.
 */
const STYLE_VALUE =
  /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|-?\d+(\.\d+)?(%|px|em|rem)?|[a-z][a-z-]*)$/i;

/**
 * Ne garde d'un `style` que les déclarations reconnues.
 *
 * Autoriser un `style` libre rouvrirait une surface d'injection ; on
 * reconstruit donc la déclaration à partir de ce qu'on a su lire, plutôt que
 * de laisser passer la chaîne d'origine.
 */
/**
 * Un identifiant de signet acceptable.
 *
 * Ni espace ni accolade : c'est ce qui le distingue d'un morceau de texte, et
 * ce qui garantit qu'il ressorte du fichier tel qu'il y est entré. Les lettres
 * accentuées passent — Pandoc les accepte, et un document français en porte.
 */
function safeId(value) {
  const id = String(value ?? '');
  return id.length <= 128 && /^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u.test(id);
}

function safeStyle(value) {
  const kept = [];
  for (const decl of value.split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const val = decl.slice(at + 1).trim();
    if (!STYLE_PROPS.test(prop) || !STYLE_VALUE.test(val)) continue;
    kept.push(`${prop}: ${val}`);
  }
  return kept.join('; ');
}

/**
 * Traduit le `src` d'une image en adresse affichable, quand un résolveur est
 * fourni. Les adresses absolues (http, data) sont déjà bonnes.
 */
let resolveImage = null;

function clean(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.nodeValue);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    // Commentaires et instructions de traitement : rien à afficher.
    return document.createDocumentFragment();
  }

  const tag = node.tagName.toLowerCase();
  const attrs = ALLOWED[tag];

  // Balise écartée : on garde son texte, jamais son comportement. Un `<script>`
  // perd jusqu'à son texte — le reste du document, lui, survit.
  if (!attrs) {
    const frag = document.createDocumentFragment();
    if (tag === 'script' || tag === 'style') return frag;
    for (const child of [...node.childNodes]) frag.append(clean(child));
    return frag;
  }

  // Une case à cocher de liste de tâches, et rien d'autre : les autres champs
  // de saisie n'ont aucun sens dans un document, et n'y entrent donc pas.
  if (tag === 'input' && node.getAttribute('type') !== 'checkbox') {
    return document.createDocumentFragment();
  }

  const out = document.createElement(tag);
  for (const { name, value } of [...node.attributes]) {
    if (!attrs.includes(name)) continue;
    if ((name === 'href' || name === 'src') && !safeUrl(value)) continue;
    if (name === 'id' && !safeId(value)) continue;
    if (name === 'class' && KEEP_CLASSES[tag]) {
      const kept = value.split(/\s+/).filter((c) => KEEP_CLASSES[tag].includes(c));
      if (kept.length) out.setAttribute('class', kept.join(' '));
      continue;
    }
    if (name === 'style') {
      const safe = safeStyle(value);
      if (safe) out.setAttribute('style', safe);
      continue;
    }
    out.setAttribute(name, value);
  }
  if (tag === 'a') out.setAttribute('rel', 'noreferrer noopener');

  // Une image désignée par un chemin relatif au document ne veut rien dire
  // pour la webview : on la traduit en adresse `asset:`.
  if (tag === 'img' && resolveImage) {
    const src = out.getAttribute('src');
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      const url = resolveImage(src);
      // Le chemin d'origine est conservé : c'est lui qui doit repartir dans le
      // fichier. Sans cela l'aller-retour y écrirait l'adresse `asset:`, qui
      // ne veut rien dire hors de cette machine.
      out.setAttribute('data-src', src);
      if (url) out.setAttribute('src', url);
      else out.removeAttribute('src');
    }
  }

  for (const child of [...node.childNodes]) out.append(clean(child));
  return out;
}

/**
 * Un lien Markdown dans une légende : `[le texte](l'adresse)`.
 *
 * La légende ne vit pas en HTML dans le fichier : elle transite par le texte
 * entre crochets de Pandoc, que `marked` laisse **brut** dans l'attribut `alt`
 * — il n'analyse pas la description d'une image comme du texte enrichi. La
 * syntaxe du lien y survit donc telle quelle, et ces deux fonctions font
 * l'aller-retour entre cette chaîne et la `<figcaption>` de l'aperçu.
 *
 * L'adresse s'arrête au premier `)` : une parenthèse dans une URL doit être
 * écrite `%29`, comme le veut déjà Pandoc pour un lien sans chevrons.
 */
export const CAPTION_LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g;

/** Remplit un nœud d'une légende, ses liens devenus des `<a>`. */
export function captionInto(node, source) {
  // Le nœud vient tantôt du document affiché, tantôt de celui du `DOMParser` :
  // c'est le sien qui fabrique, jamais le `document` global.
  const doc = node.ownerDocument;
  node.textContent = '';
  let last = 0;
  for (const found of String(source).matchAll(CAPTION_LINK)) {
    const [whole, text, href] = found;
    // Ni texte ni adresse : il n'y a pas de lien à poser, seulement des
    // crochets que la légende garde tels qu'ils ont été écrits.
    if (!text || !href) continue;
    if (found.index > last) {
      node.append(doc.createTextNode(source.slice(last, found.index)));
    }
    const a = doc.createElement('a');
    a.setAttribute('href', href);
    a.textContent = text;
    node.append(a);
    last = found.index + whole.length;
  }
  if (last < source.length) node.append(doc.createTextNode(source.slice(last)));
}

/** La légende telle qu'elle s'écrit dans le fichier, liens compris. */
export function captionSource(node) {
  if (!node) return '';
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue;
    else if (child.tagName === 'A') {
      out += `[${child.textContent}](${child.getAttribute('href') ?? ''})`;
    } else out += child.textContent;
  }
  return out.trim();
}

/** La légende en texte seul — ce que porte l'`alt` d'une image. */
export function captionText(source) {
  return String(source).replace(CAPTION_LINK, (whole, text, href) =>
    text && href ? text : whole,
  ).trim();
}

/**
 * Relit la syntaxe d'attributs de Pandoc / Quarto qui suit une image.
 *
 * `marked` ne la connaît pas : il rend l'image, puis laisse `{fig-align=…}` en
 * texte brut juste après. On consomme ce texte et on bâtit la figure que
 * l'aperçu sait afficher.
 *
 * Le travail se fait sur l'arbre produit par `marked`, pas sur le Markdown :
 * une accolade à l'intérieur d'un bloc de code n'a alors aucune chance d'être
 * prise pour un attribut, puisqu'il ne s'y trouve pas d'image.
 */
function liftFigures(doc) {
  for (const img of [...doc.querySelectorAll('img')]) {
    const next = img.nextSibling;
    if (!next || next.nodeType !== Node.TEXT_NODE) continue;

    const found = next.nodeValue.match(/^\{([^}]*)\}/);
    if (!found) continue;

    const align = found[1].match(/fig-align\s*=\s*"?([a-z]+)"?/i)?.[1].toLowerCase();
    const width = found[1].match(/width\s*=\s*"?(\d+(?:\.\d+)?%)"?/i)?.[1];
    if (!align && !width) continue;

    next.nodeValue = next.nodeValue.slice(found[0].length);
    if (!next.nodeValue.trim()) next.remove();

    const decls = [];
    if (width) decls.push(`width: ${width}`);
    if (align === 'center') decls.push('margin-left: auto', 'margin-right: auto');
    else if (align === 'right') decls.push('margin-left: auto', 'margin-right: 0');

    const paragraph = img.parentElement;
    const figure = doc.createElement('figure');
    if (decls.length) figure.setAttribute('style', decls.join('; '));

    img.replaceWith(figure);
    figure.append(img);

    // Chez Pandoc, le texte entre crochets est la légende.
    const caption = img.getAttribute('alt') ?? '';
    if (caption) {
      const legend = doc.createElement('figcaption');
      captionInto(legend, caption);
      figure.append(legend);
      // L'`alt` sert l'accessibilité : la syntaxe des liens n'a rien à y faire,
      // seul leur texte compte.
      img.setAttribute('alt', captionText(caption));
    }

    // Une image seule dans son paragraphe : la figure prend sa place plutôt
    // que de rester enfermée dans un `<p>` qui n'a plus rien d'autre à porter.
    if (paragraph?.tagName === 'P' && paragraph.childNodes.length === 1) {
      paragraph.replaceWith(figure);
    }
  }
}

/** L'appel d'une note de bas de page, dans la syntaxe de Pandoc : `[^1]`. */
const FOOTNOTE = /\[\^([^\]\s]+)\]/g;

/**
 * Désamorce les définitions de notes avant que `marked` ne les lise.
 *
 * `[^1]: le texte` a la forme d'une définition de lien — `[étiquette]: cible` —
 * et `marked`, qui ne connaît pas les notes, la retirerait purement et
 * simplement du rendu : la note disparaîtrait du fichier au premier
 * aller-retour. On remplace donc l'appel en tête de ligne par la balise qu'il
 * aurait de toute façon au rendu ; la ligne ne commence plus par un crochet,
 * et le reste du texte garde sa mise en forme Markdown.
 *
 * Rien n'est touché dans un bloc de code, où une définition n'est qu'un
 * exemple.
 */
function expandFootnotes(markdown) {
  let fence = null;

  return String(markdown ?? '')
    .split('\n')
    .map((line) => {
      const rail = line.match(/^\s*(```+|~~~+)/)?.[1];
      if (rail) {
        if (!fence) fence = rail[0];
        else if (rail[0] === fence) fence = null;
        return line;
      }
      if (fence) return line;

      return line.replace(/^\[\^([^\]\s]+)\]:/, (_all, label) => `<sup class="fn">${text(label)}</sup>:`);
    })
    .join('\n');
}

/** Un span à attributs de Pandoc : `[texte]{…}`. */
const SPAN = /\[([^[\]]*)\]\{([^{}]*)\}/g;

/**
 * Rend les spans à attributs de Pandoc — `[texte]{.smallcaps}` pour les
 * petites capitales, `[texte]{style="color: …"}` pour une couleur.
 *
 * `marked` ne connaît pas cette syntaxe : faute de parenthèses derrière, il
 * laisse les crochets en texte brut. On les relit donc sur l'arbre rendu,
 * comme les attributs d'une image — et jamais dans un bloc de code, où la même
 * suite de caractères n'est qu'un exemple. Une accolade qui ne porte rien que
 * l'application sache rendre est laissée telle quelle : mieux vaut la montrer
 * que de l'escamoter.
 */
/**
 * Relève le signet d'un titre, et ce qu'il porte d'autre entre accolades.
 *
 * `marked` ne connaît pas les attributs de Pandoc et les laisserait en texte
 * dans le titre — le signet se lirait à l'écran, et le sommaire porterait les
 * accolades. On les relève donc ici, comme `liftFigures` relève celles d'une
 * image. La syntaxe elle-même est lue par `readAttrs`, que la source lit aussi :
 * une seule lecture, pour que le rendu et le fichier ne puissent pas en avoir
 * deux idées différentes.
 *
 * Le bloc d'attributs termine la ligne du titre : il vit donc dans son
 * **dernier nœud de texte**. Le retirer là plutôt que de réécrire
 * `textContent` est ce qui laisse intact le gras, le code et les spans qu'un
 * titre peut porter — les réécrire les aplatirait en texte.
 *
 * L'identifiant est extrait, le reste des accolades survit tel quel dans
 * `data-attrs` : une classe ou une clé que l'application ne sait pas lire
 * revient au fichier telle qu'elle y était, sans que rien ici ait à la
 * comprendre. Les valeurs entre guillemets — `key="a b"` — sont donc gardées
 * d'un bloc, et non découpées sur les espaces.
 */
function liftHeadings(doc) {
  for (const head of doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const walker = doc.createTreeWalker(head, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
    if (!last) continue;

    // `null` quand il n'y a pas de bloc d'attributs, ou quand les accolades ne
    // portent rien : le titre garde alors son texte tel qu'il est écrit.
    const block = readAttrs(last.nodeValue);
    if (!block) continue;

    if (block.id) head.setAttribute('id', block.id);
    if (block.attrs) head.setAttribute('data-attrs', block.attrs);
    last.nodeValue = last.nodeValue.slice(0, block.at);
  }
}

function liftSpans(doc) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const found = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!new RegExp(SPAN.source).test(node.nodeValue)) continue;
    if (node.parentElement?.closest('code, pre')) continue;
    found.push(node);
  }

  for (const node of found) {
    const text = node.nodeValue;
    const frag = doc.createDocumentFragment();
    let at = 0;

    for (const match of text.matchAll(SPAN)) {
      const span = spanFor(doc, match[2]);
      // Rien de connu là-dedans : on n'y touche pas, et le texte du passage
      // rejoindra la tranche suivante tel qu'il est écrit.
      if (!span) continue;

      if (match.index > at) frag.append(doc.createTextNode(text.slice(at, match.index)));
      span.textContent = match[1];
      frag.append(span);
      at = match.index + match[0].length;
    }
    if (at < text.length) frag.append(doc.createTextNode(text.slice(at)));
    node.replaceWith(frag);
  }

  liftSplitSpans(doc);
}

/**
 * Le `<span>` que portent des attributs de Pandoc, ou `null` s'ils ne disent
 * rien que l'application sache rendre.
 */
function spanFor(doc, attrs) {
  const classes = SPAN_CLASSES.filter((c) => new RegExp(`(^|\\s)\\.${c}(\\s|$)`).test(attrs));
  const style = attrs.match(/style\s*=\s*"([^"]*)"/)?.[1];
  if (!classes.length && !style) return null;

  const span = doc.createElement('span');
  if (classes.length) span.className = classes.join(' ');
  if (style) span.setAttribute('style', style);
  return span;
}

/**
 * Les spans dont le texte porte lui-même une mise en forme :
 * `[Arrivée (`IE507`)]{.underline}`.
 *
 * `marked` a fait du code, du gras ou de l'italique des balises, si bien que le
 * crochet ouvrant et `]{…}` ne sont plus dans le même nœud de texte — et la
 * lecture d'un seul nœud, plus haut, ne les voit pas. On cherche donc, parmi
 * les enfants d'un même élément, un nœud de texte qui ouvre un crochet sans le
 * fermer, puis le premier crochet qui suit dans un nœud de texte frère : si
 * c'est `]{…}`, tout ce qui les sépare — balises comprises — entre dans le
 * span. L'intérieur des balises n'est pas lu : un crochet dans du code n'est
 * que du code.
 */
function liftSplitSpans(doc) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const parents = new Set();

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.includes('[')) continue;
    if (node.parentElement?.closest('code, pre')) continue;
    parents.add(node.parentNode);
  }

  for (const parent of parents) {
    let child = parent.firstChild;
    while (child) child = spanAcross(doc, child) ?? child.nextSibling;
  }
}

/**
 * Tente d'ouvrir un span au dernier crochet de `start`. Rend le nœud d'où
 * reprendre la lecture quand un span a été posé, `null` sinon.
 */
function spanAcross(doc, start) {
  if (start.nodeType !== Node.TEXT_NODE) return null;
  const open = start.nodeValue.lastIndexOf('[');
  if (open < 0 || start.nodeValue.includes(']', open)) return null;

  for (let node = start.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType !== Node.TEXT_NODE) continue;

    const close = node.nodeValue.search(/[[\]]/);
    if (close < 0) continue;
    // Un autre crochet s'ouvre avant que celui-ci ne se ferme : ce n'est pas
    // un span, ou pas celui-là.
    if (node.nodeValue[close] === '[') return null;

    const match = node.nodeValue.slice(close).match(/^\]\{([^{}]*)\}/);
    const span = match && spanFor(doc, match[1]);
    if (!span) return null;

    // Le texte de tête perd son crochet, celui de queue sa fermeture : ce qui
    // reste entre les deux coupures est le contenu du span.
    const first = start.splitText(open);
    first.nodeValue = first.nodeValue.slice(1);
    const rest = node.splitText(close);
    rest.nodeValue = rest.nodeValue.slice(match[0].length);

    const inner = [];
    for (let n = first; n !== rest; n = n.nextSibling) inner.push(n);
    span.append(...inner);
    rest.before(span);
    if (!start.nodeValue) start.remove();
    return rest;
  }
  return null;
}

/**
 * Fait d'un tableau à barres verticales un tableau de l'éditeur.
 *
 * Markdown standard écrit un tableau ainsi :
 *
 *     | Col1  | Col2   |
 *     |-------|--------|
 *     | deded | frfrfr |
 *
 * `marked` le lit de lui-même, mais en `<table>` nu : la grille de Pandoc, elle,
 * arrive de `tables.js` avec la classe `tbl`, à laquelle tiennent l'aspect du
 * tableau et sa mise en page — sans elle, il ne se présentait pas comme un
 * tableau. On la lui donne donc. L'alignement des colonnes, que les
 * deux-points de sa barre disent, `marked` l'a déjà posé en `align` sur chaque
 * cellule, comme le fait la grille.
 *
 * À l'enregistrement, il ressort en grille, la seule forme que `turndown` sache
 * écrire.
 */
function liftPipeTables(doc) {
  for (const table of doc.querySelectorAll('table:not(.tbl)')) table.classList.add('tbl');
}

/**
 * Rend les appels de note — `[^1]` — en exposant.
 *
 * `marked` les laisse en texte brut, et `turndown` échapperait alors leurs
 * crochets : la note ne serait plus une note au premier aller-retour. Ils
 * deviennent donc un `<sup>`, que la règle de conversion sait réécrire. Jamais
 * dans un bloc de code, où l'appel n'est qu'un exemple.
 */
function liftFootnotes(doc) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const found = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!new RegExp(FOOTNOTE.source).test(node.nodeValue)) continue;
    if (node.parentElement?.closest('code, pre')) continue;
    found.push(node);
  }

  for (const node of found) {
    const value = node.nodeValue;
    const frag = doc.createDocumentFragment();
    let at = 0;

    for (const match of value.matchAll(FOOTNOTE)) {
      if (match.index > at) frag.append(doc.createTextNode(value.slice(at, match.index)));
      const mark = doc.createElement('sup');
      mark.className = 'fn';
      mark.textContent = match[1];
      frag.append(mark);
      at = match.index + match[0].length;
    }
    if (at < value.length) frag.append(doc.createTextNode(value.slice(at)));
    node.replaceWith(frag);
  }
}

/** Un shortcode de Quarto ou Hugo : `{{< nom argument >}}`. */
const SHORTCODE = /\{\{<[^{}<>]*>\}\}/g;

/**
 * Entoure les shortcodes d'une balise, pour que le rendu les distingue.
 *
 * Ce n'est qu'un habillage : la balise est un `<span>` sans style, que
 * `turndown` déplie — le fichier ne garde donc que le texte du shortcode. Les
 * tirets qui l'encadrent à l'écran viennent de la feuille de style, jamais du
 * document.
 *
 * Le travail se fait sur l'arbre rendu, et jamais dans un bloc de code : un
 * shortcode donné en exemple entre accents graves reste ce qu'il est, du texte.
 */
function liftShortcodes(doc) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const found = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!new RegExp(SHORTCODE.source).test(node.nodeValue)) continue;
    if (node.parentElement?.closest('code, pre')) continue;
    found.push(node);
  }

  for (const node of found) {
    const text = node.nodeValue;
    const frag = doc.createDocumentFragment();
    let at = 0;

    for (const match of text.matchAll(SHORTCODE)) {
      if (match.index > at) frag.append(doc.createTextNode(text.slice(at, match.index)));
      const span = doc.createElement('span');
      span.className = 'shortcode';
      span.textContent = match[0];
      frag.append(span);
      at = match.index + match[0].length;
    }
    if (at < text.length) frag.append(doc.createTextNode(text.slice(at)));
    node.replaceWith(frag);
  }
}

/**
 * Markdown → fragment DOM assaini, prêt à être inséré.
 *
 * `resolve` traduit le chemin relatif d'une image en adresse que la webview
 * sait charger ; sans lui les images du projet restent des cadres vides.
 */
export function toFragment(markdown, resolve = null) {
  if (!globalThis.marked) throw new Error('marked.js absent de vendor/');
  // L'en-tête YAML n'a rien à faire dans le rendu : `marked` ne le connaît
  // pas, et son « --- » de fermeture se lirait comme un soulignement de
  // titre de niveau 2. Le bloc se modifie par sa propre boîte, pas ici.
  const { body } = splitFront(markdown);
  // Les grilles de Pandoc deviennent du HTML avant l'analyse : `marked` ne les
  // connaît pas et les rendrait en texte brut.
  const html = globalThis.marked.parse(expand(expandFootnotes(body)), { gfm: true, breaks: false });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  liftFigures(doc);
  liftPipeTables(doc);
  liftHeadings(doc);
  liftSpans(doc);
  liftFootnotes(doc);
  liftShortcodes(doc);

  resolveImage = resolve;
  try {
    const frag = document.createDocumentFragment();
    for (const node of [...doc.body.childNodes]) frag.append(clean(node));
    return frag;
  } finally {
    resolveImage = null;
  }
}

/**
 * Le texte d'un nœud, mobilier de l'éditeur exclu.
 *
 * `service.remove` ne vaut que pour ce que `turndown` traverse lui-même ; une
 * règle qui lit le texte d'un nœud doit écarter le mobilier par ses propres
 * moyens.
 */
function plain(node) {
  return [...node.childNodes]
    .filter((n) => !(n.nodeType === Node.ELEMENT_NODE && n.classList?.contains('chrome')))
    .map((n) => n.textContent)
    .join('');
}

/** Échappement pour un contenu de balise, et pour une valeur d'attribut. */
const text = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (v) => text(v).replace(/"/g, '&quot;');

let service = null;

/**
 * L'instance de `turndown` et ses règles.
 *
 * Elle n'est bâtie qu'une fois : `addRule` empile ses règles, les poser à
 * chaque conversion les accumulerait sans fin.
 */
function make() {
  const service = new globalThis.TurndownService({
    // `## Titre` : la forme que `files::outline` lit pour bâtir le sommaire.
    headingStyle: 'atx',
    // `***` et non `---` : trois tirets sous un paragraphe en feraient un titre
    // souligné, et en tête de fichier le début d'un bloc YAML.
    hr: '***',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',

    // Une **ligne vide voulue** : un paragraphe qui ne porte qu'une espace
    // insécable. Deux retours à la ligne n'en font pas une — Markdown les
    // ramène à une séparation de blocs —, et `<br>` est du HTML en ligne, que
    // le document ne porte pas. `&nbsp;` seule vit dans les deux mondes :
    // CommonMark et Pandoc la lisent, et le paragraphe qu'elle occupe fait une
    // ligne blanche en HTML comme en PDF.
    //
    // Cela se dit ici et non dans une règle : `turndown` tient pour vide tout
    // nœud dont le texte n'est que du blanc — et en JavaScript, l'insécable en
    // est —, si bien qu'aucune règle ne serait consultée pour ce paragraphe.
    // `blankReplacement` est le seul endroit où l'on puisse le rattraper.
    blankReplacement: (_content, node) =>
      (node.nodeName === 'P' && node.textContent === NBSP
        ? `\n\n${BLANK}\n\n`
        : (node.isBlock ? '\n\n' : '')),
  });

  // Un titre rend son signet, dans la syntaxe d'attributs de Pandoc :
  // `## Titre {#mon-signet}`. Sans cette règle, `turndown` écrirait le titre
  // seul et le signet disparaîtrait du fichier au premier aller-retour — les
  // liens qui le visent tomberaient dans le vide.
  //
  // La règle est écrite en entier plutôt que de laisser celle de `turndown`
  // faire les dièses : celle-ci ne saurait pas où poser les accolades, qui
  // viennent après le texte du titre et non avant.
  service.addRule('titre', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const level = Number(node.nodeName.charAt(1));
      const attrs = [];
      // L'identifiant d'abord : c'est l'ordre que Pandoc écrit lui-même.
      if (node.id) attrs.push(`#${node.id}`);
      const rest = node.getAttribute('data-attrs');
      if (rest) attrs.push(rest);

      // Un titre vide n'a pas de signet à porter : ce serait un bloc
      // d'attributs suspendu à rien, que Pandoc lirait comme du texte.
      const text = content.trim();
      if (!text) return '';

      const suffix = attrs.length ? ` {${attrs.join(' ')}}` : '';
      return `\n\n${'#'.repeat(level)} ${text}${suffix}\n\n`;
    },
  });

  // Une liste **aérée** — une ligne vide entre deux entrées — est celle dont les
  // entrées portent un paragraphe : c'est ce que `marked` en fait, et ce que
  // CommonMark comme Pandoc appellent une liste « loose ». La différence se voit
  // à la compilation, l'espacement des entrées n'étant pas le même.
  //
  // `turndown` ne sait pas le dire : sa règle ramène toujours une entrée à une
  // seule fin de ligne, et l'aération serait donc perdue au premier
  // aller-retour. La règle est reprise en entier — préfixe et indentation
  // compris — pour lui ajouter cette ligne vide.
  service.addRule('entree-de-liste', {
    filter: 'li',
    replacement: (content, node, options) => {
      const text = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/gm, '\n    ')
        // L'indentation a suivi jusqu'à la dernière fin de ligne : les espaces
        // qu'elle y a semés ne tiennent rien. Seules les lignes faites de blanc
        // se vident — deux espaces en fin de ligne, eux, sont un saut de ligne.
        .replace(/^[ \t]+$/gm, '');

      const list = node.parentNode;
      let prefix = `${options.bulletListMarker}   `;
      if (list.nodeName === 'OL') {
        const start = list.getAttribute('start');
        const rank = [...list.children].indexOf(node);
        prefix = `${start ? Number(start) + rank : rank + 1}.  `;
      }

      // La fin de ligne de `turndown`, puis la ligne vide de l'aération. La
      // dernière entrée n'en porte pas : ce qui suit la liste a la sienne.
      const end = node.nextSibling && !/\n$/.test(text) ? '\n' : '';
      const air = node.nextSibling && loose(list) ? '\n' : '';
      return prefix + text + end + air;
    },
  });

  // Le barré est du GFM : turndown ne le connaît pas dans son jeu de base,
  // et sans cette règle `<del>` perdrait ses tildes à l'aller-retour.
  service.addRule('barre', {
    filter: ['del', 's', 'strike'],
    replacement: (content) => `~~${content}~~`,
  });

  // Une figure s'écrit dans la syntaxe d'attributs de Pandoc / Quarto, que
  // d'autres outils comprennent — et non en HTML, dont l'`outerHTML`
  // porterait de surcroît l'adresse `asset:` de l'aperçu.
  //
  //     ![la légende](image.svg){fig-align="center" width=90%}
  //
  // Chez Pandoc, le texte entre crochets *est* la légende : c'est donc lui
  // qu'on écrit, et l'attribut `alt` le reprend pour l'accessibilité.
  service.addRule('figure', {
    filter: 'figure',
    replacement: (_content, node) => {
      const img = node.querySelector('img');
      if (!img) return '';

      const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
      const legend = node.querySelector('figcaption');
      const caption = legend ? captionSource(legend) : (img.getAttribute('alt') ?? '');

      const style = node.getAttribute('style') ?? '';
      const left = /margin-left:\s*auto/.test(style);
      const right = /margin-right:\s*auto/.test(style);
      const width = style.match(/width:\s*(\d+(?:\.\d+)?%)/);

      const attrs = [];
      // L'alignement à gauche est le comportement par défaut : rien à écrire.
      if (left && right) attrs.push('fig-align="center"');
      else if (left) attrs.push('fig-align="right"');
      if (width) attrs.push(`width=${width[1]}`);

      const suffix = attrs.length ? `{${attrs.join(' ')}}` : '';
      // Lignes vides autour : chez Pandoc, une image seule dans son paragraphe
      // est ce qui en fait une figure.
      return `\n\n![${caption}](${src})${suffix}\n\n`;
    },
  });

  // L'image repart avec le chemin relatif du document, jamais avec l'adresse
  // `asset:` que la webview a utilisée pour l'afficher.
  service.addRule('image', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = node.getAttribute('data-src') || node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') ?? '';
      const title = node.getAttribute('title');
      return `![${alt}](${src}${title ? ` "${title}"` : ''})`;
    },
  });

  // Un tableau s'écrit en grille Pandoc — la seule forme qui admette plusieurs
  // lignes dans une cellule, une légende et des largeurs de colonnes. Sans
  // cette règle, `turndown` ne connaîtrait pas les tableaux du tout et les
  // aplatirait en texte suivi ; un tableau à barres verticales lu dans un
  // fichier ressort donc lui aussi en grille.
  //
  // La conversion des cellules repasse par la même instance : `turndown` bâtit
  // un document neuf à chaque appel et ne garde rien entre deux, l'appel
  // imbriqué est donc sans effet de bord.
  service.addRule('tableau', {
    filter: 'table',
    replacement: (_content, node) =>
      `\n\n${toGrid(node, (cell) => service.turndown(cell.innerHTML ?? ''))}\n\n`,
  });

  // Bloc de code : le langage choisi repart après les accents graves.
  //
  // `turndown` a bien une règle pour cela, mais elle exige que le `<code>` soit
  // le tout premier nœud du `<pre>` : un espace laissé par la frappe, le
  // mobilier de l'éditeur déplacé par le moteur d'édition, et la règle ne
  // s'applique plus — le bloc ressort alors en texte suivi, langage perdu. On
  // écrit donc la clôture nous-mêmes, en allant chercher le `<code>` où qu'il
  // soit.
  service.addRule('bloc-de-code', {
    filter: 'pre',
    replacement: (_content, node) => {
      const source = node.querySelector('code');
      const text = plain(source ?? node).replace(/\n$/, '');
      const language = (source?.getAttribute('class') ?? '').match(/language-(\S+)/)?.[1] ?? '';

      // Une clôture doit être plus longue que la plus longue suite d'accents
      // graves du code qu'elle enferme.
      const runs = [...text.matchAll(/^`{3,}/gm)].map((m) => m[0].length + 1);
      const fence = '`'.repeat(Math.max(3, ...runs));

      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    },
  });

  // Un span repart dans la syntaxe qui l'a rendu : le span à attributs de
  // Pandoc, que Quarto lit — et non du HTML en ligne.
  //
  // Seules les deux couleurs que les pastilles savent poser sont réécrites :
  // un `style` venu d'ailleurs — la police d'un texte collé, par exemple — n'a
  // rien à faire dans le document, et son span se déplie sur son seul texte.
  service.addRule('span-pandoc', {
    filter: (node) =>
      node.nodeName === 'SPAN'
      && (SPAN_CLASSES.some((c) => node.classList.contains(c)) || node.getAttribute('style')),
    replacement: (content, node) => {
      const attrs = SPAN_CLASSES.filter((c) => node.classList.contains(c)).map((c) => `.${c}`);

      const style = node.getAttribute('style') ?? '';
      const kept = [...style.matchAll(/(?:^|;)\s*(color|background-color)\s*:\s*([^;]+)/g)]
        .map(([, prop, value]) => `${prop}: ${value.trim()}`);
      if (kept.length) attrs.push(`style="${kept.join('; ')}"`);

      return attrs.length ? `[${content}]{${attrs.join(' ')}}` : content;
    },
  });

  // L'appel d'une note repart dans la syntaxe de Pandoc. La définition, elle,
  // n'a pas de règle à elle : son paragraphe commence par ce même appel, et
  // `[^1]: le texte` se réécrit donc tout seul.
  service.addRule('note-de-bas-de-page', {
    filter: (node) => node.nodeName === 'SUP' && node.classList.contains('fn'),
    replacement: (content) => `[^${content}]`,
  });

  // La case d'une liste de tâches repart en `[x] ` ou `[ ] ` au début de son
  // entrée ; `turndown` pose la puce devant, et la ligne retrouve la forme du
  // GFM. L'attribut fait foi : la propriété ne survit pas à la relecture du
  // HTML de la zone d'édition.
  service.addRule('case-a-cocher', {
    filter: (node) => node.nodeName === 'INPUT' && node.getAttribute('type') === 'checkbox',
    replacement: (_content, node) => (node.hasAttribute('checked') ? '[x] ' : '[ ] '),
  });

  // Le mobilier de l'éditeur — la liste des langages posée sur un bloc de code —
  // n'est pas du texte : il ne doit jamais repartir dans le fichier. Le rendu
  // le repose après chaque reconstruction, la conversion l'ignore.
  service.remove((node) => node.classList?.contains('chrome'));

  // Aucune balise n'est gardée telle quelle : le fichier ne porte que du
  // Markdown. Ce que `turndown` ne sait pas traduire — `<span>`, `<u>`,
  // `<mark>`, qu'ils viennent de la saisie ou d'un fichier écrit ailleurs —
  // est déplié, et son texte survit seul.
  return service;
}

/** Une liste est aérée quand ses entrées portent un paragraphe. */
function loose(list) {
  return [...list.children].some(
    (li) => li.nodeName === 'LI' && [...li.children].some((n) => n.nodeName === 'P'),
  );
}

/** HTML → Markdown, dans la forme que lit déjà le reste de l'application. */
export function toMarkdown(html) {
  if (!globalThis.TurndownService) throw new Error('turndown.js absent de vendor/');
  service ??= make();
  return service.turndown(html ?? '');
}

/** Les deux bibliothèques sont-elles bien chargées ? */
export function ready() {
  return Boolean(globalThis.marked && globalThis.TurndownService);
}
