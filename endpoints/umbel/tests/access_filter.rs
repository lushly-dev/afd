//! Reader filters (phase 2 specification, sections 3.1 and 6, D53): built from the call's
//! principal, `onBehalfOf` and the groups; `SPACE_NOT_READABLE`; every store read path with
//! restricted content; `event-list` skipping version 1 events the caller cannot read; and what
//! `workspace-show` says about how far all of it holds.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandResult};
use serde_json::{Value, json};
use support::plugins::seal;
use support::store::{ALL_GRANTS, ALLOW_ALL, StoreProbe, config};
use support::{agent, call};
use umbel::Host;
use umbel::plugins::sdk;

const ACCESS: &str = r#"
[access.groups.platform]
members = ["agent:ci", "human:grace"]

[access.groups.everyone]
members = ["*"]
"#;

/// `main` is readable by anyone; `beta` only by the group `platform` and `human:ada`.
fn workspace() -> (tempfile::TempDir, Host) {
    let text = config("", ACCESS, ALLOW_ALL).replace(
        "[spaces.beta]\n",
        "[spaces.beta]\nreaders = [\"group:platform\", \"human:ada\"]\n",
    );
    let dir = support::workspace(&text);
    let mut grants = ALL_GRANTS.to_vec();
    grants.push("events");
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(StoreProbe::with_grants(&grants, true)))
    })
    .unwrap();
    (dir, host)
}

fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
}

fn acting_for(id: &str, person: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id(id)
        .with_on_behalf_of(person)
}

async fn as_actor(host: &Host, actor: Actor, command: &str, input: Value) -> CommandResult<Value> {
    call(host, actor, command, input).await
}

fn result(outcome: &CommandResult<Value>) -> Value {
    assert!(outcome.success, "{outcome:?}");
    outcome.data.clone().unwrap()["result"].clone()
}

fn code(outcome: &CommandResult<Value>) -> String {
    outcome.error.as_ref().expect("a failure").code.clone()
}

fn read(space: &str, op: &str, args: Value) -> Value {
    json!({ "space": space, "op": op, "args": args })
}

/// Three documents in `main`: public, platform-only and ada-only, all indexed with a shared word.
async fn seed(host: &Host) {
    let docs = [
        ("notes/open", json!(["space"])),
        ("notes/platform", json!(["group:platform"])),
        ("notes/ada", json!(["principal:human:ada"])),
    ];
    for (id, access) in docs {
        let put = as_actor(
            host,
            agent("writer"),
            "sp-write",
            read(
                "main",
                "doc-put",
                json!({"id": id, "text": "shared", "access": access}),
            ),
        )
        .await;
        assert!(put.success, "{put:?}");
        let index = as_actor(
            host,
            agent("writer"),
            "sp-write",
            read(
                "main",
                "index-replace",
                json!({"id": id, "text": "shared word", "access": access, "applied": 1}),
            ),
        )
        .await;
        assert!(index.success, "{index:?}");
    }
    let graph = as_actor(
        host,
        agent("writer"),
        "sp-write",
        read(
            "main",
            "graph-docs",
            json!({"ids": ["notes/open", "notes/platform", "notes/ada"], "applied": 3}),
        ),
    )
    .await;
    assert!(graph.success, "{graph:?}");
}

async fn listing(host: &Host, actor: Actor, space: &str) -> Value {
    result(&as_actor(host, actor, "sp-read", read(space, "doc-list", json!({}))).await)
}

#[tokio::test]
async fn readers_see_what_their_principal_and_groups_allow_on_every_read_path() {
    let (_dir, host) = workspace();
    seed(&host).await;

    // An agent no group holds: the public document only. Ids, counts and hits alike.
    let outsider = agent("loopback");
    assert_eq!(
        listing(&host, outsider.clone(), "main").await,
        json!(["notes/open"])
    );
    let search = as_actor(
        &host,
        outsider.clone(),
        "sp-read",
        read("main", "index-search", json!({"text": "shared"})),
    )
    .await;
    assert_eq!(result(&search), json!(["notes/open"]));
    let get = as_actor(
        &host,
        outsider.clone(),
        "sp-read",
        read("main", "doc-get", json!({"id": "notes/platform"})),
    )
    .await;
    assert_eq!(
        result(&get),
        Value::Null,
        "an unreadable document is absent, not forbidden"
    );
    let missing = as_actor(
        &host,
        outsider.clone(),
        "sp-read",
        read("main", "doc-get", json!({"id": "notes/nothing"})),
    )
    .await;
    assert_eq!(
        result(&missing),
        Value::Null,
        "absent and unreadable look alike"
    );
    let chunks = as_actor(
        &host,
        outsider.clone(),
        "sp-read",
        read("main", "index-chunks", json!({"id": "notes/ada"})),
    )
    .await;
    assert_eq!(result(&chunks), json!(0));
    let changes = as_actor(
        &host,
        outsider.clone(),
        "sp-read",
        read("main", "doc-changes", json!({})),
    )
    .await;
    assert_eq!(result(&changes), json!(["notes/open"]));

    // A member of the group `platform` also reads its document; the group's name is never theirs.
    assert_eq!(
        listing(&host, agent("ci"), "main").await,
        json!(["notes/open", "notes/platform"])
    );
    // An agent acting for `human:ada` is `human:ada`: it reads what Ada may.
    assert_eq!(
        listing(&host, acting_for("assistant", "ada"), "main").await,
        json!(["notes/ada", "notes/open"])
    );
    // `*` in a group's members includes the anonymous caller.
    let anonymous = Actor::new(ActorKind::Test).with_id("testkit");
    assert_eq!(
        listing(&host, anonymous, "main").await,
        json!(["notes/open"])
    );
}

#[tokio::test]
async fn restricted_ids_never_appear_in_the_graph_or_the_change_log_of_an_outsider() {
    let (_dir, host) = workspace();
    seed(&host).await;
    let outsider = agent("loopback");
    let ids =
        json!({"ids": ["doc:notes/platform", "doc:notes/open", "doc:notes/ada", "tag:shared"]});
    let nodes = as_actor(
        &host,
        outsider.clone(),
        "sp-read",
        read("main", "graph-nodes", ids.clone()),
    )
    .await;
    assert_eq!(result(&nodes), json!(["doc:notes/open", "tag:shared"]));
    let neighbors = as_actor(
        &host,
        outsider.clone(),
        "sp-read",
        read("main", "graph-neighbors", json!({"node": "tag:shared"})),
    )
    .await;
    assert_eq!(result(&neighbors), json!(["doc:notes/open>tag:shared"]));
    let subgraph = as_actor(
        &host,
        outsider.clone(),
        "sp-read",
        read("main", "graph-subgraph", json!({})),
    )
    .await;
    assert_eq!(
        result(&subgraph),
        json!({"nodes": ["doc:notes/open", "tag:shared"], "edges": 1})
    );
    // A member of the group sees its document's node and edge, and nothing of Ada's.
    let member = as_actor(
        &host,
        agent("ci"),
        "sp-read",
        read("main", "graph-subgraph", json!({})),
    )
    .await;
    assert_eq!(result(&member)["edges"], 2);
    let derived = as_actor(
        &host,
        agent("writer"),
        "sp-write",
        read("main", "derive-changes", json!({})),
    )
    .await;
    assert_eq!(
        result(&derived).as_array().unwrap().len(),
        3,
        "a derivation read is not filtered"
    );
}

#[tokio::test]
async fn a_reader_outside_a_spaces_readers_gets_space_not_readable_before_the_handler() {
    let (dir, host) = workspace();
    for actor in [
        agent("loopback"),
        human("bob"),
        acting_for("assistant", "bob"),
    ] {
        for (command, input) in [
            ("sp-read", read("beta", "doc-list", json!({}))),
            (
                "sp-write",
                read("beta", "doc-put", json!({"id": "notes/x", "text": "x"})),
            ),
            ("store-show", json!({"space": "beta"})),
            ("event-list", json!({"space": "beta"})),
        ] {
            let outcome = as_actor(&host, actor.clone(), command, input).await;
            assert_eq!(
                code(&outcome),
                "SPACE_NOT_READABLE",
                "{command}: {outcome:?}"
            );
        }
    }
    // Nothing ran: no store for `beta`, no event.
    assert!(!dir.path().join("state/spaces/beta/store").exists());
    assert!(support::events(dir.path(), "beta").is_empty());
    // A principal or group in `readers` passes, and so does an agent acting for Ada.
    for actor in [
        human("ada"),
        agent("ci"),
        human("grace"),
        acting_for("assistant", "ada"),
    ] {
        let outcome = as_actor(
            &host,
            actor.clone(),
            "sp-read",
            read("beta", "doc-list", json!({})),
        )
        .await;
        assert!(outcome.success, "{actor:?}: {outcome:?}");
    }
}

#[tokio::test]
async fn spaces_checks_every_spaces_readers() {
    let (_dir, host) = workspace();
    let outcome = as_actor(
        &host,
        agent("loopback"),
        "sp-read",
        json!({"spaces": ["main", "beta"], "op": "spaces"}),
    )
    .await;
    assert_eq!(code(&outcome), "SPACE_NOT_READABLE");
    let allowed = as_actor(
        &host,
        agent("ci"),
        "sp-read",
        json!({"spaces": ["main", "beta"], "op": "spaces"}),
    )
    .await;
    assert_eq!(result(&allowed), json!(["main", "beta"]));
}

#[tokio::test]
async fn store_show_counts_only_what_the_caller_can_read() {
    let (_dir, host) = workspace();
    seed(&host).await;
    let outsider = as_actor(&host, agent("loopback"), "store-show", json!({})).await;
    assert!(outsider.success, "{outsider:?}");
    let data = outsider.data.unwrap();
    assert_eq!(data["counts"]["documents"], 1);
    assert_eq!(data["counts"]["chunks"], 1);
    assert!(
        data.get("totals").is_none(),
        "totals are for a person at the CLI only: {data}"
    );
    // The head and the applied revisions are shown to every reader: a count leak accepted in
    // specification section 6.
    assert_eq!(data["head"], 3);
    assert_eq!(data["index"]["applied"], 1);
    let member = as_actor(&host, agent("ci"), "store-show", json!({})).await;
    assert_eq!(member.data.unwrap()["counts"]["documents"], 2);
}

#[tokio::test]
async fn event_list_skips_version_1_events_the_caller_cannot_read() {
    let (dir, host) = workspace();
    // One event readable by the space, one by the group `platform`, one by Ada only, each a
    // mutation of the probe with the access set its command supplies for its event.
    for (id, access) in [
        ("notes/open", json!(["space"])),
        ("notes/platform", json!(["group:platform"])),
        ("notes/ada", json!(["principal:human:ada"])),
    ] {
        let outcome = as_actor(
            &host,
            agent("writer"),
            "sp-write",
            read(
                "main",
                "doc-put",
                json!({"id": id, "text": "x", "access": access, "event_access": access}),
            ),
        )
        .await;
        assert!(outcome.success, "{outcome:?}");
    }
    assert_eq!(support::events(dir.path(), "main").len(), 3);
    let seqs = |outcome: &CommandResult<Value>| -> Vec<u64> {
        outcome.data.as_ref().unwrap()["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|event| event["seq"].as_u64().unwrap())
            .collect()
    };
    // The outsider sees one, with the gaps left where the others were skipped; the cursor still
    // moves to the end so the next read starts after them.
    let outsider = as_actor(&host, agent("loopback"), "event-list", json!({})).await;
    assert_eq!(seqs(&outsider), [1]);
    let data = outsider.data.unwrap();
    assert_eq!(data["cursor"], "v0:main:3");
    assert_eq!(data["hasMore"], false);
    let text = data.to_string();
    assert!(
        !text.contains("notes/platform") && !text.contains("notes/ada"),
        "{text}"
    );
    let member = as_actor(&host, agent("ci"), "event-list", json!({})).await;
    assert_eq!(seqs(&member), [1, 2]);
    let ada = as_actor(
        &host,
        acting_for("assistant", "ada"),
        "event-list",
        json!({}),
    )
    .await;
    assert_eq!(seqs(&ada), [1, 3]);
}

#[tokio::test]
async fn the_events_grant_reads_through_the_same_filter() {
    let (_dir, host) = workspace();
    for (id, access) in [
        ("notes/open", json!(["space"])),
        ("notes/platform", json!(["group:platform"])),
    ] {
        let outcome = as_actor(
            &host,
            agent("writer"),
            "sp-write",
            read(
                "main",
                "doc-put",
                json!({"id": id, "text": "x", "access": access, "event_access": access}),
            ),
        )
        .await;
        assert!(outcome.success, "{outcome:?}");
    }
    let seqs = |actor: Actor| {
        let host = &host;
        async move { result(&as_actor(host, actor, "sp-read", read("main", "events", json!({}))).await) }
    };
    assert_eq!(seqs(agent("loopback")).await, json!([1]));
    assert_eq!(seqs(agent("ci")).await, json!([1, 2]));
    // And a space nobody in `readers` is: the grant is refused as SPACE_NOT_READABLE.
    let refused = as_actor(
        &host,
        agent("loopback"),
        "sp-read",
        read("beta", "events", json!({})),
    )
    .await;
    assert_eq!(code(&refused), "SPACE_NOT_READABLE");
}

#[tokio::test]
async fn as_reader_evaluates_as_another_principal_from_the_cli_for_a_human_only() {
    let (dir, host) = workspace();
    seed(&host).await;
    let args = |principal: &str| json!({"space": "main", "op": "doc-list", "args": {"principal": principal}});
    // A human at the CLI (the library stands in for the interface here only by name): the
    // command is exposed to the CLI alone, and the call's actor is a human.
    let as_ada = as_actor(&host, human("local"), "sp-eval", args("human:ada")).await;
    assert_eq!(result(&as_ada), json!(["notes/ada", "notes/open"]));
    let as_ci = as_actor(&host, human("local"), "sp-eval", args("agent:ci")).await;
    assert_eq!(result(&as_ci), json!(["notes/open", "notes/platform"]));
    let as_nobody = as_actor(&host, human("local"), "sp-eval", args("agent:nobody")).await;
    assert_eq!(result(&as_nobody), json!(["notes/open"]));
    // The Reader answers search under the principal's filter too.
    let search = as_actor(
        &host,
        human("local"),
        "sp-eval",
        json!({"space": "main", "op": "index-search", "args": {"principal": "human:ada", "text": "shared"}}),
    )
    .await;
    assert_eq!(result(&search), json!(["notes/ada", "notes/open"]));
    // An agent, or a bad principal string, is refused.
    let agent_call = as_actor(&host, agent("ci"), "sp-eval", args("human:ada")).await;
    assert_eq!(code(&agent_call), "NOT_GRANTED");
    assert!(
        agent_call
            .error
            .unwrap()
            .message
            .contains("STORE_WRITE_NOT_ALLOWED")
    );
    let bad = as_actor(&host, human("local"), "sp-eval", args("ada")).await;
    assert_eq!(code(&bad), "INVALID");
    // `as_reader` on a space the principal may not read is SPACE_NOT_READABLE on the read.
    let beta = as_actor(
        &host,
        human("ada"),
        "sp-eval",
        json!({"space": "beta", "op": "doc-list", "args": {"principal": "agent:nobody"}}),
    )
    .await;
    assert_eq!(code(&beta), "NOT_GRANTED");
    assert!(beta.error.unwrap().message.contains("SPACE_NOT_READABLE"));
    // A command that is not CLI-only has no `as_reader`; `sp-read` is exposed everywhere and
    // its handler never asks. The workspace is kept alive to here.
    drop(dir);
}

#[tokio::test]
async fn workspace_show_says_how_far_access_filtering_holds() {
    let (_dir, host) = workspace();
    let shown = call(&host, human("local"), "workspace-show", json!({})).await;
    let data = shown.data.unwrap();
    assert_eq!(
        data["access"],
        json!({"principals": "unverified", "exact": ["library"]})
    );
    assert_eq!(data["versions"]["config"], 3);
    assert_eq!(data["versions"]["manifest"], json!([1, 2]));
    assert_eq!(data["versions"]["provenance"], 1);
    assert_eq!(data["versions"]["event"], 1);
    assert_eq!(data["versions"]["store"], 1);
}

#[tokio::test]
async fn reader_tokens_are_the_callers_own_tokens_and_nobody_elses() {
    let (_dir, host) = workspace();
    let tokens = |actor: Actor, space: &'static str| {
        let host = &host;
        async move {
            result(
                &as_actor(
                    host,
                    actor,
                    "sp-read",
                    read(space, "reader-tokens", json!({})),
                )
                .await,
            )
        }
    };
    // human:grace is in the group platform; the group everyone has `*` as a member.
    assert_eq!(
        tokens(human("grace"), "main").await,
        json!([
            "group:everyone",
            "group:platform",
            "principal:human:grace",
            "space"
        ])
    );
    // An agent acting for a person is that person.
    assert_eq!(
        tokens(acting_for("ci-bot", "grace"), "main").await,
        json!([
            "group:everyone",
            "group:platform",
            "principal:human:grace",
            "space"
        ])
    );
    assert_eq!(
        tokens(human("nobody"), "main").await,
        json!(["group:everyone", "principal:human:nobody", "space"])
    );
    // A space the caller may not read refuses before any token is given.
    let refused = as_actor(
        &host,
        human("nobody"),
        "sp-read",
        read("beta", "reader-tokens", json!({})),
    )
    .await;
    assert_eq!(code(&refused), "SPACE_NOT_READABLE");
}
