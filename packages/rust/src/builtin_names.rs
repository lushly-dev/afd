//! Names of the tools an AFD MCP server provides itself.
//!
//! These are not the application's commands. Servers reserve them, and tooling
//! that inspects a remote server (such as `afd validate --surface`) skips them.
//! The TypeScript (`@lushly-dev/afd-core`), Python and C++ packages export the
//! same names.

/// Tools the server's tool router handles itself.
pub const AFD_META_TOOL_NAMES: &[&str] = &[
    "afd-call",
    "afd-batch",
    "afd-pipe",
    "afd-discover",
    "afd-detail",
];

/// Discovery commands registered by the bootstrap option.
pub const AFD_BOOTSTRAP_COMMAND_NAMES: &[&str] = &["afd-help", "afd-docs", "afd-schema"];

/// Context commands registered when a server configures contexts.
pub const AFD_CONTEXT_COMMAND_NAMES: &[&str] =
    &["afd-context-list", "afd-context-enter", "afd-context-exit"];

/// Every tool or command name an AFD server provides itself: the meta-tools,
/// then the bootstrap commands, then the context commands.
pub const AFD_BUILTIN_TOOL_NAMES: &[&str] = &[
    "afd-call",
    "afd-batch",
    "afd-pipe",
    "afd-discover",
    "afd-detail",
    "afd-help",
    "afd-docs",
    "afd-schema",
    "afd-context-list",
    "afd-context-enter",
    "afd-context-exit",
];

/// Whether `name` is a tool or command that AFD servers provide themselves.
pub fn is_afd_builtin_name(name: &str) -> bool {
    AFD_BUILTIN_TOOL_NAMES.contains(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_names_combine_the_three_lists() {
        let combined: Vec<&str> = AFD_META_TOOL_NAMES
            .iter()
            .chain(AFD_BOOTSTRAP_COMMAND_NAMES)
            .chain(AFD_CONTEXT_COMMAND_NAMES)
            .copied()
            .collect();
        assert_eq!(AFD_BUILTIN_TOOL_NAMES, combined.as_slice());
    }

    #[test]
    fn recognizes_builtin_names_exactly() {
        for name in ["afd-call", "afd-detail", "afd-help", "afd-context-enter"] {
            assert!(is_afd_builtin_name(name), "{name}");
        }
        for name in ["todo-create", "afd", "afd-custom", "AFD-CALL", "todo"] {
            assert!(!is_afd_builtin_name(name), "{name}");
        }
    }
}
