//! The exit criterion of phase 2 (specification section 12): the seeded thousand-document fixture
//! in two spaces, indexed from scratch, and four things asserted on it:
//!
//! 1. a thousand Markdown documents (and the code files) indexed, both indexes and graphs at their
//!    heads;
//! 2. no result crossing spaces without an explicit multi-space query;
//! 3. results filtered by principal, and a space the principal may not read refused;
//! 4. `knowledge-eval`'s report valid against `eval-report.v1.json`, meeting the gate, and written
//!    to a file (`UMBEL_EXIT_REPORT`; CI uploads it as an artifact).
//!
//! The fixture is synthetic with planted terms, so these numbers measure the pipeline and
//! regressions, not quality on real content.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeSet;

use afd::{Actor, ActorKind, CommandInterface};
use serde_json::{Value, json};
use support::eval::{Seeded, seeded};
use support::{build, code, data, json_of};
use umbel_plugin_knowledge::eval::fixture::{self, DEFAULT_SEED, MEMBER, READER};
use umbel_plugin_knowledge::eval::gate;
use umbel_plugin_knowledge::eval::queries::{EvalQuery, Kind};

fn actor(principal: &str) -> Actor {
    let (kind, id) = principal.split_once(':').unwrap();
    let kind = match kind {
        "human" => ActorKind::Human,
        "agent" => ActorKind::Agent,
        other => panic!("the fixture has no {other} principal"),
    };
    Actor::new(kind).with_id(id)
}

/// Call `command` over MCP as `principal`, on `host`.
async fn ask(host: &umbel::Host, principal: &str, command: &str, input: Value) -> Value {
    let context = host
        .context(actor(principal))
        .with_interface(CommandInterface::Mcp);
    json_of(host.registry().execute(command, input, Some(context)).await)
}

/// The ids of the documents of `space` that `principal` can list, optionally in one collection.
async fn listed(
    host: &umbel::Host,
    principal: &str,
    space: &str,
    collection: Option<&str>,
) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let mut after: Option<String> = None;
    loop {
        let mut input = json!({ "space": space, "limit": 500 });
        if let Some(collection) = collection {
            input["collection"] = json!(collection);
        }
        if let Some(after) = &after {
            input["after"] = json!(after);
        }
        let page = ask(host, principal, "knowledge-list", input).await;
        for doc in data(&page)["documents"].as_array().unwrap() {
            ids.insert(doc["id"].as_str().unwrap().to_owned());
        }
        match data(&page)["nextAfter"].as_str() {
            Some(next) => after = Some(next.to_owned()),
            None => return ids,
        }
    }
}

fn hits(result: &Value) -> Vec<(String, String)> {
    data(result)["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| {
            (
                hit["space"].as_str().unwrap().to_owned(),
                hit["doc"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

/// Section 12, point 1.
async fn indexed_and_caught_up(fixture: &Seeded) {
    for space in ["alpha", "beta"] {
        let refreshed = fixture
            .cli("knowledge-refresh", json!({ "space": space }))
            .await;
        assert_eq!(refreshed["success"], true, "{refreshed}");
    }
    for space in ["alpha", "beta"] {
        let rebuilt = fixture
            .cli(
                "knowledge-index",
                json!({ "space": space, "rebuild": true }),
            )
            .await;
        assert_eq!(rebuilt["success"], true, "{rebuilt}");
    }

    let documents = |collection: &str| {
        fixture
            .manifest
            .documents
            .get(collection)
            .copied()
            .unwrap_or(0)
    };
    assert_eq!(
        documents("alpha/handbook") + documents("alpha/runbooks"),
        600
    );
    assert_eq!(documents("alpha/code"), 50);
    assert_eq!(documents("beta/notes"), 400);

    let mut markdown = 0;
    for (space, expected) in [("alpha", 650_usize), ("beta", 400)] {
        let shown = fixture.cli("store-show", json!({ "space": space })).await;
        let shown = data(&shown);
        assert_eq!(shown["counts"]["documents"], expected, "{space}: {shown}");
        assert_eq!(shown["totals"]["documents"], expected, "{space}: {shown}");
        assert!(
            shown["counts"]["chunks"].as_u64().unwrap() >= expected as u64,
            "{shown}"
        );
        let head = shown["head"].as_u64().unwrap();
        assert!(head > 0);
        assert_eq!(
            shown["index"]["applied"], head,
            "{space}: the index is at the head"
        );
        assert_eq!(
            shown["graph"]["applied"], head,
            "{space}: the graph is at the head"
        );

        // What the listing finds in each collection is what the fixture wrote.
        let code_files = listed(&fixture.host, "human:local", space, Some("code")).await;
        let all = listed(&fixture.host, "human:local", space, None).await;
        assert_eq!(all.len(), expected);
        assert_eq!(code_files.len(), if space == "alpha" { 50 } else { 0 });
        markdown += all.len() - code_files.len();
    }
    assert_eq!(markdown, 1000, "a thousand Markdown documents");
}

/// Section 12, point 2.
async fn no_result_crosses_spaces(
    fixture: &Seeded,
    set: &fixture::Fixture,
    restricted: &BTreeSet<String>,
) {
    let host = &fixture.host;
    let mut searches = 0;
    for query in &set.queries {
        let EvalQuery {
            query: text,
            filters,
            principal,
            ..
        } = query;
        // Every query of the set, in each space on its own: only that space's hits come back,
        // including the queries whose words occur in both spaces.
        for space in ["alpha", "beta"] {
            let result = ask(
                host,
                principal,
                "knowledge-search",
                json!({ "query": text, "space": space, "filters": filters }),
            )
            .await;
            for (label, doc) in hits(&result) {
                assert_eq!(label, space, "{}: {doc} came back from {label}", query.id);
                if principal == READER {
                    assert!(
                        !restricted.contains(&doc),
                        "{}: the outsider was given the restricted {doc}",
                        query.id
                    );
                }
            }
            searches += 1;
        }
    }
    assert_eq!(searches, 2 * set.queries.len());
    eprintln!("single-space searches: {searches}");

    // The cross-space queries return `beta` hits only when `spaces` names it, each labeled.
    let cross: Vec<&EvalQuery> = set
        .queries
        .iter()
        .filter(|q| q.kind == Kind::CrossSpace)
        .collect();
    assert_eq!(cross.len(), 15);
    for query in cross {
        let alone = ask(
            host,
            &query.principal,
            "knowledge-search",
            json!({ "query": query.query, "space": "alpha" }),
        )
        .await;
        assert!(
            hits(&alone).iter().all(|(space, _)| space == "alpha"),
            "{}: {alone}",
            query.id
        );
        let both = ask(
            host,
            &query.principal,
            "knowledge-search",
            json!({ "query": query.query, "spaces": ["alpha", "beta"] }),
        )
        .await;
        assert_eq!(data(&both)["spaces"], json!(["alpha", "beta"]));
        let found = hits(&both);
        assert!(
            found.iter().any(|(space, _)| space == "beta"),
            "{}: the explicit query returns beta hits: {both}",
            query.id
        );
        assert!(
            found
                .iter()
                .all(|(space, _)| space == "alpha" || space == "beta"),
            "{}: every hit is labeled with one of the two spaces",
            query.id
        );
        let (answer, _) = query.qrels.iter().find(|(_, grade)| **grade == 2).unwrap();
        let (space, doc) = answer.split_once(':').unwrap();
        assert!(
            found.contains(&(space.to_owned(), doc.to_owned())),
            "{}: {answer} is among {found:?}",
            query.id
        );
    }

    // A document of one space is not there in the other.
    let in_alpha = set
        .topics
        .iter()
        .find(|t| t.space == "alpha" && !t.restricted)
        .unwrap()
        .answer
        .clone();
    let in_beta = set
        .topics
        .iter()
        .find(|t| t.space == "beta")
        .unwrap()
        .answer
        .clone();
    for (asked_in, doc, other) in [
        ("alpha", &in_beta, &in_alpha),
        ("beta", &in_alpha, &in_beta),
    ] {
        let open = ask(
            host,
            READER,
            "knowledge-open",
            json!({ "space": asked_in, "doc": doc }),
        )
        .await;
        assert_eq!(code(&open), "DOCUMENT_NOT_FOUND", "{open}");
        let neighbors = ask(
            host,
            READER,
            "knowledge-neighbors",
            json!({ "space": asked_in, "doc": doc }),
        )
        .await;
        assert_eq!(code(&neighbors), "DOCUMENT_NOT_FOUND", "{neighbors}");
        let related = ask(
            host,
            READER,
            "knowledge-related",
            json!({ "space": asked_in, "doc": doc }),
        )
        .await;
        assert_eq!(code(&related), "DOCUMENT_NOT_FOUND", "{related}");
        let path = ask(
            host,
            READER,
            "knowledge-path",
            json!({ "space": asked_in, "from": other, "to": doc }),
        )
        .await;
        assert_eq!(code(&path), "PATH_NOT_FOUND", "{path}");
        // The same document, asked for in its own space, is there.
        let own = if asked_in == "alpha" { "beta" } else { "alpha" };
        let open = ask(
            host,
            READER,
            "knowledge-open",
            json!({ "space": own, "doc": doc }),
        )
        .await;
        assert_eq!(open["success"], true, "{open}");
    }
}

/// Section 12, point 3.
async fn results_follow_the_principal(
    fixture: &Seeded,
    set: &fixture::Fixture,
    restricted: &BTreeSet<String>,
) {
    let host = &fixture.host;
    let probes: Vec<&EvalQuery> = set
        .queries
        .iter()
        .filter(|q| q.kind == Kind::Permission)
        .collect();
    assert_eq!(probes.len(), 20);
    assert_eq!(restricted.len(), 45, "the restricted share of the handbook");

    let mut linked_public = 0;
    for probe in &probes {
        let (answer, _) = probe.qrels.iter().next().unwrap();
        let answer = answer.strip_prefix("alpha:").unwrap();
        assert!(restricted.contains(answer));

        // As the outsider the probe finds no restricted document; as a member the answer is first.
        let outsider = ask(
            host,
            READER,
            "knowledge-search",
            json!({ "query": probe.query, "space": "alpha" }),
        )
        .await;
        assert!(
            hits(&outsider)
                .iter()
                .all(|(_, doc)| !restricted.contains(doc)),
            "{}: {outsider}",
            probe.id
        );
        let member = ask(
            host,
            MEMBER,
            "knowledge-search",
            json!({ "query": probe.query, "space": "alpha" }),
        )
        .await;
        assert_eq!(
            hits(&member).first().map(|(_, doc)| doc.as_str()),
            Some(answer),
            "{}: {member}",
            probe.id
        );

        // Opening the restricted document: absent for the outsider, there for the member.
        let closed = ask(
            host,
            READER,
            "knowledge-open",
            json!({ "space": "alpha", "doc": answer }),
        )
        .await;
        assert_eq!(code(&closed), "DOCUMENT_NOT_FOUND", "{closed}");
        let open = ask(
            host,
            MEMBER,
            "knowledge-open",
            json!({ "space": "alpha", "doc": answer }),
        )
        .await;
        assert_eq!(open["success"], true, "{open}");

        // The graph: a public document that links to the restricted one never names it to the
        // outsider, and no path to it exists for them.
        let inbound = ask(
            host,
            MEMBER,
            "knowledge-neighbors",
            json!({ "space": "alpha", "doc": answer, "direction": "in", "kinds": ["links_to"], "limit": 200 }),
        )
        .await;
        let citers: Vec<String> = data(&inbound)["edges"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|edge| edge["node"]["id"].as_str()?.strip_prefix("doc:"))
            .map(str::to_owned)
            .filter(|doc| !restricted.contains(doc))
            .collect();
        for citer in &citers {
            let around = ask(
                host,
                READER,
                "knowledge-neighbors",
                json!({ "space": "alpha", "doc": citer, "limit": 200 }),
            )
            .await;
            assert!(
                !data(&around).to_string().contains(answer),
                "{}: {citer} names the restricted {answer} to the outsider: {around}",
                probe.id
            );
            let path = ask(
                host,
                READER,
                "knowledge-path",
                json!({ "space": "alpha", "from": citer, "to": answer }),
            )
            .await;
            assert_eq!(code(&path), "PATH_NOT_FOUND", "{path}");
            // The member reaches it in one hop.
            let path = ask(
                host,
                MEMBER,
                "knowledge-path",
                json!({ "space": "alpha", "from": citer, "to": answer }),
            )
            .await;
            assert_eq!(data(&path)["hops"], 1, "{path}");
            linked_public += 1;
        }
    }
    eprintln!(
        "permission probes: {}; public citers of a restricted answer checked: {linked_public}",
        probes.len()
    );
    assert!(
        linked_public >= 1,
        "at least one restricted answer has a public citer to test the graph with"
    );

    // A space with `readers = ["group:restricted"]` refuses the outsider, and only the outsider.
    let config = std::fs::read_to_string(fixture.dir.path().join("umbel.toml")).unwrap();
    let closed = config.replacen(
        "[spaces.beta]\n",
        "[spaces.beta]\nreaders = [\"group:restricted\"]\n",
        1,
    );
    assert_ne!(config, closed);
    std::fs::write(fixture.dir.path().join("umbel.toml"), closed).unwrap();
    let closed_host = build(fixture.dir.path());
    let query = &probes[0].query;
    for (command, input) in [
        (
            "knowledge-search",
            json!({ "query": query, "space": "beta" }),
        ),
        (
            "knowledge-search",
            json!({ "query": query, "spaces": ["alpha", "beta"] }),
        ),
        ("knowledge-list", json!({ "space": "beta" })),
    ] {
        let refused = ask(&closed_host, READER, command, input.clone()).await;
        assert_eq!(code(&refused), "SPACE_NOT_READABLE", "{command}: {refused}");
        for reader in ["human:local", MEMBER] {
            let allowed = ask(&closed_host, reader, command, input.clone()).await;
            assert_eq!(allowed["success"], true, "{reader} {command}: {allowed}");
        }
    }
    let alpha = ask(
        &closed_host,
        READER,
        "knowledge-search",
        json!({ "query": query, "space": "alpha" }),
    )
    .await;
    assert_eq!(alpha["success"], true, "alpha stays readable: {alpha}");
}

/// Section 12, point 4.
async fn the_report_validates_and_meets_the_gate(fixture: &Seeded) {
    let result = fixture.eval().await;
    assert_eq!(result["success"], true, "{result}");
    let report = &result["data"];

    let path = match std::env::var("UMBEL_EXIT_REPORT") {
        Ok(path) => std::path::PathBuf::from(path),
        Err(_) => fixture.dir.path().join("exit-report.json"),
    };
    std::fs::write(&path, serde_json::to_string_pretty(report).unwrap()).unwrap();

    // Read back from the file: that is what the artifact holds.
    let written: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let schema =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/eval-report.v1.json");
    let schema: Value = serde_json::from_str(&std::fs::read_to_string(schema).unwrap()).unwrap();
    let validator = jsonschema::options().build(&schema).unwrap();
    let errors: Vec<String> = validator
        .iter_errors(&written)
        .map(|e| e.to_string())
        .collect();
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(written["queries"]["total"], 220);
    assert_eq!(written["queries"]["skipped"], 0);
    assert_eq!(written["leaks"], 0);

    let baseline: Value = serde_json::from_str(include_str!("../eval/baseline.json")).unwrap();
    assert_eq!(baseline["fixture"]["digest"], fixture.manifest.digest);
    if let Err(failures) = gate::check(&written, Some(&baseline)) {
        panic!("the gate failed:\n{}", failures.join("\n"));
    }
    eprintln!("report: {}", path.display());
    eprintln!("overall: {}", written["metrics"]["overall"]);
}

#[tokio::test]
async fn the_exit_criterion_of_phase_two() {
    let fixture = seeded();
    assert_eq!(fixture.manifest.seed, DEFAULT_SEED);
    let set = fixture::build(DEFAULT_SEED);

    indexed_and_caught_up(&fixture).await;

    // The restricted documents: those the person in the group lists and the outsider does not.
    let everything = listed(&fixture.host, "human:local", "alpha", None).await;
    let public = listed(&fixture.host, READER, "alpha", None).await;
    let restricted: BTreeSet<String> = everything.difference(&public).cloned().collect();

    no_result_crosses_spaces(&fixture, &set, &restricted).await;
    the_report_validates_and_meets_the_gate(&fixture).await;
    // Last: it rewrites the workspace's configuration.
    results_follow_the_principal(&fixture, &set, &restricted).await;
}
