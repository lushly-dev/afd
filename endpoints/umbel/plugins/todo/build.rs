//! Embed the manifest's schemas, so the compiled plugin carries them.

fn main() {
    if let Err(error) = umbel_sdk::build::embed_assets(&["schemas"]) {
        panic!("cannot embed the plugin's files: {error}");
    }
}
