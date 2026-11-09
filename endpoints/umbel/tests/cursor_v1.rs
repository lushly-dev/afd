//! Positions, sequence numbers and totals (phase 5 specification, section 9.3; step 7): to a
//! hosted caller that is neither the operator nor stdio (here the library, as section 4.7 treats
//! an embedder's caller, and a verified caller over HTTP) every position is the sealed position of
//! something it can read, deterministic and refused for anyone else, so writing, indexing or
//! journaling what it cannot read changes no byte of what it is shown: `event-list`'s events,
//! cursors, `head` and pages, `event-ack`, `space-list`'s counts, a store revision and
//! `dev.umbel/index`. The operator, stdio and mode `none` keep version 0 cursors and plain
//! positions (section 14's point 10), and stored cursor files keep positions and consult
//! `[principal.equivalents]`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandResult};
use serde_json::{Value, json};
use support::oauth::{Running, Setup};
use support::store::{ALL_GRANTS, StoreProbe};
use umbel::Host;
use umbel::plugins::sdk;
use umbel_testkit_idp::TestIdp;

const P_ADA: &str = "principal:human:corp/ada";
const P_BO: &str = "principal:human:corp/bo";

/// `main` (the default) and `beta`, both anyone's, and the store probe in both.
const REST: &str = r#"[spaces.main.collections.notes]
root = "spaces/main/notes"

[spaces.beta]
[spaces.beta.collections.notes]
root = "spaces/beta/notes"

[plugins]
enabled = ["sp"]

[plugins.sp]
source = "compiled:sp"
spaces = ["main", "beta"]

[plugins.sp.grants.content_write]
allow = ["main/*", "beta/*"]
[plugins.sp.grants.documents_write]
allow = ["main/*", "beta/*"]
[plugins.sp.grants.records_write]
allow = ["main", "beta"]
[plugins.sp.grants.index_write]
allow = ["main", "beta"]
[plugins.sp.grants.graph_write]
allow = ["main", "beta"]
"#;

fn probe() -> StoreProbe {
    let mut grants = ALL_GRANTS.to_vec();
    grants.push("events");
    StoreProbe::with_grants(&grants, true)
}

fn configure(builder: umbel::HostBuilder) -> umbel::HostBuilder {
    builder.with_compiled(sdk(probe()))
}

/// [`configure`] with the fixtures the `oauth` workspace lists as first-class tools, for the
/// operator's CLI.
fn configure_cli(builder: umbel::HostBuilder) -> umbel::HostBuilder {
    configure(
        builder
            .register(support::oauth::whoami())
            .register(support::oauth::touch()),
    )
}

/// An `oauth` workspace and a host of it; its library callers' positions are sealed.
struct Hosted {
    _kit: TestIdp,
    dir: tempfile::TempDir,
    host: Host,
}

async fn hosted(principal: &str) -> Hosted {
    let kit = TestIdp::start().await.unwrap();
    let setup = Setup {
        rest: REST,
        principal,
        ..Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    let host = support::oauth::host_with(dir.path(), &kit, None, None, configure);
    Hosted {
        _kit: kit,
        dir,
        host,
    }
}

fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
}

fn ada() -> Actor {
    human("corp/ada")
}

fn bo() -> Actor {
    human("corp/bo")
}

async fn call(host: &Host, actor: Actor, command: &str, input: Value) -> CommandResult<Value> {
    support::call(host, actor, command, input).await
}

/// The data of a call that must succeed.
async fn data(host: &Host, actor: Actor, command: &str, input: Value) -> Value {
    let result = call(host, actor, command, input).await;
    assert!(result.success, "{command}: {result:?}");
    result.data.unwrap()
}

/// The error of a call that must fail, without its trace.
async fn refused(host: &Host, actor: Actor, command: &str, input: Value) -> Value {
    let result = call(host, actor, command, input).await;
    assert!(!result.success, "{command}: {result:?}");
    serde_json::to_value(result.error.unwrap()).unwrap()
}

/// `id` written in `main` as a document `access` reads, its event read by the same tokens.
async fn write(host: &Host, actor: Actor, id: &str, access: &[&str]) -> CommandResult<Value> {
    let result = call(
        host,
        actor,
        "sp-write",
        json!({
            "op": "doc-put",
            "args": { "id": id, "text": format!("text of {id}"), "access": access, "event_access": access },
        }),
    )
    .await;
    assert!(result.success, "{result:?}");
    result
}

async fn events(host: &Host, actor: Actor, input: Value) -> Value {
    data(host, actor, "event-list", input).await
}

fn is_cursor_v1(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|text| text.starts_with("v1.") && text.len() >= 58)
}

/// What a caller is shown of `main`: every page of `event-list` at `limit`, then `space-list`.
async fn shown(host: &Host, actor: Actor, limit: u64) -> Vec<Value> {
    let mut out = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let mut input = json!({ "limit": limit });
        if let Some(after) = &after {
            input["after"] = json!(after);
        }
        let page = events(host, actor.clone(), input).await;
        let more = page["hasMore"] == json!(true);
        after = page["cursor"].as_str().map(str::to_owned);
        out.push(page);
        if !more {
            break;
        }
    }
    out.push(data(host, actor, "space-list", json!({})).await);
    out
}

#[tokio::test]
async fn hidden_events_change_no_byte_of_what_a_sealed_caller_is_shown() {
    let h = hosted("local_id = \"corp/ada\"").await;
    write(&h.host, bo(), "notes/b1", &[P_BO]).await;
    write(&h.host, ada(), "notes/shared", &["space"]).await;
    write(&h.host, bo(), "notes/b2", &[P_BO]).await;
    let before_all = shown(&h.host, bo(), 100).await;
    let before_paged = shown(&h.host, bo(), 1).await;
    let ada_before = shown(&h.host, ada(), 100).await;

    // Ada's documents and events, which bo cannot read.
    for n in 0..5 {
        write(&h.host, ada(), &format!("notes/hidden-{n}"), &[P_ADA]).await;
    }

    assert_eq!(shown(&h.host, bo(), 100).await, before_all);
    assert_eq!(shown(&h.host, bo(), 1).await, before_paged);
    assert_ne!(
        shown(&h.host, ada(), 100).await,
        ada_before,
        "ada reads them"
    );

    // What bo is shown: three events, each a view with sealed positions and no count.
    let page = &before_all[0];
    let validator = support::schema_validator("event-view.v1");
    let listed = page["events"].as_array().unwrap();
    assert_eq!(listed.len(), 3, "{page}");
    for event in listed {
        if let Err(error) = validator.validate(event) {
            panic!("{error}: {event}");
        }
        assert!(is_cursor_v1(&event["cursor"]), "{event}");
        assert_eq!(event["id"], event["cursor"]);
        for counted in ["seq", "journalSeq", "changes"] {
            assert!(event.get(counted).is_none(), "{counted}: {event}");
        }
        assert!(event["record"].get("version").is_none(), "{event}");
    }
    for field in ["cursor", "acknowledged", "head"] {
        assert!(is_cursor_v1(&page[field]), "{field}: {page}");
    }
    assert_eq!(
        page["head"], listed[2]["cursor"],
        "the head is bo's last event"
    );
    assert_eq!(page["cursor"], page["head"]);
    assert_eq!(page["hasMore"], json!(false));
    // One event a page: three pages, each with one event bo can read, the last at the head.
    assert_eq!(before_paged.len(), 4);
    for (n, page) in before_paged[..3].iter().enumerate() {
        assert_eq!(page["events"].as_array().unwrap().len(), 1, "{page}");
        assert_eq!(page["events"][0]["id"], listed[n]["id"]);
        assert_eq!(page["hasMore"], json!(n < 2), "{page}");
    }
    // space-list counts bo's events and gives bo's head (step 3's follow-up).
    let spaces = &before_all[1]["spaces"];
    let main = spaces
        .as_array()
        .unwrap()
        .iter()
        .find(|space| space["id"] == "main")
        .unwrap();
    assert_eq!(main["events"], json!(3), "{main}");
    assert_eq!(main["head"], page["head"]);
    // Equal positions seal equal: the same list again is the same bytes.
    assert_eq!(events(&h.host, bo(), json!({})).await, *page);
}

#[tokio::test]
async fn a_cursor_opens_only_for_its_caller_its_space_and_never_as_version_0() {
    let h = hosted("local_id = \"corp/ada\"").await;
    write(&h.host, bo(), "notes/b1", &["space"]).await;
    write(&h.host, bo(), "notes/b2", &["space"]).await;
    let mine = events(&h.host, bo(), json!({ "limit": 1 })).await;
    let cursor = mine["cursor"].clone();
    // Bo resumes after his own cursor.
    let next = events(&h.host, bo(), json!({ "after": cursor })).await;
    assert_eq!(next["events"].as_array().unwrap().len(), 1, "{next}");

    // Another caller's cursor, another space's, a version 0 string, an altered token and a
    // malformed one are one refusal, alike byte for byte.
    let refusal = |error: Value| {
        assert_eq!(error["code"], json!("INVALID_CURSOR"), "{error}");
        error
    };
    let theirs = refusal(refused(&h.host, ada(), "event-list", json!({ "after": cursor })).await);
    let elsewhere = refusal(
        refused(
            &h.host,
            bo(),
            "event-list",
            json!({ "space": "beta", "after": cursor }),
        )
        .await,
    );
    let v0 = refusal(refused(&h.host, bo(), "event-list", json!({ "after": "v0:main:1" })).await);
    let mut altered = cursor.as_str().unwrap().to_owned();
    altered.pop();
    altered.push(if cursor.as_str().unwrap().ends_with('A') {
        'B'
    } else {
        'A'
    });
    let altered = refusal(refused(&h.host, bo(), "event-list", json!({ "after": altered })).await);
    let malformed =
        refusal(refused(&h.host, bo(), "event-list", json!({ "after": "v1.nope" })).await);
    for other in [&elsewhere, &v0, &altered, &malformed] {
        assert_eq!(other, &theirs);
    }
    assert!(!theirs.to_string().contains("v0:"), "{theirs}");
    // event-ack refuses them the same way.
    let ack = refusal(refused(&h.host, bo(), "event-ack", json!({ "cursor": "v0:main:1" })).await);
    assert_eq!(ack["code"], json!("INVALID_CURSOR"));
}

#[tokio::test]
async fn event_ack_stores_a_position_and_answers_in_sealed_cursors() {
    let h = hosted("local_id = \"corp/ada\"").await;
    write(&h.host, bo(), "notes/b1", &[P_BO]).await;
    write(&h.host, ada(), "notes/hidden", &[P_ADA]).await;
    write(&h.host, bo(), "notes/b2", &[P_BO]).await;
    let first = events(&h.host, bo(), json!({ "limit": 1 })).await;
    let start = first["acknowledged"].clone();
    let acked = data(
        &h.host,
        bo(),
        "event-ack",
        json!({ "cursor": first["cursor"] }),
    )
    .await;
    assert_eq!(acked["acknowledged"], first["cursor"]);
    assert_eq!(
        acked["previous"], start,
        "the cursor before the first event"
    );
    // Without `after`, the list resumes after the acknowledged cursor: bo's second event.
    let resumed = events(&h.host, bo(), json!({})).await;
    assert_eq!(resumed["acknowledged"], first["cursor"]);
    assert_eq!(resumed["events"].as_array().unwrap().len(), 1, "{resumed}");
    // The file holds the position, as every cursor file does (section 9.3).
    let files: Vec<_> = std::fs::read_dir(h.dir.path().join("state/spaces/main/cursors"))
        .unwrap()
        .flatten()
        .collect();
    assert_eq!(files.len(), 1);
    let file: Value = serde_json::from_slice(&std::fs::read(files[0].path()).unwrap()).unwrap();
    assert!(
        file["cursor"].as_str().unwrap().starts_with("v0:main:"),
        "{file}"
    );
    // A hidden event after it moves nothing bo is shown.
    write(&h.host, ada(), "notes/hidden-2", &[P_ADA]).await;
    assert_eq!(events(&h.host, bo(), json!({})).await, resumed);
}

#[tokio::test]
async fn revisions_are_the_sealed_last_readable_ones_and_the_journal_keeps_them_whole() {
    let h = hosted("local_id = \"corp/ada\"").await;
    let rev_of = |result: &CommandResult<Value>| {
        result.data.as_ref().unwrap()["result"]["rev"]
            .as_u64()
            .unwrap()
    };
    let mine = write(&h.host, bo(), "notes/b1", &[P_BO]).await;
    let hidden = write(&h.host, ada(), "notes/hidden", &[P_ADA]).await;
    let (b1, h1) = (rev_of(&mine), rev_of(&hidden));
    assert!(h1 > b1);
    let position = |actor: Actor, rev: u64| {
        let host = &h.host;
        async move {
            data(
                host,
                actor,
                "sp-read",
                json!({ "op": "position", "args": { "rev": rev } }),
            )
            .await["result"]
                .clone()
        }
    };
    // The hidden revision is bo's last readable one, sealed: equal to b1's.
    let sealed = position(bo(), b1).await;
    assert!(sealed.as_str().unwrap().starts_with("r1."), "{sealed}");
    assert_eq!(position(bo(), h1).await, sealed);
    assert_ne!(
        position(ada(), h1).await,
        position(ada(), b1).await,
        "ada reads h1"
    );
    // It names b1 again for bo, and nothing for ada or as a number.
    let back = |actor: Actor, value: Value| {
        let host = &h.host;
        async move {
            call(
                host,
                actor,
                "sp-read",
                json!({ "op": "position-of", "args": { "value": value } }),
            )
            .await
        }
    };
    let opened = back(bo(), sealed.clone()).await;
    assert_eq!(opened.data.unwrap()["result"], json!(b1));
    assert!(!back(ada(), sealed.clone()).await.success);
    assert!(
        !back(bo(), json!(b1)).await.success,
        "a number from a sealed caller"
    );

    // The result shows no `dev.umbel/changes` and seals `dev.umbel/index`; the journal entry
    // and the operator's event hold the changes whole, and the index as the caller saw it.
    let extra = |result: &CommandResult<Value>| result.metadata.as_ref().unwrap().extra.clone();
    assert!(
        !extra(&mine).contains_key("dev.umbel/changes"),
        "{:?}",
        extra(&mine)
    );
    let forged = call(&h.host, bo(), "sp-forge", json!({ "op": "x" })).await;
    let index = &extra(&forged)["dev.umbel/index"]["main"];
    assert!(
        index["applied"].as_str().unwrap().starts_with("r1."),
        "{index}"
    );
    assert!(
        index["head"].as_str().unwrap().starts_with("r1."),
        "{index}"
    );
    let entries = support::journal_entries(h.dir.path());
    let journaled = entries
        .iter()
        .filter(|entry| entry.command == "sp-write")
        .map(|entry| entry.result.metadata.as_ref().unwrap().extra["dev.umbel/changes"].clone())
        .collect::<Vec<_>>();
    assert_eq!(journaled[0]["toRev"], json!(b1), "{journaled:?}");
    assert_eq!(journaled[1]["toRev"], json!(h1), "{journaled:?}");
    let forged_entry = entries
        .iter()
        .find(|entry| entry.command == "sp-forge")
        .unwrap();
    assert_eq!(
        forged_entry.result.metadata.as_ref().unwrap().extra["dev.umbel/index"]["main"],
        *index
    );
    let line = support::events(h.dir.path(), "main")
        .into_iter()
        .find(|event| event["changes"]["toRev"] == json!(b1))
        .expect("the event keeps its changes");
    assert_eq!(
        line["record"].get("version"),
        None,
        "doc-put names no record"
    );
}

#[tokio::test]
async fn the_operator_stdio_and_mode_none_keep_version_0_and_plain_positions() {
    let h = hosted("local_id = \"corp/ada\"").await;
    write(&h.host, bo(), "notes/b1", &[P_BO]).await;
    write(&h.host, ada(), "notes/hidden", &[P_ADA]).await;
    // The operator (`corp/ada`), at the CLI: the events it reads, with `seq`, and version 0
    // cursors that move past bo's.
    let run = support::cli_with(
        h.dir.path(),
        &["call", "event-list"],
        support::Scripted::no_terminal(),
        configure_cli,
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let listed = run.json()["data"].clone();
    assert_eq!(listed["cursor"], json!("v0:main:2"), "{listed}");
    assert_eq!(listed["events"].as_array().unwrap().len(), 1, "{listed}");
    assert_eq!(listed["events"][0]["seq"], json!(2));
    let run = support::cli_with(
        h.dir.path(),
        &["call", "space-list"],
        support::Scripted::no_terminal(),
        configure_cli,
    )
    .await;
    let main = run.json()["data"]["spaces"][0].clone();
    assert_eq!(
        (main["events"].clone(), main["head"].clone()),
        (json!(2), json!("v0:main:2"))
    );

    // stdio: `process`, so version 0, and a version 0 string is accepted back.
    let mut stdio = support::mcp::Stdio::connect(&h.host).await;
    let reply = stdio
        .request(
            "tools/call",
            json!({ "name": "event-list", "arguments": { "after": "v0:main:0" } }),
        )
        .await;
    let page = &reply["result"]["structuredContent"]["data"];
    assert!(
        page["cursor"].as_str().unwrap().starts_with("v0:main:"),
        "{reply}"
    );

    // Mode none: the library reads as before.
    let dir = support::workspace(&format!(
        "config_version = 5\ndefault_space = \"main\"\n[spaces.main]\n{REST}"
    ));
    let plain = umbel::HostBuilder::open(dir.path())
        .unwrap()
        .with_compiled(sdk(probe()))
        .seal()
        .unwrap();
    write(&plain, bo(), "notes/b1", &["space"]).await;
    let page = events(&plain, bo(), json!({})).await;
    assert_eq!(page["cursor"], json!("v0:main:1"), "{page}");
    assert_eq!(page["events"][0]["seq"], json!(1));
    let position = data(
        &plain,
        bo(),
        "sp-read",
        json!({ "op": "position", "args": { "rev": 1 } }),
    )
    .await;
    assert_eq!(position["result"], json!(1));
}

#[tokio::test]
async fn a_stored_cursor_file_consults_the_equivalents() {
    // Mode none with a declared namespace, so the equivalence is plain to see in version 0.
    let dir = support::workspace(&format!(
        r#"config_version = 5
default_space = "main"

[principal]
local_id = "corp/ada"

[principal.equivalents]
"human:ada" = "human:corp/ada"

[auth.namespaces.corp]

[spaces.main]
{REST}"#
    ));
    let host = umbel::HostBuilder::open(dir.path())
        .unwrap()
        .with_compiled(sdk(probe()))
        .seal()
        .unwrap();
    for n in 0..3 {
        write(&host, bo(), &format!("notes/{n}"), &["space"]).await;
    }
    // The legacy principal acknowledged event 2 before the move.
    let legacy = human("ada");
    data(
        &host,
        legacy.clone(),
        "event-ack",
        json!({ "cursor": "v0:main:2" }),
    )
    .await;
    // Its namespaced self reads from there, without a file of its own.
    let page = events(&host, ada(), json!({})).await;
    assert_eq!(page["acknowledged"], json!("v0:main:2"), "{page}");
    assert_eq!(page["events"].as_array().unwrap().len(), 1, "{page}");
    // Its first acknowledgement is its own; the legacy file is never changed.
    let acked = data(&host, ada(), "event-ack", json!({ "cursor": "v0:main:3" })).await;
    assert_eq!(acked["previous"], json!("v0:main:2"), "{acked}");
    assert_eq!(
        events(&host, ada(), json!({})).await["acknowledged"],
        json!("v0:main:3")
    );
    assert_eq!(
        events(&host, legacy, json!({})).await["acknowledged"],
        json!("v0:main:2")
    );
    // Nobody else reads the legacy cursor.
    assert_eq!(
        events(&host, bo(), json!({})).await["acknowledged"],
        json!("v0:main:0")
    );
}

#[tokio::test]
async fn a_verified_caller_over_http_is_handed_cursor_version_1() {
    let running = Running::start(Setup::default()).await;
    let token = running.token().sign();
    let result = running.result(&token, "event-list", json!({})).await;
    assert_eq!(result["success"], json!(true), "{result}");
    for field in ["cursor", "acknowledged", "head"] {
        assert!(is_cursor_v1(&result["data"][field]), "{field}: {result}");
    }
    // A version 0 string over HTTP is refused, as from any caller that is not `process`.
    let refused = running
        .result(&token, "event-list", json!({ "after": "v0:main:0" }))
        .await;
    assert_eq!(
        refused["error"]["code"],
        json!("INVALID_CURSOR"),
        "{refused}"
    );
}

/// One OAuth client acting for `person`, as the hook maps every person token of that client.
fn client_for(person: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id("corp/shared-client")
        .with_on_behalf_of(person)
}

#[tokio::test]
async fn people_on_one_client_keep_cursors_of_their_own() {
    // The review's B2: a cursor file keyed by the client alone was every person's on it.
    let h = hosted("local_id = \"corp/ada\"").await;
    for n in 0..3 {
        write(&h.host, bo(), &format!("notes/{n}"), &["space"]).await;
    }
    let bo_before = events(&h.host, client_for("corp/bo"), json!({})).await;
    let mine = events(&h.host, client_for("corp/ada"), json!({ "limit": 2 })).await;
    data(
        &h.host,
        client_for("corp/ada"),
        "event-ack",
        json!({ "cursor": mine["cursor"] }),
    )
    .await;
    // Bo's view through the same client is untouched; ada resumes after her own cursor.
    assert_eq!(
        events(&h.host, client_for("corp/bo"), json!({})).await,
        bo_before
    );
    let resumed = events(&h.host, client_for("corp/ada"), json!({})).await;
    assert_eq!(resumed["acknowledged"], mine["cursor"]);
    assert_eq!(resumed["events"].as_array().unwrap().len(), 1, "{resumed}");
    // Two files: one per person.
    let files = std::fs::read_dir(h.dir.path().join("state/spaces/main/cursors"))
        .unwrap()
        .count();
    assert_eq!(files, 1, "only ada acknowledged");
    data(
        &h.host,
        client_for("corp/bo"),
        "event-ack",
        json!({ "cursor": bo_before["cursor"] }),
    )
    .await;
    assert_eq!(
        events(&h.host, client_for("corp/ada"), json!({})).await,
        resumed,
        "bo's acknowledgement moves nothing of ada's"
    );
}

#[tokio::test]
async fn the_cli_only_built_ins_are_the_operators_from_the_library_too() {
    // The review's I3: the library checks no interface, so the handlers refuse.
    let h = hosted("local_id = \"corp/ada\"").await;
    write(&h.host, bo(), "notes/one", &["space"]).await;
    for (command, input) in [
        ("store-show", json!({})),
        ("event-rebuild", json!({})),
        ("store-check", json!({})),
        ("store-backup", json!({ "path": "backups/one" })),
    ] {
        let error = refused(&h.host, bo(), command, input).await;
        assert_eq!(
            error["code"],
            json!("COMMAND_NOT_EXPOSED"),
            "{command}: {error}"
        );
    }
    // The operator, at the CLI, runs them.
    let run = support::cli_with(
        h.dir.path(),
        &["call", "store-show"],
        support::Scripted::no_terminal(),
        configure_cli,
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
}

#[tokio::test]
async fn the_journal_keeps_a_sealed_results_changes_whatever_its_trace() {
    // The review's I4: the stash is keyed by a fresh reference the result carries, not by a
    // trace id a context may lack or share.
    let h = hosted("local_id = \"corp/ada\"").await;
    let mut context = h.host.context(bo());
    context.trace_id = None;
    let result = h
        .host
        .registry()
        .execute(
            "sp-write",
            json!({ "op": "doc-put", "args": { "id": "notes/untraced", "text": "x", "event_access": ["space"] } }),
            Some(context),
        )
        .await;
    assert!(result.success, "{result:?}");
    let rev = result.data.as_ref().unwrap()["result"]["rev"].clone();
    let extra = &result.metadata.as_ref().unwrap().extra;
    assert!(!extra.contains_key("dev.umbel/changes"), "{extra:?}");
    assert!(extra["dev.umbel/journal-ref"].is_string(), "{extra:?}");
    let entry = support::journal_entries(h.dir.path())
        .into_iter()
        .find(|entry| entry.command == "sp-write")
        .unwrap();
    let journaled = &entry.result.metadata.as_ref().unwrap().extra;
    assert_eq!(
        journaled["dev.umbel/changes"]["toRev"], rev,
        "{journaled:?}"
    );
    assert!(
        !journaled.contains_key("dev.umbel/journal-ref"),
        "{journaled:?}"
    );
    let line = support::events(h.dir.path(), "main");
    assert_eq!(line[0]["changes"]["toRev"], rev);
}
