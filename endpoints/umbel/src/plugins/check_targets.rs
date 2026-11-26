//! What the sealed doctor hands to a compiled plugin's own checks: each space override of a
//! pack (`plugins.pack_checks`, D172) and each instance's configuration
//! (`plugins.config_checks`, D206), with the services the check runs under.

use std::sync::Arc;

use serde_json::Value;

use super::compiled::CompiledPlugin;
use super::grants::Services;

/// One compiled instance, and what checking its configuration needs.
#[derive(Clone)]
pub(crate) struct ConfigCheck {
    pub instance: String,
    pub required: bool,
    pub plugin: Arc<dyn CompiledPlugin>,
    pub services: Services,
    /// The space the check runs in: `None` for the workspace's default space, else the
    /// instance's first enabled space when the default is not one of its spaces.
    pub space: Option<String>,
}

impl ConfigCheck {
    /// Run the plugin's own check of its configuration: `None` when the plugin offers none.
    pub(crate) fn run(&self) -> Option<Value> {
        let input = match &self.space {
            Some(space) => serde_json::json!({ "space": space }),
            None => serde_json::json!({}),
        };
        let services = self.services.call(&input, &afd::CommandContext::default());
        self.plugin.check_config(services)
    }
}

impl std::fmt::Debug for ConfigCheck {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConfigCheck")
            .field("instance", &self.instance)
            .field("required", &self.required)
            .finish_non_exhaustive()
    }
}

impl PartialEq for ConfigCheck {
    fn eq(&self, other: &Self) -> bool {
        (&self.instance, self.required, &self.space)
            == (&other.instance, other.required, &other.space)
    }
}

/// One space override of one compiled instance's pack, and what checking it needs (D172).
#[derive(Clone)]
pub(crate) struct PackCheck {
    pub instance: String,
    pub required: bool,
    pub pack: String,
    pub space: String,
    pub plugin: Arc<dyn CompiledPlugin>,
    pub services: Services,
}

impl PackCheck {
    /// Run the plugin's own check against the override: `None` when the plugin offers none.
    pub(crate) fn run(&self) -> Option<Value> {
        let input = serde_json::json!({ "space": self.space });
        let services = self.services.call(&input, &afd::CommandContext::default());
        self.plugin.check_pack(&self.pack, services)
    }
}

impl std::fmt::Debug for PackCheck {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PackCheck")
            .field("instance", &self.instance)
            .field("required", &self.required)
            .field("pack", &self.pack)
            .field("space", &self.space)
            .finish_non_exhaustive()
    }
}

impl PartialEq for PackCheck {
    fn eq(&self, other: &Self) -> bool {
        (&self.instance, self.required, &self.pack, &self.space)
            == (&other.instance, other.required, &other.pack, &other.space)
    }
}
