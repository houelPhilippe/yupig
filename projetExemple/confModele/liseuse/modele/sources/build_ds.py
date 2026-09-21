import os, textwrap
D='project/components'
FONTS='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:wght@400;600&display=swap">'
IC={
 'sidebar':'<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/>',
 'search':'<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
 'file':'<path d="M3.5 2.5h5.5l3.5 3.5v7.5h-9z"/><path d="M9 2.5V6h3.5"/>',
 'sliders':'<path d="M3 5h10M3 11h10"/><circle cx="6" cy="5" r="1.6"/><circle cx="10.5" cy="11" r="1.6"/>',
 'left':'<path d="M10 3L5 8l5 5"/>','right':'<path d="M6 3l5 5-5 5"/>',
 'up':'<path d="M3 10l5-5 5 5"/>','down':'<path d="M3 6l5 5 5-5"/>',
 'close':'<path d="M4 4l8 8M12 4l-8 8"/>',
 'book':'<path d="M8 3.8C6.5 2.9 4.5 2.8 2.5 3.3v9.4c2-.5 4-.4 5.5.5 1.5-.9 3.5-1 5.5-.5V3.3c-2-.5-4-.4-5.5.5zM8 3.8v9.4"/>',
 'scroll':'<path d="M8 2.5v11M5 5.5l3-3 3 3M5 10.5l3 3 3-3"/>',
}
def ic(n): return f'<svg viewBox="0 0 16 16" aria-hidden="true">{IC[n]}</svg>'
def w(path,txt):
    os.makedirs(os.path.dirname(path),exist_ok=True); open(path,'w').write(txt)
BASE='html,body{margin:0}body{background:var(--chrome);color:var(--ink);font-family:var(--font-sans);padding:16px}.row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}.cap{font:400 12px/16px var(--font-sans);color:var(--ink-muted);margin:0 0 8px}'
def page(marker,body,extra=''):
    return f'<!-- @dsCard {marker} -->\n{FONTS}\n<style>{BASE}{extra}</style>\n{body}\n'

# ---------- IconButton ----------
w(f'{D}/IconButton/preview.html',page('group="Actions" height=128 subtitle="Bouton de barre d\'outils"',f'''
<p class="cap">Repos · survol (forcé) · pressé · désactivé · avec libellé</p>
<div class="row">
 <button class="lsr-iconbtn" aria-label="Sommaire">{ic('sidebar')}</button>
 <button class="lsr-iconbtn" style="background:var(--accent-soft)" aria-label="Recherche">{ic('search')}</button>
 <button class="lsr-iconbtn" aria-pressed="true" aria-label="Sommaire ouvert">{ic('sidebar')}</button>
 <button class="lsr-iconbtn" disabled aria-label="Page précédente">{ic('left')}</button>
 <button class="lsr-iconbtn">{ic('file')}Ouvrir</button>
 <button class="lsr-iconbtn">{ic('sliders')}Réglages</button>
 <button class="lsr-btn">{ic('file')}Choisir un fichier…</button>
</div>'''))
w(f'{D}/IconButton/README.md','''Bouton compact de 32 px pour les barres de la liseuse : une icône seule ou une icône suivie d'un libellé court.

**Ce que le consommateur fournit.** Un `<button class="lsr-iconbtn">` contenant un `<svg viewBox="0 0 16 16">` (trait 1,5 px, `currentColor`) et, pour une icône seule, un `aria-label` en français. Un bouton à bascule porte `aria-pressed`, un bouton qui ouvre un panneau porte `aria-expanded`.

**À faire**
- Un libellé verbe à l'infinitif ou nom court : « Ouvrir », « Réglages ».
- Laisser l'état pressé s'exprimer par `accent-soft` + bordure `accent` : la couleur ne porte jamais l'état seule (la bordure change aussi).

**À éviter**
- Plus de deux mots dans un libellé.
- Un bouton d'action principale sans libellé : utiliser `lsr-btn` (bordure `rule-strong`) pour les actions qui ne vivent pas dans une barre.
''')

# ---------- ReaderToolbar ----------
w(f'{D}/ReaderToolbar/preview.html',page('group="Navigation" height=210 subtitle="Barre d\'outils et recherche"',f'''
<style>body{{padding:0;background:var(--page)}}.gap{{height:16px}}</style>
<header class="lsr-toolbar">
 <button class="lsr-iconbtn" aria-pressed="true" aria-label="Sommaire">{ic('sidebar')}</button>
 <div class="lsr-toolbar__title"><strong>Guide de la liseuse</strong><span>guide-liseuse.html · 1 320 mots · ≈ 6 min</span></div>
 <div class="lsr-toolbar__group">
  <button class="lsr-iconbtn" aria-label="Rechercher dans le document" aria-expanded="true">{ic('search')}</button>
  <button class="lsr-iconbtn">{ic('file')}Ouvrir</button>
  <span class="lsr-toolbar__sep"></span>
  <button class="lsr-iconbtn" aria-label="Réglages de lecture">{ic('sliders')}Réglages</button>
 </div>
</header>
<div class="lsr-searchbar">
 <label class="lsr-search">{ic('search')}<input type="search" value="colonne" aria-label="Rechercher dans le document"></label>
 <span class="lsr-searchbar__count">2 / 5</span>
 <button class="lsr-iconbtn" aria-label="Occurrence précédente">{ic('up')}</button>
 <button class="lsr-iconbtn" aria-label="Occurrence suivante">{ic('down')}</button>
 <button class="lsr-iconbtn" aria-label="Fermer la recherche">{ic('close')}</button>
</div>
<div class="gap"></div>
<header class="lsr-toolbar" style="border-top:1px solid var(--rule)">
 <button class="lsr-iconbtn" aria-label="Sommaire">{ic('sidebar')}</button>
 <div class="lsr-toolbar__title"><strong>Titre très long d'un document technique qui ne tient pas sur une ligne</strong><span>specification.html</span></div>
 <div class="lsr-toolbar__group"><button class="lsr-iconbtn" aria-label="Rechercher">{ic('search')}</button><button class="lsr-iconbtn" aria-label="Réglages">{ic('sliders')}</button></div>
</header>'''))
w(f'{D}/ReaderToolbar/README.md','''Barre d'outils de 48 px (`bar-h`) sur `chrome` : bascule du sommaire, titre du document avec ses métadonnées, recherche, ouverture d'un fichier, réglages. La recherche ouvre une seconde rangée (`lsr-searchbar`) sous la barre.

**Ce que le consommateur fournit.** Le titre (`<strong>`) et une ligne de métadonnées (`<span>` : nom de fichier, nombre de mots, temps de lecture) ; les boutons sont des `IconButton`. Le titre se tronque avec une ellipse : ne jamais le faire passer à la ligne.

**À faire**
- En dessous de 700 px, ne garder que des boutons icône seule avec `aria-label`.
- Compter le temps de lecture à 230 mots par minute et l'afficher arrondi (« ≈ 6 min »).

**À éviter**
- Ajouter des actions rares (export, impression) dans la barre : elles vont dans le panneau de réglages.
''')

# ---------- ContentsList ----------
toc=[(0,'Guide de la liseuse',0),(1,'Ouvrir un document',0),(2,'Depuis un fichier',0),(2,'Par glisser-déposer',0),(1,'Se déplacer',1),(2,'Sommaire',0),(2,'Recherche dans le document',0),(2,'Raccourcis clavier',0),(1,'Régler la lecture',0),(2,'Thèmes',0),(2,'Typographie',0)]
def li(l,t,cur):
    cu=' aria-current="location"' if cur else ''
    return f'<li><a href="#" data-level="{l}" style="--lvl:{l}"{cu}>{t}</a></li>'
items=''.join(li(*x) for x in toc)
w(f'{D}/ContentsList/preview.html',page('group="Navigation" height=440 subtitle="Sommaire généré depuis les titres"',f'''
<style>body{{padding:0}}.wrap{{display:grid;grid-template-columns:var(--sidebar-w) 1fr;gap:0;height:420px}}.wrap nav{{border-right:1px solid var(--rule);overflow:auto}}.empty{{background:var(--chrome)}}</style>
<div class="wrap">
<nav class="lsr-toc" aria-label="Sommaire"><h2 class="lsr-toc__head">Sommaire</h2><ol>{items}</ol></nav>
<nav class="lsr-toc empty" aria-label="Sommaire (document sans titres)"><h2 class="lsr-toc__head">Sommaire</h2><p class="lsr-toc__empty">Ce document ne contient aucun titre (h1 à h4). Utilisez la recherche ou la barre de progression pour naviguer.</p></nav>
</div>'''))
w(f'{D}/ContentsList/README.md','''Sommaire latéral construit à partir des titres `h1` à `h4` du document ouvert. L'entrée de la section en cours porte `aria-current="location"` : fond `accent-soft`, texte `accent-ink`, graisse 600.

**Ce que le consommateur fournit.** Une liste `<ol>` d'ancres `<a data-level="0..3" style="--lvl:N">` ; le niveau 0 est le niveau de titre le plus haut présent dans le document (un document qui commence à `h2` n'est pas décalé). Si aucun titre n'existe, afficher `lsr-toc__empty` avec une consigne.

**À faire**
- Faire défiler la liste pour garder l'entrée courante visible.
- Fermer le sommaire après un choix quand il s'affiche en tiroir (moins de 900 px).

**À éviter**
- Numéroter les entrées : la numérotation appartient au document, pas à la liseuse.
- Signaler l'entrée courante par un liseré : c'est le fond `accent-soft` et la graisse qui portent l'état.
''')

# ---------- ProgressBar ----------
def status(p,ticks,section,meta,label):
    tk=''.join(f'<i class="lsr-progress__tick" style="left:{t}%"></i>' for t in ticks)
    return f'<footer class="lsr-status" style="--p:{p}%"><div class="lsr-progress" role="slider" tabindex="0" aria-label="{label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="{p}">{tk}<span class="lsr-progress__fill"></span><span class="lsr-progress__thumb"></span></div><div class="lsr-status__row"><span class="lsr-status__section">{section}</span><span class="lsr-status__meta">{meta}</span></div></footer>'
w(f'{D}/ProgressBar/preview.html',page('group="Lecture" height=250 subtitle="Progression et barre d\'état"',
 '<style>body{padding:0;background:var(--page)}.stack{display:grid;gap:12px;padding:0}</style><div class="stack">'
 +status(0,[0,18,41,66,84],'Guide de la liseuse','0 % · ≈ 6 min restantes','Progression de lecture')
 +status(42,[0,18,41,66,84],'Se déplacer › Recherche dans le document','42 % · ≈ 4 min restantes','Progression de lecture')
 +status(100,[0,18,41,66,84],'Limites connues','Page 14 / 14 · fin du document','Progression de lecture')
 +'</div>'))
w(f'{D}/ProgressBar/README.md','''Barre d'état de bas d'écran : une piste de progression cliquable et une ligne « section courante » / « position ». Les repères verticaux (`lsr-progress__tick`) marquent le début de chaque section de niveau 1 et 2 ; ce sont des informations, pas de la décoration.

**Ce que le consommateur fournit.** La progression en pourcentage dans la variable CSS `--p` du conteneur, la liste des positions de repères (en %), le fil d'Ariane de la section courante et un texte de position : « 42 % · ≈ 4 min restantes » en défilement, « Page 6 / 14 » en mode pages.

**À faire**
- Donner à la piste `role="slider"`, `aria-valuenow` et la gestion des flèches gauche/droite.
- Écrire « fin du document » plutôt que « 0 min restante ».

**À éviter**
- Animer le remplissage pendant un défilement : la progression suit le doigt ou la molette sans transition.
''')

# ---------- SettingsPanel ----------
def seg(items,cur): return '<div class="lsr-seg">'+''.join(f'<button aria-pressed="{"true" if i==cur else "false"}">{t}</button>' for i,t in enumerate(items))+'</div>'
panel=f'''<section class="lsr-panel" aria-label="Réglages de lecture">
 <div class="lsr-panel__head"><h2>Réglages de lecture</h2><button class="lsr-iconbtn" aria-label="Fermer">{ic('close')}</button></div>
 <fieldset class="lsr-field"><legend>Thème</legend><div class="lsr-swatches">
  <button class="lsr-swatch" aria-pressed="false">Auto</button>
  <button class="lsr-swatch" data-theme="light" aria-pressed="true" style="background:var(--page);color:var(--ink)"><b>Aa</b>Clair</button>
  <button class="lsr-swatch" data-theme="sepia" aria-pressed="false" style="background:var(--page);color:var(--ink)"><b>Aa</b>Sépia</button>
  <button class="lsr-swatch" data-theme="dark" aria-pressed="false" style="background:var(--page);color:var(--ink)"><b>Aa</b>Sombre</button></div></fieldset>
 <fieldset class="lsr-field"><legend>Police</legend>{seg(['Sans','Serif','Mono'],0)}</fieldset>
 <div class="lsr-field lsr-range"><div class="lsr-field__row"><label class="lsr-field__label" for="ps">Taille du texte</label><span class="lsr-field__value">17 px</span></div><input id="ps" type="range" min="14" max="28" value="17"></div>
 <div class="lsr-field lsr-range"><div class="lsr-field__row"><label class="lsr-field__label" for="pl">Interligne</label><span class="lsr-field__value">1,65</span></div><input id="pl" type="range" min="1.3" max="2" step="0.05" value="1.65"></div>
 <fieldset class="lsr-field"><legend>Largeur du texte</legend>{seg(['Étroite','Moyenne','Large'],1)}</fieldset>
 <fieldset class="lsr-field"><legend>Affichage</legend>{seg(['Défilement','Pages'],0)}</fieldset>
 <fieldset class="lsr-field"><legend>Position du sommaire</legend>{seg(['À gauche','À droite'],0)}</fieldset>
 <div class="lsr-field lsr-range"><div class="lsr-field__row"><label class="lsr-field__label" for="pt">Largeur du sommaire</label><span class="lsr-field__value">296 px</span></div><input id="pt" type="range" min="200" max="560" step="8" value="296"></div>
 <fieldset class="lsr-field"><legend>Styles du document</legend>{seg(['Ignorés','Conservés'],0)}</fieldset>
</section>'''
w(f'{D}/SettingsPanel/preview.html',page('group="Réglages" height=800 subtitle="Panneau flottant de réglages"',
 '<style>body{background:var(--page)}</style><div class="row">'+panel+'<div data-theme="sepia" style="background:var(--chrome);padding:16px;border-radius:8px">'+panel.replace('id="ps"','id="ps2"').replace('id="pl"','id="pl2"').replace('id="pt"','id="pt2"').replace('for="ps"','for="ps2"').replace('for="pl"','for="pl2"').replace('for="pt"','for="pt2"')+'</div></div>'))
w(f'{D}/SettingsPanel/README.md','''Panneau flottant (`raised`, bordure `rule-strong`, ombre `shadow-popover`, coin `radius-lg`) qui regroupe les réglages de lecture : thème, police, taille, interligne, largeur, affichage, styles du document.

**Ce que le consommateur fournit.** Un `<section class="lsr-panel">` positionné sous la barre d'outils (à droite) ; chaque réglage est un `<fieldset class="lsr-field">` avec sa `<legend>`. Choix exclusifs : `lsr-seg` (boutons `aria-pressed`). Valeurs continues : `lsr-range` avec la valeur affichée en `lsr-field__value`. Thèmes : `lsr-swatch` avec `data-theme` sur le bouton pour qu'il s'affiche dans les couleurs du thème qu'il désigne.

**À faire**
- Appliquer chaque réglage immédiatement, sans bouton « Appliquer », et le mémoriser côté lecteur.
- Fermer le panneau avec Échap ou un clic à l'extérieur, et rendre le focus au bouton qui l'a ouvert.

**À éviter**
- Deux panneaux ouverts en même temps.
- Une largeur supérieure à `panel-w` : sous 380 px, le panneau prend la largeur de l'écran moins les gouttières.
''')

# ---------- ReadingPage ----------
doc='''<article class="lsr-doc">
<h1>Cycle de vie d'un document</h1>
<p>La zone de lecture règle la <strong>largeur de ligne</strong>, l'interligne et la hiérarchie des titres&nbsp;; le document n'a rien à fournir de plus que du HTML sémantique. Le texte courant se lit à 17&nbsp;px avec un interligne de 1,65.</p>
<h2>Éléments pris en charge</h2>
<p>Les listes, <a href="#">les liens</a>, le code en ligne comme <code>lsr-doc</code> et les touches <kbd>Alt</kbd> + <kbd>←</kbd> sont stylés.</p>
<table><thead><tr><th>Élément</th><th>Rendu</th></tr></thead><tbody><tr><td>Tableau</td><td>Défilement horizontal si trop large</td></tr><tr><td>Image</td><td>Largeur maximale de la colonne</td></tr></tbody></table>
<pre><code>&lt;h2 id="etapes"&gt;Étapes&lt;/h2&gt;</code></pre>
<aside><p><strong>Note.</strong> Une note en <code>&lt;aside&gt;</code> prend le fond <code>accent-soft</code>.</p></aside>
<p>Une occurrence de <mark class="lsr-hit">recherche</mark> et la <mark class="lsr-hit" data-current>courante</mark>.</p>
</article>'''
cols=''.join(f'<div data-theme="{t}" style="background:var(--page);padding:24px;border-radius:8px;flex:1 1 300px;min-width:0;border:1px solid var(--rule)"><p class="cap">Thème {n}</p>{doc}</div>' for t,n in (('light','clair'),('sepia','sépia'),('dark','sombre')))
w(f'{D}/ReadingPage/preview.html',page('group="Lecture" height=920 subtitle="Typographie du document"',f'<div class="row">{cols}</div>','body{padding:16px}'))
w(f'{D}/ReadingPage/README.md','''Typographie du document lu, portée par la classe `lsr-doc` : titres `h1` à `h6`, paragraphes, listes, liens, code (`code`, `pre`, `kbd`), citations, notes (`aside`, `.note`), tableaux, images, figures, filets, occurrences de recherche (`mark.lsr-hit`).

**Ce que le consommateur fournit.** Le HTML du document, déjà assaini (aucun script, aucun gestionnaire `on…`), dans un élément `<article class="lsr-doc">`. Les réglages de l'utilisateur passent par trois variables CSS : `--read-size` (px), `--read-leading` (sans unité) et `--read-font` (`var(--font-sans)`, `var(--font-serif)` ou `var(--font-mono)`). La largeur de ligne se règle sur l'élément lui-même en `em` : `max-width: 30em` (étroite), `38em` (moyenne), `48em` (large).

**À faire**
- Garder une ligne de 60 à 75 caractères : c'est la largeur moyenne, pas la largeur de l'écran.
- Retirer les couleurs, fonds et polices en ligne du document quand l'utilisateur choisit « Styles ignorés » : c'est ce qui rend les trois thèmes lisibles.

**À éviter**
- Justifier le texte : l'alignement reste à gauche.
- Lire un tableau large en le réduisant : il défile horizontalement dans son propre conteneur.
''')

# ---------- ReaderShell ----------
article=doc.replace('<h1>Cycle de vie d\'un document</h1>','<h1>Guide de la liseuse</h1>')
tocs=''.join(li(*x) for x in toc[:9])
shell=f'''<div class="lsr-shell" style="height:540px">
<header class="lsr-toolbar"><button class="lsr-iconbtn" aria-pressed="true" aria-label="Sommaire">{ic('sidebar')}</button><div class="lsr-toolbar__title"><strong>Guide de la liseuse</strong><span>guide-liseuse.html · 1 320 mots · ≈ 6 min</span></div><div class="lsr-toolbar__group"><button class="lsr-iconbtn" aria-label="Rechercher">{ic('search')}</button><button class="lsr-iconbtn">{ic('file')}Ouvrir</button><button class="lsr-iconbtn">{ic('sliders')}Réglages</button></div></header>
<div class="lsr-shell__body"><button class="lsr-resizer" role="separator" aria-orientation="vertical" aria-label="Largeur du sommaire" aria-valuemin="200" aria-valuemax="560" aria-valuenow="296"></button><aside class="lsr-sidebar"><nav class="lsr-toc" aria-label="Sommaire"><h2 class="lsr-toc__head">Sommaire</h2><ol>{tocs}</ol></nav></aside>
<main class="lsr-main" style="overflow:hidden"><div style="padding:32px 48px;max-width:38em;margin:0 auto">{article}</div></main></div>
{status(42,[0,18,41,66,84],'Se déplacer › Sommaire','42 % · ≈ 4 min restantes','Progression de lecture')}
</div>'''
shell_r=shell.replace('<div class="lsr-shell" style="height:540px">','<div class="lsr-shell" data-toc-side="right" style="height:540px;--toc-w:240px">')
w(f'{D}/ReaderShell/preview.html',page('group="Assemblage" height=1180 subtitle="Barre, sommaire, lecture, état ; sommaire à gauche ou à droite"','<p class="cap">Sommaire à gauche (largeur par défaut)</p>'+shell+'<p class="cap" style="margin-top:24px">Sommaire à droite, largeur 240 px</p>'+shell_r,'body{padding:16px;background:var(--page)}'))
w(f'{D}/ReaderShell/README.md','''Assemblage complet de la liseuse : une grille `lsr-shell` à trois rangées (barre d'outils, corps, barre d'état) dont le corps porte deux colonnes (`lsr-sidebar` de largeur `sidebar-w`, `lsr-main` qui prend le reste).

**Ce que le consommateur fournit.** Un conteneur de hauteur définie (`height: 100%`), les quatre composants `ReaderToolbar`, `ContentsList`, `ReadingPage` et `ProgressBar`, et le panneau `SettingsPanel` posé en absolu au-dessus.

**Sommaire à gauche ou à droite.** Posez `data-toc-side="right"` sur `lsr-shell` (ou sur un parent) pour placer le sommaire à droite ; la grille échange ses zones (`side`, `main`) sans changer l'ordre du balisage. La largeur se règle avec la variable `--toc-w` (défaut : `sidebar-w`). La poignée `lsr-resizer` (`role="separator"`, un bouton placé dans `lsr-shell__body`) se positionne d'elle-même sur le bord intérieur du sommaire.

**À faire**
- Laisser l'utilisateur ajuster la largeur du sommaire entre 200 px et 560 px (60 % de la largeur au plus), à la souris (glisser, double-clic pour réinitialiser), au clavier (flèches, Maj + flèches, Début, Fin) et par un curseur dans les réglages.
- Sous 900 px, passer le sommaire en tiroir par-dessus la lecture, fermé par défaut, du côté choisi.
- Laisser la zone de lecture prendre le focus clavier après l'ouverture d'un document pour que les flèches et la barre d'espace fonctionnent tout de suite.

**À éviter**
- Ajouter une seconde barre latérale : les réglages restent dans un panneau flottant.
''')

# ---------- Cover ----------
cover='''<!-- @dsCard height=288 -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>
html,body{margin:0;background:var(--page)}
svg{display:block;width:960px;height:288px}
.ground{fill:var(--page)}
.dot{fill:var(--accent)}
.b-accent{fill:var(--accent);rx:var(--radius-sm)}
.b-ink{fill:var(--ink);rx:var(--radius-sm)}
.b-soft{fill:var(--accent-soft);rx:var(--radius-sm)}
.b-mark{fill:var(--mark-active);rx:var(--radius-sm)}
.b-muted{fill:var(--rule-strong);rx:var(--radius-sm)}
.name{font:600 96px/1 var(--font-sans);fill:var(--ink);letter-spacing:-.02em}
.tag{font:400 14px/1 var(--font-sans);fill:var(--ink-muted)}
</style>
<svg viewBox="0 0 960 288" role="img" aria-label="Liseuse">
<!--
blocs : accent 144x192 (3x4 pas de space-7) ; ink 96x192 ; accent-soft 144x96 ; mark-active 48x48 ; rule-strong 96x96 — pas 48px (space-7), rayons radius-sm
disposition : une dalle haute accent avec satellites, blocs qui débordent en haut, en bas et à droite
motif : grille de points au pas 48px (space-7) — précis, technique, lecture de documentation
pas : 48px partout ; coin : radius-sm
-->
<rect class="ground" width="960" height="288"/>
<g id="dots">DOTS</g>
<rect class="b-accent" x="576" y="0" width="144" height="192"/>
<rect class="b-ink" x="720" y="96" width="96" height="192"/>
<rect class="b-soft" x="816" y="0" width="144" height="96"/>
<rect class="b-mark" x="528" y="192" width="48" height="48"/>
<rect class="b-muted" x="864" y="192" width="96" height="96"/>
<text class="name" x="48" y="176">Liseuse</text>
<text class="tag" x="48" y="220">Lire des documents HTML, sans distraction.</text>
</svg>
'''
dots=''.join(f'<circle class="dot" cx="{504+48*i}" cy="{24+48*j}" r="2.5"/>' for i in range(10) for j in range(6))
w(f'{D}/Cover/preview.html',cover.replace('DOTS',dots))
