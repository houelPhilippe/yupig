Publier une prochaine version (exemple : 1.0.3)

1. Voir où on en est
cd ~/DEV/tableauDeBord.rust
git status --short
git fetch origin
git log --oneline main..origin/main    # vide = rien de nouveau sur GitHub
Si cette dernière commande affiche des commits, récupère-les d'abord : git pull --rebase origin main.

2. Changer le numéro de version, aux deux endroits :
- src-tauri/tauri.conf.json : "version": "1.0.3"
- src-tauri/Cargo.toml : version = "1.0.3"

Puis mets à jour Cargo.lock :
cargo update --manifest-path src-tauri/Cargo.toml --workspace

3. Vérifier que le code Rust est sain (conseillé)
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

4. Enregistrer, sans demande.md
git add -A -- . ':!demande.md'
git commit -m "Version 1.0.3 : <ce qui a changé>"
git tag -a v1.0.3 -m "Version 1.0.3"

5. Envoyer vers GitHub
git push origin main
git push origin v1.0.3
Si git demande une identification : utilisateur houelPhilippe, et un nouveau jeton comme mot de passe.

6. Vérifier
git log --oneline origin/main -1
git ls-remote --tags origin v1.0.3

Les numéros de version se lisent ainsi :
- correctif : 1.0.2 → 1.0.3
- nouvelles fonctions : 1.0.x → 1.1.0
- changement majeur : 1.x → 2.0.0

Tu peux aussi simplement me demander « publie la version 1.0.3 » : je reprendrai ces étapes en te montrant chaque commande avant de l'exécuter.