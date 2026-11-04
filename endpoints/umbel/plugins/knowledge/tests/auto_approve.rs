//! Auto-approval (phase 4 specification, section 8.3; owner decision 1, D98): `knowledge-auto-approve`
//! and its one rule kind, `deprecate-declared`. Off unless an area lists it; only a drafted
//! deprecate, never a create, update or verify, nor a memory-derived, flagged or alternative
//! proposal; only when a person's applied proposal wrote the declaration into the document's
//! current bytes, so a `superseded_by` typed into a file never triggers it; a successor that
//! resolves, is not deprecated and is readable by the target's readers; never from a pipeline,
//! the curator's included; recorded as the policy's decision, never a person's.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandInterface};
use serde_json::{Value, json};
use support::drafter::{self, item};
use support::records;
use support::*;
use umbel_store::{ContentHash, DerivedFrom, DocumentStore, Expect, ReaderFilter};

const OLD: &str = "---\ntitle: Old rollback\ntype: runbook\n---\n# Old rollback\n\nUse the tag.\n";
/// `OLD` declaring its successor.
const DECLARED: &str = "---\ntitle: Old rollback\ntype: runbook\nsuperseded_by: handbook/new\n---\n# Old rollback\n\nUse the tag.\n";
/// `DECLARED` with only its body changed: the declaration is context in its diff.
const DECLARED_EDITED: &str = "---\ntitle: Old rollback\ntype: runbook\nsuperseded_by: handbook/new\n---\n# Old rollback\n\nUse the old tag.\n";
const NEW: &str = "---\ntitle: Rollback\ntype: runbook\n---\n# Rollback\n\nUse the release tag.\n";
const RULE: &str = "auto = [\"deprecate-declared\"]\n";
const COMMAND: &str = "knowledge-auto-approve";

/// The stand-ins' configuration with the curator listed, the CLI's person `human:local`, and the
/// handbook area given `extra` keys.
fn config(extra: &str) -> String {
    drafter::config(&["curator"], "local").replace(
        "space = \"main\"\ncollection = \"handbook\"\n",
        &format!("space = \"main\"\ncollection = \"handbook\"\n{extra}"),
    )
}

/// The handbook with `old` and its successor `new`, read and indexed.
async fn fixture(extra: &str) -> Fx {
    let fx = Fx::with_drafters(&config(extra));
    fx.handbook("old.md", OLD);
    fx.handbook("new.md", NEW);
    fx.refresh("main").await;
    fx
}

async fn hash_of(fx: &Fx, doc: &str) -> String {
    let listed = fx
        .as_actor(member(), "knowledge-list", json!({ "prefix": doc }))
        .await;
    data(&listed)["documents"][0]["contentHash"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn file(fx: &Fx, path: &str) -> String {
    std::fs::read_to_string(fx.path(&format!("spaces/main/handbook/{path}"))).unwrap()
}

/// `agent:<id>` acting for `human:<id>`.
fn agent_of(id: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id(id)
        .with_on_behalf_of(id)
}

/// An update of `doc` to `content`, proposed by `bo`'s agent under `key` and approved at the
/// terminal by `human:local`: a person's applied proposal. Then the files are read again. The
/// proposal's id.
async fn approved_update(fx: &Fx, key: &str, doc: &str, content: &str) -> String {
    let base = hash_of(fx, doc).await;
    let proposed = fx
        .as_actor(
            agent_of("bo"),
            "knowledge-propose",
            json!({
                "idempotency_key": key,
                "change": { "op": "update", "doc": doc, "baseHash": base, "content": content },
                "rationale": "The page says what replaced it.",
                "evidence": [{ "kind": "text", "ref": "team notes" }],
            }),
        )
        .await;
    let id = data(&proposed)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let approved = fx
        .at_terminal("knowledge-approve", json!({ "proposal": id }))
        .await;
    assert_eq!(data(&approved)["applied"], true, "{approved}");
    fx.refresh("main").await;
    id
}

/// `old` declares `handbook/new` as its successor through a person's applied proposal.
async fn declare(fx: &Fx) -> String {
    approved_update(fx, "declare", "handbook/old", DECLARED).await
}

/// The curator's drafted deprecate of `handbook/old` at its current bytes, pointing to
/// `handbook/new` as its frontmatter writes it, citing `cite` at its current hash; the proposal
/// id.
async fn draft_citing(fx: &Fx, key: &str, cite: &str) -> String {
    draft_of(fx, key, "handbook/old", cite).await
}

/// The curator's drafted deprecate of `doc`, as [`draft_citing`] drafts `handbook/old`'s.
async fn draft_of(fx: &Fx, key: &str, doc: &str, cite: &str) -> String {
    let base = hash_of(fx, doc).await;
    let cited = hash_of(fx, cite).await;
    let (result, _) = drafter::submit(
        fx,
        json!([{
            "idempotency_key": key,
            "change": { "op": "deprecate", "doc": doc, "baseHash": base, "supersededBy": "handbook/new" },
            "rationale": "The document names a successor in superseded_by that resolves to a readable document that is not deprecated.",
            "evidence": [{ "kind": "document", "ref": cite, "contentHash": cited }],
        }]),
        None,
    )
    .await;
    let stored = item(data(&result), "results", 0);
    assert_eq!(stored["ok"], true, "{result}");
    stored["proposal"]["id"].as_str().unwrap().to_owned()
}

/// [`draft_citing`] the successor.
async fn draft(fx: &Fx) -> String {
    draft_citing(fx, "d1", "handbook/new").await
}

/// `knowledge-auto-approve` as `human:local` on the command line, past its prompt (as cron runs
/// it with `--yes`).
async fn auto(fx: &Fx) -> Value {
    fx.cli(COMMAND, json!({})).await
}

/// `knowledge-auto-approve` as `actor` on the command line interface.
async fn auto_as(fx: &Fx, actor: Actor) -> Value {
    json_of(
        fx.call(actor, CommandInterface::Cli, COMMAND, json!({}))
            .await,
    )
}

/// The reason the call skipped `id` for.
fn skipped<'a>(result: &'a Value, id: &str) -> &'a str {
    data(result)["skipped"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["proposal"] == id)
        .unwrap_or_else(|| panic!("{id} was not skipped: {result}"))["reason"]
        .as_str()
        .unwrap()
}

fn applied(result: &Value) -> Vec<String> {
    data(result)["applied"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["proposal"].as_str().unwrap().to_owned())
        .collect()
}

fn state(fx: &Fx, id: &str) -> Value {
    records::read(fx, id).body["state"].clone()
}

/// Nothing was applied: the draft is pending and `old` holds `bytes`.
fn untouched(fx: &Fx, id: &str, bytes: &str) {
    assert_eq!(state(fx, id), "pending");
    assert_eq!(file(fx, "old.md"), bytes);
}

/// Put `handbook/old` in the document store as `bytes` with its envelope's `derivedFrom` set to
/// `derived`, and write the file alike: a writer other than the knowledge plugin, as any plugin
/// holding `documents_write` could.
fn forge(fx: &Fx, bytes: &str, derived: Option<Vec<DerivedFrom>>) {
    let store = records::store(fx, "main");
    let stored = store
        .get_document("handbook/old", &ReaderFilter::derivation())
        .unwrap()
        .unwrap();
    let mut write = stored.write.clone();
    let hash = ContentHash::of(bytes.as_bytes());
    write.bytes = bytes.as_bytes().to_vec();
    write.size = bytes.len() as u64;
    write.content_hash = hash.clone();
    write.envelope.content_hash = Some(hash.to_string());
    write.envelope.derived_from = derived;
    store
        .put_document(write, Expect::Hash(stored.write.content_hash.clone()))
        .unwrap();
    fx.handbook("old.md", bytes);
}

// ── Off by default ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_rule_is_off_unless_the_documents_area_lists_it() {
    // Another area of the space lists the rule; the handbook's does not.
    let other = "\n[plugins.knowledge.config.areas.code]\nspace = \"main\"\ncollection = \"code\"\nauto = [\"deprecate-declared\"]\n";
    let fx = Fx::with_drafters(&format!("{}{other}", config("")));
    fx.handbook("old.md", OLD);
    fx.handbook("new.md", NEW);
    fx.refresh("main").await;
    declare(&fx).await;
    let id = draft(&fx).await;
    let result = auto(&fx).await;
    assert_eq!(data(&result)["counts"]["examined"], 0, "{result}");
    assert!(applied(&result).is_empty());
    untouched(&fx, &id, DECLARED);

    // With no area listing a rule at all, nothing is even read.
    let fx = fixture("").await;
    declare(&fx).await;
    let id = draft(&fx).await;
    let result = auto(&fx).await;
    assert_eq!(data(&result)["counts"]["examined"], 0, "{result}");
    untouched(&fx, &id, DECLARED);
}

// ── The rule holding ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_declared_deprecate_is_applied_as_the_areas_policy_decision() {
    let fx = fixture(RULE).await;
    let writer = declare(&fx).await;
    let id = draft(&fx).await;
    let pending = records::read(&fx, &id).body;
    let result = auto(&fx).await;
    assert_eq!(applied(&result), std::slice::from_ref(&id), "{result}");
    assert_eq!(data(&result)["applied"][0]["rule"], "deprecate-declared");
    assert_eq!(data(&result)["nextStep"], "knowledge-refresh");

    // Recorded as the policy's decision, never a person's (step 1, amendment 8).
    let body = records::read(&fx, &id).body;
    records::assert_valid("proposal.v2", &body);
    assert_eq!(body["state"], "applied");
    assert_eq!(
        body["decision"]["by"],
        json!({ "kind": "service", "id": "policy:handbook" })
    );
    assert_eq!(body["decision"]["principal"], "human:local");
    assert_eq!(body["decision"]["channel"], "policy");
    assert_eq!(body["policy"]["rule"], "auto:deprecate-declared");
    assert_ne!(body["policy"]["version"], pending["policy"]["version"]);
    assert_eq!(body["exception"], Value::Null);

    // The file deprecated, pointing to its successor; the document's lineage is the deprecate.
    let text = file(&fx, "old.md");
    assert!(text.contains("status: \"deprecated\""), "{text}");
    assert!(text.contains("superseded_by: \"handbook/new\""), "{text}");
    let document = records::store(&fx, "main")
        .get_document("handbook/old", &ReaderFilter::derivation())
        .unwrap()
        .unwrap();
    let lineage = document.write.envelope.derived_from.unwrap();
    assert_eq!(lineage.len(), 1);
    assert_eq!(lineage[0].id, id);
    assert_ne!(lineage[0].id, writer);

    // The drafter reads the decision in its feed, with its channel.
    let fed = drafter::feed_as(&fx, "curator", 0).await;
    let decisions = data(&fed)["decisions"].as_array().unwrap();
    let decided = decisions
        .iter()
        .find(|decision| decision["proposal"] == id)
        .unwrap();
    assert_eq!(decided["state"], "applied");
    assert_eq!(decided["channel"], "policy");

    // Applied once: a second call finds nothing pending under the rule.
    let again = auto(&fx).await;
    assert!(applied(&again).is_empty(), "{again}");
    assert_eq!(data(&again)["counts"]["examined"], 0, "{again}");

    // Digest-journaled, keeping the space and the limit and no proposal id.
    let entries = records::journal_entries(&fx, COMMAND);
    assert!(!entries.is_empty());
    for entry in entries {
        assert_eq!(entry["input"]["dev.umbel/journal"], "digest", "{entry}");
        assert!(!entry.to_string().contains(&id), "{entry}");
    }
}

// ── Bytes an applied proposal wrote, and only those ─────────────────────────────────────────

#[tokio::test]
async fn a_superseded_by_typed_into_a_file_never_triggers_it() {
    let fx = fixture(RULE).await;
    fx.handbook("old.md", DECLARED);
    fx.refresh("main").await;
    let id = draft(&fx).await;
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "not-written-by-proposal", "{result}");
    untouched(&fx, &id, DECLARED);
}

#[tokio::test]
async fn a_declaration_carried_through_a_later_edit_or_verification_was_not_written_by_it() {
    // Typed into the file, then a person approves an edit of the body: the declaration is
    // context in that diff, not a change the person approved.
    let fx = fixture(RULE).await;
    fx.handbook("old.md", DECLARED);
    fx.refresh("main").await;
    approved_update(&fx, "body", "handbook/old", DECLARED_EDITED).await;
    let id = draft(&fx).await;
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "declaration-not-written", "{result}");
    untouched(&fx, &id, DECLARED_EDITED);

    // Typed into the file, then a person verifies the document as it stands: a verify writes
    // no declaration.
    let fx = fixture(RULE).await;
    fx.handbook("old.md", DECLARED);
    fx.refresh("main").await;
    let verified = fx
        .at_terminal("knowledge-verify", json!({ "doc": "handbook/old" }))
        .await;
    assert_eq!(data(&verified)["applied"], true, "{verified}");
    fx.refresh("main").await;
    let before = file(&fx, "old.md");
    let id = draft(&fx).await;
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "not-written-by-proposal", "{result}");
    untouched(&fx, &id, &before);
}

#[tokio::test]
async fn bytes_changed_after_the_applied_proposal_are_not_its_bytes() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    // Edited on disk and not read again: the file is not the document's bytes.
    let edited = format!("{DECLARED}\nAn edit nobody proposed.\n");
    fx.handbook("old.md", &edited);
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "bytes-changed", "{result}");
    untouched(&fx, &id, &edited);
    // Read again: the document is no longer the bytes the draft was made against.
    fx.refresh("main").await;
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "target-changed", "{result}");
    untouched(&fx, &id, &edited);
}

#[tokio::test]
async fn an_envelope_naming_a_proposal_proves_nothing_the_proposal_record_does_not() {
    // Bytes another writer put, keeping the envelope that names the applied proposal.
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let forged = format!("{DECLARED}\nA paragraph the person never approved.\n");
    let keep = records::store(&fx, "main")
        .get_document("handbook/old", &ReaderFilter::derivation())
        .unwrap()
        .unwrap()
        .write
        .envelope
        .derived_from;
    forge(&fx, &forged, keep);
    let id = draft(&fx).await;
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "not-written-by-proposal", "{result}");
    untouched(&fx, &id, &forged);

    // Typed bytes with an envelope naming a person's applied proposal of another document.
    let fx = fixture(RULE).await;
    fx.handbook("old.md", DECLARED);
    fx.refresh("main").await;
    let other = approved_update(
        &fx,
        "other",
        "handbook/new",
        &NEW.replace("release tag", "signed release tag"),
    )
    .await;
    let hash = records::read(&fx, &other).content_hash.to_string();
    for (n, derived) in [
        vec![DerivedFrom {
            kind: "proposal".to_owned(),
            id: other.clone(),
            content_hash: hash.clone(),
        }],
        // Two lineages, or one of another kind, are not a proposal's bytes either.
        vec![
            DerivedFrom {
                kind: "proposal".to_owned(),
                id: other.clone(),
                content_hash: hash.clone(),
            },
            DerivedFrom {
                kind: "proposal".to_owned(),
                id: other.clone(),
                content_hash: hash.clone(),
            },
        ],
        vec![DerivedFrom {
            kind: "document".to_owned(),
            id: "handbook/new".to_owned(),
            content_hash: hash.clone(),
        }],
    ]
    .into_iter()
    .enumerate()
    {
        forge(&fx, DECLARED, Some(derived));
        let id = draft_citing(&fx, &format!("forged-{n}"), "handbook/new").await;
        let result = auto(&fx).await;
        assert_eq!(skipped(&result, &id), "not-written-by-proposal", "{result}");
        untouched(&fx, &id, DECLARED);
        // Withdraw it, so the next forgery's draft is not refused as already open.
        let (withdrawn, _) = drafter::submit(
            &fx,
            json!([]),
            Some(json!([{ "proposal": id, "reason": "source-changed" }])),
        )
        .await;
        assert_eq!(
            item(data(&withdrawn), "withdrawals", 0)["ok"],
            true,
            "{withdrawn}"
        );
    }
}

#[tokio::test]
async fn the_declaration_must_be_the_one_the_deprecate_names() {
    let fx = fixture(RULE).await;
    approved_update(
        &fx,
        "declare",
        "handbook/old",
        &DECLARED.replace("handbook/new", "/handbook/new"),
    )
    .await;
    // The frontmatter says `/handbook/new`; the draft says `handbook/new`.
    let id = draft(&fx).await;
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "declaration-differs", "{result}");
    assert_eq!(state(&fx, &id), "pending");
}

// ── What is never applied ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn only_a_drafted_deprecate_is_ever_applied() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let base = hash_of(&fx, "handbook/old").await;
    // A drafted verify first: a drafted proposal waits for any open one on its document.
    let (verify, _) = drafter::submit(
        &fx,
        json!([drafter::verify("v1", "handbook/old", &base)]),
        None,
    )
    .await;
    let verify = item(data(&verify), "results", 0)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // Undrafted proposals by a person's agent: a deprecate naming the declared successor, an
    // update and a create.
    let mut undrafted = Vec::new();
    for (key, change) in [
        (
            "deprecate",
            json!({ "op": "deprecate", "doc": "handbook/old", "baseHash": base, "supersededBy": "handbook/new" }),
        ),
        (
            "update",
            json!({ "op": "update", "doc": "handbook/old", "baseHash": base, "content": format!("{DECLARED}More.\n") }),
        ),
        (
            "create",
            json!({ "op": "create", "doc": "handbook/fresh", "content": "---\ntitle: Fresh\nsuperseded_by: handbook/new\n---\nFresh.\n" }),
        ),
    ] {
        let proposed = fx
            .as_actor(
                agent_of("bo"),
                "knowledge-propose",
                json!({
                    "idempotency_key": key,
                    "change": change,
                    "rationale": "Replaced.",
                    "evidence": [{ "kind": "text", "ref": "team notes" }],
                }),
            )
            .await;
        undrafted.push(
            data(&proposed)["proposal"]["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    let result = auto(&fx).await;
    assert!(applied(&result).is_empty(), "{result}");
    assert_eq!(data(&result)["counts"]["examined"], 4, "{result}");
    assert_eq!(skipped(&result, &verify), "op");
    assert_eq!(skipped(&result, &undrafted[0]), "not-drafted");
    assert_eq!(skipped(&result, &undrafted[1]), "op");
    assert_eq!(skipped(&result, &undrafted[2]), "op");
    for id in undrafted.iter().chain([&verify]) {
        assert_eq!(state(&fx, id), "pending", "{id}");
    }
    assert_eq!(file(&fx, "old.md"), DECLARED);
}

#[tokio::test]
async fn memory_derived_flagged_and_alternative_drafts_are_never_applied() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    let faithful = records::read(&fx, &id).body;
    // Variants of the faithful draft, stored as a library embedder can (D14): each differs in one
    // way that the rule never accepts, whatever the rest says.
    let variant = |n: u32, change: &dyn Fn(&mut Value)| {
        let mut body = faithful.clone();
        body["id"] = json!(format!("p-{n:020x}"));
        body["idempotencyKey"] = json!(format!("variant-{n}"));
        change(&mut body);
        records::seed(&fx, &body);
        body["id"].as_str().unwrap().to_owned()
    };
    let memory = variant(1, &|body| {
        body["evidence"]
            .as_array_mut()
            .unwrap()
            .push(drafter::memory_entry(1));
    });
    let derived = variant(2, &|body| {
        body["provenance"]["derivedFrom"] = json!([{
            "kind": "memory", "id": records::SOURCE_ID, "contentHash": records::SOURCE_HASH,
        }]);
    });
    let promoted = variant(3, &|body| {
        body["drafter"]["mode"] = json!("promoted");
        body["drafter"]["promotedBy"] = json!("human:local");
    });
    let flagged = variant(4, &|body| body["flags"] = json!(["instruction-like"]));
    let alternative = variant(5, &|body| {
        body["conflictSet"] = json!(format!("k-{}", "a".repeat(20)))
    });
    let unlisted = variant(6, &|body| body["drafter"]["instance"] = json!("scribe"));

    let result = auto(&fx).await;
    // The faithful draft holds; each variant is refused for what makes it one.
    assert_eq!(applied(&result), std::slice::from_ref(&id), "{result}");
    assert_eq!(skipped(&result, &memory), "memory");
    assert_eq!(skipped(&result, &derived), "memory");
    assert_eq!(skipped(&result, &promoted), "memory");
    assert_eq!(skipped(&result, &flagged), "flagged");
    assert_eq!(skipped(&result, &alternative), "alternative");
    assert_eq!(skipped(&result, &unlisted), "drafter-not-listed");
    for variant in [
        &memory,
        &derived,
        &promoted,
        &flagged,
        &alternative,
        &unlisted,
    ] {
        assert_eq!(state(&fx, variant), "pending", "{variant}");
    }
}

// ── The successor ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_successor_must_resolve_and_not_be_deprecated() {
    // Deprecated since the draft.
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    fx.handbook(
        "new.md",
        &NEW.replace("type: runbook\n", "type: runbook\nstatus: deprecated\n"),
    );
    fx.refresh("main").await;
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "successor-deprecated", "{result}");
    untouched(&fx, &id, DECLARED);

    // Gone since the draft.
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    fx.remove("spaces/main/handbook/new.md");
    fx.refresh("main").await;
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "successor-missing", "{result}");
    untouched(&fx, &id, DECLARED);

    // A declaration that resolves to no document of the space: an address outside it.
    let fx = fixture(RULE).await;
    approved_update(
        &fx,
        "declare",
        "handbook/old",
        &DECLARED.replace("handbook/new", "https://example.com/new"),
    )
    .await;
    let base = hash_of(&fx, "handbook/old").await;
    let (result, _) = drafter::submit(
        &fx,
        json!([{
            "idempotency_key": "d1",
            "change": { "op": "deprecate", "doc": "handbook/old", "baseHash": base, "supersededBy": "https://example.com/new" },
            "rationale": "It names a successor.",
            "evidence": [{ "kind": "document", "ref": "handbook/old", "contentHash": base }],
        }]),
        None,
    )
    .await;
    let id = item(data(&result), "results", 0)["proposal"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "successor-missing", "{result}");
    assert_eq!(state(&fx, &id), "pending");
}

#[tokio::test]
async fn the_successor_must_be_readable_by_the_caller_and_by_every_reader_of_the_target() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    // The draft cites the target, as the successor will be one the drafter cannot read.
    let id = draft_citing(&fx, "d1", "handbook/old").await;
    fx.handbook(
        "new.md",
        &NEW.replace(
            "type: runbook\n",
            "type: runbook\naccess: [group:platform]\n",
        ),
    );
    fx.refresh("main").await;
    // `human:local` cannot read it: absent and unreadable are one answer.
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "successor-missing", "{result}");
    // `human:ada`, of `platform`, reads it, but the target's readers (`space`) could not.
    let result = auto_as(&fx, member()).await;
    assert_eq!(skipped(&result, &id), "successor-narrower", "{result}");
    untouched(&fx, &id, DECLARED);
}

// ── The area ────────────────────────────────────────────────────────────────────────────────

#[test]
fn an_area_cannot_list_more_than_the_one_rule() {
    for extra in [
        "auto = [\"deprecate-declared\", \"create\"]\n",
        "auto = [\"verify-declared\"]\n",
        "auto = [\"*\"]\n",
        "auto = [\"deprecate-declared\", \"deprecate-declared\"]\n",
        "auto = \"deprecate-declared\"\n",
        "auto = [\"deprecate-declared\"]\nauto_ops = [\"create\", \"update\"]\n",
    ] {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), config(extra)).unwrap();
        for root in ["main/handbook", "main/code", "beta/notes"] {
            std::fs::create_dir_all(dir.path().join("spaces").join(root)).unwrap();
        }
        let sealed = support::plugins(umbel::HostBuilder::open(dir.path()).unwrap(), true).seal();
        let error = sealed
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default();
        assert!(error.contains("PLUGIN_CONFIG_INVALID"), "{extra}: {error}");
    }
}

#[tokio::test]
async fn the_area_that_lists_the_rule_must_still_govern_the_document() {
    let mut fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    // A more specific area, which lists no rule, now governs the document.
    let narrower = "\n[plugins.knowledge.config.areas.old-pages]\nspace = \"main\"\ncollection = \"handbook\"\nprefix = \"old\"\n";
    fx.reopen(&format!("{}{narrower}", config(RULE)));
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "area-changed", "{result}");
    untouched(&fx, &id, DECLARED);
    // The recorded area no longer lists the rule: the proposal is not even considered.
    fx.reopen(&config(""));
    let result = auto(&fx).await;
    assert_eq!(data(&result)["counts"]["examined"], 0, "{result}");
    untouched(&fx, &id, DECLARED);
}

#[tokio::test]
async fn the_caller_must_be_one_of_the_areas_approvers() {
    let fx = fixture(&format!("{RULE}approvers = [\"principal:human:local\"]\n")).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    let result = auto_as(&fx, member()).await;
    assert_eq!(skipped(&result, &id), "not-approver", "{result}");
    untouched(&fx, &id, DECLARED);
    let result = auto(&fx).await;
    assert_eq!(applied(&result), [id], "{result}");
}

// ── Who runs it ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn no_pipeline_and_no_agent_runs_the_rule() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    // A step of the curator's pipeline, listed in drafters, and of an unlisted instance's.
    for pipeline in ["curator-auto", "scribe-auto"] {
        let (result, _) = drafter::run(&fx, pipeline, json!({})).await;
        assert_eq!(
            code(&result),
            "PROPOSAL_AUTO_NOT_ALLOWED",
            "{pipeline}: {result}"
        );
        untouched(&fx, &id, DECLARED);
    }
    // An agent on the command line's interface, as a library could call it.
    let result = auto_as(&fx, agent("x")).await;
    assert_eq!(code(&result), "PROPOSAL_AUTO_NOT_ALLOWED", "{result}");
    assert_eq!(result["error"]["details"]["reason"], "not-a-person");
    // Over MCP it is not exposed, to anyone.
    for actor in [human("local"), agent("x")] {
        let result = fx.as_actor(actor, COMMAND, json!({})).await;
        assert_eq!(result["success"], false, "{result}");
    }
    untouched(&fx, &id, DECLARED);

    // The manifest: the command line only, a prompt but no person-only confirmation (a policy
    // decides, so cron runs it with --yes), no AFD approval, digest-journaled.
    let manifest: toml::Table = umbel_plugin_knowledge::MANIFEST.parse().unwrap();
    let command = manifest["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|command| command["name"].as_str() == Some(COMMAND))
        .unwrap();
    assert_eq!(command["expose"]["mcp"].as_bool(), Some(false));
    assert_eq!(command["expose"]["agent"].as_bool(), Some(false));
    assert_eq!(command["expose"]["cli"].as_bool(), Some(true));
    assert!(command.get("confirm_prompt").is_some());
    assert!(command.get("confirm").is_none());
    assert!(command.get("approval").is_none());
    assert_eq!(command["journal"]["mode"].as_str(), Some("digest"));
}

#[tokio::test]
async fn its_prompt_is_asked_at_a_terminal_and_yes_answers_it_off_one() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    // No terminal and no --yes: nothing runs.
    let (_, value) = fx
        .command_line(Terminal::new(false, false), &["call", COMMAND, "{}"])
        .await;
    assert_eq!(code(&value), "CONFIRMATION_REQUIRED", "{value}");
    // A person who answers no.
    let console = Terminal::new(true, false);
    let (_, value) = fx
        .command_line(console.clone(), &["call", COMMAND, "{}"])
        .await;
    assert_eq!(value["success"], false, "{value}");
    assert_eq!(console.asked().len(), 1);
    untouched(&fx, &id, DECLARED);
    // Cron, with --yes.
    let (code, value) = fx
        .command_line(
            Terminal::new(false, false),
            &["call", COMMAND, "{}", "--yes"],
        )
        .await;
    assert_eq!(code, 0, "{value}");
    assert_eq!(applied(&value), [id], "{value}");
}

#[tokio::test]
async fn a_call_applies_at_most_its_limit_and_says_more_remain() {
    let fx = fixture(RULE).await;
    fx.handbook("older.md", &OLD.replace("Old rollback", "Older rollback"));
    fx.refresh("main").await;
    declare(&fx).await;
    approved_update(
        &fx,
        "declare-older",
        "handbook/older",
        &DECLARED.replace("Old rollback", "Older rollback"),
    )
    .await;
    let first = draft(&fx).await;
    let second = draft_of(&fx, "d2", "handbook/older", "handbook/new").await;
    let result = fx.cli(COMMAND, json!({ "limit": 1 })).await;
    assert_eq!(applied(&result).len(), 1, "{result}");
    assert_eq!(data(&result)["more"], true, "{result}");
    let result = fx.cli(COMMAND, json!({ "limit": 1 })).await;
    assert_eq!(applied(&result).len(), 1, "{result}");
    assert_eq!(data(&result)["more"], false, "{result}");
    for id in [&first, &second] {
        assert_eq!(state(&fx, id), "applied", "{id}");
    }
    // The input is closed: nothing a caller sends names another rule or op.
    let widened = fx
        .cli(COMMAND, json!({ "rule": "create", "ops": ["create"] }))
        .await;
    assert_eq!(code(&widened), "VALIDATION_ERROR", "{widened}");
}

// ── Races ───────────────────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_calls_at_once_apply_the_draft_once() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    let (first, second) = tokio::join!(auto(&fx), auto(&fx));
    let total = applied(&first).len() + applied(&second).len();
    assert_eq!(total, 1, "{first}\n{second}");
    assert_eq!(state(&fx, &id), "applied");
    assert_eq!(
        file(&fx, "old.md")
            .matches("status: \"deprecated\"")
            .count(),
        1
    );
}

/// The draft as a policy decision left it when its apply stopped: approved, not applied.
fn stopped(fx: &Fx, id: &str, by: Value, channel: &str, rule: &str) {
    let mut body = records::read(fx, id).body;
    body["state"] = json!("approved");
    body["decision"] = json!({
        "by": by, "principal": "human:local", "at": "2026-01-01T00:00:00.000Z",
        "traceId": "0a1b2c3d4e5f60718293a4b5c6d7e8f9", "proposerKind": "human", "channel": channel,
    });
    body["policy"]["rule"] = json!(rule);
    records::assert_valid("proposal.v2", &body);
    records::overwrite(fx, &body);
}

#[tokio::test]
async fn a_stopped_policy_apply_resumes_only_when_the_rule_holds_again() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    stopped(
        &fx,
        &id,
        json!({ "kind": "service", "id": "policy:handbook" }),
        "policy",
        "auto:deprecate-declared",
    );
    // The file was changed by whoever won the race: the rule does not hold, nothing is written.
    let edited = format!("{DECLARED}\nThe writer that won.\n");
    fx.handbook("old.md", &edited);
    let result = auto(&fx).await;
    assert_eq!(skipped(&result, &id), "bytes-changed", "{result}");
    assert_eq!(state(&fx, &id), "approved");
    assert_eq!(file(&fx, "old.md"), edited);
    // The checked bytes again: resumed, keeping the policy's first decision.
    fx.handbook("old.md", DECLARED);
    let result = auto(&fx).await;
    assert_eq!(applied(&result), std::slice::from_ref(&id), "{result}");
    let body = records::read(&fx, &id).body;
    records::assert_valid("proposal.v2", &body);
    assert_eq!(body["state"], "applied");
    assert_eq!(body["decision"]["at"], "2026-01-01T00:00:00.000Z");
    assert_eq!(body["decision"]["channel"], "policy");
}

#[tokio::test]
async fn a_persons_stopped_approval_is_the_persons_to_resume() {
    let fx = fixture(RULE).await;
    declare(&fx).await;
    let id = draft(&fx).await;
    stopped(
        &fx,
        &id,
        json!({ "kind": "human", "id": "local" }),
        "terminal",
        "person",
    );
    let result = auto(&fx).await;
    assert_eq!(data(&result)["counts"]["examined"], 0, "{result}");
    assert_eq!(state(&fx, &id), "approved");
    assert_eq!(file(&fx, "old.md"), DECLARED);
}
