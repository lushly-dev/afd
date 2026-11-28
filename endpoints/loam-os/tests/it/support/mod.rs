//! What the host's integration tests share: workspaces, a host built as the binary builds it,
//! and the fakes (`fakes`) and fixtures (`fixture`) the scenario harness seeds it from.

pub(crate) mod fakes;
pub(crate) mod fixture;

use std::fs;
use std::path::{Path, PathBuf};

use afd::{Actor, ActorKind, CommandResult};
use loam_os_host::LoamOs;
use serde_json::Value;
use umbel::HostBuilder;

use fakes::FlakyStorage;

/// The example workspace the runbook tells an operator to start from.
pub(crate) const EXAMPLE: &str = include_str!("../../../examples/umbel.toml");

/// A workspace holding `config` as its `umbel.toml`.
pub(crate) fn workspace(config: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), config).unwrap();
    (dir, root)
}

/// The example with its `[plugins.loamos.config...]` tables replaced by `config`.
pub(crate) fn with_config(config: &str) -> String {
    let head = EXAMPLE
        .split("\n[plugins.loamos.config")
        .next()
        .unwrap()
        .to_owned();
    format!("{head}\n{config}")
}

/// The host as the binary builds it ([`loam_os_host::install`]), around `plugin`, with the
/// journal policies' storage replaced by `storage` when one is given, and the clock stopped at
/// `now` when one is given.
pub(crate) fn host(
    root: &Path,
    plugin: LoamOs,
    storage: Option<FlakyStorage>,
    now: Option<afd::ClockInstant>,
) -> umbel::Host {
    let mut builder = HostBuilder::open(root).unwrap();
    if let Some(now) = now {
        builder = builder.with_clock(afd::fixed_clock(now));
    }
    let policies = match storage {
        Some(storage) => loam_os_host::journal_policies().with_storage(storage),
        None => loam_os_host::journal_policies(),
    };
    loam_os_host::install(builder, plugin, policies)
        .seal()
        .unwrap()
}

/// Call `name` with `input` as the test actor `id`, as every scenario step is called.
pub(crate) async fn call_as(
    host: &umbel::Host,
    id: &str,
    name: &str,
    input: Value,
) -> CommandResult<Value> {
    let actor = Actor::new(ActorKind::Test).with_id(id);
    host.registry()
        .execute(name, input, Some(host.context(actor)))
        .await
}
