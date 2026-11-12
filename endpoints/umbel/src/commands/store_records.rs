//! `store-records-reindex` and the doctor's `records.declared` and `records.size` (records host
//! specification, sections 12.1 and 12.3).
//!
//! The command rebuilds the lane of each declared kind it names, in one space, in chunks: a kind
//! being rebuilt is offline until the rebuild ends, and the rest of the store is not. It changes
//! no record and makes no event; its inputs are a space, an instance and a kind, none of which is
//! content, and its journal entry is a digest that keeps them. For the CLI and the operator only.
//!
//! Vectors (`vectorsOnly`, the model, and whether a meaning lane is served) join with that
//! specification's step B5.

use super::store_common::{space_property, view};
use super::{Builtin, blocking, returns_object};
use crate::doctor::Check;
use crate::plugins::{LoadedPlugins, Status};
use crate::store::{Hub, command_error, records};
use crate::workspace::Workspace;
use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    ResultOptions, Warning, failure, success, success_with,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};
use umbel_store::lane::{LANE_DESIGN_RECORDS, LaneState, LaneStatus, RecordDecl};

/// The command's name.
pub(crate) const REINDEX: &str = "store-records-reindex";
/// The inputs its journal digest keeps: none is content.
pub(crate) const REINDEX_KEPT: &[&str] = &["space", "plugin", "kind"];

struct Handler {
    workspace: Arc<Workspace>,
    stores: Hub,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
}

/// Every declared kind of every loaded instance enabled for `space`: the instance and the
/// declaration, in instance order and manifest order.
fn declared_in(loaded: &LoadedPlugins, space: &str) -> Vec<(String, RecordDecl)> {
    loaded
        .instances
        .iter()
        .filter(|instance| {
            instance.status == Status::Loaded && instance.spaces.iter().any(|s| s == space)
        })
        .flat_map(|instance| {
            instance
                .manifest
                .iter()
                .flat_map(|manifest| &manifest.records)
                .map(|decl| (instance.id.clone(), decl.clone()))
        })
        .collect()
}

fn not_declared(message: String, plugin: Option<&str>) -> CommandError {
    CommandError::new(records::RECORD_KIND_NOT_DECLARED, message)
        .with_suggestion(format!(
            "List the instance's declared kinds with `umbel plugin-show {}`.",
            plugin.unwrap_or("<plugin>")
        ))
        .with_retryable(false)
}

/// The kinds the input names, among those declared in the space.
fn selected(
    declared: Vec<(String, RecordDecl)>,
    space: &str,
    plugin: Option<&str>,
    kind: Option<&str>,
) -> Result<Vec<(String, RecordDecl)>, CommandError> {
    let chosen: Vec<(String, RecordDecl)> = declared
        .into_iter()
        .filter(|(instance, decl)| {
            plugin.is_none_or(|plugin| plugin == instance)
                && kind.is_none_or(|kind| kind == decl.kind)
        })
        .collect();
    if chosen.is_empty() && (plugin.is_some() || kind.is_some()) {
        let what = match (plugin, kind) {
            (Some(plugin), Some(kind)) => {
                format!("the kind {kind} is not a declared record kind of {plugin}")
            }
            (Some(plugin), None) => format!("{plugin} declares no record kind"),
            (None, Some(kind)) => format!("no plugin instance declares the record kind {kind}"),
            (None, None) => String::new(),
        };
        return Err(not_declared(
            format!("{what} loaded for the space `{space}`"),
            plugin,
        ));
    }
    Ok(chosen)
}

fn run(
    stores: &Hub,
    space: &str,
    chosen: &[(String, RecordDecl)],
) -> Result<(Value, Vec<String>), CommandError> {
    let opened = stores.space(space).map_err(|e| command_error(&e))?;
    let mut kinds = Vec::new();
    let mut superseded = Vec::new();
    for (instance, decl) in chosen {
        let report = opened
            .documents
            .reindex_records(
                instance,
                decl,
                &crate::plugins::scan_record_text,
                None,
                false,
            )
            .map_err(|e| command_error(&e))?;
        if report.superseded {
            superseded.push(format!("{instance}.{}", decl.kind));
        }
        kinds.push(json!({
            "plugin": instance,
            "kind": decl.kind,
            "records": report.records,
            "unindexed": report.unindexed,
            "wordingsChanged": report.wordings_changed,
            "superseded": report.superseded,
            "vectorsWritten": report.vectors_written,
            "vectorsRemoved": report.vectors_removed,
        }));
    }
    Ok((json!({ "space": space, "kinds": kinds }), superseded))
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        if let Some(refused) = super::operator_only(&self.workspace, &context, REINDEX) {
            return failure(refused);
        }
        let (space, _filter) = match view(&self.workspace, &input, &context) {
            Ok(view) => view,
            Err(error) => return failure(error),
        };
        let space = space.to_string();
        let name = |key: &str| input.get(key).and_then(Value::as_str).map(str::to_owned);
        let (plugin, kind) = (name("plugin"), name("kind"));
        let declared = self
            .loaded
            .get()
            .map(|loaded| declared_in(loaded, &space))
            .unwrap_or_default();
        let chosen = match selected(declared, &space, plugin.as_deref(), kind.as_deref()) {
            Ok(chosen) => chosen,
            Err(error) => return failure(error),
        };
        let stores = Arc::clone(&self.stores);
        match blocking(move || run(&stores, &space, &chosen)).await {
            Ok((data, superseded)) if superseded.is_empty() => success(data),
            Ok((data, superseded)) => {
                // A write the rebuild did not see is never forgotten: the kind stays stale.
                let warning = Warning::new(
                    records::RECORD_LANE_STALE,
                    format!(
                        "A record was written, or another rebuild began, while {} was rebuilt: this rebuild stopped and cleared nothing; run it again.",
                        superseded.join(", ")
                    ),
                );
                let options = ResultOptions {
                    warnings: Some(vec![warning]),
                    ..ResultOptions::default()
                };
                success_with(data, options)
            }
            Err(error) => failure(error),
        }
    }
}

/// `store-records-reindex`.
pub(crate) fn store_records_reindex(
    workspace: Arc<Workspace>,
    stores: Hub,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
) -> Builtin {
    let definition = CommandDefinition::new(
        REINDEX,
        "Rebuild the record lane of a space's declared record kinds from their stored records, in chunks; a kind is offline while it is rebuilt",
        vec![],
        Handler {
            workspace,
            stores,
            loaded,
        },
    )
    .with_category("store")
    .with_returns(returns_object(
        "space and kinds: per kind its plugin, kind, records, unindexed, wordingsChanged, superseded, vectorsWritten and vectorsRemoved",
    ))
    .as_mutation()
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "space": space_property(),
                "plugin": {
                    "type": "string",
                    "minLength": 1,
                    "description": "A plugin instance; default: every loaded instance of the space that declares a record kind"
                },
                "kind": {
                    "type": "string",
                    "minLength": 1,
                    "description": "A declared record kind; default: every kind the instances declare"
                },
            },
            "additionalProperties": false,
        }),
    }
}

/// One declared kind in one space, as the doctor found it.
struct Found {
    space: String,
    name: String,
    decl: RecordDecl,
    status: LaneStatus,
}

/// Section 12.3's rule for saying what a rebuild will remove: a standing kind whose stored
/// `text` or `standing` differs from the manifest's.
fn loses_standing(stored: Option<&str>, decl: &RecordDecl) -> bool {
    let Some(stored) = stored.and_then(|text| serde_json::from_str::<Value>(text).ok()) else {
        return false;
    };
    let now = decl.to_json();
    decl.standing
        && (stored.get("text") != now.get("text") || stored.get("standing") != now.get("standing"))
}

/// `records.declared`: every declared kind is ready, with no unindexed record.
fn declared_check(found: &[Found], failed: &[String]) -> Check {
    const ID: &str = "records.declared";
    let stale: Vec<String> = found
        .iter()
        .filter(|kind| kind.status.state == LaneState::Stale)
        .map(|kind| {
            let lost = if loses_standing(kind.status.stored.as_deref(), &kind.decl) {
                format!(
                    " (its text or standing changed: the rebuild will remove {} affirmation(s) and {} evidence row(s))",
                    kind.status.affirmed, kind.status.evidence
                )
            } else {
                String::new()
            };
            format!("{}: {}{lost}", kind.space, kind.name)
        })
        .chain(failed.iter().cloned())
        .collect();
    if !stale.is_empty() {
        return Check::fail(
            ID,
            format!(
                "declared record kinds whose lane must be rebuilt: {}",
                stale.join("; ")
            ),
            "Run umbel store-records-reindex for the space; until then every lane service on the kind answers RECORD_LANE_STALE.",
        );
    }
    let unindexed: Vec<String> = found
        .iter()
        .filter(|kind| kind.status.unindexed > 0)
        .map(|kind| format!("{}: {} ({})", kind.space, kind.name, kind.status.unindexed))
        .collect();
    if !unindexed.is_empty() {
        return Check::warn(
            ID,
            format!(
                "records their kind's declaration does not admit, which no lane service returns: {}",
                unindexed.join("; ")
            ),
            "Write each record again through its plugin with values the declaration admits: a text pointer holds a string, a key pointer a string or a list of strings.",
        );
    }
    Check::pass(
        ID,
        if found.is_empty() {
            "No stored space holds a declared record kind".to_owned()
        } else {
            format!("{} declared record kind(s) ready", found.len())
        },
    )
}

/// `records.size`: no kind holds more than `bound` records in a space.
fn size_check(found: &[Found], bound: u64) -> Check {
    const ID: &str = "records.size";
    let large: Vec<String> = found
        .iter()
        .filter(|kind| kind.status.records > bound)
        .map(|kind| format!("{}: {} ({})", kind.space, kind.name, kind.status.records))
        .collect();
    if large.is_empty() {
        Check::pass(
            ID,
            format!("no declared record kind holds more than {bound} records in a space"),
        )
    } else {
        Check::warn(
            ID,
            format!(
                "declared record kinds past the lane's design size of {bound} records: {}",
                large.join("; ")
            ),
            "Past this size a ranked find can be refused (RECORD_QUERY_TOO_BROAD) and a rebuild takes longer; split the kind, or move the records a plugin no longer needs.",
        )
    }
}

/// The doctor's two record checks on a sealed host, in order: `records.declared` and
/// `records.size`. They read the lane of every declared kind of every loaded instance, in each
/// of its spaces that already has a store: a space nothing has written to is not given an empty
/// store by a health check.
pub(crate) fn checks(workspace: &Workspace, stores: &Hub, loaded: &LoadedPlugins) -> [Check; 2] {
    let mut found = Vec::new();
    let mut failed = Vec::new();
    for space in workspace.spaces() {
        let dir = workspace.layout().space_state_dir(&space.id);
        if !dir.join("store").join("store.sqlite3").is_file() {
            continue;
        }
        let declared = declared_in(loaded, space.id.as_str());
        if declared.is_empty() {
            continue;
        }
        let opened = match stores.space(space.id.as_str()) {
            Ok(opened) => opened,
            Err(error) => {
                failed.push(format!("{}: the store cannot be opened: {error}", space.id));
                continue;
            }
        };
        for (instance, decl) in declared {
            let name = format!("{instance}.{}", decl.kind);
            match opened.documents.lane_status(&instance, &decl) {
                Ok(status) => found.push(Found {
                    space: space.id.to_string(),
                    name,
                    decl,
                    status,
                }),
                Err(error) => failed.push(format!("{}: {name}: {error}", space.id)),
            }
        }
    }
    [
        declared_check(&found, &failed),
        size_check(&found, LANE_DESIGN_RECORDS),
    ]
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::doctor::CheckStatus;
    use umbel_store::lane::Pointer;

    fn decl(standing: bool, text: &[&str]) -> RecordDecl {
        RecordDecl {
            kind: "note".to_owned(),
            standing,
            text: text.iter().map(|p| Pointer::parse(p).unwrap()).collect(),
            keys: vec![Pointer::parse("/bed").unwrap()],
            matched: None,
        }
    }

    fn found(decl: RecordDecl, state: LaneState, stored: Option<&RecordDecl>) -> Found {
        Found {
            space: "garden".to_owned(),
            name: "notes.note".to_owned(),
            decl,
            status: LaneStatus {
                state,
                stored: stored.map(|decl| umbel_store::canonical_json(&decl.to_json())),
                affirmed: 4,
                evidence: 7,
                records: 12,
                unindexed: 0,
                with_match: 0,
                vectors: std::collections::BTreeMap::new(),
            },
        }
    }

    #[test]
    fn a_stale_kind_fails_naming_it_and_the_command() {
        let same = decl(true, &["/statement"]);
        let check = declared_check(&[found(same.clone(), LaneState::Stale, Some(&same))], &[]);
        assert_eq!(check.status, CheckStatus::Fail);
        assert!(check.message.contains("garden: notes.note"), "{check:?}");
        assert!(!check.message.contains("affirmation"), "{check:?}");
        assert!(
            check
                .suggestion
                .as_deref()
                .unwrap()
                .contains("umbel store-records-reindex")
        );
    }

    #[test]
    fn a_changed_text_or_standing_says_what_the_rebuild_removes() {
        let old = decl(true, &["/statement"]);
        let plain = decl(false, &["/statement"]);
        for (new, stored) in [
            (decl(true, &["/statement", "/why"]), &old),
            (decl(true, &["/wording"]), &old),
            (old.clone(), &plain),
        ] {
            let check = declared_check(&[found(new, LaneState::Stale, Some(stored))], &[]);
            assert_eq!(check.status, CheckStatus::Fail);
            assert!(
                check
                    .message
                    .contains("will remove 4 affirmation(s) and 7 evidence row(s)"),
                "{check:?}"
            );
        }
        // A kind whose keys alone changed keeps what it holds; a kind without standing is not
        // one the rule speaks of; one never declared holds nothing.
        let mut rekeyed = old.clone();
        rekeyed.keys = vec![Pointer::parse("/tags").unwrap()];
        for (new, stored) in [
            (rekeyed, Some(&old)),
            (plain.clone(), Some(&old)),
            (plain.clone(), Some(&plain)),
            (old.clone(), None),
        ] {
            let check = declared_check(&[found(new, LaneState::Stale, stored)], &[]);
            assert_eq!(check.status, CheckStatus::Fail);
            assert!(!check.message.contains("affirmation"), "{check:?}");
        }
    }

    #[test]
    fn unindexed_records_warn_with_their_count_and_ready_kinds_pass() {
        let ready = decl(false, &["/statement"]);
        let mut held = found(ready.clone(), LaneState::Ready, Some(&ready));
        held.status.unindexed = 3;
        let check = declared_check(&[held], &[]);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(
            check.message.contains("garden: notes.note (3)"),
            "{check:?}"
        );
        let check = declared_check(&[found(ready.clone(), LaneState::Ready, Some(&ready))], &[]);
        assert_eq!(check.status, CheckStatus::Pass);
        assert_eq!(check.message, "1 declared record kind(s) ready");
        assert_eq!(declared_check(&[], &[]).status, CheckStatus::Pass);
        // A store that cannot be read fails the check, naming the space.
        let check = declared_check(&[], &["garden: notes.note: busy".to_owned()]);
        assert_eq!(check.status, CheckStatus::Fail);
    }

    #[test]
    fn a_kind_past_the_bound_warns_naming_it_and_its_count() {
        let ready = decl(false, &["/statement"]);
        let kinds = [found(ready.clone(), LaneState::Ready, Some(&ready))];
        assert_eq!(size_check(&kinds, 12).status, CheckStatus::Pass);
        let check = size_check(&kinds, 11);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(
            check.message.contains("garden: notes.note (12)"),
            "{check:?}"
        );
        assert_eq!(
            size_check(&kinds, LANE_DESIGN_RECORDS).status,
            CheckStatus::Pass
        );
        assert_eq!(LANE_DESIGN_RECORDS, 100_000);
    }

    #[test]
    fn the_input_names_an_instance_a_kind_both_or_neither() {
        let declared = || {
            vec![
                ("notes".to_owned(), decl(true, &["/statement"])),
                (
                    "beds".to_owned(),
                    RecordDecl {
                        kind: "bed".to_owned(),
                        ..decl(false, &["/name"])
                    },
                ),
            ]
        };
        let names = |plugin: Option<&str>, kind: Option<&str>| {
            selected(declared(), "garden", plugin, kind).map(|chosen| {
                chosen
                    .into_iter()
                    .map(|(instance, decl)| format!("{instance}.{}", decl.kind))
                    .collect::<Vec<_>>()
            })
        };
        assert_eq!(names(None, None).unwrap(), ["notes.note", "beds.bed"]);
        assert_eq!(names(Some("beds"), None).unwrap(), ["beds.bed"]);
        assert_eq!(names(None, Some("note")).unwrap(), ["notes.note"]);
        assert_eq!(names(Some("notes"), Some("note")).unwrap(), ["notes.note"]);
        for (plugin, kind) in [
            (Some("notes"), Some("bed")),
            (Some("other"), None),
            (None, Some("seed")),
        ] {
            let error = names(plugin, kind).unwrap_err();
            assert_eq!(error.code, "RECORD_KIND_NOT_DECLARED");
            assert!(error.suggestion.unwrap().contains("umbel plugin-show"));
            assert_eq!(error.retryable, Some(false));
        }
        // A space where nothing is declared has nothing to rebuild, and that is no failure.
        assert!(
            selected(Vec::new(), "garden", None, None)
                .unwrap()
                .is_empty()
        );
    }
}
