//! Standing (records host specification, sections 6 and 15.2; D160 to D162): what gives a
//! record standing, and that nothing an agent's call claims or passes can.
//!
//! - **Affirmed** is written only inside a call that passed the person gate, by the space's one
//!   configured person: at a terminal with and without the confirmed mark, as
//!   `tests/require_human.rs` does it; under another command's mark; through `Services::call`,
//!   which names no command; as a step of a batch and of a pipeline; and by a caller who is not
//!   the space's person.
//! - **The person's own**: each of a mark's four checks, a collection that became
//!   command-writable after a mark, and a document that no longer equals its file on disk.
//! - **Attested** is computed at each read and never stored: it lapses when the cited document
//!   changes, when the collection stops being own and when a mark is withdrawn.
//! - **The label** never uses a tier of verified knowledge; a reader who cannot read the cited
//!   document sees how it is the person's own and nothing else; and a call for verified content
//!   is given at most what the space's `verified_admits` names, whatever `standings` it passes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandResult};
use serde_json::{Value, json};
use std::path::Path;
use support::plugins::{metadata, seal};
use support::standing::{config, file, manifest, plugin, plugin_with, workspace};
use support::{Run, Scripted, agent, call, cli_with};
use umbel::{Host, HostBuilder};

const ROSES: &str = "Prune roses in late winter, before the buds swell.";
const SUN: &str = "Roses want morning sun.";
const MULCH: &str = "Mulch the roses in autumn.";
const PERSON: &str = "person = \"human:local\"";

fn configure(builder: HostBuilder) -> HostBuilder {
    builder.with_compiled(plugin())
}

fn host(dir: &Path) -> Host {
    seal(dir, configure).unwrap()
}

/// The garden's person is the CLI's caller; the orchard has none.
fn garden() -> tempfile::TempDir {
    workspace(&config(PERSON, "", ""))
}

fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
}

fn result(outcome: &CommandResult<Value>) -> Value {
    assert!(outcome.success, "{outcome:?}");
    outcome.data.clone().unwrap()["result"].clone()
}

fn refusal(outcome: &CommandResult<Value>) -> String {
    assert!(!outcome.success, "expected a failure: {outcome:?}");
    outcome.error.as_ref().unwrap().message.clone()
}

/// Run `op` of `command` in process, as `actor` through the library.
async fn run(
    host: &Host,
    actor: Actor,
    command: &str,
    op: &str,
    args: Value,
) -> CommandResult<Value> {
    call(host, actor, command, json!({ "op": op, "args": args })).await
}

/// Run `op` of `command` in a host of its own, as an agent, and answer its result.
async fn once(dir: &Path, command: &str, op: &str, args: Value) -> Value {
    let host = host(dir);
    result(&run(&host, agent("ada"), command, op, args).await)
}

/// Run `op` of `command` with the `umbel` command, in `space`, on `console`.
async fn cli(
    dir: &Path,
    command: &str,
    space: &str,
    op: &str,
    args: Value,
    console: std::sync::Arc<Scripted>,
) -> Run {
    let input = json!({ "space": space, "op": op, "args": args }).to_string();
    cli_with(dir, &["call", command, &input], console, configure).await
}

/// Run `op` of `notes-review` at a terminal, in the garden, answering its prompt with yes.
async fn review(dir: &Path, op: &str, args: Value) -> Run {
    cli(
        dir,
        "notes-review",
        "garden",
        op,
        args,
        Scripted::new(true, true),
    )
    .await
}

fn done(run: &Run) -> Value {
    assert_eq!(run.code, 0, "{}", run.stdout);
    run.json()["data"]["result"].clone()
}

fn refused(run: &Run) -> String {
    assert_ne!(run.code, 0, "expected a failure: {}", run.stdout);
    run.json()["error"]["message"].as_str().unwrap().to_owned()
}

/// The revisions a CLI call wrote, as its journal entry holds them.
fn changes(dir: &Path, command: &str) -> Value {
    let entries = support::journal_entries(dir);
    let entry = entries
        .iter()
        .rev()
        .find(|entry| entry.command == command)
        .unwrap_or_else(|| panic!("no journal entry of {command}"));
    entry
        .result
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.extra.get("dev.umbel/changes").cloned())
        .unwrap_or(Value::Null)
}

async fn put(dir: &Path, id: &str, statement: &str) {
    let body = json!({ "statement": statement, "bed": "north" });
    once(dir, "notes-write", "put", json!({ "id": id, "body": body })).await;
}

/// Store the document `<collection>/<name>` from the file the test wrote, as a sync would.
async fn sync(dir: &Path, collection: &str, name: &str, text: &str) -> String {
    file(dir, collection, name, text);
    let doc = format!("{collection}/{name}");
    let stored = once(
        dir,
        "notes-write",
        "sync",
        json!({ "doc": doc, "text": text }),
    )
    .await;
    stored["contentHash"].as_str().unwrap().to_owned()
}

async fn cite(dir: &Path, id: &str, statement: &str, doc: &str) {
    let body = json!({ "statement": statement, "bed": "north" });
    once(
        dir,
        "notes-write",
        "cite",
        json!({ "id": id, "body": body, "doc": doc }),
    )
    .await;
}

/// The record `id` as an agent reads it, with its label.
async fn record(dir: &Path, id: &str) -> Value {
    once(dir, "notes-read", "read", json!({ "id": id })).await
}

/// The label of `id`: one of the three standings, and no tier of verified knowledge anywhere
/// in it.
async fn label(dir: &Path, id: &str) -> Value {
    let label = record(dir, id).await["dev.umbel/standing"].clone();
    assert_no_tier(&label);
    label
}

async fn standing(dir: &Path, id: &str) -> String {
    label(dir, id).await["standing"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// A label says `unverified`, `attested` or `affirmed`, and no value in it is `machine`,
/// `human` or `owner`, the tiers of verified knowledge.
fn assert_no_tier(label: &Value) {
    assert!(
        matches!(
            label["standing"].as_str(),
            Some("unverified" | "attested" | "affirmed")
        ),
        "{label}"
    );
    fn walk(value: &Value, label: &Value) {
        match value {
            Value::String(text) => assert!(
                !matches!(text.as_str(), "machine" | "human" | "owner"),
                "a label names a tier of verified knowledge: {label}"
            ),
            Value::Array(items) => items.iter().for_each(|item| walk(item, label)),
            Value::Object(members) => members.iter().for_each(|(key, item)| {
                assert!(
                    !matches!(key.as_str(), "machine" | "human" | "owner" | "tier"),
                    "{label}"
                );
                walk(item, label);
            }),
            _ => {}
        }
    }
    walk(label, label);
}

fn sqlite(dir: &Path) -> rusqlite::Connection {
    rusqlite::Connection::open(dir.join("state/spaces/garden/store/store.sqlite3")).unwrap()
}

fn count(dir: &Path, sql: &str) -> i64 {
    sqlite(dir).query_row(sql, [], |row| row.get(0)).unwrap()
}

// ── Affirmed: section 6.1's four checks ─────────────────────────────────────────────────────────

#[tokio::test]
async fn at_a_terminal_the_spaces_person_affirms_and_withdraws() {
    let dir = garden();
    put(dir.path(), "n1", ROSES).await;
    assert_eq!(standing(dir.path(), "n1").await, "unverified");

    let console = Scripted::new(true, true);
    let affirmed = cli(
        dir.path(),
        "notes-review",
        "garden",
        "affirm",
        json!({ "id": "n1" }),
        console.clone(),
    )
    .await;
    let answered = done(&affirmed);
    assert_eq!(console.asked().len(), 1, "the person was asked once");
    assert_eq!(answered["standing"], "affirmed");
    assert_eq!(answered["affirmed"]["by"], "human:local");
    assert_eq!(
        answered["affirmed"]["assurance"],
        json!({ "level": "terminal", "method": "cli-terminal" })
    );
    assert_eq!(answered["source"], Value::Null);
    assert_no_tier(&answered);
    // The decision is one revision, noted for the call as every store write is.
    assert_eq!(
        changes(dir.path(), "notes-review"),
        json!({ "fromRev": 2, "toRev": 2, "count": 1 })
    );
    // Every reader of the record reads it affirmed. Who affirmed it, and how they were
    // proven beyond the level, is shown to the operator and to the space's person, and to no
    // other reader of the record: by id and in a find.
    let read = label(dir.path(), "n1").await;
    assert_eq!(read["standing"], "affirmed");
    assert_eq!(
        read["affirmed"],
        json!({ "by": null, "at": answered["affirmed"]["at"], "assurance": { "level": "terminal" } })
    );
    let found = once(dir.path(), "notes-read", "find", json!({})).await;
    assert_eq!(found["items"][0]["dev.umbel/standing"], read);
    assert!(!read.to_string().contains("human:local"), "{read}");
    for op in ["read", "find"] {
        let by_person = cli(
            dir.path(),
            "notes-read",
            "garden",
            op,
            json!({ "id": "n1" }),
            Scripted::no_terminal(),
        )
        .await;
        let shown = done(&by_person);
        let shown = if op == "find" {
            shown["items"][0]["dev.umbel/standing"].clone()
        } else {
            shown["dev.umbel/standing"].clone()
        };
        assert_eq!(
            shown, answered,
            "{op}: the person and the operator see all of it"
        );
    }
    // The decision row holds the wording decided on, the person and the assurance.
    let row: (String, String, String, String) = sqlite(dir.path())
        .query_row(
            "SELECT d.decision, d.by, d.assurance, d.wording_hash = l.wording_hash
             FROM record_decisions d JOIN record_lane l ON l.affirmed_seq = d.seq",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get::<_, bool>(3)?.to_string(),
                ))
            },
        )
        .unwrap();
    assert_eq!(
        row,
        (
            "affirm".to_owned(),
            "human:local".to_owned(),
            r#"{"level":"terminal","method":"cli-terminal"}"#.to_owned(),
            "true".to_owned()
        )
    );

    // Affirmed again, it writes nothing and notes nothing.
    let again = review(dir.path(), "affirm", json!({ "id": "n1" })).await;
    assert_eq!(done(&again), answered);
    assert_eq!(changes(dir.path(), "notes-review"), Value::Null);
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        1
    );

    // Withdrawn, and withdrawn again.
    let withdrawn = review(dir.path(), "withdraw", json!({ "id": "n1" })).await;
    assert_eq!(
        done(&withdrawn),
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    assert_eq!(
        changes(dir.path(), "notes-review"),
        json!({ "fromRev": 3, "toRev": 3, "count": 1 })
    );
    let again = review(dir.path(), "withdraw", json!({ "id": "n1" })).await;
    assert_eq!(done(&again)["standing"], "unverified");
    assert_eq!(changes(dir.path(), "notes-review"), Value::Null);
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        2
    );

    // A put inside the call a person decided is the person's (section 4.2's table, first
    // row), whatever the plugin claims; the same put from a command nobody decided is not.
    let body = json!({ "statement": SUN, "bed": "east" });
    let by_person = review(
        dir.path(),
        "put",
        json!({ "id": "n2", "body": body, "authority": "agent" }),
    )
    .await;
    done(&by_person);
    assert_eq!(
        record(dir.path(), "n2").await["envelope"]["authority"],
        "person"
    );
    let plain = cli(
        dir.path(),
        "notes-write",
        "garden",
        "put",
        json!({ "id": "n3", "body": { "statement": MULCH }, "authority": "person" }),
        Scripted::new(true, true),
    )
    .await;
    done(&plain);
    assert_eq!(
        record(dir.path(), "n3").await["envelope"]["authority"],
        "tool"
    );
}

#[tokio::test]
async fn without_the_confirmed_mark_nothing_is_affirmed() {
    let dir = garden();
    put(dir.path(), "n1", ROSES).await;
    let affirm = json!({ "id": "n1" });
    // No terminal; a terminal and `--yes` or `--approve`; a terminal whose person says no.
    let no_terminal = cli(
        dir.path(),
        "notes-review",
        "garden",
        "affirm",
        affirm.clone(),
        Scripted::no_terminal(),
    )
    .await;
    assert_eq!(no_terminal.error_code(), "CONFIRMATION_REQUIRED");
    let input = json!({ "op": "affirm", "args": affirm }).to_string();
    for flag in ["--yes", "--approve"] {
        let flagged = cli_with(
            dir.path(),
            &["call", "notes-review", &input, flag],
            Scripted::new(true, true),
            configure,
        )
        .await;
        assert_eq!(flagged.error_code(), "CONFIRMATION_REQUIRED", "{flag}");
    }
    let declined = cli(
        dir.path(),
        "notes-review",
        "garden",
        "affirm",
        affirm.clone(),
        Scripted::new(true, false),
    )
    .await;
    assert_eq!(declined.error_code(), "CONFIRMATION_DECLINED");
    // In process: an agent, the space's own person through the library, and a caller that
    // says it is the CLI and never went through the prompt.
    let host = host(dir.path());
    for actor in [agent("ada"), human("local")] {
        let outcome = run(&host, actor, "notes-review", "affirm", affirm.clone()).await;
        assert_eq!(outcome.error.unwrap().code, "CONFIRMATION_REQUIRED");
    }
    let mut context = host.context(human("local"));
    context.interface = Some(afd::CommandInterface::Cli);
    let unmarked = host
        .registry()
        .execute(
            "notes-review",
            json!({ "op": "affirm", "args": affirm }),
            Some(context),
        )
        .await;
    assert_eq!(unmarked.error.unwrap().code, "CONFIRMATION_REQUIRED");
    drop(host);
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );
    assert_eq!(
        count(
            dir.path(),
            "SELECT COUNT(*) FROM record_lane WHERE affirmed_seq IS NOT NULL"
        ),
        0
    );
}

#[tokio::test]
async fn a_command_no_person_decides_cannot_decide_whoever_calls_it() {
    let dir = garden();
    put(dir.path(), "n1", ROSES).await;
    file(dir.path(), "talks", "pruning", ROSES);
    once(
        dir.path(),
        "notes-write",
        "sync",
        json!({ "doc": "talks/pruning", "text": ROSES }),
    )
    .await;
    let host = host(dir.path());
    // An agent, the space's person through the library, and a body or an input that claims.
    for actor in [agent("ada"), human("local")] {
        for (op, args) in [
            ("affirm", json!({ "id": "n1" })),
            (
                "affirm",
                json!({ "id": "n1", "confirmed": true, "person": "human:local", "standing": "affirmed" }),
            ),
            ("withdraw", json!({ "id": "n1" })),
            ("mark", json!({ "doc": "talks/pruning" })),
            ("unmark", json!({ "doc": "talks/pruning" })),
        ] {
            let outcome = run(&host, actor.clone(), "notes-write", op, args).await;
            let message = refusal(&outcome);
            assert_eq!(outcome.error.as_ref().unwrap().code, "NOT_GRANTED", "{op}");
            assert!(
                message.contains("RECORD_DECISION_NOT_GATED: a decision on standing is made only inside a call a person decided"),
                "{op}: {message}"
            );
        }
    }
    // An embedder that forges all the CLI would set for a person who answered a prompt of
    // this command (its principal, its interface and both of its marks) still has no proof:
    // the proof is for a `require-human` command of the instance. No real call carries these
    // marks for such a command: the CLI sets the confirmed mark only for a `require-human`
    // command, or after an authority prompt, which a plugin that declares a record kind
    // cannot have (`memory_write` excludes `records_write`).
    let mut forged = host.context(human("local"));
    forged.interface = Some(afd::CommandInterface::Cli);
    let cli_principal = umbel::principal::Principal::new(
        human("local"),
        umbel::principal::Transport::Cli,
        umbel::principal::Authentication::Process,
    );
    forged.actor = Some(human("local"));
    forged.extra.insert(
        umbel::principal::PRINCIPAL_KEY.to_owned(),
        cli_principal.to_value(),
    );
    forged
        .extra
        .insert("dev.umbel/human-confirmed".into(), json!("notes-write"));
    forged
        .extra
        .insert("dev.umbel/human-present".into(), json!("notes-write"));
    let outcome = host
        .registry()
        .execute(
            "notes-write",
            json!({ "op": "affirm", "args": { "id": "n1" } }),
            Some(forged),
        )
        .await;
    assert!(refusal(&outcome).contains("RECORD_DECISION_NOT_GATED"));
    drop(host);
    // At a terminal too: the person is present, and the command is not one a person decides.
    let at_terminal = cli(
        dir.path(),
        "notes-write",
        "garden",
        "affirm",
        json!({ "id": "n1" }),
        Scripted::new(true, true),
    )
    .await;
    assert!(refused(&at_terminal).contains("RECORD_DECISION_NOT_GATED"));
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_own"), 0);
}

#[tokio::test]
async fn a_nested_call_and_another_commands_name_get_no_proof() {
    let dir = garden();
    put(dir.path(), "n1", ROSES).await;
    file(dir.path(), "talks", "pruning", ROSES);
    once(
        dir.path(),
        "notes-write",
        "sync",
        json!({ "doc": "talks/pruning", "text": ROSES }),
    )
    .await;
    // The person confirms `notes-review` at a terminal. Its handler then asks the host for
    // services with no command (`Services::call`), and as another command a person decides.
    for via in ["nested", "other"] {
        for (op, args) in [
            ("affirm", json!({ "id": "n1", "via": via })),
            ("mark", json!({ "doc": "talks/pruning", "via": via })),
        ] {
            let console = Scripted::new(true, true);
            let asked = cli(
                dir.path(),
                "notes-review",
                "garden",
                op,
                args,
                console.clone(),
            )
            .await;
            assert_eq!(console.asked().len(), 1, "the person did confirm the call");
            let message = refused(&asked);
            assert!(
                message.contains("RECORD_DECISION_NOT_GATED"),
                "{via} {op}: {message}"
            );
        }
    }
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_own"), 0);
    // A put made that way is not the person's either.
    let body = json!({ "statement": SUN, "bed": "east" });
    let nested = review(
        dir.path(),
        "put",
        json!({ "id": "n2", "body": body, "via": "nested", "authority": "person" }),
    )
    .await;
    done(&nested);
    assert_eq!(
        record(dir.path(), "n2").await["envelope"]["authority"],
        "tool"
    );
    // The same call as the command it is does decide: the refusals above were the proof's.
    assert_eq!(
        done(&review(dir.path(), "affirm", json!({ "id": "n1" })).await)["standing"],
        "affirmed"
    );
}

#[tokio::test]
async fn a_batch_step_and_a_pipeline_step_get_no_proof() {
    let dir = garden();
    put(dir.path(), "n1", ROSES).await;
    let step = |command: &str| json!({ "command": command, "input": { "op": "affirm", "args": { "id": "n1" } } });
    // A batch at a terminal: the gated command is refused before its handler, with or without
    // a context that claims the confirmation, and the ungated one has no proof.
    for request in [
        json!({ "commands": [step("notes-review")] }),
        json!({ "commands": [step("notes-review")], "context": { "dev.umbel/human-confirmed": "notes-review" } }),
    ] {
        let batch = cli_with(
            dir.path(),
            &["batch", &request.to_string()],
            Scripted::new(true, true),
            configure,
        )
        .await;
        assert_eq!(
            batch.json()["results"][0]["result"]["error"]["code"],
            "CONFIRMATION_REQUIRED",
            "{}",
            batch.stdout
        );
    }
    let request = json!({ "commands": [step("notes-write")], "context": { "dev.umbel/human-confirmed": "notes-write" } });
    let batch = cli_with(
        dir.path(),
        &["batch", &request.to_string()],
        Scripted::new(true, true),
        configure,
    )
    .await;
    let message = batch.json()["results"][0]["result"]["error"]["message"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        message.contains("RECORD_DECISION_NOT_GATED"),
        "{}",
        batch.stdout
    );

    // A pipeline whose step is the gated command, confirmed at a terminal: the confirmation
    // is the pipeline's, so its step has none under its own name.
    let console = Scripted::new(true, true);
    let piped = cli(
        dir.path(),
        "notes-pipe",
        "garden",
        "affirm",
        json!({ "id": "n1" }),
        console.clone(),
    )
    .await;
    assert_ne!(piped.code, 0, "{}", piped.stdout);
    assert_eq!(
        piped.error_code(),
        "CONFIRMATION_REQUIRED",
        "{}",
        piped.stdout
    );
    // In process, as the space's person through the library.
    let host = host(dir.path());
    let outcome = run(
        &host,
        human("local"),
        "notes-pipe",
        "affirm",
        json!({ "id": "n1" }),
    )
    .await;
    assert_eq!(outcome.error.unwrap().code, "CONFIRMATION_REQUIRED");
    drop(host);
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );
}

#[tokio::test]
async fn only_the_spaces_person_decides() {
    // The CLI's caller is `human:rowan`: the orchard's person, and not the garden's.
    let dir = workspace(&config(
        PERSON,
        "person = \"human:rowan\"",
        "\n[principal]\nlocal_id = \"rowan\"\n",
    ));
    put(dir.path(), "n1", ROSES).await;
    let host = host(dir.path());
    let body = json!({ "statement": SUN, "bed": "row-1" });
    result(
        &call(
            &host,
            agent("ada"),
            "notes-write",
            json!({ "space": "orchard", "op": "put", "args": { "id": "o1", "body": body } }),
        )
        .await,
    );
    drop(host);
    let console = Scripted::new(true, true);
    let elsewhere = cli(
        dir.path(),
        "notes-review",
        "garden",
        "affirm",
        json!({ "id": "n1" }),
        console.clone(),
    )
    .await;
    assert_eq!(console.asked().len(), 1, "a person did confirm the call");
    let message = refused(&elsewhere);
    assert!(
        message.contains(
            "RECORD_DECISION_NOT_THE_PERSON: only the space's person decides standing here"
        ),
        "{message}"
    );
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    let own = cli(
        dir.path(),
        "notes-review",
        "orchard",
        "affirm",
        json!({ "id": "o1" }),
        Scripted::new(true, true),
    )
    .await;
    assert_eq!(done(&own)["affirmed"]["by"], "human:rowan");

    // A space with no person: nobody decides there, the CLI's caller included.
    let dir = workspace(&config("", "", "").replace("own = true\n", ""));
    put(dir.path(), "n1", ROSES).await;
    file(dir.path(), "talks", "pruning", ROSES);
    once(
        dir.path(),
        "notes-write",
        "sync",
        json!({ "doc": "talks/pruning", "text": ROSES }),
    )
    .await;
    for (op, args) in [
        ("affirm", json!({ "id": "n1" })),
        ("mark", json!({ "doc": "talks/pruning" })),
        ("unmark", json!({ "doc": "talks/pruning" })),
    ] {
        let message = refused(&review(dir.path(), op, args).await);
        assert!(
            message.contains("RECORD_DECISION_NOT_THE_PERSON"),
            "{op}: {message}"
        );
    }
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_own"), 0);
}

#[tokio::test]
async fn a_decision_reaches_only_a_record_the_person_may_read() {
    // Records are private to their writer here, so the agent's is not the person's to read.
    let private = config(PERSON, "", "").replace("default_access = \"space\"", "");
    let dir = workspace(&private);
    put(dir.path(), "n1", ROSES).await;
    for id in ["n1", "absent"] {
        let hidden = review(dir.path(), "affirm", json!({ "id": id })).await;
        assert_eq!(hidden.error_code(), "NOT_FOUND", "{id}: {}", hidden.stdout);
    }
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );
    // The person's own record is theirs to affirm.
    let body = json!({ "statement": SUN, "bed": "east" });
    done(&review(dir.path(), "put", json!({ "id": "mine", "body": body })).await);
    assert_eq!(
        done(&review(dir.path(), "affirm", json!({ "id": "mine" })).await)["standing"],
        "affirmed"
    );
    // A decision on a kind without standing, and on one the manifest does not declare.
    for kind in ["bed", "seed"] {
        let message =
            refused(&review(dir.path(), "affirm", json!({ "kind": kind, "id": "x" })).await);
        assert!(
            message.contains(&format!(
                "RECORD_KIND_NOT_STANDING: {kind} is not a standing kind"
            )),
            "{message}"
        );
    }
}

// ── The person's own: section 6.2's marks ───────────────────────────────────────────────────────

#[tokio::test]
async fn a_person_marks_a_synced_document_and_unmarks_it() {
    let dir = garden();
    let hash = sync(dir.path(), "talks", "pruning", ROSES).await;
    cite(dir.path(), "n1", ROSES, "talks/pruning").await;
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    assert_eq!(
        once(
            dir.path(),
            "notes-read",
            "own",
            json!({ "doc": "talks/pruning" })
        )
        .await,
        Value::Null
    );

    let marked = review(
        dir.path(),
        "mark",
        json!({ "doc": "talks/pruning", "hash": hash }),
    )
    .await;
    let rev = done(&marked)["rev"].as_u64().unwrap();
    assert_eq!(
        changes(dir.path(), "notes-review"),
        json!({ "fromRev": rev, "toRev": rev, "count": 1 })
    );
    // Every record that cites it word for word reads attested at once, with nothing written
    // to the record.
    let attested = label(dir.path(), "n1").await;
    assert_eq!(attested["standing"], "attested");
    assert_eq!(attested["affirmed"], Value::Null);
    assert_eq!(attested["source"]["basis"], "marked");
    assert_eq!(attested["source"]["doc"], "talks/pruning");
    assert_eq!(attested["source"]["contentHash"], json!(hash));
    assert_eq!(attested["source"]["units"], json!([1]));
    assert_eq!(attested["source"]["rule"], "sentences/1");
    assert!(attested["source"]["storedAt"].is_string());
    assert_eq!(attested["source"]["generatedAt"], Value::Null);
    let own = once(
        dir.path(),
        "notes-read",
        "own",
        json!({ "doc": "talks/pruning" }),
    )
    .await;
    assert_eq!(own["basis"], "marked");
    assert_eq!(own["contentHash"], json!(hash));
    // The mark holds who made it and how.
    let row: (String, String) = sqlite(dir.path())
        .query_row("SELECT by, assurance FROM doc_own", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(
        row,
        (
            "human:local".to_owned(),
            r#"{"level":"terminal","method":"cli-terminal"}"#.to_owned()
        )
    );
    // Marked again, it answers the stored revision and notes nothing.
    let again = review(dir.path(), "mark", json!({ "doc": "talks/pruning" })).await;
    assert_eq!(done(&again)["rev"], rev);
    assert_eq!(changes(dir.path(), "notes-review"), Value::Null);
    // A mark is of the content the person was shown. The document changes: the mark no
    // longer matches, so it is not the person's own, whatever cites its new content.
    let longer = format!("{ROSES} Mulch after.");
    let second = sync(dir.path(), "talks", "pruning", &longer).await;
    assert_eq!(
        once(
            dir.path(),
            "notes-read",
            "own",
            json!({ "doc": "talks/pruning" })
        )
        .await,
        Value::Null
    );
    cite(dir.path(), "n1", ROSES, "talks/pruning").await;
    assert_eq!(
        label(dir.path(), "n1").await,
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    // Marked on its new content, it is the person's own again.
    let remarked = review(
        dir.path(),
        "mark",
        json!({ "doc": "talks/pruning", "hash": second }),
    )
    .await;
    let rev = done(&remarked)["rev"].as_u64().unwrap();
    assert_eq!(
        label(dir.path(), "n1").await["source"]["contentHash"],
        json!(second)
    );
    // A mark that is withdrawn lapses what rested on it.
    let unmarked = review(dir.path(), "unmark", json!({ "doc": "talks/pruning" })).await;
    assert_eq!(done(&unmarked)["rev"], rev + 1);
    assert_eq!(
        changes(dir.path(), "notes-review"),
        json!({ "fromRev": rev + 1, "toRev": rev + 1, "count": 1 })
    );
    assert_eq!(
        label(dir.path(), "n1").await,
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    let again = review(dir.path(), "unmark", json!({ "doc": "talks/pruning" })).await;
    assert_eq!(again.error_code(), "NOT_FOUND");
}

#[tokio::test]
async fn each_of_a_marks_four_checks_refuses() {
    // The wiki is where a proposal's page is written: a command can write files there.
    let dir = workspace(&config(
        PERSON,
        "",
        "\n[plugins.notes.grants.content_write]\nallow = [\"garden/wiki\"]\n\n[access.groups.growers]\nmembers = [\"human:bo\"]\n",
    ));
    let hash = sync(dir.path(), "talks", "pruning", ROSES).await;
    let other = sync(dir.path(), "talks", "sun", SUN).await;
    // 1. Readable by the caller: an absent document and one the person may not read, alike.
    file(dir.path(), "talks", "private", MULCH);
    once(
        dir.path(),
        "notes-write",
        "sync",
        json!({ "doc": "talks/private", "text": MULCH, "access": "group:growers" }),
    )
    .await;
    for doc in ["talks/absent", "talks/private"] {
        let hidden = review(dir.path(), "mark", json!({ "doc": doc, "hash": hash })).await;
        assert_eq!(hidden.error_code(), "NOT_FOUND", "{doc}: {}", hidden.stdout);
    }
    // 2. The content hash the person was shown.
    let stale = review(
        dir.path(),
        "mark",
        json!({ "doc": "talks/pruning", "hash": other }),
    )
    .await;
    assert_eq!(stale.error_code(), "CONFLICT", "{}", stale.stdout);
    assert!(
        refused(&stale).contains(&hash),
        "the conflict names the content it has"
    );
    // 3. No command writes files where it lies: a page an approved proposal wrote, which is
    // its file on disk and still not the person's to mark.
    let host = host(dir.path());
    result(
        &run(
            &host,
            agent("ada"),
            "notes-write",
            "replace",
            json!({ "collection": "wiki", "path": "pruning.md", "text": ROSES }),
        )
        .await,
    );
    result(
        &run(
            &host,
            agent("ada"),
            "notes-write",
            "sync",
            json!({ "doc": "wiki/pruning", "text": ROSES }),
        )
        .await,
    );
    drop(host);
    let written = review(dir.path(), "mark", json!({ "doc": "wiki/pruning" })).await;
    let message = refused(&written);
    assert_eq!(written.error_code(), "NOT_GRANTED");
    assert!(
        message.contains("STORE_OWN_MARK_REFUSED: a document can be marked as the person's own only where no command writes files"),
        "{message}"
    );
    // 4. It equals its file on disk: a document a command stored with no file, and one whose
    // file changed after it was stored.
    once(
        dir.path(),
        "notes-write",
        "sync",
        json!({ "doc": "talks/unfiled", "text": MULCH }),
    )
    .await;
    std::fs::write(
        dir.path().join("content/talks/sun.md"),
        "Roses want afternoon shade.",
    )
    .unwrap();
    for doc in ["talks/unfiled", "talks/sun"] {
        let unequal = review(dir.path(), "mark", json!({ "doc": doc })).await;
        let message = refused(&unequal);
        assert_eq!(unequal.error_code(), "NOT_GRANTED", "{doc}");
        assert!(
            message.contains("STORE_OWN_MARK_REFUSED: a document can be marked as the person's own only when it equals its file on disk"),
            "{doc}: {message}"
        );
    }
    // A file reached through a symbolic link is not the collection's file.
    #[cfg(unix)]
    {
        std::fs::write(dir.path().join("content/elsewhere.md"), MULCH).unwrap();
        std::os::unix::fs::symlink(
            dir.path().join("content/elsewhere.md"),
            dir.path().join("content/talks/linked.md"),
        )
        .unwrap();
        once(
            dir.path(),
            "notes-write",
            "sync",
            json!({ "doc": "talks/linked", "text": MULCH }),
        )
        .await;
        let linked = review(dir.path(), "mark", json!({ "doc": "talks/linked" })).await;
        assert!(refused(&linked).contains("only when it equals its file on disk"));
    }
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM doc_own"),
        0,
        "nothing was marked"
    );
    // All four hold for the synced file.
    done(
        &review(
            dir.path(),
            "mark",
            json!({ "doc": "talks/pruning", "hash": hash }),
        )
        .await,
    );
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_own"), 1);
}

#[tokio::test]
async fn a_collection_that_becomes_command_writable_stops_its_marks_counting() {
    let dir = garden();
    sync(dir.path(), "talks", "pruning", ROSES).await;
    cite(dir.path(), "n1", ROSES, "talks/pruning").await;
    done(&review(dir.path(), "mark", json!({ "doc": "talks/pruning" })).await);
    assert_eq!(standing(dir.path(), "n1").await, "attested");
    // The deployer lets a command write files into the collection. Each host judges that at
    // its start, so the next host does not count the mark.
    let writable = config(
        &format!("{PERSON}\nverified_admits = \"affirmed+attested\""),
        "",
        "\n[plugins.notes.grants.content_write]\nallow = [\"garden/talks\"]\n",
    );
    std::fs::write(dir.path().join("umbel.toml"), writable).unwrap();
    assert_eq!(
        label(dir.path(), "n1").await,
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    assert_eq!(
        once(
            dir.path(),
            "notes-read",
            "own",
            json!({ "doc": "talks/pruning" })
        )
        .await,
        Value::Null
    );
    let verified = once(
        dir.path(),
        "notes-read",
        "find",
        json!({ "verifiedOnly": true }),
    )
    .await;
    assert_eq!(verified["ids"], json!([]), "nor is it verified content");
    // The mark was not deleted, and cannot be made again while a command writes there.
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_own"), 1);
    let again = review(
        dir.path(),
        "mark",
        json!({ "doc": "talks/pruning", "speaker": "Gardener" }),
    )
    .await;
    assert!(refused(&again).contains("only where no command writes files"));
    // The allow taken away again, the mark counts as it did.
    let plain = config(
        &format!("{PERSON}\nverified_admits = \"affirmed+attested\""),
        "",
        "",
    );
    std::fs::write(dir.path().join("umbel.toml"), plain).unwrap();
    assert_eq!(standing(dir.path(), "n1").await, "attested");
    let verified = once(
        dir.path(),
        "notes-read",
        "find",
        json!({ "verifiedOnly": true }),
    )
    .await;
    assert_eq!(verified["ids"], json!(["n1"]));
}

// ── Attested: computed at each read, never stored ───────────────────────────────────────────────

#[tokio::test]
async fn attested_lapses_when_the_document_changes_and_when_the_collection_stops_being_own() {
    let dir = garden();
    let first = sync(dir.path(), "journal", "roses", ROSES).await;
    cite(dir.path(), "n1", ROSES, "journal/roses").await;
    let attested = label(dir.path(), "n1").await;
    assert_eq!(attested["standing"], "attested");
    assert_eq!(attested["source"]["basis"], "collection");
    assert_eq!(attested["source"]["contentHash"], json!(first));
    // Nothing of it is stored on the record: the lane row holds no affirmation.
    assert_eq!(
        count(
            dir.path(),
            "SELECT COUNT(*) FROM record_lane WHERE affirmed_seq IS NOT NULL"
        ),
        0
    );
    let head = count(dir.path(), "SELECT MAX(rev) FROM changes");
    // The document changes: the evidence names the old content.
    let longer = format!("{ROSES} Mulch after.");
    let second = sync(dir.path(), "journal", "roses", &longer).await;
    assert_ne!(first, second);
    assert_eq!(
        label(dir.path(), "n1").await,
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    assert_eq!(
        count(dir.path(), "SELECT MAX(rev) FROM changes"),
        head + 1,
        "only the document's put was written: nothing was written to the record"
    );
    // The plugin cites the new content, and the record reads attested again.
    cite(dir.path(), "n1", ROSES, "journal/roses").await;
    let again = label(dir.path(), "n1").await;
    assert_eq!(again["standing"], "attested");
    assert_eq!(again["source"]["contentHash"], json!(second));
    // Evidence that does not say word for word attests nothing: the plugin's code found the
    // wording was not exactly the cited units, and said so.
    let body = json!({ "statement": SUN, "bed": "east" });
    once(
        dir.path(),
        "notes-write",
        "cite",
        json!({ "id": "loose", "body": body, "doc": "journal/roses", "verbatim": false }),
    )
    .await;
    assert_eq!(
        label(dir.path(), "loose").await,
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    // The deployer no longer names the collection as the person's own.
    let not_own = config(PERSON, "", "").replace("own = true\n", "");
    std::fs::write(dir.path().join("umbel.toml"), not_own).unwrap();
    assert_eq!(
        label(dir.path(), "n1").await,
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    // Nor does a speaker the evidence does not name.
    let spoken =
        config(PERSON, "", "").replace("own = true\n", "own = true\nspeaker = \"Gardener\"\n");
    std::fs::write(dir.path().join("umbel.toml"), spoken).unwrap();
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    std::fs::write(dir.path().join("umbel.toml"), config(PERSON, "", "")).unwrap();
    assert_eq!(standing(dir.path(), "n1").await, "attested");
}

#[tokio::test]
async fn evidence_must_cite_a_document_the_writer_reads_at_its_content() {
    let dir = workspace(&config(
        PERSON,
        "",
        "\n[access.groups.growers]\nmembers = [\"human:bo\"]\n",
    ));
    let hash = sync(dir.path(), "journal", "roses", ROSES).await;
    file(dir.path(), "journal", "private", MULCH);
    let hidden = once(
        dir.path(),
        "notes-write",
        "sync",
        json!({ "doc": "journal/private", "text": MULCH, "access": "group:growers" }),
    )
    .await;
    let host = host(dir.path());
    let body = json!({ "statement": ROSES, "bed": "north" });
    let cited =
        |doc: &str, hash: &str| json!({ "id": "n1", "body": body, "doc": doc, "hash": hash });
    // Absent, unreadable by the writer and another content hash: one answer, naming nothing.
    let mut refusals = Vec::new();
    for (doc, hash) in [
        ("journal/absent", hash.as_str()),
        ("journal/private", hidden["contentHash"].as_str().unwrap()),
        ("journal/roses", hidden["contentHash"].as_str().unwrap()),
    ] {
        let outcome = run(&host, agent("ada"), "notes-write", "cite", cited(doc, hash)).await;
        assert_eq!(outcome.error.as_ref().unwrap().code, "INVALID");
        let message = refusal(&outcome);
        assert!(
            message.contains("RECORD_EVIDENCE_INVALID: the evidence is not acceptable:"),
            "{message}"
        );
        assert!(
            !message.contains("journal/") && !message.contains("sha256:"),
            "{message}"
        );
        refusals.push(message);
    }
    assert!(
        refusals.iter().all(|message| *message == refusals[0]),
        "{refusals:?}"
    );
    // Its shape.
    let mut shaped = cited("journal/roses", &hash);
    shaped["units"] = json!([3, 2]);
    assert!(
        refusal(&run(&host, agent("ada"), "notes-write", "cite", shaped).await)
            .contains("RECORD_EVIDENCE_INVALID")
    );
    let mut ruled = cited("journal/roses", &hash);
    ruled["rule"] = json!("canary rule");
    let message = refusal(&run(&host, agent("ada"), "notes-write", "cite", ruled).await);
    assert!(
        message.contains("RECORD_EVIDENCE_INVALID") && !message.contains("canary"),
        "{message}"
    );
    // Nothing was written by a refused put.
    assert_eq!(
        result(
            &run(
                &host,
                agent("ada"),
                "notes-read",
                "read",
                json!({ "id": "n1" })
            )
            .await
        ),
        Value::Null
    );
    // A reader of the document may cite it: the same call by `human:bo`.
    let by_bo = run(
        &host,
        human("bo"),
        "notes-write",
        "cite",
        cited("journal/private", hidden["contentHash"].as_str().unwrap()),
    )
    .await;
    assert!(by_bo.success, "{by_bo:?}");
    // Evidence is for a standing kind of the instance.
    let bed = json!({ "kind": "bed", "id": "north", "body": { "name": "The north bed" }, "doc": "journal/roses", "hash": hash });
    assert!(
        refusal(&run(&host, agent("ada"), "notes-write", "cite", bed).await)
            .contains("RECORD_KIND_NOT_STANDING: bed is not a standing kind")
    );
    let seed =
        json!({ "kind": "seed", "id": "s", "body": {}, "doc": "journal/roses", "hash": hash });
    assert!(
        refusal(&run(&host, agent("ada"), "notes-write", "cite", seed).await)
            .contains("RECORD_KIND_NOT_DECLARED")
    );
}

// ── The label, and what a reader may see of a source ────────────────────────────────────────────

#[tokio::test]
async fn a_reader_who_cannot_read_the_cited_document_sees_the_basis_alone() {
    let dir = workspace(&config(
        &format!("{PERSON}\nverified_admits = \"affirmed+attested\""),
        "",
        "\n[access.groups.growers]\nmembers = [\"human:bo\"]\n",
    ));
    // `human:bo` reads the journal's private page; the agent does not. Both read the record.
    file(dir.path(), "journal", "private", ROSES);
    let host = host(dir.path());
    let synced = result(
        &run(
            &host,
            human("bo"),
            "notes-write",
            "sync",
            json!({ "doc": "journal/private", "text": ROSES, "access": "group:growers" }),
        )
        .await,
    );
    let hash = synced["contentHash"].as_str().unwrap().to_owned();
    let body = json!({ "statement": ROSES, "bed": "north" });
    result(&run(&host, human("bo"), "notes-write", "cite", json!({ "id": "n1", "body": body, "doc": "journal/private", "units": [4, 5], "rule": "sentences/9" })).await);
    result(
        &run(
            &host,
            agent("ada"),
            "notes-write",
            "put",
            json!({ "id": "n2", "body": { "statement": SUN, "bed": "east" } }),
        )
        .await,
    );
    let read = |actor: Actor, op: &'static str, args: Value| {
        let host = &host;
        async move { result(&run(host, actor, "notes-read", op, args).await) }
    };
    let hidden = read(agent("ada"), "read", json!({ "id": "n1" })).await;
    assert_eq!(
        hidden["dev.umbel/standing"],
        json!({
            "standing": "attested",
            "affirmed": null,
            "source": {
                "doc": null, "contentHash": null, "basis": "collection", "speaker": null,
                "units": null, "rule": null, "storedAt": null, "generatedAt": null,
            },
        })
    );
    assert_no_tier(&hidden["dev.umbel/standing"]);
    let text = hidden.to_string();
    for secret in ["journal/private", hash.as_str(), "sentences/9", "[4,5]"] {
        assert!(!text.contains(secret), "{secret} is shown: {text}");
    }
    // Its reader sees all of it.
    let seen =
        read(human("bo"), "read", json!({ "id": "n1" })).await["dev.umbel/standing"]["source"]
            .clone();
    assert_eq!(seen["doc"], "journal/private");
    assert_eq!(seen["contentHash"], json!(hash));
    assert_eq!(seen["units"], json!([4, 5]));
    assert_eq!(seen["rule"], "sentences/9");
    // `doc_own` says nothing of a document its caller may not read.
    assert_eq!(
        read(agent("ada"), "own", json!({ "doc": "journal/private" })).await,
        Value::Null
    );
    assert_eq!(
        read(human("bo"), "own", json!({ "doc": "journal/private" })).await["basis"],
        "collection"
    );

    // Differential (section 15.1): the unreadable document changes. For the reader who
    // cannot read it, the only difference is that record's standing and basis, and its place
    // in a filter and a total.
    let before = snapshot(&host).await;
    assert_eq!(
        (&before.1, &before.2, &before.3),
        (&json!(2), &json!(["n1"]), &json!(["n2"]))
    );
    let longer = format!("{ROSES} Mulch after.");
    file(dir.path(), "journal", "private", &longer);
    result(
        &run(
            &host,
            human("bo"),
            "notes-write",
            "sync",
            json!({ "doc": "journal/private", "text": longer, "access": "group:growers" }),
        )
        .await,
    );
    let after = snapshot(&host).await;
    assert_eq!(after.0[1], before.0[1], "another record is untouched");
    let mut was = before.0[0].clone();
    let mut is = after.0[0].clone();
    assert_eq!(
        is["dev.umbel/standing"].take(),
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
    was["dev.umbel/standing"].take();
    assert_eq!(is, was, "nothing of the record but its standing changed");
    assert_eq!(
        (&after.1, &after.2, &after.3),
        (&json!(2), &json!([]), &json!(["n1", "n2"]))
    );
}

/// What the agent reads of the two records: each by id, the total of every record, and the ids
/// a call for verified content and a call for unverified records are given.
async fn snapshot(host: &Host) -> (Vec<Value>, Value, Value, Value) {
    let mut out = Vec::new();
    for id in ["n1", "n2"] {
        out.push(result(
            &run(
                host,
                agent("ada"),
                "notes-read",
                "read",
                json!({ "id": id }),
            )
            .await,
        ));
    }
    let find = |args: Value| async move {
        result(&run(host, agent("ada"), "notes-read", "find", args).await)
    };
    let all = find(json!({})).await;
    let verified = find(json!({ "verifiedOnly": true })).await;
    let unverified = find(json!({ "standings": ["unverified"] })).await;
    (
        out,
        all["total"].clone(),
        verified["ids"].clone(),
        unverified["ids"].clone(),
    )
}

#[tokio::test]
async fn a_call_for_verified_content_gets_what_the_space_admits_and_no_more() {
    for (admits, verified) in [
        ("", json!(["a"])),
        ("verified_admits = \"affirmed\"", json!(["a"])),
        ("verified_admits = \"affirmed+attested\"", json!(["a", "t"])),
    ] {
        let dir = workspace(&config(&format!("{PERSON}\n{admits}"), "", ""));
        sync(dir.path(), "journal", "roses", ROSES).await;
        put(dir.path(), "a", MULCH).await;
        cite(dir.path(), "t", ROSES, "journal/roses").await;
        put(dir.path(), "u", SUN).await;
        done(&review(dir.path(), "affirm", json!({ "id": "a" })).await);
        let host = host(dir.path());
        let find = |args: Value| {
            let host = &host;
            async move { result(&run(host, agent("ada"), "notes-read", "find", args).await) }
        };
        // No call asks: every record, with its label.
        let all = find(json!({})).await;
        assert_eq!(all["ids"], json!(["a", "t", "u"]));
        assert_eq!(
            all["admitted"],
            json!(["unverified", "attested", "affirmed"])
        );
        for item in all["items"].as_array().unwrap() {
            assert_no_tier(&item["dev.umbel/standing"]);
        }
        // A call asks for verified content: what the space's `verified_admits` names.
        let asked = find(json!({ "verifiedOnly": true })).await;
        assert_eq!(asked["ids"], verified, "{admits}");
        assert_eq!(
            asked["total"],
            verified.as_array().unwrap().len(),
            "{admits}"
        );
        // Whatever standings the call passes, it is given no more than that.
        let widened = find(
            json!({ "verifiedOnly": true, "standings": ["unverified", "attested", "affirmed"] }),
        )
        .await;
        assert_eq!(widened["ids"], verified, "{admits}");
        assert_eq!(widened["admitted"], asked["admitted"], "{admits}");
        let outside = find(json!({ "verifiedOnly": true, "standings": ["unverified"] })).await;
        assert_eq!(
            outside["ids"],
            json!([]),
            "a standing outside it is not an error and returns less"
        );
        assert_eq!(outside["admitted"], json!([]));
        assert_eq!(outside["total"], 0);
        // By id too: an unverified record is not read as verified content.
        let read = |args: Value| {
            let host = &host;
            async move { result(&run(host, agent("ada"), "notes-read", "read", args).await) }
        };
        assert_eq!(
            read(json!({ "id": "u", "verifiedOnly": true })).await,
            Value::Null
        );
        assert_eq!(
            read(json!({ "id": "u", "verifiedOnly": true, "standings": ["unverified"] })).await,
            Value::Null
        );
        assert_eq!(
            read(json!({ "id": "a", "verifiedOnly": true })).await["id"],
            "a"
        );
        // Without the flag, `standings` narrows every read.
        assert_eq!(
            find(json!({ "standings": ["unverified"] })).await["ids"],
            json!(["u"])
        );
        assert_eq!(
            find(json!({ "standings": ["attested"] })).await["ids"],
            json!(["t"])
        );
        drop(host);
        // A decision reaches an unverified record whatever a read would admit.
        assert_eq!(
            done(&review(dir.path(), "affirm", json!({ "id": "u" })).await)["standing"],
            "affirmed"
        );
    }
    // No space key asks for every read: the two a deployer might try are not keys.
    for key in ["verified_only = true", "min_standing = \"affirmed\""] {
        let dir = workspace(&config(&format!("{PERSON}\n{key}"), "", ""));
        let error = HostBuilder::open(dir.path())
            .err()
            .expect("the configuration is refused");
        let name = key.split(' ').next().unwrap();
        assert!(
            format!("{error:?}").contains(&format!("`spaces.garden.{name}` is not a known key")),
            "{key}: {error:?}"
        );
    }
}

#[tokio::test]
async fn record_get_and_record_list_are_refused_on_a_standing_kind() {
    let dir = garden();
    put(dir.path(), "n1", ROSES).await;
    let host = host(dir.path());
    for op in ["get", "list"] {
        let outcome = run(&host, agent("ada"), "notes-read", op, json!({ "id": "n1" })).await;
        assert_eq!(outcome.error.as_ref().unwrap().code, "INVALID", "{op}");
        assert!(
            refusal(&outcome).contains(
                "RECORD_KIND_STANDING: note is a standing kind: read it with record_read or record_find, which label it"
            ),
            "{op}"
        );
    }
    // On every other kind they are unchanged: a declared kind without standing, and one the
    // manifest does not declare.
    result(
        &run(
            &host,
            agent("ada"),
            "notes-write",
            "put",
            json!({ "kind": "bed", "id": "north", "body": { "name": "The north bed" } }),
        )
        .await,
    );
    result(
        &run(
            &host,
            agent("ada"),
            "notes-write",
            "put",
            json!({ "kind": "log", "id": "l1", "body": { "line": "sowed" } }),
        )
        .await,
    );
    for kind in ["bed", "log"] {
        let id = if kind == "bed" { "north" } else { "l1" };
        let got = result(
            &run(
                &host,
                agent("ada"),
                "notes-read",
                "get",
                json!({ "kind": kind, "id": id }),
            )
            .await,
        );
        assert_eq!(got["id"], id, "{kind}");
        assert_eq!(
            result(
                &run(
                    &host,
                    agent("ada"),
                    "notes-read",
                    "list",
                    json!({ "kind": kind })
                )
                .await
            ),
            json!([id])
        );
    }
    assert_eq!(
        metadata(
            &run(
                &host,
                agent("ada"),
                "notes-read",
                "read",
                json!({ "id": "n1" })
            )
            .await
        )["dev.umbel/plugin"]["id"],
        "notes"
    );
}

// ── A declaration that changes ──────────────────────────────────────────────────────────────────

/// `records.declared` of a host over `dir` whose `notes` plugin has `manifest`.
async fn declared_check(dir: &Path, manifest: String) -> (String, String) {
    let host = seal(dir, |builder| builder.with_compiled(plugin_with(manifest))).unwrap();
    let outcome = call(&host, agent("ada"), "workspace-doctor", json!({})).await;
    let data = match (&outcome.data, &outcome.error) {
        (Some(data), _) => data.clone(),
        (_, Some(error)) => serde_json::to_value(error.details.clone().unwrap()).unwrap(),
        _ => panic!("{outcome:?}"),
    };
    let check = data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == "records.declared")
        .unwrap()
        .clone();
    (
        check["status"].as_str().unwrap().to_owned(),
        check["message"].as_str().unwrap().to_owned(),
    )
}

async fn reindex(dir: &Path, manifest: String) -> Run {
    cli_with(
        dir,
        &["call", "store-records-reindex", "{}", "--yes"],
        Scripted::no_terminal(),
        |builder| builder.with_compiled(plugin_with(manifest)),
    )
    .await
}

#[tokio::test]
async fn a_kinds_standing_alone_costs_no_standing_and_a_changed_text_is_said_before_the_rebuild() {
    let dir = garden();
    put(dir.path(), "n1", ROSES).await;
    done(&review(dir.path(), "affirm", json!({ "id": "n1" })).await);
    // The next version of the plugin declares the kind without standing, over the same text.
    let without = manifest().replace("standing = true\n", "");
    assert_ne!(without, manifest());
    let (status, message) = declared_check(dir.path(), without.clone()).await;
    assert_eq!(status, "fail", "{message}");
    assert!(
        !message.contains("affirmation"),
        "no wording moves, so the rebuild removes nothing: {message}"
    );
    let rebuilt = reindex(dir.path(), without.clone()).await;
    assert_eq!(
        rebuilt.json()["data"]["kinds"][0]["wordingsChanged"],
        0,
        "{}",
        rebuilt.stdout
    );
    // Declared with standing again, the record reads affirmed: what the person decided was
    // this wording, and it never moved.
    let (status, message) = declared_check(dir.path(), manifest()).await;
    assert_eq!(status, "fail", "{message}");
    assert!(!message.contains("affirmation"), "{message}");
    assert_eq!(reindex(dir.path(), manifest()).await.code, 0);
    let again = label(dir.path(), "n1").await;
    assert_eq!(again["standing"], "affirmed");
    assert_eq!(again["affirmed"]["assurance"]["level"], "terminal");

    // A version that changes the text pointer, and declares no standing: the rebuild will
    // take the affirmation, and the doctor says so first, whatever the declaration.
    let renamed = without
        .replace("text = [\"/statement\"]", "text = [\"/wording\"]")
        .replace("match = \"/statement\"", "match = \"/wording\"");
    let (status, message) = declared_check(dir.path(), renamed.clone()).await;
    assert_eq!(status, "fail", "{message}");
    assert!(
        message.contains("garden: notes.note (its text changed: the rebuild will remove 1 affirmation(s) and 0 evidence row(s))"),
        "{message}"
    );
    let rebuilt = reindex(dir.path(), renamed).await;
    assert_eq!(
        rebuilt.json()["data"]["kinds"][0]["wordingsChanged"],
        1,
        "{}",
        rebuilt.stdout
    );
    assert_eq!(reindex(dir.path(), manifest()).await.code, 0);
    assert_eq!(
        label(dir.path(), "n1").await,
        json!({ "standing": "unverified", "affirmed": null, "source": null })
    );
}

// ── What the terminal's assurance rests on ──────────────────────────────────────────────────────

/// Standing is at least as strict as memory's person-gated commands (D86,
/// `tests/cli_authority_prompt.rs`): a process at a terminal that carries an agent variable
/// answers the `require-human` prompt, passes the plugin gate, and still neither affirms nor
/// marks, because the CLI withholds its human-present mark and the proof asks for it.
#[tokio::test]
async fn at_a_terminal_an_agent_variable_withholds_the_proof() {
    let dir = workspace(&config(
        PERSON,
        "",
        "\n[principal]\nagent_env = [\"GARDEN_AGENT\"]\n",
    ));
    put(dir.path(), "n1", ROSES).await;
    sync(dir.path(), "talks", "pruning", ROSES).await;
    for variable in ["AI_AGENT", "CLAUDECODE", "GARDEN_AGENT"] {
        for (op, args) in [
            ("affirm", json!({ "id": "n1" })),
            ("mark", json!({ "doc": "talks/pruning" })),
            ("unmark", json!({ "doc": "talks/pruning" })),
        ] {
            let input = json!({ "op": op, "args": args }).to_string();
            // No terminal: refused before the handler, as every such call is.
            let piped = support::cli_with_vars(
                dir.path(),
                &["call", "notes-review", &input],
                Scripted::no_terminal(),
                &[(variable, "1")],
                configure,
            )
            .await;
            assert_eq!(
                piped.error_code(),
                "CONFIRMATION_REQUIRED",
                "{variable} {op}"
            );
            // A terminal whose prompt is answered: the gate passes, and the proof is withheld.
            let console = Scripted::new(true, true);
            let answered = support::cli_with_vars(
                dir.path(),
                &["call", "notes-review", &input],
                console.clone(),
                &[(variable, "1")],
                configure,
            )
            .await;
            assert_eq!(
                console.asked().len(),
                1,
                "{variable} {op}: the prompt was answered"
            );
            let message = refused(&answered);
            assert!(
                message.contains("RECORD_DECISION_NOT_GATED"),
                "{variable} {op}: {message}"
            );
        }
    }
    assert_eq!(standing(dir.path(), "n1").await, "unverified");
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        0
    );
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_own"), 0);
    // Nor is a put inside such a call the person's.
    let body = json!({ "statement": SUN, "bed": "east" });
    let input = json!({ "op": "put", "args": { "id": "n2", "body": body } }).to_string();
    let written = support::cli_with_vars(
        dir.path(),
        &["call", "notes-review", &input],
        Scripted::new(true, true),
        &[("AI_AGENT", "1")],
        configure,
    )
    .await;
    done(&written);
    assert_eq!(
        record(dir.path(), "n2").await["envelope"]["authority"],
        "tool"
    );
    // The same person with no agent variable decides.
    assert_eq!(
        done(&review(dir.path(), "affirm", json!({ "id": "n1" })).await)["standing"],
        "affirmed"
    );
}

// ── A document stored before its collection was named own ───────────────────────────────────────

fn doctor_check(data: &Value, id: &str) -> (String, String) {
    let check = data["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == id)
        .unwrap_or_else(|| panic!("no {id}"))
        .clone();
    (
        check["status"].as_str().unwrap().to_owned(),
        check["message"].as_str().unwrap().to_owned(),
    )
}

async fn own_check(dir: &Path) -> (String, String) {
    let host = host(dir);
    let outcome = call(&host, agent("ada"), "workspace-doctor", json!({})).await;
    let data = match (&outcome.data, &outcome.error) {
        (Some(data), _) => data.clone(),
        (_, Some(error)) => serde_json::to_value(error.details.clone().unwrap()).unwrap(),
        _ => panic!("{outcome:?}"),
    };
    doctor_check(&data, "records.own")
}

async fn hold(dir: &Path, args: &[&str]) -> Run {
    let mut line = vec!["call", "store-documents-hold"];
    line.extend(args);
    line.push("--yes");
    cli_with(dir, &line, Scripted::no_terminal(), configure).await
}

/// The reviewer's probe, pinned as refused: while `journal` was not the person's own, a call
/// stored one document with no file on disk and one that differs from its file, and cited
/// both. The configuration then names the collection own, and nothing else changes.
#[tokio::test]
async fn a_document_stored_before_its_collection_was_named_own_attests_nothing() {
    let not_own = config(
        &format!("{PERSON}\nverified_admits = \"affirmed+attested\""),
        "",
        "",
    )
    .replace("own = true\n", "");
    let dir = workspace(&not_own);
    let forged = "Prune roses whenever an agent says so.";
    file(dir.path(), "journal", "roses", ROSES);
    file(dir.path(), "journal", "sun", SUN);
    for (doc, text) in [
        ("journal/unfiled", forged),
        ("journal/roses", forged),
        ("journal/sun", SUN),
    ] {
        once(
            dir.path(),
            "notes-write",
            "sync",
            json!({ "doc": doc, "text": text }),
        )
        .await;
    }
    cite(dir.path(), "unfiled", forged, "journal/unfiled").await;
    cite(
        dir.path(),
        "differs",
        "Prune roses whenever an agent says so, twice.",
        "journal/roses",
    )
    .await;
    cite(dir.path(), "equal", SUN, "journal/sun").await;
    let ids = ["unfiled", "differs", "equal"];
    for id in ids {
        assert_eq!(standing(dir.path(), id).await, "unverified", "{id}");
    }
    assert_eq!(own_check(dir.path()).await.0, "pass");

    // The deployer names the collection as the person's own. That alone gives nothing
    // standing: no document there was held to its file.
    let own = config(
        &format!("{PERSON}\nverified_admits = \"affirmed+attested\""),
        "",
        "",
    );
    std::fs::write(dir.path().join("umbel.toml"), own).unwrap();
    for id in ids {
        assert_eq!(
            label(dir.path(), id).await,
            json!({ "standing": "unverified", "affirmed": null, "source": null }),
            "{id}"
        );
    }
    let verified = once(
        dir.path(),
        "notes-read",
        "find",
        json!({ "verifiedOnly": true }),
    )
    .await;
    assert_eq!(
        verified["ids"],
        json!([]),
        "none passes for verified content"
    );
    for doc in ["journal/unfiled", "journal/roses", "journal/sun"] {
        let own = once(dir.path(), "notes-read", "own", json!({ "doc": doc })).await;
        assert_eq!(own, Value::Null, "{doc}");
    }
    // The doctor counts them and names the command.
    let (status, message) = own_check(dir.path()).await;
    assert_eq!(status, "warn", "{message}");
    assert!(
        message.ends_with("attest nothing: garden/journal (3)"),
        "{message}"
    );

    // The operator has the host compare each stored document with its file. The one that
    // equals its file is held; the one with no file and the one that differs are not.
    let held = hold(dir.path(), &["collection=journal"]).await;
    assert_eq!(held.code, 0, "{}", held.stdout);
    let answer = held.json();
    assert_eq!(
        answer["data"],
        json!({ "space": "garden", "collection": "journal", "documents": 3, "held": 1, "differing": 2 })
    );
    assert_eq!(
        answer["warnings"][0]["code"], "STORE_OWN_SOURCE_MISMATCH",
        "{answer}"
    );
    assert!(
        !held.stdout.contains("agent says so"),
        "counts, and never text"
    );
    assert_eq!(standing(dir.path(), "equal").await, "attested");
    for id in ["unfiled", "differs"] {
        assert_eq!(standing(dir.path(), id).await, "unverified", "{id}");
    }
    let verified = once(
        dir.path(),
        "notes-read",
        "find",
        json!({ "verifiedOnly": true }),
    )
    .await;
    assert_eq!(verified["ids"], json!(["equal"]));
    let (status, message) = own_check(dir.path()).await;
    assert_eq!(status, "warn", "{message}");
    assert!(message.ends_with("garden/journal (2)"), "{message}");
    // Run again, it holds the same one and changes nothing.
    assert_eq!(
        hold(dir.path(), &["collection=journal"]).await.json()["data"]["held"],
        1
    );

    // The command is the operator's at the command line, for an own collection, and leaves a
    // digest journal entry and no event.
    for (args, code) in [
        (&["collection=talks"][..], "STORE_COLLECTION_NOT_OWN"),
        (&["collection=absent"][..], "STORE_COLLECTION_NOT_OWN"),
        (
            &["collection=rows", "space=orchard"][..],
            "STORE_COLLECTION_NOT_OWN",
        ),
    ] {
        let refused = hold(dir.path(), args).await;
        assert_eq!(refused.error_code(), code, "{args:?}: {}", refused.stdout);
    }
    let host = host(dir.path());
    let definition = host.registry().get("store-documents-hold").unwrap();
    let expose = definition.expose.clone();
    assert!(expose.cli && !expose.mcp && !expose.agent, "{expose:?}");
    drop(host);
    let journal = std::fs::read_to_string(support::journal_path(dir.path())).unwrap();
    let entry: Value = journal
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|entry| entry["command"] == "store-documents-hold")
        .expect("the command is journaled");
    assert_eq!(entry["input"]["keep"], json!({ "collection": "journal" }));
    assert!(
        support::events(dir.path(), "garden")
            .iter()
            .all(|event| event["command"] != "store-documents-hold")
    );
}

// ── A space whose person changes ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_former_persons_decisions_and_marks_are_set_aside() {
    let dir = garden();
    put(dir.path(), "n1", ROSES).await;
    sync(dir.path(), "talks", "pruning", SUN).await;
    cite(dir.path(), "n2", SUN, "talks/pruning").await;
    done(&review(dir.path(), "affirm", json!({ "id": "n1" })).await);
    done(&review(dir.path(), "mark", json!({ "doc": "talks/pruning" })).await);
    assert_eq!(standing(dir.path(), "n1").await, "affirmed");
    assert_eq!(standing(dir.path(), "n2").await, "attested");

    // The deployer names another person for the space, who is now the CLI's caller.
    let successor = config(
        "person = \"human:rowan\"\nverified_admits = \"affirmed+attested\"",
        "",
        "\n[principal]\nlocal_id = \"rowan\"\n",
    );
    std::fs::write(dir.path().join("umbel.toml"), &successor).unwrap();
    for id in ["n1", "n2"] {
        assert_eq!(
            label(dir.path(), id).await,
            json!({ "standing": "unverified", "affirmed": null, "source": null }),
            "{id}: the former person's decision gives no standing"
        );
    }
    assert_eq!(
        once(
            dir.path(),
            "notes-read",
            "own",
            json!({ "doc": "talks/pruning" })
        )
        .await,
        Value::Null
    );
    let verified = once(
        dir.path(),
        "notes-read",
        "find",
        json!({ "verifiedOnly": true }),
    )
    .await;
    assert_eq!(verified["ids"], json!([]));
    // Nothing was deleted: the decisions are there, and are not read.
    assert_eq!(
        count(dir.path(), "SELECT COUNT(*) FROM record_decisions"),
        1
    );
    assert_eq!(count(dir.path(), "SELECT COUNT(*) FROM doc_own"), 1);

    // The new person affirms and marks in their own name.
    let affirmed = done(&review(dir.path(), "affirm", json!({ "id": "n1" })).await);
    assert_eq!(affirmed["affirmed"]["by"], "human:rowan");
    done(&review(dir.path(), "mark", json!({ "doc": "talks/pruning" })).await);
    assert_eq!(standing(dir.path(), "n1").await, "affirmed");
    assert_eq!(standing(dir.path(), "n2").await, "attested");
    let by: String = sqlite(dir.path())
        .query_row("SELECT by FROM doc_own", [], |r| r.get(0))
        .unwrap();
    assert_eq!(by, "human:rowan");

    // A space with no person: nothing reads affirmed or marked.
    let nobody = successor
        .replace("person = \"human:rowan\"\n", "")
        .replace("own = true\n", "");
    std::fs::write(dir.path().join("umbel.toml"), nobody).unwrap();
    for id in ["n1", "n2"] {
        assert_eq!(standing(dir.path(), id).await, "unverified", "{id}");
    }
}
