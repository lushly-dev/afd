//! `store-records-reindex`, `store-documents-hold` and the doctor's `records.declared`,
//! `records.standing`, `records.meaning`, `records.own` and `records.size` (records host
//! specification, sections 12.1 to 12.3).
//!
//! `store-records-reindex` rebuilds the lane of each declared kind it names, in one space, in
//! chunks, then rebuilds missing vectors (and removes other models' vectors) when the space's
//! model loaded, and re-reads the kind's eval gate report. With `vectorsOnly = true` it skips the
//! lane rebuild and runs only the vector pass. For the CLI and the operator only.

use super::store_common::{space_property, view};
use super::{Builtin, blocking, returns_object};
use crate::doctor::Check;
use crate::meaning::{GateState, MeaningHub, ModelState};
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
use umbel_store::lane::{LANE_DESIGN_RECORDS, LaneState, LaneStatus, MATCH_POSTINGS, RecordDecl};

/// The command's name.
pub(crate) const REINDEX: &str = "store-records-reindex";
/// The inputs its journal digest keeps: none is content.
pub(crate) const REINDEX_KEPT: &[&str] = &["space", "plugin", "kind", "vectorsOnly"];

struct Handler {
    workspace: Arc<Workspace>,
    stores: Hub,
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
    meaning: Arc<MeaningHub>,
}

/// Every declared kind of every loaded instance enabled for `space`: the instance and the
/// declaration, in instance order and manifest order.
pub(crate) fn declared_in(loaded: &LoadedPlugins, space: &str) -> Vec<(String, RecordDecl)> {
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

pub(crate) fn not_declared(message: String, plugin: Option<&str>) -> CommandError {
    CommandError::new(records::RECORD_KIND_NOT_DECLARED, message)
        .with_suggestion(format!(
            "List the instance's declared kinds with `umbel plugin show plugin={}`.",
            plugin.unwrap_or("<plugin>")
        ))
        .with_retryable(false)
}

fn model_unavailable(message: String) -> CommandError {
    CommandError::new(records::RECORD_MODEL_UNAVAILABLE, message)
        .with_suggestion("Run umbel workspace doctor and fix what records.meaning reports.")
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

struct ReindexOutcome {
    data: Value,
    superseded: Vec<String>,
    model_warning: Option<String>,
}

fn run(
    stores: &Hub,
    meaning: &MeaningHub,
    space: &str,
    chosen: &[(String, RecordDecl)],
    vectors_only: bool,
) -> Result<ReindexOutcome, CommandError> {
    let embedder = meaning.space_embedder(space);
    let model_problem = meaning.space_model_failed(space);
    if vectors_only && embedder.is_none() {
        let reason = match model_problem {
            Some(problem) => format!(
                "the embedding model configured for space `{space}` did not load: {problem}"
            ),
            None => format!("no embedding model is configured for space `{space}`"),
        };
        return Err(model_unavailable(reason));
    }
    let model_warning = (!vectors_only).then(|| {
        model_problem.map(|problem| {
            format!(
                "The embedding model configured for space `{space}` did not load ({problem}): the lane rebuilt, and its vector pass was skipped."
            )
        })
    }).flatten();

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
                embedder.as_deref(),
                vectors_only,
            )
            .map_err(|e| command_error(&e))?;
        if report.superseded {
            superseded.push(format!("{instance}.{}", decl.kind));
        } else if decl.matched.is_some() {
            // Section 12.1 step 3: re-read the kind's gate report after rebuild.
            let _ = meaning.refresh_gate(space, instance, decl);
        }
        let meaning_state =
            if decl.matched.is_some() && meaning.is_served(space, instance, &decl.kind) {
                "served"
            } else {
                "off"
            };
        kinds.push(json!({
            "plugin": instance,
            "kind": decl.kind,
            "records": report.records,
            "unindexed": report.unindexed,
            "wordingsChanged": report.wordings_changed,
            "superseded": report.superseded,
            "vectorsWritten": report.vectors_written,
            "vectorsRemoved": report.vectors_removed,
            "meaning": meaning_state,
        }));
    }
    Ok(ReindexOutcome {
        data: json!({ "space": space, "kinds": kinds }),
        superseded,
        model_warning,
    })
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
        let vectors_only = input
            .get("vectorsOnly")
            .and_then(Value::as_bool)
            .unwrap_or(false);
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
        let meaning = Arc::clone(&self.meaning);
        match blocking(move || run(&stores, &meaning, &space, &chosen, vectors_only)).await {
            Ok(outcome) => {
                let mut warnings = Vec::new();
                if !outcome.superseded.is_empty() {
                    // A write the rebuild did not see is never forgotten: the kind stays stale.
                    warnings.push(Warning::new(
                        records::RECORD_LANE_STALE,
                        format!(
                            "A record was written, or another rebuild began, while {} was rebuilt: this rebuild stopped and cleared nothing; run it again.",
                            outcome.superseded.join(", ")
                        ),
                    ));
                }
                if let Some(message) = outcome.model_warning {
                    warnings.push(Warning::new(records::RECORD_MODEL_UNAVAILABLE, message));
                }
                if warnings.is_empty() {
                    success(outcome.data)
                } else {
                    let options = ResultOptions {
                        warnings: Some(warnings),
                        ..ResultOptions::default()
                    };
                    success_with(outcome.data, options)
                }
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
    meaning: Arc<MeaningHub>,
) -> Builtin {
    let definition = CommandDefinition::new(
        REINDEX,
        "Rebuild the record lane of a space's declared record kinds from their stored records, in chunks, and compute missing vectors; a kind is offline while it is rebuilt",
        vec![],
        Handler {
            workspace,
            stores,
            loaded,
            meaning,
        },
    )
    .with_category("store")
    .with_returns(returns_object(
        "space and kinds: per kind its plugin, kind, records, unindexed, wordingsChanged, superseded, vectorsWritten, vectorsRemoved and meaning",
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
                "vectorsOnly": {
                    "type": "boolean",
                    "description": "Skip the lane rebuild and compute missing vectors (and remove other models' vectors) only; default false"
                },
            },
            "additionalProperties": false,
        }),
    }
}

/// The command that holds an own collection's stored documents to their files.
pub(crate) const HOLD: &str = "store-documents-hold";
/// The inputs its journal digest keeps: none is content.
pub(crate) const HOLD_KEPT: &[&str] = &["space", "collection"];
/// `collection` names no collection of the space that is configured as the person's own.
const STORE_COLLECTION_NOT_OWN: &str = "STORE_COLLECTION_NOT_OWN";

struct HoldHandler {
    workspace: Arc<Workspace>,
    stores: Hub,
}

/// Compare each stored document of `collection` with its file on disk and record, for each
/// that equals it, that the host held it to its file (section 3, rule 2): how many documents
/// the collection holds, how many are held now, and how many differ from their file or have
/// none. Counts, and never a document's id or text.
fn hold(
    workspace: &Workspace,
    stores: &Hub,
    space: &str,
    collection: &str,
) -> Result<(u64, u64, u64), CommandError> {
    use umbel_store::{ListQuery, ReaderFilter};
    let opened = stores.space(space).map_err(|e| command_error(&e))?;
    let (mut documents, mut held, mut differing) = (0u64, 0u64, 0u64);
    let mut after = None;
    loop {
        let query = ListQuery {
            collection: Some(collection.to_owned()),
            prefix: None,
            doc_type: None,
            after: after.take(),
            limit: umbel_store::MAX_LIST_LIMIT,
        };
        // The operator's own read of what the store holds: counts leave, and nothing else.
        let page = opened
            .documents
            .list_documents(&query, &ReaderFilter::derivation())
            .map_err(|e| command_error(&e))?;
        for document in &page.items {
            documents += 1;
            let on_disk = crate::plugins::own_file_hash(
                workspace,
                space,
                collection,
                &document.path,
                document.size,
            );
            let equal = on_disk.as_ref() == Some(&document.content_hash)
                && opened
                    .documents
                    .hold_document(&document.id, &document.content_hash)
                    .map_err(|e| command_error(&e))?;
            if equal {
                held += 1;
            } else {
                differing += 1;
            }
        }
        match page.next {
            Some(next) => after = Some(next),
            None => return Ok((documents, held, differing)),
        }
    }
}

#[async_trait]
impl CommandHandler for HoldHandler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        if let Some(refused) = super::operator_only(&self.workspace, &context, HOLD) {
            return failure(refused);
        }
        let (space, _filter) = match view(&self.workspace, &input, &context) {
            Ok(view) => view,
            Err(error) => return failure(error),
        };
        let space = space.to_string();
        let collection = input
            .get("collection")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let own = self
            .workspace
            .config()
            .spaces
            .iter()
            .find(|declared| declared.id.as_str() == space)
            .is_some_and(|declared| {
                declared
                    .collections
                    .iter()
                    .any(|declared| declared.id == collection && declared.own)
            });
        if !own {
            return failure(
                CommandError::new(
                    STORE_COLLECTION_NOT_OWN,
                    format!(
                        "`{collection}` is not a collection of the space `{space}` configured as the person's own"
                    ),
                )
                .with_suggestion(
                    "Name a collection whose table sets own = true in umbel.toml; umbel workspace doctor lists each space's own collections under records.standing.",
                )
                .with_retryable(false),
            );
        }
        let (workspace, stores) = (Arc::clone(&self.workspace), Arc::clone(&self.stores));
        let (held_space, held_collection) = (space.clone(), collection.clone());
        let done = blocking(move || hold(&workspace, &stores, &held_space, &held_collection)).await;
        match done {
            Ok((documents, held, differing)) => {
                let data = json!({
                    "space": space,
                    "collection": collection,
                    "documents": documents,
                    "held": held,
                    "differing": differing,
                });
                if differing == 0 {
                    return success(data);
                }
                let warning = Warning::new(
                    records::STORE_OWN_SOURCE_MISMATCH,
                    format!(
                        "{differing} stored document(s) of `{collection}` differ from their file on disk or have none: they are not held, and attest nothing. Run the collection's sync, which stores a changed file again and removes a document whose file is gone, then run this again."
                    ),
                );
                success_with(
                    data,
                    ResultOptions {
                        warnings: Some(vec![warning]),
                        ..ResultOptions::default()
                    },
                )
            }
            Err(error) => failure(error),
        }
    }
}

/// `store-documents-hold`.
pub(crate) fn store_documents_hold(workspace: Arc<Workspace>, stores: Hub) -> Builtin {
    let definition = CommandDefinition::new(
        HOLD,
        "Compare each stored document of one own collection with its file on disk and hold those that are equal, so that they can attest; a document stored before its collection was named own is not held until this runs",
        vec![],
        HoldHandler { workspace, stores },
    )
    .with_category("store")
    .with_returns(returns_object(
        "space, collection and three counts: documents, held (equal to their file, and held to it now) and differing (not equal, or with no file)",
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
                "collection": {
                    "type": "string",
                    "minLength": 1,
                    "description": "A collection of the space configured own = true"
                },
            },
            "required": ["collection"],
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

/// Section 12.3's rule for saying what a rebuild will remove: a kind whose stored `text`
/// differs from the manifest's, **whatever the manifest declares it as**. The wording hash is
/// taken over the values at the text pointers in declaration order, so the rebuild finds every
/// record's wording changed and takes the affirmation and the evidence from each, under a
/// declaration with standing and under one without (section 12.1, step 1.3). A kind whose
/// `standing` alone changed loses nothing: its wordings did not move.
fn loses_standing(stored: Option<&str>, decl: &RecordDecl) -> bool {
    let Some(stored) = stored.and_then(|text| serde_json::from_str::<Value>(text).ok()) else {
        return false;
    };
    stored.get("text") != decl.to_json().get("text")
}

/// `records.declared`: every declared kind is ready, with no unindexed record.
fn declared_check(found: &[Found], failed: &[String]) -> Check {
    const ID: &str = "records.declared";
    let stale: Vec<String> = found
        .iter()
        .filter(|kind| kind.status.state == LaneState::Stale)
        .map(|kind| {
            let holds = kind.status.affirmed > 0 || kind.status.evidence > 0;
            let lost = if holds && loses_standing(kind.status.stored.as_deref(), &kind.decl) {
                format!(
                    " (its text changed: the rebuild will remove {} affirmation(s) and {} evidence row(s))",
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
            "Run umbel store records-reindex space=<id>; until then every lane service on the kind answers RECORD_LANE_STALE.",
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

/// `records.size`: no kind holds more than `record_bound` records or `postings_bound` postings in
/// a space (records host specification, section 12.3 and step B4 review follow-up).
fn size_check(found: &[Found], record_bound: u64, postings_bound: u64) -> Check {
    const ID: &str = "records.size";
    let large: Vec<String> = found
        .iter()
        .filter_map(|kind| {
            let over_records = kind.status.records > record_bound;
            let over_postings = kind.status.postings > postings_bound;
            match (over_records, over_postings) {
                (false, false) => None,
                (true, true) => Some(format!(
                    "{}: {} ({} records, {} postings)",
                    kind.space, kind.name, kind.status.records, kind.status.postings
                )),
                (true, false) => Some(format!(
                    "{}: {} ({} records)",
                    kind.space, kind.name, kind.status.records
                )),
                (false, true) => Some(format!(
                    "{}: {} ({} postings)",
                    kind.space, kind.name, kind.status.postings
                )),
            }
        })
        .collect();
    if large.is_empty() {
        Check::pass(
            ID,
            format!(
                "no declared record kind holds more than {record_bound} records or {postings_bound} postings in a space"
            ),
        )
    } else {
        let any_over_postings = found
            .iter()
            .any(|kind| kind.status.postings > postings_bound);
        let suggestion = if any_over_postings {
            format!(
                "Past {postings_bound} postings a match or ranked find of the kind is refused for every reader (RECORD_QUERY_TOO_BROAD); past {record_bound} records vector scans and rebuilds take longer. Split the kind, or move the records a plugin no longer needs."
            )
        } else {
            format!(
                "Past {record_bound} records vector scans and rebuilds take longer (matching and ranked finds stay served until {postings_bound} postings, when they answer RECORD_QUERY_TOO_BROAD). Split the kind, or move the records a plugin no longer needs."
            )
        };
        Check::warn(
            ID,
            format!(
                "declared record kinds past the lane's bounds ({record_bound} records or {postings_bound} postings): {}",
                large.join("; ")
            ),
            &suggestion,
        )
    }
}

/// `records.quota` (D212): no principal is at or past the records write quota in a kind. A
/// principal there keeps every record it holds, and its puts that would add more are refused
/// (`RECORD_QUOTA_EXCEEDED`); a deployer who lowered a limit under what a principal holds, or a
/// rebuild that gave its records more postings, is how one passes it. The check names no
/// principal: the store reports the largest use, not whose. With no limit set (mode `none`'s
/// default) it passes saying so; with a kind it could not read (`unread`, which
/// `records.declared` names) a pass says it is incomplete.
fn quota_check(found: &[Found], unread: usize, quota: umbel_store::lane::RecordQuota) -> Check {
    const ID: &str = "records.quota";
    if quota == umbel_store::lane::RecordQuota::unlimited() {
        return Check::pass(
            ID,
            "no records write quota is set: limits.kind_records and limits.kind_postings apply by default only in a hosted mode".to_owned(),
        );
    }
    let at: Vec<String> = found
        .iter()
        .filter_map(|kind| {
            let records = kind.status.most_records >= quota.records;
            let postings = kind.status.most_postings >= quota.postings;
            let mut held = Vec::new();
            if records {
                held.push(format!(
                    "{} of kind_records {}",
                    kind.status.most_records,
                    limit(quota.records)
                ));
            }
            if postings {
                held.push(format!(
                    "{} of kind_postings {}",
                    kind.status.most_postings,
                    limit(quota.postings)
                ));
            }
            (!held.is_empty())
                .then(|| format!("{}: {} ({})", kind.space, kind.name, held.join(", ")))
        })
        .collect();
    if at.is_empty() {
        let incomplete = if unread == 0 {
            String::new()
        } else {
            format!(" ({unread} declared kind(s) could not be read; records.declared names them)")
        };
        Check::pass(
            ID,
            format!(
                "no principal holds kind_records {} or kind_postings {} in a declared record kind{incomplete}",
                limit(quota.records),
                limit(quota.postings)
            ),
        )
    } else {
        Check::warn(
            ID,
            format!(
                "a principal is at or past its records write quota in: {}",
                at.join("; ")
            ),
            "Its puts that would add records or postings to the kind are refused (RECORD_QUOTA_EXCEEDED); no service deletes a declared record, so raise limits.kind_records or limits.kind_postings in umbel.toml (config_version 8) if the use is expected.",
        )
    }
}

/// A limit as the check prints it: `none` for no limit.
fn limit(value: u64) -> String {
    if value == u64::MAX {
        "none".to_owned()
    } else {
        value.to_string()
    }
}

/// One space where a standing kind is enabled, as `records.standing` reports it.
struct StandingSpace {
    space: String,
    /// The standing kinds enabled there, as `<instance>.<kind>`.
    kinds: Vec<String>,
    person: bool,
    own: Vec<String>,
    command_writable: Vec<String>,
    verified_admits: &'static str,
}

/// The spaces of `workspace` where a loaded instance declares a standing kind, with what the
/// configuration says of each: whether it has a `person`, its own collections, the collections
/// a command can write files into, and what "verified" means there.
fn standing_spaces(workspace: &Workspace, loaded: &LoadedPlugins) -> Vec<StandingSpace> {
    let config = workspace.config();
    config
        .spaces
        .iter()
        .filter_map(|space| {
            let id = space.id.as_str();
            let kinds: Vec<String> = declared_in(loaded, id)
                .into_iter()
                .filter(|(_, decl)| decl.standing)
                .map(|(instance, decl)| format!("{instance}.{}", decl.kind))
                .collect();
            (!kinds.is_empty()).then(|| StandingSpace {
                space: id.to_owned(),
                kinds,
                person: space.person.is_some(),
                own: space
                    .collections
                    .iter()
                    .filter(|collection| collection.own)
                    .map(|collection| collection.id.clone())
                    .collect(),
                command_writable: space
                    .collections
                    .iter()
                    .filter(|collection| config.command_writable(id, &collection.id))
                    .map(|collection| collection.id.clone())
                    .collect(),
                verified_admits: space.verified_admits.as_str(),
            })
        })
        .collect()
}

/// `records.standing`: every space where a standing kind is enabled has a `person`. It lists
/// each such space's own collections, its command-writable ones and `verified_admits`, which
/// together say what can read as attested there and what a call for verified content is given.
/// It names whether a person is set, never who.
fn standing_check(found: &[StandingSpace]) -> Check {
    const ID: &str = "records.standing";
    if found.is_empty() {
        return Check::pass(ID, "No space enables a standing record kind");
    }
    let list = |ids: &[String]| {
        if ids.is_empty() {
            "none".to_owned()
        } else {
            ids.join(", ")
        }
    };
    let listed: Vec<String> = found
        .iter()
        .map(|space| {
            format!(
                "{} ({}): own collections: {}; command-writable collections: {}; verified_admits: {}",
                space.space,
                space.kinds.join(", "),
                list(&space.own),
                list(&space.command_writable),
                space.verified_admits
            )
        })
        .collect();
    let without: Vec<&str> = found
        .iter()
        .filter(|space| !space.person)
        .map(|space| space.space.as_str())
        .collect();
    if without.is_empty() {
        Check::pass(
            ID,
            format!(
                "every space where a standing record kind is enabled has a person. {}",
                listed.join(". ")
            ),
        )
    } else {
        Check::warn(
            ID,
            format!(
                "spaces where a standing record kind is enabled and no person is configured, so no record there can be affirmed or attested: {}. {}",
                without.join(", "),
                listed.join(". ")
            ),
            "Set person = \"human:<id>\" under [spaces.<id>] in umbel.toml (config_version = 6): the one person whose decisions give standing in the space.",
        )
    }
}

/// `records.own`: every stored document of every own collection is held to its file on disk
/// (section 3, rule 2). A document that is not, which is one stored before its collection was
/// named own or before this fact was kept, is the person's own by no collection and attests
/// nothing until `store-documents-hold` has compared it with its file. `unheld` is each such
/// collection as `<space>/<collection>` with its count.
fn own_check(unheld: &[(String, u64)], failed: &[String], collections: usize) -> Check {
    const ID: &str = "records.own";
    if !failed.is_empty() {
        return Check::fail(
            ID,
            format!(
                "own collections that could not be read: {}",
                failed.join("; ")
            ),
            "Run umbel store check space=<id>.",
        );
    }
    if unheld.is_empty() {
        return Check::pass(
            ID,
            if collections == 0 {
                "No stored space has a collection named as the person's own".to_owned()
            } else {
                format!(
                    "every stored document of {collections} own collection(s) is held to its file on disk"
                )
            },
        );
    }
    let listed: Vec<String> = unheld
        .iter()
        .map(|(collection, count)| format!("{collection} ({count})"))
        .collect();
    Check::warn(
        ID,
        format!(
            "stored documents of own collections that the host has not held to their file on disk, so they are nobody's own and attest nothing: {}",
            listed.join("; ")
        ),
        "Run umbel store documents-hold collection=<id> space=<id> for each (space= may be left out for the default space): it compares each stored document with its file and holds those that are equal. A document that differs is stored again by the collection's next sync.",
    )
}

/// `records.meaning` (section 12.3): each configured model loaded, has no missing vector, and
/// has a passing, bound, non-stale eval report for each kind with a match field. Always warns
/// for an `http` model, naming the host record text is sent to.
fn meaning_check(
    workspace: &Workspace,
    loaded: &LoadedPlugins,
    meaning: &MeaningHub,
    found: &[Found],
) -> Check {
    const ID: &str = "records.meaning";
    let mut failures = Vec::new();
    let mut warnings = Vec::new();
    for (id, slot) in meaning.models() {
        if let Some(host) = slot.config.http_host() {
            warnings.push(format!(
                "model `{id}` uses the http provider and sends record text to `{host}`"
            ));
        }
        if let ModelState::Failed(problem) = &slot.state {
            failures.push(format!("model `{id}`: {problem}"));
        }
    }
    if !failures.is_empty() {
        let mut details = vec![format!(
            "embedding model load failure(s): {}",
            failures.join("; ")
        )];
        details.extend(warnings);
        return Check::fail(
            ID,
            details.join("; "),
            "Check [models.<id>] in umbel.toml: verify every pinned file exists with its SHA-256 digest and build umbel with the provider's Cargo feature (embed-static, embed-onnx or embed-http).",
        );
    }
    let configured_spaces: Vec<&crate::workspace::SpaceConfig> = workspace
        .spaces()
        .iter()
        .filter(|space| space.meaning.is_some())
        .collect();
    if configured_spaces.is_empty() {
        if warnings.is_empty() {
            return Check::pass(ID, "No space configures an embedding model");
        }
        return Check::warn(
            ID,
            warnings.join("; "),
            "An http embedding model sends record text off the machine; confirm the endpoint host is intended.",
        );
    }
    for space in &configured_spaces {
        let space_id = space.id.as_str();
        let active_model = meaning.space_embedder(space_id).map(|e| e.model().clone());
        for (instance, decl) in declared_in(loaded, space_id) {
            if decl.matched.is_none() {
                continue;
            }
            let name = format!("{instance}.{}", decl.kind);
            let status = found
                .iter()
                .find(|f| f.space == space_id && f.name == name)
                .map(|f| &f.status);
            if let (Some(model), Some(status)) = (&active_model, status) {
                let present = status.vectors.get(model.as_str()).copied().unwrap_or(0);
                let missing = status.with_match.saturating_sub(present);
                if missing > 0 {
                    warnings.push(format!(
                        "{space_id}: {name} has {missing} record(s) missing vectors for {model}"
                    ));
                }
            }
            match meaning.evaluate_gate(space_id, &instance, &decl) {
                GateState::Passed { records } => {
                    if let Some(status) = status
                        && status.records > records.saturating_mul(4)
                    {
                        warnings.push(format!(
                            "{space_id}: {name} holds {} records, more than four times the {records} its eval report scored",
                            status.records
                        ));
                    }
                }
                GateState::Missing => warnings.push(format!(
                    "{space_id}: {name} has no eval report; meaning stays off"
                )),
                GateState::Invalid(why) => warnings.push(format!(
                    "{space_id}: {name} has an unreadable eval report ({why}); meaning stays off"
                )),
                GateState::Unbound(which) => warnings.push(format!(
                    "{space_id}: {name} eval report is bound to another {which}; meaning stays off"
                )),
                GateState::Failed(why) => warnings.push(format!(
                    "{space_id}: {name} eval report did not pass ({why}); meaning stays off"
                )),
            }
        }
    }
    if warnings.is_empty() {
        Check::pass(
            ID,
            format!(
                "{} space(s) configured for meaning: every model loaded, vectors complete, and eval gates passing",
                configured_spaces.len()
            ),
        )
    } else {
        Check::warn(
            ID,
            warnings.join("; "),
            "Run umbel store records-reindex to fill missing vectors and umbel store records-eval plugin=<id> kind=<kind> probes=<file> to refresh eval reports, then restart the server.",
        )
    }
}

/// The doctor's six record checks on a sealed host, in order: `records.declared`,
/// `records.standing`, `records.meaning`, `records.own`, `records.size` and `records.quota`.
/// The first and the last two read the lane of every declared kind of every loaded instance, and
/// the fourth the documents of every own collection, in each space that already has a store: a space nothing
/// has written to is not given an empty store by a health check.
pub(crate) fn checks(
    workspace: &Workspace,
    stores: &Hub,
    loaded: &LoadedPlugins,
    meaning: &MeaningHub,
) -> [Check; 6] {
    let mut found = Vec::new();
    let mut failed = Vec::new();
    let (mut unheld, mut own_failed, mut own_collections) = (Vec::new(), Vec::new(), 0usize);
    for space in workspace.spaces() {
        let dir = workspace.layout().space_state_dir(&space.id);
        if !dir.join("store").join("store.sqlite3").is_file() {
            continue;
        }
        let own: Vec<&str> = space
            .collections
            .iter()
            .filter(|collection| collection.own)
            .map(|collection| collection.id.as_str())
            .collect();
        if !own.is_empty() {
            match stores.space(space.id.as_str()) {
                Ok(opened) => {
                    for collection in own {
                        own_collections += 1;
                        let name = format!("{}/{collection}", space.id);
                        match opened.documents.unheld_documents(collection) {
                            Ok(0) => {}
                            Ok(count) => unheld.push((name, count)),
                            Err(error) => own_failed.push(format!("{name}: {error}")),
                        }
                    }
                }
                Err(error) => {
                    own_failed.push(format!("{}: the store cannot be opened: {error}", space.id))
                }
            }
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
        standing_check(&standing_spaces(workspace, loaded)),
        meaning_check(workspace, loaded, meaning, &found),
        own_check(&unheld, &own_failed, own_collections),
        size_check(&found, LANE_DESIGN_RECORDS, MATCH_POSTINGS),
        quota_check(&found, failed.len(), workspace.record_quota()),
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
                postings: 80,
                most_records: 12,
                most_postings: 80,
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
                .contains("umbel store records-reindex")
        );
    }

    #[test]
    fn a_changed_text_says_what_the_rebuild_removes_whatever_the_declaration() {
        let old = decl(true, &["/statement"]);
        let plain = decl(false, &["/statement"]);
        // The rebuild takes the standing from every record whose wording changed, under a
        // declaration with standing and under one without, so the doctor says so under both.
        for (new, stored) in [
            (decl(true, &["/statement", "/why"]), &old),
            (decl(true, &["/wording"]), &old),
            (decl(false, &["/wording"]), &old),
            (decl(false, &["/statement", "/why"]), &old),
            (decl(false, &[]), &old),
            (decl(true, &["/wording"]), &plain),
        ] {
            let check = declared_check(&[found(new, LaneState::Stale, Some(stored))], &[]);
            assert_eq!(check.status, CheckStatus::Fail);
            assert!(
                check
                    .message
                    .contains("its text changed: the rebuild will remove 4 affirmation(s) and 7 evidence row(s)"),
                "{check:?}"
            );
        }
        // A kind whose keys alone changed keeps what it holds, and so does one whose
        // `standing` alone changed, either way: no wording moved. One never declared holds
        // nothing.
        let mut rekeyed = old.clone();
        rekeyed.keys = vec![Pointer::parse("/tags").unwrap()];
        for (new, stored) in [
            (rekeyed, Some(&old)),
            (plain.clone(), Some(&old)),
            (old.clone(), Some(&plain)),
            (plain.clone(), Some(&plain)),
            (old.clone(), None),
        ] {
            let check = declared_check(&[found(new, LaneState::Stale, stored)], &[]);
            assert_eq!(check.status, CheckStatus::Fail);
            assert!(!check.message.contains("affirmation"), "{check:?}");
        }
        // A kind that holds no standing fact has nothing to lose, and is not told it has.
        let mut empty = found(decl(true, &["/wording"]), LaneState::Stale, Some(&old));
        empty.status.affirmed = 0;
        empty.status.evidence = 0;
        let check = declared_check(&[empty], &[]);
        assert!(!check.message.contains("affirmation"), "{check:?}");
    }

    fn standing_space(space: &str, person: bool) -> StandingSpace {
        StandingSpace {
            space: space.to_owned(),
            kinds: vec!["notes.note".to_owned()],
            person,
            own: vec!["journal".to_owned(), "talks".to_owned()],
            command_writable: vec!["wiki".to_owned()],
            verified_admits: "affirmed+attested",
        }
    }

    #[test]
    fn a_space_with_a_standing_kind_and_no_person_warns() {
        assert_eq!(standing_check(&[]).status, CheckStatus::Pass);
        let check = standing_check(&[standing_space("garden", true)]);
        assert_eq!(check.status, CheckStatus::Pass);
        assert!(
            check.message.contains(
                "garden (notes.note): own collections: journal, talks; command-writable collections: wiki; verified_admits: affirmed+attested"
            ),
            "{check:?}"
        );
        let mut bare = standing_space("orchard", false);
        bare.own.clear();
        bare.command_writable.clear();
        bare.verified_admits = "affirmed";
        let check = standing_check(&[standing_space("garden", true), bare]);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(
            check.message.contains(
                "no person is configured, so no record there can be affirmed or attested: orchard."
            ),
            "{check:?}"
        );
        assert!(
            check.message.contains(
                "orchard (notes.note): own collections: none; command-writable collections: none; verified_admits: affirmed"
            ),
            "{check:?}"
        );
        assert!(check.message.contains("garden (notes.note)"), "{check:?}");
        assert!(check.suggestion.as_deref().unwrap().contains("person = "));
    }

    #[test]
    fn documents_of_an_own_collection_not_held_to_their_file_warn_naming_the_command() {
        assert_eq!(own_check(&[], &[], 0).status, CheckStatus::Pass);
        let held = own_check(&[], &[], 2);
        assert_eq!(held.status, CheckStatus::Pass);
        assert!(held.message.contains("2 own collection(s)"), "{held:?}");
        let check = own_check(
            &[
                ("garden/journal".to_owned(), 3),
                ("garden/talks".to_owned(), 1),
            ],
            &[],
            2,
        );
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(
            check
                .message
                .ends_with("attest nothing: garden/journal (3); garden/talks (1)"),
            "{check:?}"
        );
        assert!(
            check
                .suggestion
                .as_deref()
                .unwrap()
                .contains("umbel store documents-hold collection=<id> space=<id>")
        );
        let unread = own_check(&[], &["garden/journal: busy".to_owned()], 1);
        assert_eq!(unread.status, CheckStatus::Fail);
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
        // At both exact bounds: passes.
        assert_eq!(size_check(&kinds, 12, 80).status, CheckStatus::Pass);
        // Past record bound only: warns with record count and clarifies matching stays served.
        let check = size_check(&kinds, 11, 80);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(
            check.message.contains("garden: notes.note (12 records)"),
            "{check:?}"
        );
        assert!(
            check
                .suggestion
                .as_deref()
                .unwrap()
                .contains("stay served until 80 postings"),
            "{check:?}"
        );
        // Past postings bound only (long records, few rows): warns with postings count and refusal.
        let check = size_check(&kinds, 12, 79);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(
            check.message.contains("garden: notes.note (80 postings)"),
            "{check:?}"
        );
        assert!(
            check
                .suggestion
                .as_deref()
                .unwrap()
                .contains("Past 79 postings a match or ranked find of the kind is refused"),
            "{check:?}"
        );
        // Past both bounds: names both counts.
        let check = size_check(&kinds, 11, 79);
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(
            check
                .message
                .contains("garden: notes.note (12 records, 80 postings)"),
            "{check:?}"
        );
        assert_eq!(
            size_check(&kinds, LANE_DESIGN_RECORDS, MATCH_POSTINGS).status,
            CheckStatus::Pass
        );
        assert_eq!(LANE_DESIGN_RECORDS, 100_000);
        assert_eq!(MATCH_POSTINGS, 4_000_000);
    }

    #[test]
    fn a_principal_at_its_quota_warns_naming_the_kind_and_the_limit() {
        use umbel_store::lane::RecordQuota;
        let ready = decl(false, &["/statement"]);
        let kinds = [found(ready.clone(), LaneState::Ready, Some(&ready))];
        // The fixture's largest use is 12 records and 80 postings.
        let quota = |records, postings| RecordQuota { records, postings };
        assert_eq!(
            quota_check(&kinds, 0, quota(13, 81)).status,
            CheckStatus::Pass
        );
        let check = quota_check(&kinds, 0, quota(12, 81));
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(
            check
                .message
                .contains("garden: notes.note (12 of kind_records 12)"),
            "{check:?}"
        );
        let check = quota_check(&kinds, 0, quota(10, 40));
        assert!(
            check
                .message
                .contains("(12 of kind_records 10, 80 of kind_postings 40)"),
            "{check:?}"
        );
        assert!(
            check
                .suggestion
                .as_deref()
                .unwrap()
                .contains("RECORD_QUOTA_EXCEEDED"),
            "{check:?}"
        );
        assert_eq!(
            quota_check(&kinds, 0, crate::workspace::default_record_quota()).status,
            CheckStatus::Pass
        );
        // A kind the doctor could not read makes a pass say so.
        let check = quota_check(&kinds, 1, quota(13, 81));
        assert_eq!(check.status, CheckStatus::Pass);
        assert!(
            check
                .message
                .contains("1 declared kind(s) could not be read"),
            "{check:?}"
        );
        // No limit set: mode none's default.
        let check = quota_check(&kinds, 0, RecordQuota::unlimited());
        assert_eq!(check.status, CheckStatus::Pass);
        assert!(
            check.message.contains("no records write quota is set"),
            "{check:?}"
        );
        // One limit set and the other none.
        let check = quota_check(&kinds, 0, quota(u64::MAX, 40));
        assert!(
            check.message.contains("(80 of kind_postings 40)"),
            "{check:?}"
        );
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
            assert!(
                error
                    .suggestion
                    .unwrap()
                    .contains("umbel plugin show plugin=")
            );
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
