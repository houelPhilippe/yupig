import json
P=json.load(open('palette.json'))
usage={
 'chrome':"Fond de la barre d'outils, du sommaire et de la barre d'état. Texte : `ink`, `ink-muted`, `accent-ink`.",
 'page':"Fond de la zone de lecture et des champs de saisie. Texte : `ink`, `ink-muted`, `accent-ink`.",
 'raised':"Fond des panneaux flottants (réglages). Texte : `ink`, `ink-muted`, `accent-ink`.",
 'ink':"Texte courant sur `page`, `chrome`, `raised`, `code-bg` et `accent-soft`.",
 'ink-muted':"Texte secondaire (métadonnées, légendes, libellés) sur `page`, `chrome`, `raised`, `code-bg` et `accent-soft`.",
 'rule':"Filet décoratif : séparation barre / lecture, tableaux, blocs de code. Ne porte aucun sens seul.",
 'rule-strong':"Bordure des contrôles (champs, boutons segmentés, panneaux) : 3:1 minimum sur `page`, `chrome`, `raised`.",
 'accent':"Remplissage des actions actives (bouton segmenté sélectionné, curseur de progression). Texte dessus : `on-accent`.",
 'on-accent':"Texte et icônes sur un fond `accent`.",
 'accent-ink':"Liens, élément actif du sommaire et texte d'accentuation sur `page`, `chrome`, `raised` et `accent-soft`.",
 'accent-soft':"Fond de survol et de sélection (entrée courante du sommaire, bouton pressé). Texte : `ink`, `accent-ink`.",
 'mark':"Fond des occurrences de recherche. Texte dessus : `on-mark`.",
 'mark-active':"Fond de l'occurrence de recherche courante. Texte dessus : `on-mark` ; un contour `ink` de 2 px la distingue.",
 'on-mark':"Texte sur `mark` et `mark-active`.",
 'code-bg':"Fond du code, des citations et des en-têtes de tableau. Texte : `ink`.",
 'focus':"Anneau de focus clavier (2 px, décalage 2 px) : 3:1 minimum sur `page`, `chrome`, `raised`, `code-bg` et `accent-soft`.",
}
order=list(usage.keys())
colors=[{"name":n,"value":{t:P[t][n] for t in ('light','sepia','dark')},"usage":usage[n]} for n in order]
tok={
 "name":"Liseuse","version":1,
 "color":{"themes":[{"id":"light","name":"Clair"},{"id":"sepia","name":"Sépia"},{"id":"dark","name":"Sombre"}],"tokens":colors},
 "type":{
  "fonts":[],
  "families":{
   "sans":"\"IBM Plex Sans\", system-ui, \"Segoe UI\", Helvetica, Arial, sans-serif",
   "serif":"\"Source Serif 4\", Georgia, \"Times New Roman\", serif",
   "mono":"\"IBM Plex Mono\", ui-monospace, Consolas, monospace"},
  "groups":[
   {"name":"Interface","family":"sans","styles":[
     {"name":"ui-title","fontSize":"15px","lineHeight":"20px","fontWeight":600,"usage":"Titre du document dans la barre d'outils."},
     {"name":"ui-label","fontSize":"13px","lineHeight":"16px","fontWeight":500,"usage":"Boutons, champs, entrées du sommaire."},
     {"name":"ui-caption","fontSize":"12px","lineHeight":"16px","fontWeight":400,"usage":"Barre d'état, métadonnées, aides."},
     {"name":"ui-overline","fontSize":"11px","lineHeight":"16px","fontWeight":600,"letterSpacing":"0.08em","usage":"Intitulés de groupes en capitales (Sommaire, Thème)."}]},
   {"name":"Lecture","family":"sans","styles":[
     {"name":"read-h1","fontSize":"32px","lineHeight":"40px","fontWeight":600,"usage":"Titre du document."},
     {"name":"read-h2","fontSize":"24px","lineHeight":"32px","fontWeight":600,"usage":"Sections."},
     {"name":"read-h3","fontSize":"19px","lineHeight":"26px","fontWeight":600,"usage":"Sous-sections."},
     {"name":"read-body","fontSize":"17px","lineHeight":"28px","fontWeight":400,"usage":"Texte courant, police sans (par défaut)."},
     {"name":"read-body-serif","family":"serif","fontSize":"18px","lineHeight":"30px","fontWeight":400,"usage":"Texte courant, police à empattements (option)."},
     {"name":"read-code","family":"mono","fontSize":"14px","lineHeight":"22px","fontWeight":400,"usage":"Code et chaînes littérales."}]}]},
 "spacing":{"tokens":[
   {"name":"space-1","value":"4px","usage":"Écart icône / texte."},
   {"name":"space-2","value":"8px","usage":"Écart entre contrôles voisins."},
   {"name":"space-3","value":"12px","usage":"Marge intérieure des barres."},
   {"name":"space-4","value":"16px","usage":"Marge intérieure des panneaux ; gouttière minimale."},
   {"name":"space-5","value":"24px","usage":"Marges verticales de la zone de lecture."},
   {"name":"space-6","value":"32px","usage":"Marges latérales de la zone de lecture."},
   {"name":"space-7","value":"48px","usage":"Pas de la grille de la couverture ; marge haute des sections."},
   {"name":"space-8","value":"64px","usage":"Marge basse du document."}]},
 "radius":{"tokens":[
   {"name":"radius-sm","value":"2px","usage":"Code en ligne, occurrences de recherche."},
   {"name":"radius-md","value":"4px","usage":"Boutons, champs, blocs de code."},
   {"name":"radius-lg","value":"8px","usage":"Panneaux flottants."}]},
 "layout":{"tokens":[
   {"name":"bar-h","value":"48px","usage":"Hauteur de la barre d'outils."},
   {"name":"sidebar-w","value":"296px","usage":"Largeur du sommaire ouvert."},
   {"name":"panel-w","value":"340px","usage":"Largeur du panneau de réglages."}]},
 "shadow":{"tokens":[
   {"name":"shadow-popover","value":{"light":"0 8px 24px rgba(20, 32, 36, 0.16)","sepia":"0 8px 24px rgba(58, 48, 35, 0.2)","dark":"0 8px 24px rgba(0, 0, 0, 0.5)"},"usage":"Panneau de réglages uniquement."}]}
}
json.dump(tok,open('project/tokens.json','w'),ensure_ascii=False,indent=1)
# css for standalone reader
def block(sel,t):
    return sel+'{'+''.join(f'--{k}:{v};' for k,v in P[t].items())+'}'
sh={"light":"0 8px 24px rgba(20, 32, 36, 0.16)","sepia":"0 8px 24px rgba(58, 48, 35, 0.2)","dark":"0 8px 24px rgba(0, 0, 0, 0.5)"}
common=":root{--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;--space-7:48px;--space-8:64px;--radius-sm:2px;--radius-md:4px;--radius-lg:8px;--bar-h:48px;--sidebar-w:296px;--panel-w:340px;--font-sans:"+tok['type']['families']['sans']+";--font-serif:"+tok['type']['families']['serif']+";--font-mono:"+tok['type']['families']['mono']+";}"
css=common+"\n"
css+=block(':root','light')+f":root{{--shadow-popover:{sh['light']}}}\n"
for t in ('light','sepia','dark'):
    css+=block(f'[data-theme="{t}"]',t)+f'[data-theme="{t}"]{{--shadow-popover:{sh[t]}}}\n'
excl=':not([data-liseuse="light"]):not([data-liseuse="sepia"]):not([data-liseuse="dark"])'
css+='@media (prefers-color-scheme: dark){'+block(':root:not([data-theme="light"])'+excl,'dark')+f':root:not([data-theme="light"]){excl}{{--shadow-popover:{sh["dark"]}}}'+'}\n'
for t in ('light','sepia','dark'):
    css+=block(f':root[data-liseuse="{t}"]',t)+f':root[data-liseuse="{t}"]{{--shadow-popover:{sh[t]}}}\n'
open('reader-tokens.css','w').write(css)
print(len(css))
