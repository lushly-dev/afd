//! `workspace-doctor`: the checks of specification section 2, on a sealed host.
//!
//! [`doctor::run`](crate::doctor::run) reports the registry-independent checks and `skip`s the
//! two that need a registry; this command runs the same checks and then fills those two in.

use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::doctor::{self, Check, CheckStatus};
use crate::host::RESERVED_VERBS;
use crate::plugins::{
    CompiledCatalog, LoadedPlugins, first_class_check, loaded_check, pipelines_check,
};
use crate::store::Hub;
use crate::surfaces::{self, FirstClassPlan};
use crate::workspace::{Located, Workspace};
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult};
use async_trait::async_trait;
use serde_json::Value;
use std::sync::{Arc, OnceLock, Weak};

struct Handler {
    workspace: Arc<Workspace>,
    registry: Weak<CommandRegistry>,
    first_class: Arc<OnceLock<Vec<String>>>,
    plan: Arc<OnceLock<FirstClassPlan>>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
    catalog: Arc<CompiledCatalog>,
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    stores: Hub,
}

impl Handler {
    fn mcp_surface(&self, registry: &Arc<CommandRegistry>) -> Check {
        let first_class = self.first_class.get().cloned().unwrap_or_default();
        // The live registry already has the context commands, so none are passed here.
        match surfaces::mcp::build_server(registry, &self.workspace, &first_class, &[], None) {
            Ok(_) => Check::pass(
                "mcp.surface",
                format!(
                    "the first-class set ({}) validates against the registry",
                    first_class.join(", ")
                ),
            ),
            Err(error) => Check::fail("mcp.surface", error.message(), error.suggestion()),
        }
    }

    fn cli_verbs(registry: &CommandRegistry) -> Check {
        let clashes: Vec<String> = registry
            .list()
            .iter()
            .filter(|command| {
                let first = command.name.split('-').next().unwrap_or_default();
                RESERVED_VERBS.contains(&first)
            })
            .map(|command| command.name.clone())
            .collect();
        if clashes.is_empty() {
            Check::pass("cli.verbs", "no command starts with a reserved CLI verb")
        } else {
            Check::fail(
                "cli.verbs",
                format!(
                    "{} start with a reserved CLI verb ({})",
                    clashes.join(", "),
                    RESERVED_VERBS.join(", ")
                ),
                "Rename the commands so that their first word is not a reserved CLI verb.",
            )
        }
    }
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let workspace = Arc::clone(&self.workspace);
        let registry = self.registry.upgrade();
        let first_class_ready = self.first_class.get().is_some();
        let catalog = Arc::clone(&self.catalog);
        let mut report = tokio::task::spawn_blocking(move || {
            doctor::inspect_with_catalog(
                Ok(Located {
                    root: workspace.root().to_path_buf(),
                    found_by: workspace.found_by(),
                }),
                Some(&catalog),
            )
        })
        .await
        .unwrap_or_else(|_| doctor::run_with_catalog(self.workspace.root(), &self.catalog));
        #[cfg(feature = "store-embedded")]
        {
            let stores = Arc::clone(&self.stores);
            let workspace = Arc::clone(&self.workspace);
            let ids = ["stores.version", "stores.access", "stores.lag"];
            let found = tokio::task::spawn_blocking(move || {
                super::store_doctor_checks(&workspace, &stores)
            })
            .await;
            if let Ok(found) = found {
                for (id, found) in ids.into_iter().zip(found) {
                    if let Some(check) = report.checks.iter_mut().find(|c| c.id == id) {
                        *check = found;
                    }
                }
            }
        }
        if let Some(registry) = registry {
            for check in &mut report.checks {
                if check.status != CheckStatus::Skip {
                    continue;
                }
                match check.id.as_str() {
                    "mcp.surface" if first_class_ready => *check = self.mcp_surface(&registry),
                    "cli.verbs" => *check = Self::cli_verbs(&registry),
                    "plugins.loaded" => {
                        if let Some(loaded) = self.loaded.get() {
                            *check = loaded_check(loaded);
                        }
                    }
                    "plugins.first_class" => {
                        if let Some(plan) = self.plan.get() {
                            *check = first_class_check(plan);
                        }
                    }
                    "plugins.pipelines" => {
                        if let Some(loaded) = self.loaded.get() {
                            *check = pipelines_check(loaded);
                        }
                    }
                    _ => {}
                }
            }
        }
        report.into_result()
    }
}

/// `workspace-doctor`.
pub(crate) fn workspace_doctor(
    workspace: Arc<Workspace>,
    registry: Weak<CommandRegistry>,
    first_class: Arc<OnceLock<Vec<String>>>,
    plan: Arc<OnceLock<FirstClassPlan>>,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
    catalog: Arc<CompiledCatalog>,
    stores: Hub,
) -> Builtin {
    let definition = CommandDefinition::new(
        "workspace-doctor",
        "Check this workspace: configuration, state, keys, the lock, the journal, the HTTP and MCP settings",
        vec![],
        Handler {
            workspace,
            registry,
            first_class,
            plan,
            loaded,
            catalog,
            stores,
        },
    )
    .with_category("workspace")
    .with_returns(returns_object(
        "workspace, foundBy, healthy and checks (id, status, message, suggestion)",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: empty_input(),
    }
}
