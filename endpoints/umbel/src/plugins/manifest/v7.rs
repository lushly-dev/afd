//! What manifest version 7 adds (phase 1 specification, section 8.7; D211): the top-level
//! `instructions`, one paragraph the host adds after AFD's default text in the server's
//! instructions, in `plugins.enabled` order, unless the deployer's `mcp.instructions` replaces the
//! whole text. Only a compiled plugin declares one: its code is trusted (D42), and no untrusted
//! kind's text reaches the server's instructions.

use super::{PluginInfo, PluginKind, Tbl};
use crate::plugins::error::PluginError;

/// The top-level key manifest version 7 adds; versions 1 to 6 name and refuse it.
pub(super) const TOP_KEYS_V7: &[(&str, &str)] = &[(
    "instructions",
    "a plugin's instructions paragraph needs manifest_version = 7",
)];

/// The longest paragraph, in characters: one paragraph at the cap and AFD's default fit the
/// 2,048 UTF-16 code units one client is reported to keep (section 8.7).
pub const MAX_INSTRUCTIONS_CHARS: usize = 800;

/// `instructions`: absent, or, for a compiled plugin, 1 to [`MAX_INSTRUCTIONS_CHARS`] characters
/// without control characters, so one paragraph without line breaks.
pub(super) fn instructions(
    root: &Tbl<'_>,
    plugin: &PluginInfo,
) -> Result<Option<String>, PluginError> {
    let text = root.optional_text("instructions", MAX_INSTRUCTIONS_CHARS)?;
    if text.is_some() && plugin.kind != PluginKind::Compiled {
        return Err(root.bad(
            "instructions",
            format!(
                "is for compiled plugins only: a {} plugin's text does not reach the server's instructions (D211); set mcp.instructions in umbel.toml instead",
                plugin.kind.as_str()
            ),
        ));
    }
    Ok(text)
}
