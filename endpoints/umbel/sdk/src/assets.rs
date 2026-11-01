//! Files embedded in a plugin.

/// One embedded file: a path relative to the plugin root, with `/` separators, and its bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Asset {
    /// The path relative to the plugin root, such as `packs/greetings/pack.toml`.
    pub path: &'static str,
    /// The file's bytes.
    pub bytes: &'static [u8],
}

/// Include the asset list that [`build::embed_assets`](crate::build::embed_assets) wrote in a
/// plugin's `build.rs`, as an expression of type `&'static [Asset]`.
///
/// ```ignore
/// fn assets(&self) -> &'static [umbel_sdk::Asset] {
///     umbel_sdk::embedded_assets!()
/// }
/// ```
#[macro_export]
macro_rules! embedded_assets {
    () => {
        include!(concat!(env!("OUT_DIR"), "/umbel_assets.rs"))
    };
}
