//! `host-status`: what the host is, what its runtime answers, its journal, its machines, and
//! everything a caller may ask for.
//!
//! It refuses nothing. An unreachable runtime is `reachable: false`, records that cannot be read
//! leave the counts they feed `null` with a warning, and a configuration that fails its semantic
//! checks is still shown as it is, so the operator sees what the host sees.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use umbel::JournalHealth;
use umbel_sdk::{Outcome, success};

use crate::config::Config;
use crate::records::Records;
use crate::runtime::Runtime;
use crate::{HOST_NAME, HOST_VERSION};

/// What the records say: how many machines are active, and the runtime names they account for.
struct Listed {
    active: usize,
    names: BTreeSet<String>,
}

fn listed(records: Option<&dyn Records>) -> Result<Listed, String> {
    let Some(records) = records else {
        return Ok(Listed {
            active: 0,
            names: BTreeSet::new(),
        });
    };
    let machines = records
        .machines()
        .map_err(|error| format!("the host's records cannot be read: {error}"))?;
    let active: Vec<_> = machines
        .iter()
        .filter(|machine| machine.state.is_active())
        .collect();
    Ok(Listed {
        active: active.len(),
        // A destroyed machine's record keeps no names; one that still did would be accounting
        // for something its destruction should have removed, so only active ones count.
        names: active
            .iter()
            .flat_map(|machine| machine.runtime_names())
            .map(str::to_owned)
            .collect(),
    })
}

fn journal(health: Option<&JournalHealth>) -> Value {
    match health {
        Some(health) => json!({
            "mode": "required",
            "writable": health.writable(),
            "pending": health.pending(),
            "dropped": health.dropped(),
        }),
        // A host built without its policies keeps Umbel's default journal (D66), which cannot
        // say whether it is writable.
        None => json!({ "mode": "best-effort", "writable": null, "pending": 0, "dropped": 0 }),
    }
}

pub(crate) fn host_status(
    config: &Config,
    runtime: &dyn Runtime,
    records: Option<&dyn Records>,
    health: Option<&JournalHealth>,
) -> Outcome {
    let version = runtime.version();
    let reachable = version.is_ok();
    let listed = listed(records);
    let labelled = if reachable {
        Some(runtime.labelled())
    } else {
        None
    };
    let unlisted = match (&labelled, &listed) {
        (Some(Ok(found)), Ok(listed)) => {
            let count = |names: &[String]| {
                names
                    .iter()
                    .filter(|name| !listed.names.contains(*name))
                    .count()
            };
            json!({
                "containers": count(&found.containers),
                "volumes": count(&found.volumes),
                "error": null,
            })
        }
        (Some(Err(error)), _) => {
            json!({ "containers": null, "volumes": null, "error": error.to_string() })
        }
        (Some(Ok(_)), Err(error)) => {
            json!({ "containers": null, "volumes": null, "error": error })
        }
        (None, _) => json!({ "containers": null, "volumes": null, "error": null }),
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
    let outcome = success(json!({
        "host": { "name": HOST_NAME, "version": HOST_VERSION },
        "runtime": {
            "kind": runtime.kind(),
            "version": version.as_ref().ok(),
            "reachable": reachable,
            "error": version.as_ref().err().map(ToString::to_string),
        },
        "journal": journal(health),
        "repositories": repositories,
        "images": images,
        "sizes": sizes,
        "policies": policies,
        "capacity": {
            "machines": {
                "max": config.capacity.machines,
                "active": listed.as_ref().ok().map(|listed| listed.active),
            },
            "diskGb": config.capacity.disk_gb,
            "minFreeDiskGb": config.capacity.min_free_disk_gb,
            // Measured from step 5, inside the runtime's virtual machine (the M1 plan).
            "usedGb": null,
        },
        "unlisted": unlisted,
        "retention": {
            "recordsDays": config.retention.records_days,
            "logsDays": config.retention.logs_days,
        },
    }));
    match listed {
        Ok(_) => outcome,
        Err(error) => outcome.with_warning("RECORDS_UNREADABLE", &error),
    }
}
