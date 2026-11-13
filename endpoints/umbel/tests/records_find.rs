//! Reading and finding declared records through the SDK, on a fixture plugin (records host
//! specification, sections 7 and 15.2): a record with its three host members; key filters and
//! text; the three orders and their cursors; totals; section 7's refusals, each with its code;
//! and access: a reader who may not read a record never sees it, in a find by key, a find by
//! text, a total or a cursor, whoever it reads as.
//!
//! What a call admits (`standings`, `verified_only`) narrows a find of a standing kind and is
//! refused on a kind without standing; `records_standing.rs` holds what standing is.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, CommandResult};
use serde_json::{Value, json};
use std::path::Path;
use support::plugins::seal;
use support::records::{Notes, config};
use support::{agent, call};
use umbel::Host;
use umbel::plugins::sdk;

fn make(config_text: &str) -> (tempfile::TempDir, Host) {
    let dir = support::workspace(config_text);
    let host = host(dir.path());
    (dir, host)
}

fn host(dir: &Path) -> Host {
    seal(dir, |b| b.with_compiled(sdk(Notes::new()))).unwrap()
}

async fn run(
    host: &Host,
    actor: Actor,
    command: &str,
    op: &str,
    args: Value,
) -> CommandResult<Value> {
    call(host, actor, command, json!({ "op": op, "args": args })).await
}

fn result(outcome: &CommandResult<Value>) -> Value {
    assert!(outcome.success, "{outcome:?}");
    outcome.data.clone().unwrap()["result"].clone()
}

fn message(outcome: &CommandResult<Value>) -> String {
    assert!(!outcome.success, "expected a failure: {outcome:?}");
    outcome.error.as_ref().unwrap().message.clone()
}

async fn put(host: &Host, actor: Actor, kind: &str, id: &str, body: Value) {
    let written = run(
        host,
        actor,
        "notes-write",
        "put",
        json!({ "kind": kind, "id": id, "body": body }),
    )
    .await;
    assert!(written.success, "{written:?}");
}

async fn find(host: &Host, actor: Actor, query: Value) -> Value {
    result(&run(host, actor, "notes-read", "find", query).await)
}

async fn refused(host: &Host, op: &str, query: Value) -> String {
    message(&run(host, agent("ada"), "notes-read", op, query).await)
}

/// Every page of `query` at `limit` a page, by its cursors, to the end: the ids in order, and
/// each page's total.
async fn walk(host: &Host, actor: Actor, query: &Value, limit: u64) -> (Vec<String>, Vec<Value>) {
    let mut query = query.clone();
    query["limit"] = json!(limit);
    let (mut ids, mut totals) = (Vec::new(), Vec::new());
    for _ in 0..100 {
        let page = find(host, actor.clone(), query.clone()).await;
        let items = page["ids"].as_array().unwrap();
        assert!(items.len() as u64 <= limit);
        ids.extend(items.iter().map(|id| id.as_str().unwrap().to_owned()));
        totals.push(page["total"].clone());
        match page["next"].as_str() {
            Some(next) => query["after"] = json!(next),
            None => return (ids, totals),
        }
    }
    panic!("the cursors never ended");
}

fn note(statement: &str, bed: &str, tags: &[&str]) -> Value {
    json!({ "statement": statement, "bed": bed, "tags": tags })
}

/// Seven notes of the garden, readable by the space, in this order of writing.
async fn garden(host: &Host) {
    let notes = [
        (
            "d",
            note("Mulch the roses in autumn.", "north", &["roses", "soil"]),
        ),
        (
            "a",
            note("Roses want mulch, and more mulch.", "north", &["roses"]),
        ),
        (
            "g",
            note(
                "Water the tomatoes at the base.",
                "south",
                &["tomatoes", "watering"],
            ),
        ),
        (
            "b",
            note(
                "Mulch holds water through summer.",
                "south",
                &["soil", "watering"],
            ),
        ),
        (
            "f",
            note(
                "Prune the roses in late winter.",
                "east",
                &["roses", "pruning"],
            ),
        ),
        (
            "c",
            note("Tomatoes want six hours of sun.", "south", &["tomatoes"]),
        ),
        (
            "e",
            note(
                "Mulch, mulch and mulch again for roses.",
                "east",
                &["roses", "soil"],
            ),
        ),
    ];
    for (id, body) in notes {
        put(host, agent("ada"), "note", id, body).await;
    }
}

fn shared() -> String {
    config("default_access = \"space\"", "")
}

#[tokio::test]
async fn a_record_is_read_with_its_three_host_members() {
    let (_dir, host) = make(&shared());
    garden(&host).await;
    let got = result(
        &run(
            &host,
            agent("bo"),
            "notes-read",
            "read",
            json!({ "kind": "note", "id": "f" }),
        )
        .await,
    );
    let mut members: Vec<&str> = got
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    members.sort_unstable();
    assert_eq!(
        members,
        [
            "body",
            "contentHash",
            "dev.umbel/createdAt",
            "dev.umbel/flags",
            "dev.umbel/standing",
            "envelope",
            "id",
            "kind",
            "ns",
            "rev",
        ]
    );
    assert_eq!(
        (got["ns"].as_str(), got["kind"].as_str(), got["id"].as_str()),
        (Some("notes"), Some("note"), Some("f"))
    );
    assert_eq!(got["rev"], 5);
    assert_eq!(got["body"]["statement"], "Prune the roses in late winter.");
    assert_eq!(got["dev.umbel/createdAt"], got["envelope"]["observedAt"]);
    assert_eq!(
        got["dev.umbel/standing"],
        json!({ "standing": "unverified", "affirmed": null, "source": null }),
        "a standing record with no standing fact"
    );
    // Absent and not readable are one answer.
    let absent = result(
        &run(
            &host,
            agent("bo"),
            "notes-read",
            "read",
            json!({ "kind": "note", "id": "z" }),
        )
        .await,
    );
    assert_eq!(absent, Value::Null);
    // The first put's time stays through a later put.
    put(
        &host,
        agent("ada"),
        "note",
        "f",
        note("Prune the roses in late winter.", "west", &[]),
    )
    .await;
    let again = result(
        &run(
            &host,
            agent("bo"),
            "notes-read",
            "read",
            json!({ "kind": "note", "id": "f" }),
        )
        .await,
    );
    assert_eq!(again["dev.umbel/createdAt"], got["dev.umbel/createdAt"]);
    assert_eq!(again["rev"], 8);
}

#[tokio::test]
async fn key_filters_and_text_find_and_count() {
    let (_dir, host) = make(&shared());
    garden(&host).await;
    let ids = |page: &Value| page["ids"].clone();
    let by = |keys: Value| json!({ "kind": "note", "keys": keys });
    let page = find(
        &host,
        agent("bo"),
        by(json!([{ "key": "/bed", "any": ["north", "east"] }])),
    )
    .await;
    assert_eq!(
        (ids(&page), page["total"].clone()),
        (json!(["a", "d", "e", "f"]), json!(4))
    );
    let page = find(
        &host,
        agent("bo"),
        by(json!([{ "key": "/tags", "any": ["soil", "pruning"] }, { "key": "/bed", "any": ["east", "south"] }])),
    )
    .await;
    assert_eq!(
        (ids(&page), page["total"].clone()),
        (json!(["b", "e", "f"]), json!(3))
    );
    // Text under order `id` filters and does not rank.
    let page = find(
        &host,
        agent("bo"),
        json!({ "kind": "note", "text": { "query": "MULCH" } }),
    )
    .await;
    assert_eq!(
        (ids(&page), page["total"].clone()),
        (json!(["a", "b", "d", "e"]), json!(4))
    );
    let page = find(
        &host,
        agent("bo"),
        json!({ "kind": "note", "text": { "query": "tomato sun" },
            "keys": [{ "key": "/tags", "any": ["watering"] }] }),
    )
    .await;
    assert_eq!(ids(&page), json!(["g"]));
    assert_eq!(
        page["admitted"],
        json!(["unverified", "attested", "affirmed"])
    );
    assert_eq!(page["cut"], false);
    assert_eq!(page["next"], Value::Null);
    // A total is counted only when asked.
    let page = find(
        &host,
        agent("bo"),
        json!({ "kind": "note", "total": false }),
    )
    .await;
    assert_eq!(page["total"], Value::Null);
    // Over a kind with two text pointers, a named field alone is searched.
    put(
        &host,
        agent("ada"),
        "bed",
        "north",
        json!({ "name": "The rose bed", "about": "Morning sun, heavy soil.", "sun": "morning" }),
    )
    .await;
    put(
        &host,
        agent("ada"),
        "bed",
        "south",
        json!({ "name": "The sun trap", "about": "Roses sulk here.", "sun": ["noon", "evening"] }),
    )
    .await;
    let beds = |query: &str, fields: Value| json!({ "kind": "bed", "text": { "query": query, "fields": fields } });
    assert_eq!(
        ids(&find(&host, agent("bo"), beds("roses", json!([]))).await),
        json!(["north", "south"])
    );
    assert_eq!(
        ids(&find(&host, agent("bo"), beds("roses", json!(["/about"]))).await),
        json!(["south"])
    );
    assert_eq!(
        ids(&find(&host, agent("bo"), beds("sun", json!(["/name"]))).await),
        json!(["south"])
    );
    let page = find(
        &host,
        agent("bo"),
        json!({ "kind": "bed", "keys": [{ "key": "/sun", "any": ["evening"] }] }),
    )
    .await;
    assert_eq!(ids(&page), json!(["south"]));
    assert_eq!(
        page["items"][0]["dev.umbel/standing"],
        Value::Null,
        "a kind without standing has no label"
    );
}

#[tokio::test]
async fn the_three_orders_walk_their_cursors_to_the_end() {
    let (_dir, host) = make(&shared());
    garden(&host).await;
    // A later version of `g` moves nothing: recency is by the first put.
    put(
        &host,
        agent("ada"),
        "note",
        "g",
        note("Water the tomatoes at the base.", "west", &[]),
    )
    .await;
    let ranked_query =
        json!({ "kind": "note", "text": { "query": "mulch roses" }, "order": "rank" });
    let whole = find(&host, agent("bo"), ranked_query.clone()).await;
    let ranked: Vec<String> = whole["ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap().to_owned())
        .collect();
    let mut candidates = ranked.clone();
    candidates.sort();
    assert_eq!(
        candidates,
        ["a", "b", "d", "e", "f"],
        "the records that hold a term of the query"
    );
    assert_eq!(ranked[0], "e", "the record that says it most leads");
    assert!(
        whole["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item.get("score").is_none()),
        "the page carries no score: the order is the answer"
    );
    let owned = |ids: &[&str]| ids.iter().map(|id| (*id).to_owned()).collect::<Vec<_>>();
    let cases = [
        (
            json!({ "kind": "note" }),
            owned(&["a", "b", "c", "d", "e", "f", "g"]),
        ),
        (
            json!({ "kind": "note", "order": "recent" }),
            owned(&["e", "c", "f", "b", "g", "a", "d"]),
        ),
        (ranked_query.clone(), ranked),
    ];
    for (query, expected) in &cases {
        for limit in [1, 3, 50] {
            let (ids, totals) = walk(&host, agent("bo"), query, limit).await;
            assert_eq!(&ids, expected, "{query} in pages of {limit}");
            assert!(
                totals.iter().all(|total| *total == json!(expected.len())),
                "{query}: {totals:?}"
            );
        }
    }
    // A cursor is opaque, and is for the order that gave it.
    let mut first = json!({ "kind": "note", "limit": 2 });
    let next = find(&host, agent("bo"), first.clone()).await["next"]
        .as_str()
        .unwrap()
        .to_owned();
    first["after"] = json!(next);
    first["order"] = json!("recent");
    assert_eq!(
        refused(&host, "find", first).await,
        "invalid: RECORD_QUERY_INVALID: after is not a cursor this query's order gave"
    );
}

#[tokio::test]
async fn each_rule_of_a_find_refuses_with_its_code() {
    let (_dir, host) = make(&shared());
    garden(&host).await;
    let many: Vec<Value> = (0..9)
        .map(|_| json!({ "key": "/bed", "any": ["north"] }))
        .collect();
    let cases = [
        (
            json!({ "kind": "note", "keys": many }),
            "keys holds at most 8 filters",
        ),
        (
            json!({ "kind": "note", "keys": [{ "key": "/statement", "any": ["x"] }] }),
            "the pointer /statement of a key filter is not a key pointer of the declaration",
        ),
        (
            json!({ "kind": "note", "keys": [{ "key": "/bed", "any": [] }] }),
            "the key filter on /bed holds 1 to 64 values in any",
        ),
        (
            json!({ "kind": "note", "text": { "query": "" } }),
            "the text query is 1 to 1024 characters",
        ),
        (
            json!({ "kind": "note", "text": { "query": "..." } }),
            "the text query holds no token",
        ),
        (
            json!({ "kind": "note", "text": { "query": "roses", "fields": ["/bed"] } }),
            "the pointer /bed of the text query is not a text pointer of the declaration",
        ),
        (
            json!({ "kind": "note", "order": "rank" }),
            "order rank needs a text query",
        ),
        (
            json!({ "kind": "note", "limit": 0 }),
            "limit must be 1 to 200",
        ),
        (
            json!({ "kind": "note", "limit": 201 }),
            "limit must be 1 to 200",
        ),
        (
            json!({ "kind": "note", "after": "bm90IGEgY3Vyc29y" }),
            "after is not a cursor this query's order gave",
        ),
        (
            json!({ "kind": "bed", "verifiedOnly": true }),
            "standings must be empty and verified_only false for a kind without standing",
        ),
        (
            json!({ "kind": "bed", "standings": ["affirmed"] }),
            "standings must be empty and verified_only false for a kind without standing",
        ),
    ];
    for (query, rule) in cases {
        assert_eq!(
            refused(&host, "find", query.clone()).await,
            format!("invalid: RECORD_QUERY_INVALID: {rule}"),
            "{query}"
        );
    }
    assert_eq!(
        refused(
            &host,
            "read",
            json!({ "kind": "bed", "id": "x", "verifiedOnly": true })
        )
        .await,
        "invalid: RECORD_QUERY_INVALID: standings must be empty and verified_only false for a kind without standing"
    );
    // A refusal never holds the query's text or a filter's value.
    let long = refused(
        &host,
        "find",
        json!({ "kind": "note", "text": { "query": "canary".repeat(200) } }),
    )
    .await;
    assert!(!long.contains("canary"), "{long}");
    // On a standing kind a call may ask for a standing: it is answered, with what it admitted.
    // Nothing here is affirmed or attested, so a call for verified content is given nothing.
    for (query, admitted) in [
        (
            json!({ "kind": "note", "verifiedOnly": true }),
            json!(["affirmed"]),
        ),
        (
            json!({ "kind": "note", "standings": ["affirmed"] }),
            json!(["affirmed"]),
        ),
        (
            json!({ "kind": "note", "standings": ["attested"], "verifiedOnly": true }),
            json!([]),
        ),
    ] {
        let page = result(&run(&host, agent("ada"), "notes-read", "find", query).await);
        assert_eq!(page["admitted"], admitted, "{page}");
        assert_eq!(page["total"], 0, "{page}");
        assert_eq!(page["ids"], json!([]), "{page}");
    }
    let unverified = json!({ "kind": "note", "standings": ["unverified"] });
    let page = result(&run(&host, agent("ada"), "notes-read", "find", unverified).await);
    assert_eq!(page["admitted"], json!(["unverified"]), "{page}");
    assert_ne!(page["total"], 0, "{page}");
    assert_eq!(
        refused(&host, "find", json!({ "kind": "seed" })).await,
        "invalid: RECORD_KIND_NOT_DECLARED: the kind seed is not a declared record kind of notes"
    );
}

#[tokio::test]
async fn a_reader_never_sees_a_record_it_may_not_read() {
    // Records are private to their writer: each of three callers holds some, their ids
    // interleaved, with the same words and the same keys.
    let (dir, host) = make(&config("", ""));
    let body = || {
        note(
            "Mulch keeps the soil cool for the roses.",
            "south",
            &["soil"],
        )
    };
    let owners = [
        ("n1", "ada"),
        ("n2", "bo"),
        ("n3", "ada"),
        ("n4", "cy"),
        ("n5", "bo"),
        ("n6", "ada"),
    ];
    for (id, owner) in owners {
        put(&host, agent(owner), "note", id, body()).await;
    }
    let queries = [
        ("by id", json!({ "kind": "note" })),
        (
            "by key",
            json!({ "kind": "note", "keys": [{ "key": "/tags", "any": ["soil"] }] }),
        ),
        (
            "by text",
            json!({ "kind": "note", "text": { "query": "mulch roses" } }),
        ),
        (
            "ranked",
            json!({ "kind": "note", "text": { "query": "mulch roses" }, "order": "rank" }),
        ),
        ("by recency", json!({ "kind": "note", "order": "recent" })),
    ];
    for reader in ["ada", "bo", "cy", "dee"] {
        let mut own: Vec<String> = owners
            .iter()
            .filter(|(_, owner)| *owner == reader)
            .map(|(id, _)| (*id).to_owned())
            .collect();
        own.sort();
        for (id, owner) in owners {
            let got = result(
                &run(
                    &host,
                    agent(reader),
                    "notes-read",
                    "read",
                    json!({ "kind": "note", "id": id }),
                )
                .await,
            );
            assert_eq!(got.is_null(), owner != reader, "{reader} reads {id}");
        }
        for (what, query) in &queries {
            // One record a page: every cursor is a place between two records.
            let (mut ids, totals) = walk(&host, agent(reader), query, 1).await;
            ids.sort();
            assert_eq!(ids, own, "{reader}, {what}: its own records and no other");
            assert!(
                totals.iter().all(|total| *total == json!(own.len())),
                "{reader}, {what}: the total counts its own records: {totals:?}"
            );
            let page = find(&host, agent(reader), query.clone()).await;
            assert_eq!(page["total"], json!(own.len()), "{reader}, {what}");
            assert!(
                page["items"].as_array().unwrap().iter().all(|item| {
                    item["envelope"]["access"] == json!([format!("principal:agent:{reader}")])
                }),
                "{reader}, {what}"
            );
        }
    }
    // A cursor one reader was given is no way into another's records.
    let adas = find(&host, agent("ada"), json!({ "kind": "note", "limit": 1 })).await;
    let page = find(
        &host,
        agent("bo"),
        json!({ "kind": "note", "after": adas["next"] }),
    )
    .await;
    assert_eq!(page["ids"], json!(["n2", "n5"]));
    // Reading as another principal, from the command line, reads what that principal reads.
    drop(host);
    for (principal, own) in [("agent:bo", json!(["n2", "n5"])), ("agent:dee", json!([]))] {
        let input = json!({ "op": "find", "args": { "principal": principal, "kind": "note",
            "text": { "query": "mulch" }, "order": "rank" } })
        .to_string();
        let cli = support::cli_with(
            dir.path(),
            &["call", "notes-eval", &input],
            support::Scripted::no_terminal(),
            |b| b.with_compiled(sdk(Notes::new())),
        )
        .await;
        assert_eq!(cli.code, 0, "{}", cli.stdout);
        let page = &cli.json()["data"]["result"];
        let mut ids: Vec<&str> = page["ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_str().unwrap())
            .collect();
        ids.sort_unstable();
        assert_eq!(json!(ids), own, "{principal}");
        assert_eq!(
            page["total"],
            json!(own.as_array().unwrap().len()),
            "{principal}"
        );
    }
    let input =
        json!({ "op": "read", "args": { "principal": "agent:bo", "kind": "note", "id": "n1" } })
            .to_string();
    let cli = support::cli_with(
        dir.path(),
        &["call", "notes-eval", &input],
        support::Scripted::no_terminal(),
        |b| b.with_compiled(sdk(Notes::new())),
    )
    .await;
    assert_eq!(
        cli.json()["data"]["result"],
        Value::Null,
        "bo does not read ada's note"
    );
}

#[tokio::test]
async fn records_a_reader_cannot_read_change_nothing_it_finds() {
    let (_dir, host) = make(&config("", ""));
    for (id, statement) in [
        ("n2", "Mulch keeps the soil cool."),
        ("n4", "Water the roses at the base."),
        ("n6", "Mulch the roses in autumn."),
    ] {
        put(
            &host,
            agent("ada"),
            "note",
            id,
            note(statement, "south", &["soil"]),
        )
        .await;
    }
    let queries = [
        json!({ "kind": "note" }),
        json!({ "kind": "note", "order": "recent", "limit": 2 }),
        json!({ "kind": "note", "keys": [{ "key": "/bed", "any": ["south"] }] }),
        json!({ "kind": "note", "text": { "query": "mulch roses soil" } }),
        json!({ "kind": "note", "text": { "query": "mulch roses soil" }, "order": "rank" }),
        json!({ "kind": "note", "text": { "query": "mulch roses soil" }, "order": "rank", "limit": 1 }),
    ];
    let mut before = Vec::new();
    for query in &queries {
        before.push(find(&host, agent("ada"), query.clone()).await.to_string());
    }
    // Another caller's private notes: the same words, between ada's ids, written and changed.
    for id in ["n1", "n3", "n5", "n7"] {
        put(
            &host,
            agent("bo"),
            "note",
            id,
            note("Mulch, roses and soil: mulch the soil.", "south", &["soil"]),
        )
        .await;
    }
    put(
        &host,
        agent("bo"),
        "note",
        "n3",
        note(
            "Mulch, roses and soil: mulch the soil.",
            "north",
            &["roses"],
        ),
    )
    .await;
    for (query, before) in queries.iter().zip(&before) {
        assert_eq!(
            &find(&host, agent("ada"), query.clone()).await.to_string(),
            before,
            "{query}: byte for byte what it was"
        );
    }
}
