Il faudrait ajouter une valeur par defaut si ces champs sont vide  dans les paramètres :

  "modele de commande HTML" et donc prendre comme valeur par defaut
  "pandoc {fichier} -f markdown -t html5 --standalone --toc --toc-depth=6 --lua-filter=conf/filtre.lua --template=conf/modele.template.html --metadata-file=conf/bibliotheque.yaml -o {sortie}

  "modele de commande de l'accueil (index.md)
  "pandoc {fichier} -f markdown -t html5 --standalone --template=conf/modele-accueil.template.html --metadata-file=conf/bibliotheque.yaml -o {sortie}"

  "Modele de commande PDF"
  "pandoc {fichier} -f markdown -t html5 --standalone --template=conf/modele-accueil.template.html --metadata-file=conf/bibliotheque.yaml -o {sortie}"

  "Modele de commande WORD"
  "pandoc {fichier} --defaults=conf/defaults-docx.yaml --resource-path={dossier} --reference-doc=conf/reference.docx -o {sortie}"