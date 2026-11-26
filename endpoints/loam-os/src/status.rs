//! `host-status`: what the host is, what its runtime answers, and everything a caller may ask for.
//!
//! It refuses nothing. An unreachable runtime is `reachable: false`, and a configuration that
//! fails its semantic checks is still shown as it is, so the operator sees what the host sees.

use serde_json::{Value, json};

use crate::config::Config;
use crate::runtime::Runtime;
use crate::{HOST_NAME, HOST_VERSION};

pub(crate) fn host_status(config: &Config, runtime: &dyn Runtime) -> Value {
    let version = runtime.version();
    let reachable = version.is_ok();
    // M0 keeps no records of machines, so everything carrying the label is unlisted.
    let labelled = if reachable {
        Some(runtime.labelled())
    } else {
        None
    };
    let (unlisted, unlisted_error) = match labelled {
        Some(Ok(found)) => (Some(found), None),
        Some(Err(error)) => (None, Some(error.to_string())),
        None => (None, None),
    };
    let repositories: Vec<Value> = config
        .repositories
        .iter()
        .map(|(name, repository)| {
            let mut entry = json!({
                "name": name,
                "base": repository.base,
                "image": repository.image,
                "size": repository.size,
            });
            if let Some(steps) = &repository.checkpoint_steps {
                entry["checkpointSteps"] = json!(steps);
            }
            entry
        })
        .collect();
    let images: Vec<Value> = config
        .images
        .iter()
        .map(|(name, image)| {
            json!({
                "name": name,
                "reference": image.reference,
                "digest": image.digest(),
                "toolchain": image.toolchain,
            })
        })
        .collect();
    let sizes: Vec<Value> = config
        .sizes
        .iter()
        .map(|(name, size)| {
            json!({
                "name": name,
                "cpus": size.cpus,
                "memoryGb": size.memory_gb,
                "diskGb": size.disk_gb,
            })
        })
        .collect();
    let policies: Vec<Value> = config
        .policies
        .iter()
        .map(|(name, policy)| json!({ "name": name, "hosts": policy.hosts }))
        .collect();
    json!({
        "host": { "name": HOST_NAME, "version": HOST_VERSION },
        "runtime": {
            "kind": runtime.kind(),
            "version": version.as_ref().ok(),
            "reachable": reachable,
            "error": version.as_ref().err().map(ToString::to_string),
        },
        // Umbel's default journal until Loam OS M1 wires the required mode and its live counts
        // (Umbel D208); M0 cannot see whether the journal is writable, so it does not say.
        "journal": { "mode": "best-effort", "writable": null, "pending": 0, "dropped": 0 },
        "repositories": repositories,
        "images": images,
        "sizes": sizes,
        "policies": policies,
        "capacity": {
            "machines": { "max": config.capacity.machines, "active": 0 },
            "diskGb": config.capacity.disk_gb,
            "minFreeDiskGb": config.capacity.min_free_disk_gb,
            // M0 measures no disk; M1 does, from the machines' volumes.
            "usedGb": null,
        },
        "unlisted": {
            "containers": unlisted.map(|found| found.containers),
            "volumes": unlisted.map(|found| found.volumes),
            "error": unlisted_error,
        },
        "retention": {
            "recordsDays": config.retention.records_days,
            "logsDays": config.retention.logs_days,
        },
    })
}
