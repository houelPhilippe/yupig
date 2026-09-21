@echo off
rem ============================================================
rem  Liseuse SDS - lanceur local
rem
rem  Double-cliquez ce fichier pour LIRE la documentation.
rem  Il demarre un petit serveur local (http://localhost) et
rem  ouvre la bibliotheque dans votre navigateur.
rem
rem  POURQUOI un serveur ? Ouverts par double-clic en file://,
rem  les navigateurs isolent le stockage local et OUBLIENT vos
rem  reglages (theme, taille du texte...). Servis en http://localhost,
rem  ils sont une seule "origine" : vos reglages sont memorises
rem  d'une session a l'autre ET partages entre tous les documents.
rem
rem  Laissez la fenetre noire OUVERTE pendant la lecture.
rem  Fermez-la pour arreter le serveur.
rem
rem  Deux arguments, tous deux facultatifs :
rem
rem     %1  le repertoire a servir   (defaut : celui ecrit ci-dessous)
rem     %2  le port                  (defaut : 8000)
rem
rem  L'"Editeur Markdown" les passe lui-meme : le repertoire est celui
rem  de la compilation HTML regle dans les parametres du projet. Sans
rem  argument (par un double-clic), rien ne change : les valeurs
rem  ecrites ici font foi, et settings.json dit la sous-page a ouvrir.
rem  Son pendant pour Linux est ouvrir-la-liseuse.sh.
rem ============================================================
chcp 65001 >nul
title Liseuse SDS - serveur local (ne pas fermer)
cd /d "%~dp0"

set PORT=8000

rem -- Racine servie par le serveur local : ce repertoire devient la racine
rem    du site, http://127.0.0.1:8000/ pointant directement dessus.
set "SERVE_DIR=C:\DEV\htdocs"

rem -- Ce qu'on nous passe l'emporte sur ces deux valeurs.
if not "%~1"=="" set "SERVE_DIR=%~1"
if not "%~2"=="" set "PORT=%~2"

if not exist "%SERVE_DIR%\" (
  echo.
  echo   ERREUR : le repertoire a servir est introuvable :
  echo     %SERVE_DIR%
  echo.
  pause
  exit /b 1
)

rem -- Choix de l'interpreteur Python disponible --
where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")

echo.
echo   Liseuse SDS
echo   -----------
echo   Serveur local : http://127.0.0.1:%PORT%/
echo   Repertoire servi : %SERVE_DIR%
echo.
echo   Laissez cette fenetre OUVERTE pendant la lecture.
echo   Fermez-la (ou Ctrl+C) pour arreter le serveur.
echo.

rem -- Ouvre la page d'accueil (index.html) dans le navigateur par defaut --
rem    On vise 127.0.0.1 (et non localhost) pour rester coherent avec --bind.
rem    Proxy d'entreprise : si la page affiche une erreur du proxy, cochez
rem    "Ne pas utiliser de serveur proxy pour les adresses locales" dans les
rem    parametres reseau Windows (les navigateurs contournent normalement
rem    le proxy pour 127.0.0.1 automatiquement).
rem    Chemin de la page d'accueil dans l'URL : htmlOutputDir de settings.json
rem    ramene a la racine servie. S'il pointe ailleurs (publication vers
rem    %SERVE_DIR% faite par un autre moyen), on ouvre la racine du serveur.
rem    Lance par l'application, le repertoire servi EST la destination de la
rem    compilation : la page d'accueil est a la racine, il n'y a pas de
rem    sous-chemin a chercher.
set "URL_PATH="
if "%~1"=="" for /f "delims=" %%i in ('%PY% -c "import json, os; d = json.load(open('settings.json', encoding='utf-8')).get('htmlOutputDir', '').strip().replace('\\', '/'); c = os.environ.get('SERVE_DIR', '').replace('\\', '/').rstrip('/'); r = d[len(c):].strip('/') if c and d.lower().startswith(c.lower()) else ''; print(r + '/' if r else '')" 2^>nul') do set "URL_PATH=%%i"

start "" "http://127.0.0.1:%PORT%/%URL_PATH%"

rem -- Sert %SERVE_DIR% comme racine du site.
rem    --bind 127.0.0.1 evite l'alerte pare-feu Windows.
rem    --directory : le repertoire courant reste celui du .bat (necessaire
rem    pour lire settings.json ci-dessus), seule la racine web change.
%PY% -m http.server %PORT% --bind 127.0.0.1 --directory "%SERVE_DIR%"
