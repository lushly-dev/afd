//! The renaming rule of a mounted tool (specification section 6.3, D22, M4).

/// The command name for the mounted tool `original`, under the instance's `prefix`.
///
/// 1. An override `name` gives `<prefix>-<name>`: override names are relative to the instance's
///    prefix, so one manifest serves every instance.
/// 2. Otherwise the original is normalized: lowercase; every character outside `[a-z0-9]`
///    becomes `-`; runs of `-` collapse; leading and trailing `-` are trimmed; a segment that
///    starts with a digit gains a leading `n`.
/// 3. A normalized name that starts with `<manifest_prefix>-` has that leading segment replaced by
///    the instance's `prefix` (an instance prefix replaces the domain); any other name becomes
///    `<prefix>-<normalized>`.
///
/// # Errors
/// Why no command name can be made: the name still fails AFD's rule (`^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$`).
/// The loader reports such a tool as `PLUGIN_TOOL_UNNAMEABLE`, unless an override names it.
pub fn mount_command_name(
    manifest_prefix: &str,
    prefix: &str,
    original: &str,
    name_override: Option<&str>,
) -> Result<String, String> {
    let name = match name_override {
        Some(name) => format!("{prefix}-{name}"),
        None => {
            let normalized = normalize(original);
            if normalized.is_empty() {
                return Err(format!(
                    "the tool name `{original}` has no letter or digit to make a command name from"
                ));
            }
            match normalized.strip_prefix(&format!("{manifest_prefix}-")) {
                Some(rest) => format!("{prefix}-{rest}"),
                None => format!("{prefix}-{normalized}"),
            }
        }
    };
    afd::validate_command_name(&name)
        .map(|()| name.clone())
        .map_err(|problem| format!("`{name}` is not a command name: {problem}"))
}

/// Lowercase, `[a-z0-9]` kept, everything else a single `-`, trimmed; a segment that starts with
/// a digit gains a leading `n`.
fn normalize(original: &str) -> String {
    let mut collapsed = String::new();
    for character in original.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            collapsed.push(character);
        } else if !collapsed.ends_with('-') {
            collapsed.push('-');
        }
    }
    collapsed
        .trim_matches('-')
        .split('-')
        .map(|segment| {
            if segment.starts_with(|c: char| c.is_ascii_digit()) {
                format!("n{segment}")
            } else {
                segment.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("-")
}
