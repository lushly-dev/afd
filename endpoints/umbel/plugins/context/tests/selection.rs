//! Selection (section 9.3): terms, aggregation, status rules, the push rule and its settings,
//! project-less records, tiers and `per_authority_cap`, flagged records, `sections`, scope,
//! `verified_only`, `asOf`, and a no-task bundle holding no knowledge.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;
use umbel_store::memory::DAY_MS;
use umbel_store::{Authority, Flag, MemoryClass, Status, Tier};

const SEMANTIC: MemoryClass = MemoryClass::Semantic;

fn ada_fact(n: u64, authority: Authority, word: &str) -> umbel_store::MemoryWrite {
    entry(
        n,
        "main",
        "human:ada",
        SEMANTIC,
        authority,
        &format!("Fact {n}"),
        &format!("{word} fact number {n}"),
    )
}

#[tokio::test]
async fn a_bundle_without_a_task_holds_no_knowledge_and_lists_memory_by_recency() {
    let mut fx = Fx::new();
    fx.index(
        "main",
        vec![doc("main", "handbook/a", "A", "rollback canary")],
    );
    fx.remember_at("main", AT, vec![ada_fact(1, Authority::Person, "older")]);
    fx.remember_at(
        "main",
        AT + 1000,
        vec![ada_fact(2, Authority::Person, "newer")],
    );
    let result = fx.ada(none()).await;
    assert!(ids(&result, "knowledge").is_empty());
    assert_eq!(omitted(&result, "knowledge", "no-task").len(), 1);
    assert_eq!(
        ids(&result, "semantic"),
        [format!("main:{}", mem(2)), format!("main:{}", mem(1))]
    );
    // A blank task is no task.
    let blank = fx.ada(json!({ "task": "   " })).await;
    assert_eq!(data(&blank)["task"], json!(null));
    assert_eq!(omitted(&blank, "knowledge", "no-task").len(), 1);
    valid(&result);
}

#[tokio::test]
async fn terms_search_the_index_and_a_document_adds_its_next_chunks() {
    let mut fx = Fx::new();
    fx.index(
        "main",
        vec![
            // Two matching chunks: the second adds secondary_weight of its score.
            doc(
                "main",
                "handbook/z",
                "Z",
                "rollback canary\n\nrollback canary",
            ),
            doc("main", "handbook/a", "A", "rollback canary"),
            doc("main", "handbook/s", "S", "the the the"),
        ],
    );
    let result = fx
        .ada(json!({ "task": "How do I ROLLBACK the deploy?" }))
        .await;
    assert_eq!(
        ids(&result, "knowledge"),
        ["main:handbook/z", "main:handbook/a"]
    );
    // Stop words are not searched, so a document holding only them is not found.
    let stop = fx.ada(json!({ "task": "the of and" })).await;
    assert_eq!(omitted(&stop, "knowledge", "no-task").len(), 1);
    // Query syntax in a task is only words.
    let syntax = fx
        .ada(json!({ "task": "title:\"rollback\" -canary*" }))
        .await;
    assert_eq!(ids(&syntax, "knowledge").len(), 2, "{syntax}");
}

#[tokio::test]
async fn status_rules_drop_deprecated_and_reserved_files_count_flagged_and_lower_drafts() {
    let mut fx = Fx::new();
    let body = "rollback canary";
    fx.index(
        "main",
        vec![
            with(
                doc("main", "handbook/a-draft", "Draft", body),
                status(Status::Draft),
            ),
            doc("main", "handbook/b-stable", "Stable", body),
            with(
                doc("main", "handbook/c-old", "Old", body),
                status(Status::Deprecated),
            ),
            doc("main", "handbook/index", "Index", body),
            doc("main", "handbook/log", "Log", body),
            with(
                doc("main", "handbook/d-flagged", "Flagged", body),
                scan_flag(Flag::InstructionLike),
            ),
            with(
                doc("main", "handbook/e-links", "Links", body),
                scan_flag(Flag::BrokenLinks),
            ),
        ],
    );
    let result = fx.ada(json!({ "task": "rollback" })).await;
    // A draft scores draft_factor of the same text, so it follows the stable documents.
    assert_eq!(
        ids(&result, "knowledge"),
        [
            "main:handbook/b-stable",
            "main:handbook/e-links",
            "main:handbook/a-draft"
        ]
    );
    assert_eq!(count(&result, "knowledge", "flagged"), 1);
    valid(&result);
}

#[tokio::test]
async fn verified_only_keeps_human_and_owner_knowledge_and_omits_memory() {
    let mut fx = Fx::with(&config("[plugins.context.config]\nverified_only = true\n"));
    fx.index(
        "main",
        vec![
            doc("main", "handbook/human", "H", "rollback"),
            with(doc("main", "handbook/owner", "O", "rollback"), |w| {
                w.verification.tier = Tier::Owner;
            }),
            with(doc("main", "handbook/machine", "M", "rollback"), |w| {
                w.verification.tier = Tier::Machine;
            }),
        ],
    );
    fx.remember("main", vec![ada_fact(1, Authority::Person, "rollback")]);
    let result = fx
        .ada(json!({ "task": "rollback", "sections": ["knowledge", "semantic", "procedural"] }))
        .await;
    assert_eq!(
        ids(&result, "knowledge"),
        ["main:handbook/human", "main:handbook/owner"]
    );
    assert!(ids(&result, "semantic").is_empty());
    assert_eq!(omitted(&result, "semantic", "verified-only").len(), 1);
    assert_eq!(omitted(&result, "procedural", "verified-only").len(), 1);
}

#[tokio::test]
async fn the_default_push_is_person_only_and_one_setting_widens_it() {
    let mut fx = Fx::new();
    fx.remember(
        "main",
        vec![
            ada_fact(1, Authority::Person, "deploy"),
            ada_fact(2, Authority::Agent, "deploy"),
            ada_fact(3, Authority::Tool, "deploy"),
            ada_fact(4, Authority::Transcript, "deploy"),
        ],
    );
    for input in [json!({}), json!({ "task": "deploy" })] {
        let result = fx.ada(input).await;
        assert_eq!(ids(&result, "semantic"), [format!("main:{}", mem(1))]);
        assert_eq!(count(&result, "semantic", "authority"), 3, "{result}");
    }
    // An agent acting for ada reads the same push: the owner is the person.
    let agent = fx.bundle(agent_for("bot", "ada"), json!({})).await;
    assert_eq!(ids(&agent, "semantic"), [format!("main:{}", mem(1))]);
    fx.reconfigure(&config(
        "[plugins.context.config]\npush_authorities = [\"agent\", \"person\", \"tool\"]\n",
    ));
    let widened = fx.ada(json!({ "task": "deploy" })).await;
    // Tier order, whatever the setting's order: person, tool, agent.
    assert_eq!(
        ids(&widened, "semantic"),
        [1, 3, 2].map(|n| format!("main:{}", mem(n)))
    );
    assert_eq!(count(&widened, "semantic", "authority"), 1);
}

#[tokio::test]
async fn another_principals_readable_records_are_pushed_only_at_their_own_setting() {
    let mut fx = Fx::new();
    let bob = |n, authority| {
        shared(entry(
            n,
            "main",
            "human:bob",
            SEMANTIC,
            authority,
            "Bob's",
            "bob note",
        ))
    };
    fx.remember(
        "main",
        vec![bob(1, Authority::Person), bob(2, Authority::Agent)],
    );
    let result = fx.ada(none()).await;
    assert_eq!(ids(&result, "semantic"), [format!("main:{}", mem(1))]);
    assert_eq!(count(&result, "semantic", "authority"), 1);
    // Widening the caller's own list does not widen another principal's.
    fx.reconfigure(&config(
        "[plugins.context.config]\npush_authorities = [\"person\", \"agent\"]\n",
    ));
    assert_eq!(ids(&fx.ada(none()).await, "semantic").len(), 1);
    fx.reconfigure(&config(
        "[plugins.context.config]\npush_foreign_authorities = [\"person\", \"agent\"]\n",
    ));
    assert_eq!(ids(&fx.ada(none()).await, "semantic").len(), 2);
}

#[tokio::test]
async fn a_record_with_no_project_reaches_a_named_project_only_at_person() {
    let mut fx = Fx::with(&config(
        "[plugins.context.config]\npush_authorities = [\"person\", \"agent\"]\n",
    ));
    fx.remember(
        "main",
        vec![
            ada_fact(1, Authority::Person, "x"),
            ada_fact(2, Authority::Agent, "x"),
            in_project(ada_fact(3, Authority::Agent, "x"), "deploy"),
            in_project(ada_fact(4, Authority::Person, "x"), "other"),
        ],
    );
    let named = fx.ada(json!({ "project": "deploy" })).await;
    assert_eq!(
        ids(&named, "semantic"),
        [1, 3].map(|n| format!("main:{}", mem(n)))
    );
    // The agent's project-less note is readable and current, so it is counted; the other
    // project's record is out of scope and not counted.
    assert_eq!(count(&named, "semantic", "authority"), 1);
    // With no project named, every project is in scope.
    let any = fx.ada(none()).await;
    assert_eq!(ids(&any, "semantic").len(), 4);
}

#[tokio::test]
async fn tiers_place_people_first_and_cap_each_tier() {
    let mut fx = Fx::with(&config(
        "[plugins.context.config]\npush_authorities = [\"person\", \"agent\"]\n",
    ));
    let people: Vec<_> = (1..=10)
        .map(|n| ada_fact(n, Authority::Person, "deploy"))
        .collect();
    fx.remember_at("main", AT, people);
    // Agent notes written later still come after every person's record.
    let agents: Vec<_> = (11..=20)
        .map(|n| ada_fact(n, Authority::Agent, "deploy"))
        .collect();
    fx.remember_at("main", AT + 1000, agents);
    for input in [json!({}), json!({ "task": "deploy" })] {
        let result = fx.ada(input).await;
        let placed = ids(&result, "semantic");
        assert_eq!(placed.len(), 16, "{result}");
        let tier = |id: &String| id.as_str() <= format!("main:{}", mem(10)).as_str();
        assert!(placed[..8].iter().all(tier), "{placed:?}");
        assert!(placed[8..].iter().all(|id| !tier(id)), "{placed:?}");
        // The two past each tier's cap are named for budget.
        assert_eq!(omitted(&result, "semantic", "budget").len(), 4);
    }
}

#[tokio::test]
async fn a_flagged_record_is_never_pushed_and_only_counted() {
    let mut fx = Fx::with(&config(
        "[plugins.context.config]\npush_authorities = [\"person\", \"agent\", \"tool\"]\n",
    ));
    fx.remember(
        "main",
        vec![
            flagged(ada_fact(1, Authority::Person, "deploy")),
            ada_fact(2, Authority::Person, "deploy"),
        ],
    );
    for input in [json!({}), json!({ "task": "deploy" })] {
        let result = fx.ada(input).await;
        assert_eq!(ids(&result, "semantic"), [format!("main:{}", mem(2))]);
        assert_eq!(count(&result, "semantic", "flagged"), 1);
        assert!(omitted(&result, "semantic", "budget").is_empty());
    }
}

#[tokio::test]
async fn sections_choose_what_runs_and_episodic_admits_own_transcripts() {
    let mut fx = Fx::new();
    let episode = |n, authority| {
        entry(
            n,
            "main",
            "human:ada",
            MemoryClass::Episodic,
            authority,
            "Ep",
            "episode",
        )
    };
    fx.remember(
        "main",
        vec![
            ada_fact(1, Authority::Person, "x"),
            entry(
                2,
                "main",
                "human:ada",
                MemoryClass::Procedural,
                Authority::Person,
                "P",
                "proc",
            ),
            episode(3, Authority::Transcript),
            ada_fact(4, Authority::Transcript, "x"),
            shared(entry(
                5,
                "main",
                "human:bob",
                MemoryClass::Episodic,
                Authority::Transcript,
                "B",
                "b",
            )),
        ],
    );
    let default = fx.ada(none()).await;
    assert_eq!(section_names(&default), ["semantic", "procedural"]);
    assert!(omitted(&default, "episodic", "authority").is_empty());
    let named = fx
        .ada(json!({ "sections": ["episodic", "semantic"] }))
        .await;
    // Bundle order whatever the input's; a transcript only in episodic, and only the caller's.
    assert_eq!(section_names(&named), ["semantic", "episodic"]);
    assert_eq!(ids(&named, "episodic"), [format!("main:{}", mem(3))]);
    assert_eq!(count(&named, "episodic", "authority"), 1);
    assert_eq!(count(&named, "semantic", "authority"), 1);
    assert!(ids(&named, "procedural").is_empty());
    let nothing = fx.ada(json!({ "sections": [] })).await;
    assert!(data(&nothing)["sections"].as_array().unwrap().is_empty());
    assert!(data(&nothing)["omissions"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn a_bundle_reads_one_space() {
    let mut fx = Fx::new();
    fx.remember("main", vec![ada_fact(1, Authority::Person, "x")]);
    fx.remember(
        "beta",
        vec![entry(
            2,
            "beta",
            "human:ada",
            SEMANTIC,
            Authority::Person,
            "B",
            "beta x",
        )],
    );
    fx.index("beta", vec![doc("beta", "notes/b", "B", "beta words")]);
    let main = fx.ada(json!({ "task": "beta x" })).await;
    assert_eq!(ids(&main, "semantic"), [format!("main:{}", mem(1))]);
    assert!(ids(&main, "knowledge").is_empty());
    let beta = fx.ada(json!({ "space": "beta", "task": "beta" })).await;
    assert_eq!(data(&beta)["space"], "beta");
    assert_eq!(ids(&beta, "semantic"), [format!("beta:{}", mem(2))]);
    assert_eq!(ids(&beta, "knowledge"), ["beta:notes/b"]);
}

#[tokio::test]
async fn as_of_reads_memory_at_that_instant_and_says_knowledge_is_current() {
    let mut fx = Fx::new();
    let mut later = ada_fact(2, Authority::Person, "x");
    later.valid_from = AT + 2 * 3_600_000;
    umbel_store::conformance::samples::agree(&mut later);
    fx.remember("main", vec![ada_fact(1, Authority::Person, "x"), later]);
    fx.index("main", vec![doc("main", "handbook/a", "A", "x words")]);
    let now = fx.ada(json!({ "task": "x" })).await;
    assert_eq!(ids(&now, "semantic"), [format!("main:{}", mem(1))]);
    assert!(warning(&now, "KNOWLEDGE_NOT_BITEMPORAL").is_none());
    let then = umbel_store::memory::format_instant(AT + 3 * 3_600_000);
    let future = fx.ada(json!({ "task": "x", "asOf": then })).await;
    assert_eq!(ids(&future, "semantic").len(), 2);
    assert_eq!(data(&future)["asOf"], then);
    assert!(warning(&future, "KNOWLEDGE_NOT_BITEMPORAL").is_some());
    assert_eq!(ids(&future, "knowledge"), ["main:handbook/a"]);
    // Expiry is measured against the clock, not asOf: an expired record never returns.
    let mut gone = ada_fact(3, Authority::Person, "x");
    gone.expires_at = AT + 1;
    fx.remember("main", vec![gone]);
    let past = fx
        .ada(json!({ "asOf": umbel_store::memory::format_instant(AT + 10) }))
        .await;
    assert!(!ids(&past, "semantic").contains(&format!("main:{}", mem(3))));
    // Without knowledge asked for, no warning.
    let memory_only = fx
        .ada(json!({ "asOf": then, "sections": ["semantic"] }))
        .await;
    assert!(warning(&memory_only, "KNOWLEDGE_NOT_BITEMPORAL").is_none());
    let _ = DAY_MS;
}
