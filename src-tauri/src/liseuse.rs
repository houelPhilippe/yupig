//! La liseuse : un serveur local sur les pages compilées du projet.
//!
//! Compilées en HTML, les pages du projet se lisent dans un navigateur. Ouvertes
//! par un double-clic — en `file://` —, les navigateurs isolent le stockage
//! local et **oublient les réglages** du lecteur (thème, taille du texte) d'une
//! page à l'autre. Servies depuis `http://127.0.0.1`, elles sont une seule
//! origine : les réglages tiennent d'une session à l'autre et valent pour tous
//! les documents. D'où un petit serveur local, et cette commande pour le lancer.
//!
//! Ce n'est pas l'application qui sert les pages : c'est un **script du
//! projet**, à sa racine — `Ouvrir-la-liseuse.bat` sous Windows,
//! `ouvrir-la-liseuse.sh` ailleurs. Le même fichier se double-clique hors de
//! l'application, ce qui est sa raison d'être ; l'application ne fait que le
//! lancer en lui disant quoi servir.
//!
//! Trois règles, celles du book (`pandoc::plan_book`) :
//!
//! - **Le programme est fixe** : `cmd` ou `bash`, ce script-là, et rien
//!   d'autre. L'interface ne nomme aucun exécutable, et le chemin du script
//!   passe par `files::resolve` — il est dans le projet, liens symboliques
//!   écartés.
//! - **Aucun shell** : le répertoire servi et le port partent en arguments, un
//!   par un. Un chemin à espaces reste un seul argument.
//! - **Le répertoire servi est celui de la compilation HTML** du projet
//!   (`pandoc.htmlDest`), lu en base par Rust. Le script n'a donc rien à
//!   deviner, et la liseuse montre exactement ce que la compilation vient
//!   d'écrire.
//!
//! **L'application tient le serveur.** Il ne vit pas sa vie derrière elle : le
//! menu bascule — ouvrir, arrêter —, et quitter l'arrête (`RunEvent::Exit`).
//! C'est pourquoi le script Unix **remplace** son shell par le serveur
//! (`exec`) : le processus que nous tenons *est* le serveur, et l'arrêter
//! l'arrête vraiment. Sous Windows, où `exec` n'existe pas, `cmd` lance Python
//! et reste son parent : c'est l'arbre entier qu'on arrête, par `taskkill /T`.
//!
//! Ce que le serveur écrit — une ligne par requête — ne va nulle part : le
//! journal est celui des compilations, et une lecture y déverserait des
//! centaines de lignes sans rapport.

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use crate::error::{Error, Result};
use crate::files;

/// Le port servi. Celui qu'écrivent les scripts quand on les lance à la main.
pub const PORT: u16 = 8000;

/// Le script, à la racine du projet — un nom par système.
pub const SCRIPT_WINDOWS: &str = "Ouvrir-la-liseuse.bat";
pub const SCRIPT_UNIX: &str = "ouvrir-la-liseuse.sh";

/// Celui de ce système-ci.
pub fn script() -> &'static str {
    if cfg!(windows) {
        SCRIPT_WINDOWS
    } else {
        SCRIPT_UNIX
    }
}

/// L'adresse où lire, une fois le serveur parti.
pub fn url() -> String {
    format!("http://127.0.0.1:{PORT}/")
}

/// Le serveur de la liseuse, tant qu'il tourne.
///
/// Un seul à la fois : deux serveurs sur le même port, le second ne partirait
/// pas. L'état est tenu par l'application (`app.manage`), non par le frontend,
/// qui l'interroge — un serveur peut s'être arrêté tout seul.
#[derive(Default)]
pub struct Liseuse {
    child: Mutex<Option<Child>>,
}

impl Liseuse {
    /// Le serveur tourne-t-il encore ?
    ///
    /// La question se pose vraiment : le port peut être déjà pris, Python
    /// absent, le répertoire vidé — le serveur s'arrête alors de lui-même, et
    /// la poignée que nous gardons ne dit plus rien de vrai. `try_wait` le
    /// relève, et l'oublie.
    pub fn running(&self) -> bool {
        let mut held = self.lock();
        match held.as_mut() {
            Some(child) => match child.try_wait() {
                // Fini : on le récolte, faute de quoi il resterait zombie.
                Ok(Some(_)) => {
                    *held = None;
                    false
                }
                Ok(None) => true,
                // Injoignable : mieux vaut l'oublier que le dire vivant.
                Err(_) => {
                    *held = None;
                    false
                }
            },
            None => false,
        }
    }

    /// Lance le serveur sur `dir` et rend l'adresse à lire.
    ///
    /// `root` est la racine du projet — le script y est cherché, et c'est de là
    /// qu'il est lancé. `dir` est le répertoire de la compilation HTML, tel que
    /// les réglages du projet le portent : relatif, il s'entend depuis la
    /// racine du projet, comme `{sortie}`.
    ///
    /// Déjà lancé, rien ne repart : on rend la même adresse.
    pub fn start(&self, root: &Path, dir: &str) -> Result<String> {
        if self.running() {
            return Ok(url());
        }

        let script = files::resolve(root, script()).map_err(|_| missing_script())?;
        if !script.is_file() {
            return Err(missing_script());
        }

        let dir = dir.trim();
        if dir.is_empty() {
            return Err(Error::Other(
                "aucun répertoire de destination HTML réglé dans les paramètres du projet : \
                 la liseuse ne saurait pas quoi servir"
                    .into(),
            ));
        }
        // Un chemin relatif s'entend depuis la racine du projet ; un chemin
        // absolu se suffit — `join` le sait.
        let served = root.join(dir);
        if !served.is_dir() {
            return Err(Error::Other(format!(
                "« {} » n'existe pas : compilez le projet en HTML avant d'ouvrir la liseuse",
                served.display()
            )));
        }

        let mut command = command(&script);
        command
            .arg(served.as_os_str())
            .arg(PORT.to_string())
            .current_dir(root)
            .stdin(Stdio::null())
            // Une ligne par requête : rien à en faire, et le journal est celui
            // des compilations.
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = command.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::Other(format!(
                "« {} » introuvable : la liseuse ne peut pas démarrer",
                if cfg!(windows) { "cmd" } else { "bash" }
            )),
            _ => Error::Io(e),
        })?;

        *self.lock() = Some(child);
        Ok(url())
    }

    /// Arrête le serveur. Rend `false` s'il n'y en avait pas.
    pub fn stop(&self) -> bool {
        let Some(mut child) = self.lock().take() else {
            return false;
        };

        // Sous Windows, le processus tenu est `cmd`, qui a lancé Python :
        // l'arrêter seul laisserait le serveur derrière lui. `taskkill /T`
        // prend l'arbre entier. Ailleurs, le script s'est effacé devant le
        // serveur (`exec`) : c'est bien lui que nous tenons.
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        #[cfg(not(windows))]
        let _ = child.kill();

        // Récolté dans tous les cas : un processus qu'on n'attend pas reste
        // zombie jusqu'à la fin de l'application.
        let _ = child.wait();
        true
    }

    /// Un verrou empoisonné ne doit pas emporter la liseuse : ce qu'il garde
    /// est une poignée de processus, que la panique d'un autre fil ne rend pas
    /// fausse. Même parti pris que `Db`.
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Child>> {
        self.child.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// De quoi lancer le script : `cmd /c` sous Windows — un `.bat` n'est pas un
/// exécutable —, `bash` ailleurs, qui dispense le script du bit d'exécution
/// qu'une copie du projet peut avoir perdu.
fn command(script: &Path) -> Command {
    #[cfg(windows)]
    {
        let mut c = Command::new("cmd");
        c.arg("/c").arg(script.as_os_str());
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("bash");
        c.arg(script.as_os_str());
        c
    }
}

fn missing_script() -> Error {
    Error::Other(format!(
        "« {} » introuvable à la racine du projet : c'est ce script qui ouvre la liseuse",
        script()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("veille-liseuse-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sans_script_dans_le_projet_la_liseuse_le_dit() {
        let root = temp("sans-script");
        let err = Liseuse::default().start(&root, "htdocs").unwrap_err().to_string();
        assert!(err.contains(script()), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sans_destination_reglee_ou_sans_dossier_elle_le_dit_aussi() {
        let root = temp("sans-destination");
        std::fs::write(root.join(script()), "").unwrap();

        let err = Liseuse::default().start(&root, "  ").unwrap_err().to_string();
        assert!(err.contains("destination HTML"), "{err}");

        let err = Liseuse::default().start(&root, "htdocs").unwrap_err().to_string();
        assert!(err.contains("Compilez") || err.contains("compilez"), "{err}");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Le lancement même : le script reçoit le dossier servi et le port, et le
    /// processus que l'application tient s'arrête quand elle le lui demande.
    #[test]
    fn un_serveur_part_sur_le_dossier_servi_puis_s_arrete() {
        // Sous Windows, le script de test serait un `.bat` : on s'en tient au
        // shell, présent partout où ces tests tournent.
        if cfg!(windows) {
            eprintln!("liseuse : lancement réel non vérifié sous Windows");
            return;
        }
        let root = temp("lancement");
        std::fs::create_dir_all(root.join("htdocs")).unwrap();
        // Un faux serveur : il dort, et dit dans un fichier ce qu'on lui a
        // passé. Ce qui se vérifie ici est le lancement, pas Python.
        std::fs::write(
            root.join(script()),
            "#!/usr/bin/env bash\nprintf '%s|%s' \"$1\" \"$2\" > trace.txt\nexec sleep 30\n",
        )
        .unwrap();

        let liseuse = Liseuse::default();
        assert_eq!(liseuse.start(&root, "htdocs").unwrap(), url());
        assert!(liseuse.running());

        // Le temps que le script écrive sa trace.
        for _ in 0..50 {
            if root.join("trace.txt").is_file() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let trace = std::fs::read_to_string(root.join("trace.txt")).unwrap();
        assert_eq!(trace, format!("{}|{PORT}", root.join("htdocs").display()));

        assert!(liseuse.stop());
        assert!(!liseuse.running());
        assert!(!liseuse.stop());

        let _ = std::fs::remove_dir_all(&root);
    }
}
