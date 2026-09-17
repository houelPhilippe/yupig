--[[
  filtre.lua — Filtre Pandoc pour la compilation des specifications (*.md)
  vers le modele HTML « Liseuse ».

  Role :
   * Convertir le shortcode Quarto  {{< pagebreak >}}  en saut de page HTML.
   * Resoudre le shortcode Quarto  {{< meta cle >}}  en valeur de la
     metadonnee correspondante (front matter), avec un formatage a la
     francaise (JJ/MM/AAAA) pour {{< meta date >}}.
   * Transformer les commentaires  [texte]{.comment comment-text="..."}
     en info-bulles (attribut title) affichables au survol.
   * Centrer les figures/images et exposer fig-align.
   * Rendre les blocs « callout » ( ::: {.callout-note} ... ::: ) : bandeau
     titre + icone en HTML, encadre tcolorbox en PDF.
   * Appliquer les contenus conditionnels .content-visible / .content-hidden
     avec when-format="html" | "pdf".
   * Calculer le temps de lecture estime et le nombre de mots, injectes
     comme metadonnees ($reading-minutes$, $word-count$) utilisables par
     le modele.

  Aucune de ces transformations n'altere le design : elles adaptent
  simplement le Markdown « saveur Quarto » a un rendu Pandoc pur.
--]]

local words = 0

-- Metadonnees du document (front matter), capturees par le premier des deux
-- filtres retournes en fin de script -- voir la note pres du `return` final.
local doc_meta = pandoc.Meta({})

-- Compte les mots du corps pour le temps de lecture -------------------------
function Str(el)
  local _, n = el.text:gsub("%S+", "")
  words = words + n
  return nil
end

-- Existence d'un fichier (pour le repli SVG -> PNG en sortie LaTeX) ----------
local function file_exists(path)
  local f = io.open(path, "r")
  if f then f:close(); return true end
  return false
end

-- Cherche un fichier via le repertoire courant puis les --resource-path
-- Retourne le chemin complet trouvé, ou le chemin original si introuvable.
local function resolve_resource(rel)
  if file_exists(rel) then return rel end
  local rp = (PANDOC_STATE and PANDOC_STATE.resource_path) or {}
  for _, dir in ipairs(rp) do
    local path = dir .. "/" .. rel
    if file_exists(path) then return path end
  end
  return rel
end

-- Saut de page Word : un paragraphe vide portant <w:br w:type="page"/>.
local DOCX_PAGEBREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

-- Passe de filtrage appliquee au contenu insere par {{< include >}}.
-- Construite a l'appel : les fonctions globales citees sont definies plus
-- bas dans ce fichier, mais toutes existent au moment ou le shortcode est
-- rencontre. Doit rester le miroir de la seconde passe retournee en fin de
-- fichier (Pandoc excepte : elle porte sur le document entier).
local function content_filter()
  return {
    Str = Str,
    Para = Para,
    Span = Span,
    Underline = Underline,
    Code = Code,
    Div = Div,
    Image = Image,
    Table = Table,
    Link = Link,
    Inlines = Inlines,
  }
end

-- {{< pagebreak >}} -> <div class="pagebreak"></div> -----------------------
-- {{< include file.md >}} -> insere le contenu du fichier ------------------
-- Le shortcode arrive sous forme d'un paragraphe dont le texte concatene
-- vaut « {{< pagebreak >}} » ou « {{< include ... >}} ».
function Para(el)
  local txt_raw = pandoc.utils.stringify(el)
  local txt = txt_raw:gsub("%s+", "")
  
  if txt == "{{<pagebreak>}}" then
    if FORMAT:match("latex") then
      return pandoc.RawBlock("latex", "\\newpage")
    end
    -- DOCX : le writer ignore le HTML brut ; le saut de page y est un
    -- paragraphe vide portant <w:br w:type="page"/>.
    if FORMAT:match("docx") then
      return pandoc.RawBlock("openxml", DOCX_PAGEBREAK)
    end
    return pandoc.RawBlock("html", '<div class="pagebreak"></div>')
  end

  local include_file = txt_raw:match("^{{<%s*include%s+(.-)%s*>}}$")
  if include_file then
    local path = resolve_resource(include_file)
    local f = io.open(path, "r")
    if f then
      local content = f:read("*a")
      f:close()
      -- Parse le contenu markdown inclus
      local doc = pandoc.read(content, "markdown")
      -- Pandoc ne reparcourt PAS les elements renvoyes par une fonction de
      -- filtre : sans ce walk explicite, le contenu inclus echapperait a
      -- toute la passe en cours -- Table (attributs Quarto de la ligne de
      -- legende : .bordered, .striped, tbl-colwidths), Div (callouts,
      -- when-format), Span, Image, Link, Inlines ({{< meta >}}) et Str
      -- (comptage des mots). On rejoue donc ici la meme passe que celle
      -- retournee en fin de fichier ; Pandoc en est exclue, elle ne
      -- s'applique qu'au document entier. Para y figure : les inclusions
      -- imbriquees continuent de fonctionner.
      local walked = pandoc.walk_block(pandoc.Div(doc.blocks), content_filter())
      return walked.content
    else
      io.stderr:write("Warning: Cannot include file " .. include_file .. "\n")
      return nil
    end
  end

  return nil
end

-- Couleur CSS -> argument xcolor : #RRGGBB via [HTML], nom mis en minuscules
-- sinon (les noms xcolor sont sensibles a la casse, alors que CSS/Markdown
-- ecrit indifferemment "Yellow", "yellow" ou "YELLOW" ; cf. les
-- \providecolor de conf/preamble.tex / conf/preamble-single.tex, tous en
-- minuscules).
local function latex_color_arg(val)
  local hex = val:match("^#(%x%x%x%x%x%x)$")
  if hex then return "[HTML]{" .. hex:upper() .. "}" end
  return "{" .. val:lower() .. "}"
end

-- Commentaires .comment : recopie comment-text dans title (info-bulle) -------
-- Spans colores : le writer LaTeX de Pandoc ignore l'attribut style (HTML
-- uniquement). Pour le PDF, background-color devient \colorbox et color
-- devient \textcolor, imbriques si les deux sont presents.
-- DOCX : le writer ignore l'attribut style=. Le seul mecanisme Word qui
-- preserve la mise en forme imbriquee (gras, code, lien) dans un span colore
-- est le style de caractere : on pose custom-style=, et conf/reference.docx
-- porte la definition (couleur de texte / fond). Le nom est derive du CSS,
-- « Fond lightsalmon », « Texte blue », « Texte white fond black » ;
-- conf/gen-docx-colors.py regenere les styles correspondants.
local function docx_color_style(style)
  local bg, fg
  for prop, val in style:gmatch("([%w%-]+)%s*:%s*([^;]+)") do
    val = val:gsub("^%s+", ""):gsub("%s+$", ""):gsub("^#", ""):lower()
    prop = prop:lower()
    if prop == "background-color" then bg = val
    elseif prop == "color" then fg = val end
  end
  if fg and bg then return "Texte " .. fg .. " fond " .. bg end
  if fg then return "Texte " .. fg end
  if bg then return "Fond " .. bg end
  return nil
end

function Span(el)
  if el.classes:includes("comment") then
    local t = el.attributes["comment-text"]
    if t and t ~= "" then
      el.attributes["title"] = t
    end
  end

  if FORMAT:match("docx") and el.attributes["style"] then
    local name = docx_color_style(el.attributes["style"])
    if name then el.attributes["custom-style"] = name end
    return el
  end

  if FORMAT:match("latex") and el.attributes["style"] then
    local bg, fg
    for prop, val in el.attributes["style"]:gmatch("([%w%-]+)%s*:%s*([^;]+)") do
      val = val:gsub("^%s+", ""):gsub("%s+$", "")
      prop = prop:lower()
      if prop == "background-color" then bg = val
      elseif prop == "color" then fg = val end
    end
    if bg or fg then
      local pre, post = "", ""
      if bg then pre = pre .. "\\colorbox" .. latex_color_arg(bg) .. "{"; post = "}" .. post end
      if fg then pre = pre .. "\\textcolor" .. latex_color_arg(fg) .. "{"; post = "}" .. post end
      local out = pandoc.Inlines({ pandoc.RawInline("latex", pre) })
      out:extend(el.content)
      out:insert(pandoc.RawInline("latex", post))
      return out
    end
  end

  return el
end

-- __texte__ / <u>texte</u> (noeud Underline natif de Pandoc, distinct d'un
-- Span) : le writer LaTeX emet nativement \ul{...}, souligne par le paquet
-- soul (charge par \usepackage{soulutf8}, cf. \inlinecode). \ul est fragile
-- des qu'il contient une autre macro a argument (ex. \inlinecode{\texttt{...}}
-- pour un `code` en ligne) : soul perd le suivi des accolades et LaTeX
-- consomme tout le document jusqu'au prochain paragraphe avant d'echouer
-- ("Argument of \inlinecode has an extra }"). \underline standard ne
-- souligne pas les retours a la ligne mais n'a pas ce probleme ; ces
-- passages sont de courts intitules, jamais des paragraphes entiers.
function Underline(el)
  if not FORMAT:match("latex") then return nil end
  local out = pandoc.Inlines({ pandoc.RawInline("latex", "\\underline{") })
  out:extend(el.content)
  out:insert(pandoc.RawInline("latex", "}"))
  return out
end

-- Code inline (delimiteur ` du Markdown) : pastille grise en PDF, comme
-- dans la Liseuse HTML. Le writer LaTeX rend un simple \texttt ; on
-- l'enveloppe dans la macro \inlinecode des preambules (un \colorbox a
-- \fboxsep reduit). Le texte passe d'abord par le writer pour beneficier de
-- son echappement (\_, \%, \textbackslash{}...), sans retour a la ligne
-- qui couperait la macro.
function Code(el)
  if not FORMAT:match("latex") then return nil end
  local tex = pandoc.write(pandoc.Pandoc({ pandoc.Plain({ el }) }), "latex",
                           { wrap_text = "none" })
  tex = tex:gsub("%s+$", "")
  return pandoc.RawInline("latex", "\\inlinecode{" .. tex .. "}")
end

-- ---------------------------------------------------------------------------
-- Blocs « callout » et contenus conditionnels (saveur Quarto)
-- ---------------------------------------------------------------------------
-- Markdown source reconnu :
--   ::: {.callout-note}                       encadre bleu « Note »
--   ::: {.callout-tip}                        vert   « Astuce »
--   ::: {.callout-warning}                    orange « Avertissement »
--   ::: {.callout-caution}                    ocre   « Attention »
--   ::: {.callout-important}                  rouge  « Important »
--   ::: {.callout-note title="Mon titre"}     titre personnalise (ou premier
--                                             titre ## place dans le bloc)
--   ::: {.callout-note icon="false"}          sans icone
--   ::: {.callout-note appearance="simple"}   sans bandeau colore
--   ::: {.callout-note style="width: 72%; margin: auto"}   largeur / centrage
--   ::: {.content-visible when-format="html"} bloc reserve a un format
--   ::: {.content-hidden  when-format="pdf"}  bloc exclu d'un format
--
-- Pandoc « pur » se contente de recopier ces classes sur la <div> : il
-- n'ajoute ni bandeau, ni titre, ni icone, et n'interprete pas when-format.
-- On reconstruit donc ici la structure attendue par le CSS de la Liseuse
--   <div class="callout callout-note callout-style-default">
--     <div class="callout-header"><span class="callout-icon ..."></span>
--         <span class="callout-title-text">Note</span></div>
--     <div class="callout-body"> ... </div>
--   </div>
-- (regles dans conf/modele.template.html) et, cote PDF, l'environnement
-- calloutbox defini dans conf/preamble.tex et conf/preamble-single.tex.

-- Classe -> titre par defaut, icone DSFR (resources/dsfr utility.main.css)
-- et couleur LaTeX (\definecolor dans les preambules).
local CALLOUT_TYPES = {
  ["callout-note"]      = { title = "Note",          icon = "fr-icon-information-line",   color = "calloutNote" },
  ["callout-tip"]       = { title = "Astuce",        icon = "fr-icon-lightbulb-line",     color = "calloutTip" },
  ["callout-warning"]   = { title = "Avertissement", icon = "fr-icon-warning-line",       color = "calloutWarning" },
  ["callout-caution"]   = { title = "Attention",     icon = "fr-icon-alert-line",         color = "calloutCaution" },
  ["callout-important"] = { title = "Important",     icon = "fr-icon-error-warning-line", color = "calloutImportant" },
}

-- Nom « Quarto » du format de sortie courant, pour when-format.
local function output_format()
  if FORMAT:match("latex") or FORMAT:match("beamer") then return "pdf" end
  if FORMAT:match("html") then return "html" end
  return FORMAT
end

-- when-format accepte une liste ("html,docx") et la negation ("!pdf").
local function format_matches(spec)
  local fmt = output_format()
  local only_negations = true
  for item in spec:gmatch("[^,%s]+") do
    local negated = item:sub(1, 1) == "!"
    if negated then item = item:sub(2) else only_negations = false end
    item = item:lower()
    local hit = (item == fmt)
      or (fmt == "pdf"  and (item == "latex" or item == "beamer"))
      or (fmt == "html" and item:match("^html") ~= nil)
    if hit then return not negated end
  end
  -- Aucun item ne correspond : le bloc reste visible si la liste n'etait
  -- faite que de negations (« !pdf » = « partout sauf en PDF »).
  return only_negations
end

local function is_false(value)
  if not value then return false end
  value = tostring(value):lower()
  return value == "false" or value == "no" or value == "0"
end

-- « width: 72% » -> 0.72 (fraction de \linewidth pour tcolorbox).
local function css_width_fraction(style)
  if not style then return nil end
  local pct = style:match("width%s*:%s*([%d%.]+)%s*%%")
  local n = pct and tonumber(pct)
  if not n or n <= 0 or n > 100 then return nil end
  return n / 100
end

-- « margin: auto » / « margin: 0 auto » -> encadre centre.
local function css_centered(style)
  return style ~= nil and style:match("margin[%w%-]*%s*:%s*[^;]*auto") ~= nil
end

-- Titre du callout : attribut title=, sinon premier titre (##) du bloc
-- (convention Quarto, le titre est alors retire du corps), sinon libelle
-- par defaut du type.
local function callout_title(el, blocks, default)
  local given = el.attributes["title"]
  if given and given ~= "" then
    return pandoc.utils.blocks_to_inlines(pandoc.read(given, "markdown").blocks), blocks
  end
  if #blocks > 0 and blocks[1].t == "Header" then
    local rest = pandoc.Blocks({})
    for i = 2, #blocks do rest:insert(blocks[i]) end
    return blocks[1].content, rest
  end
  return pandoc.Inlines({ pandoc.Str(default) }), blocks
end

-- Une figure LaTeX ( \begin{figure} ) est un flottant : place dans une
-- tcolorbox, il provoque « Not in outer par mode » ou s'en echappe pour
-- atterrir sur une autre page. Dans un callout, on rend donc l'image et sa
-- legende sans flottant. \captionof est fourni nativement par KOMA-Script
-- (scrartcl / scrbook), aucun paquet supplementaire n'est requis.
local function unfloat_figures(blocks)
  return pandoc.walk_block(pandoc.Div(blocks), {
    Figure = function(f)
      local out = pandoc.Blocks({ pandoc.RawBlock("latex", "\\begin{center}") })
      out:extend(f.content)
      local cap = f.caption and f.caption.long
      if cap and #cap > 0 then
        local tex = pandoc.write(pandoc.Pandoc(cap), "latex", { wrap_text = "none" })
        out:insert(pandoc.RawBlock("latex",
          "\\captionof{figure}{" .. tex:gsub("%s+$", "") .. "}"))
      end
      -- Conserve la cible des renvois ( ![...](x){#fig-truc} ).
      if f.identifier and f.identifier ~= "" then
        out:insert(pandoc.RawBlock("latex", "\\label{" .. f.identifier .. "}"))
      end
      out:insert(pandoc.RawBlock("latex", "\\end{center}"))
      return out
    end
  }).content
end

-- Sortie PDF : \begin{calloutbox}{<options tcolorbox>}{<titre>} ... .
local function callout_latex(el, def, title, body)
  local doc = pandoc.Pandoc({ pandoc.Plain(title) })
  local title_tex = pandoc.write(doc, "latex"):gsub("%s+$", "")

  local opts = "breakable,enhanced,arc=1.5mm,boxrule=0.6pt,"
    .. "left=2.5mm,right=2.5mm,top=1.5mm,bottom=1.5mm,"
    .. "colframe=" .. def.color .. ",colback=" .. def.color .. "!5!white,"
    .. "colbacktitle=" .. def.color .. ",coltitle=white,"
    .. "fonttitle=\\bfseries\\small"

  local style = el.attributes["style"]
  local frac = css_width_fraction(style)
  if frac then
    opts = opts .. string.format(",width=%.3f\\linewidth", frac)
    if css_centered(style) then opts = opts .. ",center" end
  end

  local out = pandoc.Blocks({
    pandoc.RawBlock("latex", "\\begin{calloutbox}{" .. opts .. "}{" .. title_tex .. "}")
  })
  out:extend(unfloat_figures(body))
  out:insert(pandoc.RawBlock("latex", "\\end{calloutbox}"))
  return out
end

function Div(el)
  -- 1. Contenus conditionnels ------------------------------------------------
  local visible = el.classes:includes("content-visible")
  local hidden  = el.classes:includes("content-hidden")
  if visible or hidden then
    local when = el.attributes["when-format"]
    local matched = when ~= nil and format_matches(when)
    if visible and when and not matched then return {} end
    if hidden and ((not when) or matched) then return {} end
    -- Bloc conserve : on retire les marqueurs, qui n'ont plus de sens dans
    -- la sortie (when-format n'est pas un attribut HTML valide).
    el.classes = el.classes:filter(function(c)
      return c ~= "content-visible" and c ~= "content-hidden"
    end)
    el.attributes["when-format"] = nil
  end

  -- 2. Callouts --------------------------------------------------------------
  local def
  for _, cls in ipairs(el.classes) do
    if CALLOUT_TYPES[cls] then def = CALLOUT_TYPES[cls]; break end
  end
  if not def then return el end

  local appearance = (el.attributes["appearance"] or "default"):lower()
  local with_icon = not is_false(el.attributes["icon"])
  local title, body = callout_title(el, el.content, def.title)

  -- Attributs consommes : ils ne doivent pas ressortir sur la <div>
  -- (title= deviendrait une info-bulle).
  el.attributes["title"] = nil
  el.attributes["icon"] = nil
  el.attributes["appearance"] = nil

  if FORMAT:match("latex") then
    return callout_latex(el, def, title, body)
  end

  local header = pandoc.Inlines({})
  if with_icon then
    header:insert(pandoc.Span({}, pandoc.Attr("",
      { "callout-icon", def.icon }, { ["aria-hidden"] = "true" })))
  end
  header:insert(pandoc.Span(title, pandoc.Attr("", { "callout-title-text" })))

  local classes = pandoc.List({ "callout", "callout-style-" .. appearance })
  classes:extend(el.classes)

  return pandoc.Div({
    pandoc.Div({ pandoc.Plain(header) }, pandoc.Attr("", { "callout-header" })),
    pandoc.Div(body, pandoc.Attr("", { "callout-body" })),
  }, pandoc.Attr(el.identifier, classes, el.attributes))
end

-- Convertit un bloc de code en lignes monospace (LineBlock de Code) : evite
-- l'environnement `verbatim`, interdit dans une cellule de tableau /
-- \multirow en LaTeX (« Paragraph ended before \@xverbatim was complete »).
local function codeblock_to_lines(cb)
  local lines = {}
  for line in (cb.text .. "\n"):gmatch("(.-)\n") do
    table.insert(lines, { pandoc.Code(line) })
  end
  if #lines == 0 then lines = { { pandoc.Code(cb.text) } } end
  return pandoc.LineBlock(lines)
end

-- Images : conserve fig-align (utilise par le CSS) et garantit un alt --------
function Image(el)
  local align = el.attributes["fig-align"]
  if align then
    el.attributes["data-fig-align"] = align
    -- Retire l'attribut d'origine : Pandoc prefixe lui aussi les attributs
    -- inconnus par « data- » en HTML, d'ou un data-fig-align en double
    -- (HTML invalide) si on le laisse en place.
    el.attributes["fig-align"] = nil
  end

  -- Sortie LaTeX/PDF : le package `svg` exige Inkscape (+ --shell-escape) pour
  -- rasteriser les .svg, dependance absente ici. On pointe donc vers le .png
  -- de meme nom s'il existe (les diagrammes PlantUML sont exportes en .svg ET
  -- .png). En HTML on conserve le .svg (vectoriel, plus net).
  if FORMAT:match("latex") then
    if el.src:match("%.[Ss][Vv][Gg]$") then
      local png = el.src:gsub("%.[Ss][Vv][Gg]$", ".png")
      local resolved_png = resolve_resource(png)
      if resolved_png ~= png or file_exists(png) then
        el.src = png
      end
    end
    -- Corrige le chemin absolu/relatif complet pour lualatex (qui s'exécute à la racine)
    el.src = resolve_resource(el.src)
  end

  return el
end

-- Largeur des tableaux dans le PDF, en fraction de \linewidth.
-- N'a d'effet que sur les tableaux portant tbl-colwidths (les seuls pour
-- lesquels Pandoc emet des largeurs de colonnes explicites).
local TABLE_WIDTH = 0.90

-- Rendu « encadre » (classe .bordered) en LaTeX.
-- Le writer LaTeX de Pandoc n'emet jamais de filets verticaux : le colspec
-- produit est  {@{} >{...}p{...} >{...}p{...}@{}}  et les seules regles sont
-- les booktabs horizontales. Plutot que de reconstruire le tableau a la main
-- (il faudrait regerer minipages, \multirow, entetes repetees...), on laisse
-- Pandoc l'ecrire puis on rehausse la chaine LaTeX obtenue :
--   * colspec : un | avant chaque colonne et un | final ;
--   * \toprule / \midrule -> \hline (le \bottomrule devient inutile, la
--     derniere ligne du corps apporte deja son \hline) ;
--   * \hline apres chaque ligne du corps -> encadrement de chaque cellule ;
--   * \rowcolor{grisEntete} en tete de chaque ligne d'en-tete (les deux
--     \toprule, firsthead + head, marquent exactement ces positions ;
--     couleur et colortbl charges par conf/preamble.tex).
local function bordered_latex(t)
  local tex = pandoc.write(pandoc.Pandoc({ t }), "latex")

  -- Filets verticaux. Le colspec s'etend de « {@{} » jusqu'au « @{}} » qui
  -- ferme l'argument : aucun @{} n'apparait entre les deux.
  local patched = false
  tex = tex:gsub("(\\begin{longtable}%[%]{)@{}(.-)@{}}", function(head, spec)
    patched = true
    return head .. spec:gsub(">{", "|>{") .. "|}"
  end, 1)

  -- Colonnes sans largeur explicite (colspec « {@{}ll@{}} ») : Pandoc n'emet
  -- pas de >{...}, le patch ci-dessus ne mord pas. On laisse alors le tableau
  -- tel quel plutot que de produire du LaTeX incoherent.
  if not patched then return nil end

  tex = tex:gsub("\\toprule\\noalign{}", "\\hline\\noalign{}\n\\rowcolor{grisEntete}")
  tex = tex:gsub("\\midrule\\noalign{}", "\\hline\\noalign{}")
  tex = tex:gsub("\\bottomrule\\noalign{}", "")

  -- \hline apres chaque ligne du corps (tout ce qui suit \endlastfoot).
  local head, body = tex:match("^(.-\\endlastfoot\n)(.*)$")
  if body then
    body = body:gsub("\\tabularnewline\n", "\\tabularnewline \\hline\n")
    tex = head .. body
  end

  return pandoc.RawBlock("latex", tex)
end

-- Finition LaTeX commune a tous les chemins de sortie de Table().
-- `width` : fraction de \linewidth demandee par l'attribut width=80% de la
-- legende, a defaut TABLE_WIDTH.
local function finish(t, width)
  if not FORMAT:match("latex") then return t end

  -- Ramene la somme des largeurs a la largeur voulue. En HTML les largeurs
  -- restent normalisees a 1 : ce sont des parts du tableau, dont la largeur
  -- est portee par son style (voir Table).
  local cs = t.colspecs
  local sum = 0
  for i = 1, #cs do sum = sum + (cs[i][2] or 0) end
  if sum > 0 then
    for i = 1, #cs do
      cs[i] = { cs[i][1], (cs[i][2] or 0) / sum * (width or TABLE_WIDTH) }
    end
    t.colspecs = cs
  end

  if t.attr.classes:includes("bordered") then
    return bordered_latex(t) or t
  end
  return t
end

-- Tables : Pandoc n'interprete pas les attributs Quarto places sur la ligne
-- de legende ( : Legende {.bordered .striped tbl-colwidths="[...]"
-- tbl-align="center" width=80%} ).
-- On extrait ces classes pour les porter sur l'element <table> et on retire
-- le bloc {...} du texte de la legende.
--
-- width et tbl-align deviennent en HTML le style du <table> :
--   width=80%          -> width: 80%
--   tbl-align="center" -> margin-left: auto; margin-right: auto
--   tbl-align="right"  -> margin-left: auto
-- Un style pose sur le tableau prend le pas sur la largeur que Pandoc
-- calcule lui-meme, et sur le « width: 100% » de la feuille du modele ; les
-- largeurs du <colgroup> restent des parts du tableau. En PDF, width remplace
-- TABLE_WIDTH.
function Table(t)
  local modified = false

  -- LaTeX : remplace les blocs de code contenus dans des cellules par des
  -- lignes monospace (verbatim interdit dans une minipage/\multirow).
  if FORMAT:match("latex") then
    local n = 0
    local walked = pandoc.walk_block(t, {
      CodeBlock = function(cb) n = n + 1; return codeblock_to_lines(cb) end
    })
    if n > 0 and walked and walked.t == "Table" then
      t = walked
      modified = true
    end
  end

  local cap = t.caption and t.caption.long
  if not cap or #cap == 0 then
    return finish(t)
  end
  local last = cap[#cap]
  if last.t ~= "Para" and last.t ~= "Plain" then return finish(t) end

  local s = pandoc.utils.stringify(last)
  local attrText = s:match("{(.-)}%s*$")
  if not attrText then return finish(t) end

  -- Classes .foo -> classes du tableau
  for cls in attrText:gmatch("%.([%w_%-]+)") do
    t.attr.classes:insert(cls)
  end

  -- tbl-colwidths="[50, 50]" -> largeurs reelles des colonnes.
  -- (Pandoc ignore cet attribut Quarto : on l'applique aux colspecs.)
  -- On lit le contenu entre crochets, robuste aux guillemets courbes.
  local widthsStr = attrText:match("colwidths.-%[(.-)%]")
  if widthsStr then
    local vals, sum = {}, 0
    for num in widthsStr:gmatch("[%d%.]+") do
      local n = tonumber(num)
      if n then vals[#vals + 1] = n; sum = sum + n end
    end
    -- Normalise en fractions dont la somme vaut 1 : le tableau occupe alors
    -- 100 % de son conteneur (ex. la <div> a width:60%) avec les proportions
    -- demandees pour chaque colonne.
    if sum > 0 and #vals == #t.colspecs then
      local cs = t.colspecs
      for i = 1, #vals do
        cs[i] = { cs[i][1], vals[i] / sum }
      end
      t.colspecs = cs
    end
  end

  -- width=80% et tbl-align="center". Les guillemets sont devenus courbes a
  -- la lecture, et un guillemet courbe tient plusieurs octets : on saute donc
  -- tout ce qui n'est ni chiffre (ni lettre) ni blanc, plutot qu'un caractere
  -- unique. La frontiere ecarte « tbl-width » ou « fig-width ».
  local widthPct = tonumber(attrText:match("%f[%w%-]width%s*=%s*[^%d%s]*([%d%.]+)%%"))
  local width = widthPct and widthPct > 0 and widthPct <= 100 and widthPct / 100 or nil
  local align = attrText:match("tbl%-align%s*=%s*[^%a%s]*(%a+)")

  if FORMAT:match("html") then
    local style = {}
    if width then style[#style + 1] = string.format("width: %s%%", widthPct) end
    if align == "center" then
      style[#style + 1] = "margin-left: auto; margin-right: auto"
    elseif align == "right" then
      style[#style + 1] = "margin-left: auto"
    end
    if #style > 0 then
      local prev = t.attr.attributes["style"]
      if prev and prev ~= "" then table.insert(style, 1, prev) end
      t.attr.attributes["style"] = table.concat(style, "; ")
    end
  end

  -- Legende nettoyee (sans le bloc d'attributs) : on re-tokenise le texte
  -- en Str/Space pour un rendu propre.
  local cleaned = s:gsub("%s*{.-}%s*$", "")
  local inlines = {}
  local first = true
  for word in cleaned:gmatch("%S+") do
    if not first then table.insert(inlines, pandoc.Space()) end
    table.insert(inlines, pandoc.Str(word))
    first = false
  end
  cap[#cap] = (last.t == "Plain") and pandoc.Plain(inlines) or pandoc.Para(inlines)

  return finish(t, width)
end

-- Liens ouverts dans un nouvel onglet (qui prend le focus) :
--   * les URL externes (http://, https://, ftp://...) ;
--   * les fichiers Cc*.html, CD*.html et RESUME*.html ;
--   * les fichiers PDF (.pdf) ;
--   * les images (.jpg, .jpeg, .png, .svg).
-- mailto: et tel: n'ont pas de « // » : ils restent dans l'onglet courant,
-- ou ils sont de toute facon pris en charge par une application externe.
function Link(el)
  if FORMAT:match("html") then
    -- Ignore l'ancre et la query eventuelles pour tester l'extension
    local path = el.target:match("^([^#?]*)") or el.target
    local filename = path:match("([^/\\]+)$") or path
    local l_filename = filename:lower()
    local is_url = el.target:match("^%a[%w+.%-]*://") ~= nil
    if is_url or
       filename:match("^CC.*%.html") or filename:match("^CD.*%.html") or
       l_filename:match("^resume.*%.html$") or
       l_filename:match("%.pdf$") or
       l_filename:match("%.jpg$") or l_filename:match("%.jpeg$") or
       l_filename:match("%.png$") or l_filename:match("%.svg$") then
      el.attributes["target"] = "_blank"
      el.attributes["rel"] = "noopener"
    end
  end
  return el
end

-- Chemin d'un fichier jumeau de la page (PDF, Word...) ---------------------
-- Seuls le dernier repertoire et le nom du fichier sont retenus : la sortie
-- HTML peut etre ecrite hors du projet (« htmlOutputDir » de settings.json,
-- donc un chemin absolu), alors que les jumeaux vivent toujours dans
-- resources/<sous-dossier>/<repertoire>/<nom>.<ext>.
--   .../filesLOT02/UC12.html  ->  resources/pdf/filesLOT02/UC12.pdf
--                             ->  resources/docx/filesLOT02/UC12.docx
-- Le resultat est relatif a la racine du projet : le modele le prefixe par
-- $library-basedir$ (« ../ ») pour remonter depuis le dossier du LOT.
local function twin_href(subdir, ext)
  local path = PANDOC_STATE and PANDOC_STATE.output_file
  if (not path or path == "") and PANDOC_STATE and PANDOC_STATE.input_files then
    path = PANDOC_STATE.input_files[1]
  end
  if not path or path == "" then return nil end
  path = path:gsub("\\", "/")

  local name = path:match("([^/]+)$")
  if not name then return nil end
  name = name:gsub("%.%w+$", "")

  local dir = path:match("([^/]+)/[^/]+$")
  if dir == "." or dir == ".." then dir = nil end

  return "resources/" .. subdir .. "/" .. (dir and (dir .. "/") or "") .. name .. "." .. ext
end

local function pdf_href()  return twin_href("pdf", "pdf")   end
local function docx_href() return twin_href("docx", "docx") end

-- Publication du jumeau (PDF, Word) a cote du HTML -------------------------
-- Le HTML est generalement ecrit hors du projet (« htmlOutputDir » de
-- settings.json, C:/DEV/htdocs, qui sert de racine au serveur local). Le lien
-- « Version PDF » etant relatif a cette racine, le PDF doit y etre publie
-- comme le sont resources/dsfr et resources/img, sans quoi le lien repond 404
-- en http:// alors qu'il fonctionne en file://. A chaque compilation
-- individuelle on recopie donc le PDF du document courant :
--   <projet>/resources/pdf/<rep>/<nom>.pdf
--   -> <racine du HTML>/resources/pdf/<rep>/<nom>.pdf

local function is_windows()
  return package.config:sub(1, 1) == "\\"
end

-- Chemin absolu, separateurs normalises en « / ».
local function absolute(path)
  path = path:gsub("\\", "/")
  if path:match("^%a:/") or path:match("^/") then return path end
  local ok, cwd = pcall(function() return pandoc.system.get_working_directory() end)
  if not ok or not cwd or cwd == "" then return path end
  return (cwd:gsub("\\", "/"):gsub("/$", "")) .. "/" .. path
end

-- Windows ignore la casse : la comparaison source/destination aussi.
local function same_path(a, b)
  if is_windows() then return a:lower() == b:lower() end
  return a == b
end

local function ensure_directory(dir)
  local ok = pcall(function() pandoc.system.make_directory(dir, true) end)
  if ok then return end
  -- Repli si pandoc.system.make_directory n'existe pas (pandoc ancien).
  if is_windows() then
    os.execute('mkdir "' .. dir:gsub("/", "\\") .. '" 2>nul')
  else
    os.execute('mkdir -p "' .. dir .. '"')
  end
end

local function copy_file(src, dst)
  local input = io.open(src, "rb")
  if not input then return false end
  local data = input:read("*a")
  input:close()

  ensure_directory(dst:match("^(.*)/[^/]+$") or ".")
  local output = io.open(dst, "wb")
  if not output then return false end
  output:write(data)
  output:close()
  return true
end

-- href : chemin du jumeau relatif a la racine du projet
-- (« resources/pdf/... », « resources/docx/... »).
local function publish_twin(href)
  local out = PANDOC_STATE and PANDOC_STATE.output_file
  if not out or out == "" then return end

  -- Racine du HTML = fichier de sortie prive de « <repertoire>/<nom>.html ».
  local root = absolute(out):match("^(.*)/[^/]+/[^/]+$")
  if not root then return end

  local src = absolute(href)
  local dst = root .. "/" .. href
  if same_path(src, dst) then return end
  copy_file(src, dst)
end

-- ---------------------------------------------------------------------------
-- Shortcode Quarto {{< meta cle >}} : injecte la valeur d'une metadonnee du
-- front matter (ex. {{< meta date >}}, {{< meta releaseVersion >}}). Pandoc
-- pur ne l'interprete pas : sans ce filtre le texte "{{< meta ... >}}"
-- ressortirait tel quel dans le document.
-- ---------------------------------------------------------------------------

-- Valeur de metadonnee -> Inlines, en préservant sa mise en forme (gras,
-- italique...) plutot que de l'aplatir en texte brut.
local function meta_to_inlines(v)
  local t = pandoc.utils.type(v)
  if t == "Inlines" then return v end
  if t == "Blocks" then return pandoc.utils.blocks_to_inlines(v) end
  return pandoc.Inlines({ pandoc.Str(pandoc.utils.stringify(v)) })
end

-- "2026-06-02" (ou la valeur speciale Quarto "today") -> date au format
-- demande par le champ "date-format" du front matter (ex. "DD/MM/YYYY"),
-- sinon JJ/MM/AAAA par defaut. Les formats non reconnus (date non ISO)
-- ressortent inchanges.
local function format_date(raw, fmt)
  raw = raw:gsub("^%s+", ""):gsub("%s+$", "")
  if raw:lower() == "today" or raw:lower() == "now" then
    raw = os.date("%Y-%m-%d")
  end
  local y, m, d = raw:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
  if not y then return raw end

  fmt = (fmt or "DD/MM/YYYY"):upper()
  if fmt == "MM/DD/YYYY" then return m .. "/" .. d .. "/" .. y end
  if fmt == "YYYY-MM-DD" then return y .. "-" .. m .. "-" .. d end
  return d .. "/" .. m .. "/" .. y
end

local function is_str(el, text)
  return el ~= nil and el.t == "Str" and el.text == text
end

-- Repere, au sein d'une liste d'Inlines (paragraphe, titre, cellule de
-- tableau...), la sequence  Str"{{<" Space Str"meta" Space Str<cle> Space
-- Str">}}"  et la remplace par la valeur de la metadonnee <cle>.
function Inlines(inlines)
  local changed = false
  local out = pandoc.Inlines({})
  local i, n = 1, #inlines
  while i <= n do
    if is_str(inlines[i], "{{<")
      and inlines[i + 1] and inlines[i + 1].t == "Space"
      and is_str(inlines[i + 2], "meta")
      and inlines[i + 3] and inlines[i + 3].t == "Space"
      and inlines[i + 4] and inlines[i + 4].t == "Str"
      and inlines[i + 5] and inlines[i + 5].t == "Space"
      and is_str(inlines[i + 6], ">}}") then
      local key = inlines[i + 4].text
      local value = doc_meta[key]
      if value ~= nil then
        changed = true
        if key == "date" then
          local fmt = doc_meta["date-format"] and pandoc.utils.stringify(doc_meta["date-format"]) or nil
          out:insert(pandoc.Str(format_date(pandoc.utils.stringify(value), fmt)))
        else
          out:extend(meta_to_inlines(value))
        end
      else
        io.stderr:write("Warning: {{< meta " .. key .. " >}} : metadonnee introuvable\n")
        for j = i, i + 6 do out:insert(inlines[j]) end
      end
      i = i + 7
    else
      out:insert(inlines[i])
      i = i + 1
    end
  end
  if not changed then return nil end
  return out
end

-- Injecte les metadonnees calculees ----------------------------------------
function Pandoc(doc)
  -- DOCX : la table des matieres est produite par le writer, hors AST -- elle
  -- precede toujours le corps. Un saut de page en tete du corps tombe donc
  -- juste apres elle. (Sans --toc, on n'ajoute rien.)
  if FORMAT:match("docx") and PANDOC_WRITER_OPTIONS
     and PANDOC_WRITER_OPTIONS.table_of_contents then
    doc.blocks:insert(1, pandoc.RawBlock("openxml", DOCX_PAGEBREAK))
  end

  -- Le front matter de chaque .md porte « toc-depth: 5/6 » pour la Liseuse
  -- HTML. En LaTeX cette metadonnee alimente directement $toc-depth$ du
  -- modele et prend le pas sur le « toc-depth » du fichier de defauts : la
  -- TdM du book ressort alors jusqu'au niveau 6. On la neutralise pour que
  -- defaults-book.yaml redevienne la source de verite.
  if FORMAT:match("latex") then
    doc.meta["toc-depth"] = nil
  end

  -- $pdf-href$ : lien « Version PDF » affiche a droite du sous-titre. Un
  -- « pdf-href » pose dans le front matter reste prioritaire.
  if FORMAT:match("html") and not doc.meta["pdf-href"] then
    local href = pdf_href()
    if href then
      doc.meta["pdf-href"] = pandoc.MetaString(href)
      publish_twin(href)
    end
  end

  -- $docx-href$ : lien « Version Word » affiche a droite du lien PDF, sur le
  -- meme modele. Contrairement au PDF, le .docx n'existe que pour une partie
  -- des documents : sans le fichier dans resources/docx/, la metadonnee n'est
  -- pas posee et le modele n'affiche aucun lien mort. Un « docx-href » pose
  -- dans le front matter reste prioritaire.
  if FORMAT:match("html") and not doc.meta["docx-href"] then
    local href = docx_href()
    if href and file_exists(href) then
      doc.meta["docx-href"] = pandoc.MetaString(href)
      publish_twin(href)
    end
  end

  local minutes = math.max(1, math.floor(words / 200 + 0.5))
  doc.meta["reading-minutes"] = pandoc.MetaString(tostring(minutes))
  doc.meta["word-count"] = pandoc.MetaString(tostring(words))
  return doc
end

-- ---------------------------------------------------------------------------
-- Un script Lua sans "return" explicite est traite par Pandoc comme un
-- filtre unique regroupant toutes ses fonctions globales (Str, Span, Div...),
-- executees en une seule passe ascendante (elements les plus imbriques
-- d'abord). Dans ce mode, une fonction Meta ne s'execute qu'apres tout le
-- reste -- trop tard pour que Inlines() ci-dessus puisse s'appuyer sur le
-- front matter deja lu lors de la resolution de {{< meta cle >}}.
-- On retourne donc explicitement DEUX filtres executes l'un apres l'autre
-- sur la totalite du document : le premier capture les metadonnees, le
-- second (identique a l'ancien filtre implicite, Inlines en plus) les
-- utilise. C'est le motif documente par Pandoc pour ce cas de figure.
return {
  { Meta = function(m) doc_meta = m; return m end },
  {
    Str = Str,
    Para = Para,
    Span = Span,
    Underline = Underline,
    Code = Code,
    Div = Div,
    Image = Image,
    Table = Table,
    Link = Link,
    Inlines = Inlines,
    Pandoc = Pandoc,
  },
}
