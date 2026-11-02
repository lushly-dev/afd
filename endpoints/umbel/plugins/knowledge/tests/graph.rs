//! The structural graph (specification sections 7.3 and 8.5): every node and edge kind, co-citation
//! per citer and its cap, a restricted citer not raising a public pair's weight, readable backlink
//! counts, the graph commands, endpoint and origin filtering, and no edge across spaces.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

/// `(direction, kind, other node, weight)` of every edge `knowledge-neighbors` returned.
fn edges(result: &Value) -> Vec<(String, String, String, u64)> {
    data(result)["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|edge| {
            (
                edge["direction"].as_str().unwrap().to_owned(),
                edge["kind"].as_str().unwrap().to_owned(),
                edge["node"]["id"].as_str().unwrap().to_owned(),
                edge["weight"].as_u64().unwrap(),
            )
        })
        .collect()
}

fn edge(direction: &str, kind: &str, other: &str, weight: u64) -> (String, String, String, u64) {
    (
        direction.to_owned(),
        kind.to_owned(),
        other.to_owned(),
        weight,
    )
}

async fn neighbors(fx: &Fx, actor: afd::Actor, input: Value) -> Value {
    fx.as_actor(actor, "knowledge-neighbors", input).await
}

fn restricted(title: &str, body: &str) -> String {
    format!("---\ntitle: {title}\naccess: [group:platform]\n---\n# {title}\n\n{body}\n")
}

/// A small knowledge base with every node and edge kind.
async fn base() -> Fx {
    let fx = Fx::new();
    fx.handbook(
        "deploy/rollback.md",
        "---\ntitle: Rollback\ntags: [ops, deploy]\nowners: [\"human:ada\"]\n---\n# Rollback\n\n## Steps\n\nSee [canary](canary.md), [flags](../flags.md#kill-switch) and [canary again](canary.md).\n\n### Detail\n\nMore.\n",
    );
    fx.handbook(
        "deploy/canary.md",
        "---\ntitle: Canary\ntags: [ops]\n---\n# Canary\n\nShip to one host.\n",
    );
    fx.handbook(
        "flags.md",
        "---\ntitle: Flags\n---\n# Flags\n\n## Kill switch\n\nTurn it off.\n",
    );
    fx.handbook(
        "old.md",
        "---\ntitle: Old\nstatus: deprecated\nsuperseded_by: handbook/new\n---\n# Old\n\nGone.\n",
    );
    fx.handbook("new.md", "---\ntitle: New\n---\n# New\n\nHere.\n");
    fx.refresh("main").await;
    fx
}

#[tokio::test]
async fn every_node_and_edge_kind_is_built_from_the_documents() {
    let fx = base().await;
    let doc = neighbors(
        &fx,
        human("local"),
        json!({ "doc": "handbook/deploy/rollback", "direction": "out" }),
    )
    .await;
    let out = edges(&doc);
    for expected in [
        edge("out", "tagged", "tag:ops", 1),
        edge("out", "tagged", "tag:deploy", 1),
        edge("out", "owned_by", "owner:human:ada", 1),
        // Two links to canary, one to flags; a link with a fragment also reaches the heading.
        edge("out", "links_to", "doc:handbook/deploy/canary", 2),
        edge("out", "links_to", "doc:handbook/flags", 1),
        edge("out", "links_to", "heading:handbook/flags#kill-switch", 1),
        edge(
            "out",
            "contains",
            "heading:handbook/deploy/rollback#rollback",
            1,
        ),
    ] {
        assert!(out.contains(&expected), "{expected:?} missing from {out:?}");
    }
    // The directory holds the document.
    let inward = neighbors(
        &fx,
        human("local"),
        json!({ "doc": "handbook/deploy/rollback", "direction": "in", "kinds": ["contains"] }),
    )
    .await;
    assert_eq!(
        edges(&inward),
        [edge("in", "contains", "dir:handbook/deploy", 1)]
    );
    // Directories nest down from the collection.
    let dir = neighbors(
        &fx,
        human("local"),
        json!({ "node": "dir:handbook", "direction": "out", "kinds": ["contains"] }),
    )
    .await;
    let kids = edges(&dir);
    assert!(kids.contains(&edge("out", "contains", "dir:handbook/deploy", 1)));
    assert!(kids.contains(&edge("out", "contains", "doc:handbook/flags", 1)));
    // Headings nest: the h1 holds the h2, the h2 the h3.
    let heading = neighbors(
        &fx,
        human("local"),
        json!({ "node": "heading:handbook/deploy/rollback#steps", "direction": "out" }),
    )
    .await;
    assert_eq!(
        edges(&heading),
        [edge(
            "out",
            "contains",
            "heading:handbook/deploy/rollback#detail",
            1
        )]
    );
    // The replacement supersedes the deprecated document.
    let old = neighbors(
        &fx,
        human("local"),
        json!({ "doc": "handbook/old", "kinds": ["supersedes"] }),
    )
    .await;
    assert_eq!(
        edges(&old),
        [edge("in", "supersedes", "doc:handbook/new", 1)]
    );
    // The two documents rollback links to are co-cited by it, in both directions.
    let canary = neighbors(
        &fx,
        human("local"),
        json!({ "doc": "handbook/deploy/canary", "kinds": ["co_cited"] }),
    )
    .await;
    assert_eq!(
        edges(&canary),
        [
            edge("out", "co_cited", "doc:handbook/flags", 1),
            edge("in", "co_cited", "doc:handbook/flags", 1)
        ]
    );
    // Backlinks are links_to read the other way.
    let backlinks = neighbors(
        &fx,
        human("local"),
        json!({ "doc": "handbook/deploy/canary", "direction": "in", "kinds": ["links_to"] }),
    )
    .await;
    assert_eq!(
        edges(&backlinks),
        [edge("in", "links_to", "doc:handbook/deploy/rollback", 2)]
    );
    // A tag node lists the documents that hold it.
    let tag = neighbors(&fx, human("local"), json!({ "node": "tag:ops" })).await;
    assert_eq!(
        edges(&tag),
        [
            edge("in", "tagged", "doc:handbook/deploy/canary", 1),
            edge("in", "tagged", "doc:handbook/deploy/rollback", 1)
        ]
    );
    // Labels are the documents' titles, labeled as content.
    let first = &data(&doc)["edges"][0];
    assert_eq!(first["node"]["trust"], "content");
    assert_eq!(data(&doc)["node"]["label"], "Rollback");
}

#[tokio::test]
async fn an_index_run_reports_the_graph_and_applies_it_with_the_exact_head() {
    let fx = Fx::new();
    fx.handbook("a.md", "# A\n\nSee [b](b.md).\n");
    fx.handbook("b.md", "# B\n\nBack to [a](a.md).\n");
    assert_eq!(fx.cli("sources-sync", json!({})).await["success"], true);
    let run = fx.cli("knowledge-index", json!({})).await;
    let report = data(&run);
    assert_eq!(report["graph"]["documents"], 2);
    assert!(report["graph"]["nodes"].as_u64().unwrap() >= 6);
    assert!(report["graph"]["edges"].as_u64().unwrap() >= 6);
    assert_eq!(report["graph"]["brokenLinks"], 0);
    // Both stores reflect the head, and the metadata names the true head.
    assert_eq!(report["graphApplied"], report["indexApplied"]);
    assert_eq!(report["head"], report["applied"]);
    assert_eq!(
        run["metadata"]["dev.umbel/index"]["main"]["head"],
        report["head"]
    );
    // Run again: nothing to do, nothing rebuilt.
    let again = fx.cli("knowledge-index", json!({})).await;
    assert_eq!(data(&again)["graph"]["documents"], 0);
    // A link to nothing is counted as broken.
    fx.handbook("c.md", "# C\n\nSee [nothing](missing.md) and [a](a.md).\n");
    fx.refresh("main").await;
    let third = fx.cli("knowledge-index", json!({ "rebuild": true })).await;
    assert_eq!(data(&third)["graph"]["brokenLinks"], 1, "{third}");
    assert_eq!(data(&third)["graphApplied"], data(&third)["head"]);
}

#[tokio::test]
async fn a_changed_document_replaces_its_edges_and_a_deleted_one_loses_them() {
    let fx = base().await;
    fx.handbook(
        "deploy/rollback.md",
        "---\ntitle: Rollback\n---\n# Rollback\n\nSee [flags](../flags.md) only.\n",
    );
    fx.remove("spaces/main/handbook/old.md");
    fx.refresh("main").await;
    let out = neighbors(
        &fx,
        human("local"),
        json!({ "doc": "handbook/deploy/rollback", "direction": "out" }),
    )
    .await;
    let kinds: Vec<String> = edges(&out).into_iter().map(|e| e.1).collect();
    assert!(!kinds.contains(&"tagged".to_owned()), "{kinds:?}");
    assert!(!kinds.contains(&"owned_by".to_owned()), "{kinds:?}");
    assert!(
        !edges(&out).iter().any(|e| e.2.ends_with("canary")),
        "{out}"
    );
    // The deleted document is gone, and so is its supersession.
    let gone = neighbors(&fx, human("local"), json!({ "doc": "handbook/old" })).await;
    assert_eq!(code(&gone), "DOCUMENT_NOT_FOUND");
    let new = neighbors(
        &fx,
        human("local"),
        json!({ "doc": "handbook/new", "kinds": ["supersedes"] }),
    )
    .await;
    assert!(edges(&new).is_empty(), "{new}");
    // A rebuild produces exactly the same graph.
    let before = neighbors(&fx, human("local"), json!({ "node": "dir:handbook" })).await;
    fx.cli("knowledge-index", json!({ "rebuild": true })).await;
    let after = neighbors(&fx, human("local"), json!({ "node": "dir:handbook" })).await;
    assert_eq!(edges(&before), edges(&after));
}

#[tokio::test]
async fn co_citation_is_stored_per_citer_and_one_citer_contributes_at_most_fifty_targets() {
    let fx = Fx::new();
    let mut citer = String::from("# Citer\n\n");
    for n in 0..52 {
        fx.handbook(&format!("t{n:02}.md"), &format!("# T{n}\n\nTarget.\n"));
        citer.push_str(&format!("- [t{n:02}](t{n:02}.md)\n"));
    }
    fx.handbook("citer.md", &citer);
    fx.refresh("main").await;
    let co =
        |doc: &str| json!({ "doc": doc, "kinds": ["co_cited"], "direction": "out", "limit": 200 });
    // The first target pairs with the other 49 of the first fifty: 50 targets, 49 partners.
    let first = neighbors(&fx, human("local"), co("handbook/t00")).await;
    assert_eq!(edges(&first).len(), 49, "{first}");
    assert!(edges(&first).iter().all(|e| e.3 == 1));
    assert!(!edges(&first).iter().any(|e| e.2 == "doc:handbook/t50"));
    // The last two are past the cap: no pair at all.
    for past in ["handbook/t50", "handbook/t51"] {
        let result = neighbors(&fx, human("local"), co(past)).await;
        assert!(edges(&result).is_empty(), "{past}: {result}");
    }
    let described = fx
        .cli("knowledge-describe", json!({ "doc": "handbook/citer" }))
        .await;
    let cited = &data(&described)["links"]["coCitation"];
    assert_eq!(cited["targets"], 52);
    assert_eq!(cited["limit"], 50);
    assert_eq!(cited["capped"], true);

    // A second citer of two of them raises that pair's weight to two.
    fx.handbook("citer-two.md", "# Two\n\n[a](t00.md) [b](t01.md)\n");
    fx.refresh("main").await;
    let pair = neighbors(
        &fx,
        human("local"),
        json!({ "doc": "handbook/t00", "kinds": ["co_cited"], "direction": "out", "limit": 200 }),
    )
    .await;
    let weight = edges(&pair)
        .into_iter()
        .find(|e| e.2 == "doc:handbook/t01")
        .unwrap()
        .3;
    assert_eq!(weight, 2);
}

/// Two public documents cited together by one public document and by one restricted document.
async fn cited_together() -> Fx {
    let fx = Fx::new();
    fx.handbook(
        "x.md",
        "---\ntitle: Xenon guide\n---\n# Xenon guide\n\nxenon lamp\n",
    );
    fx.handbook(
        "y.md",
        "---\ntitle: Yttrium guide\n---\n# Yttrium guide\n\nyttrium lamp\n",
    );
    fx.handbook(
        "public-citer.md",
        "# Public citer\n\n[x](x.md) and [y](y.md)\n",
    );
    fx.handbook(
        "private-citer.md",
        &restricted("Private citer", "[x](x.md) and [y](y.md)"),
    );
    fx.refresh("main").await;
    fx
}

#[tokio::test]
async fn a_restricted_citer_does_not_raise_a_public_pairs_weight() {
    let fx = cited_together().await;
    let ask = json!({ "doc": "handbook/x", "kinds": ["co_cited"], "direction": "out" });
    let outside = neighbors(&fx, outsider(), ask.clone()).await;
    assert_eq!(
        edges(&outside),
        [edge("out", "co_cited", "doc:handbook/y", 1)]
    );
    let inside = neighbors(&fx, member(), ask).await;
    assert_eq!(
        edges(&inside),
        [edge("out", "co_cited", "doc:handbook/y", 2)]
    );
    never_mentions(&outside, &["private-citer", "Private citer"]);

    // A pair counts for related documents and for expansion only at weight two.
    let related = |actor: afd::Actor| {
        let fx = &fx;
        async move {
            fx.as_actor(actor, "knowledge-related", json!({ "doc": "handbook/x" }))
                .await
        }
    };
    let reasons = |result: &Value, doc: &str| -> Vec<String> {
        data(result)["related"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["doc"] == doc)
            .map(|row| {
                row["reasons"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|r| r["kind"].as_str().unwrap().to_owned())
                    .collect()
            })
            .unwrap_or_default()
    };
    let outside = related(outsider()).await;
    assert!(
        !reasons(&outside, "handbook/y").contains(&"co_cited".to_owned()),
        "{outside}"
    );
    let inside = related(member()).await;
    assert!(
        reasons(&inside, "handbook/y").contains(&"co_cited".to_owned()),
        "{inside}"
    );
    never_mentions(&outside, &["private-citer"]);

    let search = |actor: afd::Actor| {
        let fx = &fx;
        async move { fx.search(actor, json!({ "query": "xenon" })).await }
    };
    // x is cited together with y by one reader-visible citer only: y is not expanded to, but the
    // public citer, a backlink of x, is.
    let outside = search(outsider()).await;
    assert!(
        !hit_ids(&outside).contains(&"handbook/y".to_owned()),
        "{outside}"
    );
    assert!(
        !hit_ids(&outside).contains(&"handbook/private-citer".to_owned()),
        "{outside}"
    );
    never_mentions(&outside, &["private-citer", "Private citer"]);
    let inside = search(member()).await;
    assert!(
        hit_ids(&inside).contains(&"handbook/y".to_owned()),
        "{inside}"
    );
}

#[tokio::test]
async fn backlink_counts_and_neighbors_include_only_origins_the_reader_can_read() {
    let fx = Fx::new();
    fx.handbook("target.md", "# Target\n\nBody.\n");
    fx.handbook("open.md", "# Open\n\n[t](target.md)\n");
    fx.handbook("secret.md", &restricted("Secret", "[t](target.md)"));
    fx.refresh("main").await;
    let describe = |actor: afd::Actor| {
        let fx = &fx;
        async move {
            fx.as_actor(
                actor,
                "knowledge-describe",
                json!({ "doc": "handbook/target" }),
            )
            .await
        }
    };
    assert_eq!(data(&describe(outsider()).await)["backlinks"]["count"], 1);
    assert_eq!(data(&describe(member()).await)["backlinks"]["count"], 2);
    let ask = json!({ "doc": "handbook/target", "direction": "in", "kinds": ["links_to"] });
    let outside = neighbors(&fx, outsider(), ask.clone()).await;
    assert_eq!(
        edges(&outside),
        [edge("in", "links_to", "doc:handbook/open", 1)]
    );
    assert_eq!(data(&outside)["count"], 1);
    never_mentions(&outside, &["secret", "Secret"]);
    assert_eq!(edges(&neighbors(&fx, member(), ask).await).len(), 2);
}

#[tokio::test]
async fn graph_commands_never_name_or_count_a_document_the_reader_cannot_read() {
    let fx = Fx::new();
    fx.handbook(
        "p.md",
        "---\ntitle: Public page\ntags: [shared]\n---\n# Public page\n\nSee [q](q.md) and [h](h.md).\n",
    );
    fx.handbook(
        "q.md",
        "---\ntitle: Open page\ntags: [shared]\n---\n# Open page\n\nOpen.\n",
    );
    fx.handbook(
        "h.md",
        "---\ntitle: Hidden page\naccess: [group:platform]\ntags: [lonely-hidden-tag, shared]\nowners: [\"human:hidden-owner\"]\n---\n# Hidden page\n\nHidden [p](p.md).\n",
    );
    fx.handbook(
        "hidden-dir/inside.md",
        &restricted("Inside the hidden directory", "x"),
    );
    fx.refresh("main").await;
    const HIDDEN: &[&str] = &[
        "handbook/h",
        "Hidden page",
        "lonely-hidden-tag",
        "hidden-owner",
        "hidden-dir",
        "Inside the hidden",
    ];
    let page = neighbors(&fx, outsider(), json!({ "doc": "handbook/p" })).await;
    never_mentions(&page, HIDDEN);
    assert!(edges(&page).iter().any(|e| e.2 == "doc:handbook/q"));
    assert!(!edges(&page).iter().any(|e| e.2 == "doc:handbook/h"));
    let member_page = neighbors(&fx, member(), json!({ "doc": "handbook/p" })).await;
    assert!(edges(&member_page).iter().any(|e| e.2 == "doc:handbook/h"));
    assert!(edges(&member_page).len() > edges(&page).len());

    // The hidden document, its private tag and its directory do not exist for an outsider.
    for (input, code_expected) in [
        (json!({ "doc": "handbook/h" }), "DOCUMENT_NOT_FOUND"),
        (json!({ "node": "doc:handbook/h" }), "DOCUMENT_NOT_FOUND"),
        (json!({ "node": "tag:lonely-hidden-tag" }), "NODE_NOT_FOUND"),
        (
            json!({ "node": "owner:human:hidden-owner" }),
            "NODE_NOT_FOUND",
        ),
        (
            json!({ "node": "dir:handbook/hidden-dir" }),
            "NODE_NOT_FOUND",
        ),
    ] {
        let result = neighbors(&fx, outsider(), input.clone()).await;
        assert_eq!(code(&result), code_expected, "{input}: {result}");
        never_mentions(&result, HIDDEN);
    }
    // A tag both kinds of document hold lists only the readable holders.
    let shared = neighbors(&fx, outsider(), json!({ "node": "tag:shared" })).await;
    assert_eq!(data(&shared)["count"], 2, "{shared}");
    never_mentions(&shared, HIDDEN);
    assert_eq!(
        data(&neighbors(&fx, member(), json!({ "node": "tag:shared" })).await)["count"],
        3
    );
    // Related, path, outline and stale say nothing of it either.
    let related = fx
        .as_actor(
            outsider(),
            "knowledge-related",
            json!({ "doc": "handbook/p" }),
        )
        .await;
    never_mentions(&related, HIDDEN);
    let related_hidden = fx
        .as_actor(
            outsider(),
            "knowledge-related",
            json!({ "doc": "handbook/h" }),
        )
        .await;
    assert_eq!(code(&related_hidden), "DOCUMENT_NOT_FOUND");
    let path = fx
        .as_actor(
            outsider(),
            "knowledge-path",
            json!({ "from": "handbook/p", "to": "handbook/h" }),
        )
        .await;
    assert_eq!(code(&path), "PATH_NOT_FOUND");
    never_mentions(&path, HIDDEN);
    let tree = fx
        .as_actor(
            outsider(),
            "knowledge-outline",
            json!({ "collection": "handbook" }),
        )
        .await;
    never_mentions(&tree, HIDDEN);
    let stale = fx.as_actor(outsider(), "knowledge-stale", json!({})).await;
    never_mentions(&stale, HIDDEN);
    let outline_hidden = fx
        .as_actor(
            outsider(),
            "knowledge-outline",
            json!({ "doc": "handbook/h" }),
        )
        .await;
    assert_eq!(code(&outline_hidden), "DOCUMENT_NOT_FOUND");
}

#[tokio::test]
async fn a_path_never_passes_through_a_document_the_reader_cannot_read() {
    let fx = Fx::new();
    fx.handbook("a.md", "---\ntitle: Start\n---\n# Start\n\nvia [h](h.md)\n");
    fx.handbook("h.md", &restricted("Middle", "to [b](b.md)"));
    fx.handbook("b.md", "---\ntitle: End\n---\n# End\n\nend\n");
    fx.refresh("main").await;
    let path = |actor: afd::Actor| {
        let fx = &fx;
        async move {
            fx.as_actor(
                actor,
                "knowledge-path",
                json!({ "from": "handbook/a", "to": "handbook/b", "max_hops": 6 }),
            )
            .await
        }
    };
    // The only route goes through the restricted document.
    let outside = path(outsider()).await;
    assert_eq!(code(&outside), "PATH_NOT_FOUND");
    never_mentions(&outside, &["handbook/h", "Middle"]);
    let inside = path(member()).await;
    assert_eq!(data(&inside)["hops"], 2, "{inside}");
    let ids: Vec<&str> = data(&inside)["path"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["node"]["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["doc:handbook/a", "doc:handbook/h", "doc:handbook/b"]);
    assert_eq!(data(&inside)["path"][1]["via"]["kind"], "links_to");

    // A public detour makes the path readable, and it names no hidden node.
    fx.handbook("c.md", "---\ntitle: Detour\n---\n# Detour\n\n[b](b.md)\n");
    fx.handbook(
        "a.md",
        "---\ntitle: Start\n---\n# Start\n\nvia [h](h.md) or [c](c.md)\n",
    );
    fx.refresh("main").await;
    let outside = path(outsider()).await;
    assert_eq!(data(&outside)["hops"], 2, "{outside}");
    never_mentions(&outside, &["handbook/h", "Middle"]);
    // Shortest first, ties by node id: for a member both routes have two hops and the smaller id
    // (the detour `c`) wins.
    let inside = path(member()).await;
    assert_eq!(data(&inside)["path"][1]["node"]["id"], "doc:handbook/c");
    // The path may be asked for by node id and by kind.
    let by_kind = fx
        .as_actor(
            member(),
            "knowledge-path",
            json!({ "from": "doc:handbook/a", "to": "doc:handbook/b", "kinds": ["co_cited"] }),
        )
        .await;
    assert_eq!(code(&by_kind), "PATH_NOT_FOUND");
    let same = fx
        .as_actor(
            outsider(),
            "knowledge-path",
            json!({ "from": "handbook/a", "to": "handbook/a" }),
        )
        .await;
    assert_eq!(data(&same)["hops"], 0);
}

#[tokio::test]
async fn no_edge_crosses_spaces() {
    let fx = Fx::new();
    fx.handbook(
        "a.md",
        "# A\n\nSee [n](/notes/n1) and [m](../../beta/notes/n1.md).\n",
    );
    fx.note("n1.md", "# N1\n\nBack to [a](/handbook/a).\n");
    fx.refresh("main").await;
    fx.refresh("beta").await;
    // Each space's graph holds only its own nodes: a link out of the collection names nothing.
    let main = neighbors(&fx, human("local"), json!({ "doc": "handbook/a" })).await;
    assert!(edges(&main).iter().all(|e| !e.2.contains("n1")), "{main}");
    let other = neighbors(
        &fx,
        human("local"),
        json!({ "space": "main", "doc": "notes/n1" }),
    )
    .await;
    assert_eq!(code(&other), "DOCUMENT_NOT_FOUND");
    let node = neighbors(
        &fx,
        human("local"),
        json!({ "space": "main", "node": "dir:notes" }),
    )
    .await;
    assert_eq!(code(&node), "NODE_NOT_FOUND");
    for (command, input) in [
        (
            "knowledge-path",
            json!({ "space": "main", "from": "handbook/a", "to": "notes/n1", "max_hops": 6 }),
        ),
        (
            "knowledge-path",
            json!({ "space": "beta", "from": "notes/n1", "to": "handbook/a", "max_hops": 6 }),
        ),
    ] {
        let result = fx.cli(command, input).await;
        assert_eq!(code(&result), "PATH_NOT_FOUND", "{result}");
    }
    let related = fx
        .cli(
            "knowledge-related",
            json!({ "space": "main", "doc": "notes/n1" }),
        )
        .await;
    assert_eq!(code(&related), "DOCUMENT_NOT_FOUND");
    let beta = neighbors(
        &fx,
        human("local"),
        json!({ "space": "beta", "doc": "notes/n1" }),
    )
    .await;
    assert!(
        edges(&beta)
            .iter()
            .all(|e| !e.2.starts_with("doc:handbook/")),
        "{beta}"
    );
}

#[tokio::test]
async fn related_documents_are_ranked_by_links_co_citation_tags_owners_and_directory() {
    let fx = Fx::new();
    let front = |tags: &str| format!("---\ntags: [{tags}]\nowners: [\"human:o\"]\n---\n");
    fx.handbook(
        "a.md",
        &format!("{}# A\n\nSee [b](b.md).\n", front("t1, t2")),
    );
    fx.handbook(
        "b.md",
        &format!("{}# B\n\nSee [a](a.md).\n", front("t1, t2")),
    );
    fx.handbook("c.md", "# C\n\nAlone in the directory.\n");
    fx.handbook("sub/d.md", "---\ntags: [t1]\n---\n# D\n\nElsewhere.\n");
    fx.refresh("main").await;
    let result = fx
        .cli("knowledge-related", json!({ "doc": "handbook/a" }))
        .await;
    let rows = data(&result)["related"].as_array().unwrap();
    let summary: Vec<(String, f64)> = rows
        .iter()
        .map(|row| {
            (
                row["doc"].as_str().unwrap().to_owned(),
                row["score"].as_f64().unwrap(),
            )
        })
        .collect();
    // b: 3 x 2 links, 2 shared tags, 1 shared owner and the same directory (0.5); d: one shared
    // tag; c: the same directory.
    assert_eq!(
        summary,
        [
            ("handbook/b".to_owned(), 9.5),
            ("handbook/sub/d".to_owned(), 1.0),
            ("handbook/c".to_owned(), 0.5)
        ]
    );
    let kinds: Vec<&str> = rows[0]["reasons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["links", "tags", "owners", "directory"]);
    assert_eq!(rows[0]["reasons"][1]["shared"], json!(["t1", "t2"]));
    assert_eq!(rows[0]["trust"], "content");
    let limited = fx
        .cli(
            "knowledge-related",
            json!({ "doc": "handbook/a", "limit": 1 }),
        )
        .await;
    assert_eq!(data(&limited)["count"], 1);
}

#[tokio::test]
async fn outline_gives_a_heading_tree_and_a_directory_tree_of_readable_documents() {
    let fx = Fx::new();
    fx.handbook(
        "deploy/index.md",
        "---\ntype: okf-index\ntitle: Deploying\ndescription: Everything about shipping\n---\n# Deploying\n",
    );
    fx.handbook(
        "deploy/rollback.md",
        "# Rollback\n\n## Steps\n\n### Detail\n\n## Notes\n",
    );
    fx.handbook("flags.md", "# Flags\n");
    fx.handbook("deploy/secret.md", &restricted("Hidden steps", "x"));
    fx.refresh("main").await;
    let tree = fx
        .as_actor(
            outsider(),
            "knowledge-outline",
            json!({ "doc": "handbook/deploy/rollback" }),
        )
        .await;
    let outline = &data(&tree)["outline"];
    assert_eq!(outline[0]["text"], "Rollback");
    assert_eq!(outline[0]["children"][0]["text"], "Steps");
    assert_eq!(outline[0]["children"][0]["children"][0]["text"], "Detail");
    assert_eq!(outline[0]["children"][1]["text"], "Notes");

    let directory = fx
        .as_actor(
            outsider(),
            "knowledge-outline",
            json!({ "collection": "handbook" }),
        )
        .await;
    never_mentions(&directory, &["Hidden steps", "deploy/secret"]);
    let root = &data(&directory)["tree"];
    assert_eq!(root["name"], "handbook");
    let entries = root["entries"].as_array().unwrap();
    let deploy = entries.iter().find(|e| e["name"] == "deploy").unwrap();
    assert_eq!(deploy["description"], "Everything about shipping");
    assert_eq!(deploy["title"], "Deploying");
    let names: Vec<&str> = deploy["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["handbook/deploy/rollback"]);
    assert!(entries.iter().any(|e| e["id"] == "handbook/flags"));
    assert_eq!(data(&directory)["truncatedAt"], Value::Null);
    let member_tree = fx
        .as_actor(
            member(),
            "knowledge-outline",
            json!({ "collection": "handbook", "prefix": "handbook/deploy/" }),
        )
        .await;
    assert!(member_tree.to_string().contains("handbook/deploy/secret"));
    assert!(!member_tree.to_string().contains("handbook/flags"));

    let both = fx
        .cli(
            "knowledge-outline",
            json!({ "doc": "handbook/flags", "collection": "handbook" }),
        )
        .await;
    assert_eq!(code(&both), "GRAPH_ARGUMENTS_INVALID");
}

#[tokio::test]
async fn stale_lists_past_due_deprecated_without_successor_and_never_verified_documents() {
    let fx = Fx::new();
    let verified = "verified: [{ by: \"human:ada\", at: \"2025-12-01T00:00:00Z\" }]";
    fx.handbook(
        "fresh.md",
        &format!("---\n{verified}\nstale_after: \"2027-01-01T00:00:00Z\"\n---\n# Fresh\n"),
    );
    fx.handbook(
        "due.md",
        &format!("---\n{verified}\nstale_after: \"2025-06-01T00:00:00Z\"\n---\n# Due\n"),
    );
    fx.handbook(
        "orphan.md",
        &format!("---\n{verified}\nstatus: deprecated\n---\n# Orphan\n"),
    );
    fx.handbook(
        "replaced.md",
        &format!(
            "---\n{verified}\nstatus: deprecated\nsuperseded_by: handbook/fresh\n---\n# Replaced\n"
        ),
    );
    fx.handbook(
        "dangling.md",
        &format!("---\n{verified}\nstatus: deprecated\nsuperseded_by: handbook/nowhere\n---\n# Dangling\n"),
    );
    fx.handbook("never.md", "# Never\n");
    fx.handbook(
        "secret-due.md",
        &format!("---\n{verified}\naccess: [group:platform]\nstale_after: \"2025-06-01T00:00:00Z\"\n---\n# Secret due\n"),
    );
    fx.refresh("main").await;
    let list = |actor: afd::Actor, input: Value| {
        let fx = &fx;
        async move {
            let result = fx.as_actor(actor, "knowledge-stale", input).await;
            data(&result)["documents"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| {
                    (
                        d["doc"].as_str().unwrap().to_owned(),
                        d["reasons"][0].as_str().unwrap().to_owned(),
                    )
                })
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(
        list(outsider(), json!({ "reasons": ["past-stale-after"] })).await,
        [("handbook/due".to_owned(), "past-stale-after".to_owned())]
    );
    assert_eq!(
        list(member(), json!({ "reasons": ["past-stale-after"] }))
            .await
            .len(),
        2
    );
    let orphans = list(
        outsider(),
        json!({ "reasons": ["deprecated-without-successor"] }),
    )
    .await;
    let ids: Vec<&str> = orphans.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(ids, ["handbook/dangling", "handbook/orphan"]);
    assert_eq!(
        list(outsider(), json!({ "reasons": ["never-verified"] })).await,
        [("handbook/never".to_owned(), "never-verified".to_owned())]
    );
    // `as_of` moves the line.
    let later = list(
        outsider(),
        json!({ "reasons": ["past-stale-after"], "as_of": "2028-01-01T00:00:00Z" }),
    )
    .await;
    assert_eq!(later.len(), 2, "{later:?}");
    // Pages continue from a cursor.
    let first = fx
        .as_actor(outsider(), "knowledge-stale", json!({ "limit": 1 }))
        .await;
    let next = data(&first)["nextAfter"].as_str().unwrap().to_owned();
    let second = fx
        .as_actor(
            outsider(),
            "knowledge-stale",
            json!({ "limit": 1, "after": next }),
        )
        .await;
    assert_ne!(data(&first)["documents"], data(&second)["documents"]);
    let bad = fx
        .cli("knowledge-stale", json!({ "as_of": "yesterday" }))
        .await;
    assert_eq!(code(&bad), "QUERY_INVALID");
}
