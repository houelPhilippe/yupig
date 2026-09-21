#!/usr/bin/env bash
# ============================================================
#  Liseuse SDS - lanceur local (Linux, macOS)
#
#  Lancez ce fichier pour LIRE la documentation compilee.
#  Il demarre un petit serveur local (http://127.0.0.1) et
#  ouvre la bibliotheque dans votre navigateur.
#
#  POURQUOI un serveur ? Ouverts par double-clic en file://,
#  les navigateurs isolent le stockage local et OUBLIENT vos
#  reglages (theme, taille du texte...). Servis en http://,
#  ils sont une seule "origine" : vos reglages sont memorises
#  d'une session a l'autre ET partages entre tous les documents.
#
#  Laissez ce terminal OUVERT pendant la lecture.
#  Ctrl+C (ou fermer la fenetre) pour arreter le serveur.
#
#  C'est le pendant de Ouvrir-la-liseuse.bat, pour les systemes
#  qui n'ont pas de .bat. Les deux prennent les memes arguments,
#  tous deux facultatifs :
#
#     $1  le repertoire a servir   (defaut : $LISEUSE_DIR, sinon ~/DEV/htdocs)
#     $2  le port                  (defaut : 8000)
#
#  L'« Editeur Markdown » les passe lui-meme : le repertoire est
#  celui de la compilation HTML regle dans les parametres du projet.
# ============================================================
set -u

SERVE_DIR="${1:-${LISEUSE_DIR:-$HOME/DEV/htdocs}}"
PORT="${2:-8000}"

if [ ! -d "$SERVE_DIR" ]; then
  echo
  echo "  ERREUR : le repertoire a servir est introuvable :"
  echo "    $SERVE_DIR"
  echo
  exit 1
fi

# -- Choix de l'interpreteur Python disponible --
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo
  echo "  ERREUR : Python est introuvable (ni python3, ni python)."
  echo "  Installez-le, par exemple :  sudo apt install python3"
  echo
  exit 1
fi

URL="http://127.0.0.1:$PORT/"

echo
echo "  Liseuse SDS"
echo "  -----------"
echo "  Serveur local    : $URL"
echo "  Repertoire servi : $SERVE_DIR"
echo
echo "  Laissez ce terminal OUVERT pendant la lecture."
echo "  Ctrl+C pour arreter le serveur."
echo

# -- Ouvre la page d'accueil dans le navigateur par defaut --
#    A part, et apres une seconde : le serveur n'ecoute pas encore, et la
#    premiere requete tomberait dans le vide. On vise 127.0.0.1 (et non
#    localhost) pour rester coherent avec --bind.
(
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  elif command -v gio >/dev/null 2>&1; then
    gio open "$URL"
  elif command -v open >/dev/null 2>&1; then
    open "$URL"
  else
    echo "  (aucun ouvreur trouve : ouvrez $URL a la main)"
  fi
) >/dev/null 2>&1 &

# -- Sert $SERVE_DIR comme racine du site.
#    `exec` : ce processus DEVIENT le serveur au lieu de l'avoir pour enfant.
#    C'est ce qui permet a qui lance ce script — l'« Editeur Markdown » — de
#    l'arreter vraiment : sans `exec`, tuer ce shell laisserait Python derriere
#    lui, et le port reste pris.
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1 --directory "$SERVE_DIR"
