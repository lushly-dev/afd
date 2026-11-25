//! The command journal (the specification's 13.1): the `afd` crate's record
//! of each accepted command that changes something, in `journal.jsonl` in
//! the data directory.
//!
//! - Read commands are left out, so opening and searching mail copies nothing
//!   into it.
//! - Failures are recorded, a person's command held for approval among them;
//!   an approval's summary holds no text from mail.
//! - No secret is kept: `mail-token-create`'s result and tape are removed,
//!   and so is every approval token a held call returned, which would let
//!   whoever reads the file run the command it was issued for.
//! - The file is the person's alone (`0600`), as everything in the data
//!   directory is.
//! - Only the process that owns the store writes it: the crate's file sink
//!   allows one writer, and a call another process refused because it did
//!   not have the store is not an accepted command.

use std::collections::HashSet;
use std::sync::Arc;

use afd::{
    CommandRegistry, FileJournalSink, JournalEntry, JournalRange, JournalRecord, JournalRecorder,
    JournalSink,
};
use async_trait::async_trait;

use crate::engine::Engine;
use crate::home::{Home, create_private_dir, private_file};
use crate::tokens;

/// The journal's file in `home`.
#[must_use]
pub fn path(home: &Home) -> std::path::PathBuf {
    home.root().join("journal.jsonl")
}

/// The crate's JSON Lines file, made private before anything is written to
/// it.
struct PrivateFile {
    home: Home,
    file: FileJournalSink,
}

impl PrivateFile {
    fn prepare(&self) -> std::io::Result<()> {
        create_private_dir(self.home.root())?;
        let file = private_file()
            .create(true)
            .truncate(false)
            .open(self.file.path())?;
        // A file made before by something else may be open to others.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if file.metadata()?.permissions().mode() & 0o077 != 0 {
                file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            }
        }
        #[cfg(not(unix))]
        let _ = file;
        Ok(())
    }
}

#[async_trait]
impl JournalSink for PrivateFile {
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        self.prepare()
            .map_err(|error| format!("the journal could not be made private: {error}"))?;
        self.file.append(record).await
    }

    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        self.file.read(range).await
    }
}

/// Drops what the journal must not keep from `record`.
#[must_use]
pub fn redact(mut record: JournalRecord) -> Option<JournalRecord> {
    if let Some(details) = record
        .result
        .error
        .as_mut()
        .and_then(|error| error.details.as_mut())
    {
        details.remove("approvalToken");
    }
    // A selection's sample is mail that was read (13.1): its id and counts
    // stay, which are what an audit of a change needs.
    if record.command == crate::selections::CREATE
        && let Some(serde_json::Value::Object(data)) = record.result.data.as_mut()
    {
        data.remove("sample");
    }
    // A draft's text is journaled as the input that wrote it (13.1); a
    // result repeats it whole, and a discard or a restore would copy it in
    // though its input held none. The result keeps its ids and revision.
    if let Some(data) = record.result.data.as_mut() {
        drop_draft_text(&record.command, data);
    }
    // Refusals keep no mail-derived content (13.1): strip titles and passages
    // from failed `mail-story-propose` inputs.
    if !record.result.success && record.command == crate::stories::PROPOSE {
        scrub_failed_story_input(&mut record.input);
    }
    // Unit submission claims are spent by the time the mutation succeeds, and
    // must never be kept in the journal even when a submit fails before
    // spending the claim (plugin.spec.md 9.4).
    if record.command == crate::replysets::SUBMIT
        && let Some(obj) = record.input.as_object_mut()
    {
        obj.remove("claim");
    }
    if record.command == tokens::CREATE {
        // The token is drawn from the operating system, not the tape; the
        // tape goes too, as the crate advises for any secret.
        record.result.data = None;
        record.tape = None;
    }
    Some(record)
}

/// The entry to store for `record`: none for a command declaring `secret`
/// (`spec/journal.md`), since `redact` knows only the commands it names, and
/// none before the engine owns the store; otherwise `record` redacted.
fn admit(record: JournalRecord, secret: bool, owns_store: bool) -> Option<JournalRecord> {
    if secret || !owns_store {
        return None;
    }
    redact(record)
}

/// Removes content payloads from the result of `command`, when its input
/// already carries them or the result would copy mail text in (13.1): ids,
/// revision, and metadata stay.
fn drop_draft_text(command: &str, data: &mut serde_json::Value) {
    if (crate::drafts::RESULTS_WITH_TEXT.contains(&command)
        || command == crate::records::PROPOSE
        || command == crate::stories::PROPOSE
        || crate::replysets::RESULTS_WITH_TEXT.contains(&command))
        && let serde_json::Value::Object(data) = data
    {
        data.remove("content");
        if let Some(serde_json::Value::Object(set)) = data.get_mut("replyset") {
            set.remove("content");
            if let Some(serde_json::Value::Array(replies)) = set.get_mut("replies") {
                for reply in replies {
                    if let serde_json::Value::Object(reply) = reply {
                        reply.remove("content");
                    }
                }
            }
        }
    }
}

/// Removes `title` and member `passage` strings from a refused
/// `mail-story-propose` input so refusals remain content-free (13.1).
fn scrub_failed_story_input(input: &mut serde_json::Value) {
    let Some(obj) = input.as_object_mut() else {
        return;
    };
    obj.remove("title");
    if let Some(serde_json::Value::Array(members)) = obj.get_mut("members") {
        for member in members {
            if let Some(m) = member.as_object_mut() {
                m.remove("passage");
            }
        }
    }
}

/// The recorder for `registry`'s commands, writing to the journal in `home`
/// while `engine` owns the store. Problems writing it are reported as the
/// engine's progress is.
#[must_use]
pub fn recorder(home: &Home, registry: &CommandRegistry, engine: Arc<Engine>) -> JournalRecorder {
    let changes: HashSet<String> = registry
        .list()
        .into_iter()
        .filter(|command| command.mutation)
        .map(|command| command.name.clone())
        .collect();
    let sink = PrivateFile {
        home: home.clone(),
        file: FileJournalSink::new(path(home)),
    };
    JournalRecorder::new(Arc::new(sink))
        .with_record_failures(true)
        .with_filter(move |command| changes.contains(command))
        // Asked after the call, so a command that opened the store first is
        // recorded. A command declaring `secret` is never recorded: `redact`
        // knows only the commands it names.
        .with_redact_info({
            let engine = Arc::clone(&engine);
            move |record, info| admit(record, info.secret, engine.owns_store())
        })
        // The crate's message names the file and the system's error: the
        // engine's words, never text from mail.
        .with_on_error(move |_| engine.report("the journal could not be written"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{admit, drop_draft_text};

    fn record(command: &str) -> afd::JournalRecord {
        afd::JournalRecord {
            timestamp: "2026-01-01T00:00:00.000Z".to_owned(),
            trace_id: None,
            command: command.to_owned(),
            input: json!({ "password": "hunter2" }),
            actor: None,
            context_digest: afd::JournalContextDigest {
                hash: "sha256:00".to_owned(),
                interface: None,
            },
            context: None,
            context_omitted: None,
            output_budget: None,
            result: afd::success(json!({ "token": "issued" })),
            duration_ms: 0.0,
            tape: None,
        }
    }

    /// A command declaring `secret` is never stored, whatever `redact` would
    /// make of it; any other is redacted once the engine owns the store.
    #[test]
    fn a_secret_command_is_never_stored() {
        assert_eq!(admit(record("mail-vault-unlock"), true, true), None);
        assert_eq!(admit(record("mail-vault-unlock"), false, false), None);
        let kept = admit(record("mail-vault-unlock"), false, true).expect("an entry");
        assert_eq!(kept.command, "mail-vault-unlock");
    }

    /// A discard or a restore would copy a draft's text into the journal
    /// though its input held none: its result keeps ids and revision only.
    #[test]
    fn a_draft_result_keeps_no_text() {
        for command in crate::drafts::RESULTS_WITH_TEXT {
            let mut data = json!({
                "draft": 3,
                "revision": 2,
                "content": { "trust": "content", "body": "Lunch?" },
            });
            drop_draft_text(command, &mut data);
            assert_eq!(data, json!({ "draft": 3, "revision": 2 }), "{command}");
        }
        let mut record_res = json!({
            "record": 5,
            "message": 1,
            "content": { "trust": "content", "fields": { "category": "work" }, "passages": ["hi"] },
        });
        drop_draft_text(crate::records::PROPOSE, &mut record_res);
        assert_eq!(record_res, json!({ "record": 5, "message": 1 }));
        let mut story_res = json!({
            "story": 9,
            "kind": "cohort",
            "proposed": true,
            "content": { "trust": "content", "title": "Q4 tax docs" },
        });
        drop_draft_text(crate::stories::PROPOSE, &mut story_res);
        assert_eq!(
            story_res,
            json!({ "story": 9, "kind": "cohort", "proposed": true })
        );
        let mut replyset_res = json!({
            "replyset": {
                "id": 3,
                "revision": 1,
                "content": { "trust": "content", "sharedText": "secret" },
                "replies": [
                    { "reply": 1, "content": { "trust": "content", "text": "hello" } }
                ]
            }
        });
        drop_draft_text(crate::replysets::CREATE, &mut replyset_res);
        assert_eq!(
            replyset_res,
            json!({
                "replyset": {
                    "id": 3,
                    "revision": 1,
                    "replies": [{ "reply": 1 }]
                }
            })
        );
        let mut other = json!({ "content": { "body": "kept" } });
        drop_draft_text("mail-sync", &mut other);
        assert_eq!(other["content"]["body"], "kept");
    }

    #[test]
    fn a_replyset_submit_journal_record_drops_claim() {
        let record = afd::JournalRecord {
            timestamp: "2026-11-24T00:00:00Z".to_string(),
            trace_id: None,
            command: crate::replysets::SUBMIT.to_string(),
            input: json!({
                "replyset": 1,
                "reply": 1,
                "unit": "rsu_1_1_1",
                "claim": "secret_43_char_claim_value_that_must_go_now",
                "text": "Dear Ada, Thursday works.",
            }),
            actor: None,
            context_digest: afd::JournalContextDigest {
                hash: "sha256:0".to_string(),
                interface: Some("mcp".to_string()),
            },
            context: None,
            context_omitted: None,
            output_budget: None,
            result: afd::success(json!({
                "reply": { "reply": 1, "source": "submitted", "unit": "rsu_1_1_1" },
                "revision": 2,
            })),
            duration_ms: 1.0,
            tape: None,
        };
        let redacted = super::redact(record).expect("submit is still journaled");
        assert!(
            redacted.input.get("claim").is_none(),
            "{:?}",
            redacted.input
        );
        assert_eq!(redacted.input["unit"], "rsu_1_1_1");
        assert_eq!(redacted.input["text"], "Dear Ada, Thursday works.");
    }
}
