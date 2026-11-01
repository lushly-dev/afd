//! Embed the plugin's packs, skills and schemas, so the compiled plugin carries them.

fn main() {
    if let Err(error) = umbel_sdk::build::embed_assets(&["packs", "skills", "schemas"]) {
        panic!("cannot embed the plugin's files: {error}");
    }
}
