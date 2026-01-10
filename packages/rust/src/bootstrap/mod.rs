//! Bootstrap commands for AFD servers.
//!
//! Bootstrap commands provide introspection and documentation capabilities
//! for any AFD server. They are automatically available on all servers.

mod afd_docs;
mod afd_help;
mod afd_schema;

pub use afd_docs::{create_afd_docs_command, AfdDocsHandler, DocsInput, DocsOutput};
pub use afd_help::{create_afd_help_command, AfdHelpHandler, CommandInfo, HelpInput, HelpOutput};
pub use afd_schema::{
    create_afd_schema_command, AfdSchemaHandler, SchemaFormat, SchemaInfo, SchemaInput,
    SchemaOutput,
};

use crate::commands::{CommandDefinition, CommandRegistry};
use std::sync::Arc;

/// Get all bootstrap commands for an AFD server.
pub fn get_bootstrap_commands(registry: &Arc<CommandRegistry>) -> Vec<CommandDefinition> {
    vec![
        create_afd_help_command(Arc::clone(registry)),
        create_afd_docs_command(Arc::clone(registry)),
        create_afd_schema_command(Arc::clone(registry)),
    ]
}

/// Bootstrap command category name.
pub const BOOTSTRAP_CATEGORY: &str = "bootstrap";

/// Bootstrap command tags.
pub const BOOTSTRAP_TAGS: &[&str] = &["bootstrap", "read", "safe"];
