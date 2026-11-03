//! Digest journaling (phase 3 specification, section 7.1, D72): AFD's journal keeps inputs and
//! results as they are, and it is append-only, so a command that carries memory text declares
//! `journal.mode = "digest"` and the recorder's last look reduces its entry before it is stored.
//!
//! The entry keeps its seq, time, trace id, command, actor, context digest, duration, budget and
//! tape (which hold no text); its input becomes a byte count and the declared keys; its result
//! loses its data and every text field, keeping codes, severities, the host's `dev.umbel/` keys
//! (so events still project) and `actorKind`. The step stamps `dev.umbel/replay = "recorded"`
//! itself, because a call that fails before using a store never reaches the gate's stamp, and a
//! digest entry cannot be replayed.

use std::collections::BTreeMap;

use afd::{CommandResult, JournalRecord, ResultMetadata};
use serde_json::{Map, Value, json};

use crate::middleware::REPLAY_KEY;

/// `result.metadata` and input key: `"digest"` on a digest entry.
pub(crate) const JOURNAL_KEY: &str = "dev.umbel/journal";
/// The message a digest entry's warnings and error carry: AFD's `message` is required.
pub(crate) const DIGEST_MESSAGE: &str = "(digest)";
/// The longest list of strings a kept key may hold.
const MAX_KEPT_LIST: usize = 100;

/// The digest commands and the input keys each keeps, fixed at seal.
pub(crate) type DigestCommands = BTreeMap<String, Vec<String>>;

/// A kept input value: a string, a number, a boolean or a list of at most 100 strings.
fn keepable(value: &Value) -> bool {
    match value {
        Value::String(_) | Value::Number(_) | Value::Bool(_) => true,
        Value::Array(items) => items.len() <= MAX_KEPT_LIST && items.iter().all(Value::is_string),
        _ => false,
    }
}

/// The digest of an input: its canonical JSON length and the kept keys. No hash: a hash
/// confirms a guess at short text.
fn digest_input(input: &Value, keep: &[String]) -> Value {
    let bytes = umbel_store::canonical_json(input).len();
    let mut kept = Map::new();
    if let Value::Object(map) = input {
        for key in keep {
            if let Some(value) = map.get(key).filter(|value| keepable(value)) {
                kept.insert(key.clone(), value.clone());
            }
        }
    }
    json!({ JOURNAL_KEY: "digest", "bytes": bytes, "keep": kept })
}

/// The digest of a result: no data and no text, the codes and the host's keys kept.
fn digest_result(result: CommandResult<Value>) -> CommandResult<Value> {
    let warnings = result.warnings.map(|warnings| {
        warnings
            .into_iter()
            .map(|mut warning| {
                warning.message = DIGEST_MESSAGE.to_owned();
                warning.details = None;
                warning
            })
            .collect()
    });
    let error = result.error.map(|mut error| {
        error.message = DIGEST_MESSAGE.to_owned();
        error.suggestion = None;
        error.details = None;
        error.cause = None;
        error
    });
    let mut metadata = ResultMetadata::new();
    if let Some(old) = result.metadata {
        metadata.actor_kind = old.actor_kind;
        metadata.extra = old
            .extra
            .into_iter()
            .filter(|(key, _)| key.starts_with("dev.umbel/"))
            .collect();
    }
    metadata
        .extra
        .insert(JOURNAL_KEY.to_owned(), Value::from("digest"));
    metadata
        .extra
        .insert(REPLAY_KEY.to_owned(), Value::from("recorded"));
    let mut digested = CommandResult::default();
    digested.success = result.success;
    digested.error = error;
    digested.confidence = result.confidence;
    digested.warnings = warnings;
    digested.metadata = Some(metadata);
    digested
}

/// The recorder's redact step: a digest command's entry reduced, every other entry unchanged.
pub(crate) fn redact(commands: &DigestCommands, mut record: JournalRecord) -> JournalRecord {
    let Some(keep) = commands.get(&record.command) else {
        return record;
    };
    record.input = digest_input(&record.input, keep);
    record.result = digest_result(record.result);
    record
}

#[cfg(test)]
mod tests {
    use super::*;
    use afd::{CommandError, Warning};

    #[test]
    fn a_digest_result_keeps_codes_and_host_keys_and_no_text() {
        let mut result = afd::success(json!({ "text": "canary" }));
        result.reasoning = Some("canary".into());
        result.suggestions = Some(vec!["canary".into()]);
        result.warnings = Some(vec![Warning::new("CONTENT_FLAGGED", "canary")]);
        let mut metadata = ResultMetadata::new();
        metadata
            .extra
            .insert("dev.umbel/space".into(), json!("main"));
        metadata.extra.insert("other".into(), json!("canary"));
        metadata.trace_id = Some("t".into());
        result.metadata = Some(metadata);
        let digested = digest_result(result);
        let text = serde_json::to_string(&digested).unwrap_or_default();
        assert!(!text.contains("canary"), "{text}");
        assert_eq!(
            digested.warnings.as_ref().map(|w| w[0].code.as_str()),
            Some("CONTENT_FLAGGED")
        );
        let extra = &digested
            .metadata
            .as_ref()
            .map(|m| m.extra.clone())
            .unwrap_or_default();
        assert_eq!(extra.get("dev.umbel/space"), Some(&json!("main")));
        assert_eq!(extra.get(REPLAY_KEY), Some(&json!("recorded")));
        assert_eq!(extra.get(JOURNAL_KEY), Some(&json!("digest")));
        let failed = digest_result(afd::failure(
            CommandError::new("MEMORY_NOT_FOUND", "canary").with_suggestion("canary"),
        ));
        let text = serde_json::to_string(&failed).unwrap_or_default();
        assert!(
            !text.contains("canary") && text.contains("MEMORY_NOT_FOUND"),
            "{text}"
        );
    }

    #[test]
    fn a_digest_input_keeps_the_declared_scalars_and_short_string_lists() {
        let input = json!({
            "space": "main", "text": "canary", "ids": ["a", "b"], "n": 3, "nested": { "x": 1 },
        });
        let keep = ["space", "ids", "n", "nested", "absent"].map(str::to_owned);
        let digested = digest_input(&input, &keep);
        assert_eq!(
            digested["keep"],
            json!({ "space": "main", "ids": ["a", "b"], "n": 3 })
        );
        assert_eq!(digested[JOURNAL_KEY], json!("digest"));
        assert!(digested["bytes"].as_u64().is_some_and(|n| n > 0));
        assert!(!digested.to_string().contains("canary"));
    }
}
