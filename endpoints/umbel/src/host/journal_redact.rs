//! The journal recorder's last look at each entry: put back what a sealed result left out, drop
//! an entry of a command declaring `secret`, and reduce a digest command's entry.

use serde_json::Value;

use super::digest::{self, DigestCommands};
use crate::middleware;
use crate::positions::Stash;

/// The entry to store for `record`, or `None` for none. A sealed result's stash entry is taken
/// back first, whatever follows, so a dropped entry leaves nothing in the stash. An entry of a
/// command declaring `secret` (`spec/journal.md`) is never written, tape included: the digest
/// step reduces digest commands only and keeps tapes. So such a command's changes are never
/// projected into an event stream either; no Umbel or first-party command declares `secret`
/// today.
pub(super) fn entry(
    digests: &DigestCommands,
    stash: &Stash,
    mut record: afd::JournalRecord,
    secret: bool,
) -> Option<afd::JournalRecord> {
    restore_sealed(&mut record, stash);
    if secret {
        return None;
    }
    Some(digest::redact(digests, record))
}

/// Put back into a journal record what the plugin gate left out of a sealed result (phase 5
/// section 9.3): its `dev.umbel/changes` and record `version`, found by the reference the result
/// carries, which the record does not keep.
fn restore_sealed(record: &mut afd::JournalRecord, stash: &Stash) {
    let Some(metadata) = record.result.metadata.as_mut() else {
        return;
    };
    let Some(Value::String(reference)) = metadata.extra.remove(middleware::JOURNAL_REF_KEY) else {
        return;
    };
    let Some(mut raw) = stash.take(&reference) else {
        tracing::error!(
            "journal: a sealed result's metadata was no longer kept; its event names no changes"
        );
        return;
    };
    if let Some(version) = raw.remove("version")
        && let Some(Value::Object(found)) = metadata.extra.get_mut(crate::events::RECORD_KEY)
    {
        found.insert("version".to_owned(), version);
    }
    for (key, value) in raw {
        metadata.extra.insert(key, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use afd::{CommandResult, JournalContextDigest, JournalRecord, JournalTape, ResultMetadata};
    use serde_json::{Map, json};

    /// A record of `command` whose sealed result names `reference` in the stash.
    fn sealed(command: &str, reference: &str) -> JournalRecord {
        let mut metadata = ResultMetadata::new();
        metadata.extra.insert(
            middleware::JOURNAL_REF_KEY.to_owned(),
            Value::String(reference.to_owned()),
        );
        let mut result: CommandResult<Value> = afd::success(json!({ "key": "SECRET-KEY" }));
        result.metadata = Some(metadata);
        JournalRecord {
            timestamp: "2026-01-01T00:00:00.000Z".to_owned(),
            trace_id: None,
            idempotency_key: None,
            command: command.to_owned(),
            input: json!({ "passphrase": "hunter2" }),
            actor: None,
            context_digest: JournalContextDigest {
                hash: "sha256:00".to_owned(),
                interface: None,
            },
            context: None,
            context_omitted: None,
            output_budget: None,
            result,
            duration_ms: 0.0,
            tape: Some(JournalTape {
                clock: vec![],
                random: vec![0.5],
                truncated: false,
            }),
        }
    }

    fn stashed(stash: &Stash, reference: &str) {
        let mut raw = Map::new();
        raw.insert(
            "dev.umbel/changes".to_owned(),
            json!([{ "op": "SECRET-CHANGE" }]),
        );
        stash.put(reference, raw);
    }

    #[test]
    fn a_secret_entry_is_dropped_and_its_stash_entry_drained() {
        let stash = Stash::default();
        stashed(&stash, "ref-secret");
        let kept = entry(
            &DigestCommands::new(),
            &stash,
            sealed("vault-unlock", "ref-secret"),
            true,
        );
        assert_eq!(kept, None);
        assert!(
            stash.take("ref-secret").is_none(),
            "the stash entry was drained"
        );
    }

    #[test]
    fn any_other_entry_gets_its_stash_entry_back() {
        let stash = Stash::default();
        stashed(&stash, "ref-plain");
        let kept = entry(
            &DigestCommands::new(),
            &stash,
            sealed("vault-peek", "ref-plain"),
            false,
        )
        .expect("an entry");
        let extra = &kept.result.metadata.as_ref().unwrap().extra;
        assert!(!extra.contains_key(middleware::JOURNAL_REF_KEY));
        assert_eq!(
            extra["dev.umbel/changes"],
            json!([{ "op": "SECRET-CHANGE" }])
        );
        assert!(stash.take("ref-plain").is_none());
    }
}
