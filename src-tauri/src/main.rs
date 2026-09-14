// Sur Windows, le sous-système « windows » évite la console noire derrière la
// fenêtre en release ; en debug on la garde pour lire les traces.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    veille_lib::run()
}
