//! The eval fixture (specification section 10.1) and the query set (10.2): the generator is a
//! pure function of its seed, pinned by a digest; the vocabulary stays distinct under `en_stem`;
//! the twelve planted documents are the only ones the write scan flags; and the metrics are what
//! a hand computation says.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use tantivy::tokenizer::TokenizerManager;
use umbel_plugin_knowledge::eval::fixture::{self, DEFAULT_SEED, Fixture};
use umbel_plugin_knowledge::eval::queries::{self, Kind};
use umbel_plugin_knowledge::eval::words::is_emittable;

use support::*;

/// The SHA-256 of the tree `generate(20261101, ..)` writes. Changing the generator changes this
/// in the same pull request, and the baseline in `eval/baseline.json` is re-measured with it.
const PINNED_DIGEST: &str =
    "sha256:4fbd3143541158319a185103af994dad945dc646ce9f10711589db37477ecadf";

fn tokens(text: &str) -> Vec<String> {
    let manager = TokenizerManager::default();
    let mut analyzer = manager.get("en_stem").expect("en_stem");
    let mut stream = analyzer.token_stream(text);
    let mut found = Vec::new();
    while stream.advance() {
        found.push(stream.token().text.clone());
    }
    found
}

fn text_of(fixture: &Fixture) -> String {
    fixture
        .files
        .iter()
        .filter(|file| file.path.starts_with("spaces/") && !file.path.ends_with("queries.jsonl"))
        .map(|file| String::from_utf8_lossy(&file.bytes).into_owned())
        .collect::<Vec<_>>()
        .join("\n")
}

fn schema(name: &str) -> jsonschema::Validator {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas")
        .join(name);
    let value: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    jsonschema::options().build(&value).unwrap()
}

fn read_tree(root: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path: PathBuf = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                let relative = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((relative, std::fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out
}

#[test]
fn the_generator_is_deterministic_and_its_tree_is_pinned() {
    let first = fixture::build(DEFAULT_SEED);
    let second = fixture::build(DEFAULT_SEED);
    assert_eq!(first.manifest.digest, second.manifest.digest);
    assert_eq!(first.manifest.digest, PINNED_DIGEST);
    assert_ne!(
        fixture::build(DEFAULT_SEED + 1).manifest.digest,
        first.manifest.digest,
        "another seed is another tree"
    );

    // What `generate` writes is the tree the digest describes.
    let dir = tempfile::tempdir().unwrap();
    let manifest = fixture::generate(DEFAULT_SEED, dir.path()).unwrap();
    assert_eq!(manifest.digest, PINNED_DIGEST);
    let files: Vec<fixture::File> = read_tree(dir.path())
        .into_iter()
        .map(|(path, bytes)| fixture::File { path, bytes })
        .collect();
    assert_eq!(files.len(), manifest.files);
    assert_eq!(fixture::digest(&files), PINNED_DIGEST);
}

#[test]
fn the_tree_has_the_counts_of_the_specification() {
    let fixture = fixture::build(DEFAULT_SEED);
    let documents = &fixture.manifest.documents;
    assert_eq!(documents["alpha/handbook"], 450);
    assert_eq!(documents["alpha/runbooks"], 150);
    assert_eq!(documents["alpha/code"], 50);
    assert_eq!(documents["beta/notes"], 400);
    assert_eq!(documents.values().sum::<usize>(), 1050);
    let markdown = fixture
        .files
        .iter()
        .filter(|f| f.path.starts_with("spaces/") && f.path.ends_with(".md"))
        .count();
    assert_eq!(markdown, 1000);
    let code = fixture
        .files
        .iter()
        .filter(|f| f.path.starts_with("spaces/alpha/code/"))
        .count();
    assert_eq!(code, 50);
    assert!(fixture.files.iter().any(|f| f.path == "umbel.toml"));

    // Restricted, deprecated and verified shares of the handbook.
    let handbook: Vec<String> = fixture
        .files
        .iter()
        .filter(|f| f.path.starts_with("spaces/alpha/handbook/"))
        .map(|f| String::from_utf8_lossy(&f.bytes).into_owned())
        .collect();
    let restricted = handbook
        .iter()
        .filter(|t| t.contains("group:restricted"))
        .count();
    let deprecated = handbook
        .iter()
        .filter(|t| t.contains("status: deprecated"))
        .count();
    assert_eq!(restricted, 45, "10% of 450");
    assert_eq!(deprecated, 22, "5% of 450, rounded down");
    let verified = handbook
        .iter()
        .filter(|t| t.contains("\nverified:"))
        .count();
    assert!((100..=170).contains(&verified), "about 30%: {verified}");
}

#[test]
fn the_query_set_is_the_specified_shape_and_validates() {
    let fixture = fixture::build(DEFAULT_SEED);
    let mut kinds: BTreeMap<Kind, usize> = BTreeMap::new();
    for query in &fixture.queries {
        *kinds.entry(query.kind).or_default() += 1;
    }
    assert_eq!(fixture.queries.len(), 220);
    assert_eq!(
        kinds,
        BTreeMap::from([
            (Kind::Exact, 80),
            (Kind::Alias, 30),
            (Kind::Phrase, 20),
            (Kind::Field, 20),
            (Kind::MultiHop, 20),
            (Kind::CrossSpace, 15),
            (Kind::Unanswerable, 15),
            (Kind::Permission, 20),
        ])
    );
    assert_eq!(
        fixture
            .queries
            .iter()
            .filter(|q| q.kind.is_answerable())
            .count(),
        185
    );

    let validator = schema("eval-queries.v1.json");
    let file = fixture
        .files
        .iter()
        .find(|f| f.path == "spaces/alpha/eval/queries.jsonl")
        .unwrap();
    let text = String::from_utf8(file.bytes.clone()).unwrap();
    assert_eq!(text.lines().count(), 220);
    for line in text.lines() {
        let value: Value = serde_json::from_str(line).unwrap();
        let errors: Vec<String> = validator
            .iter_errors(&value)
            .map(|e| e.to_string())
            .collect();
        assert!(errors.is_empty(), "{line}: {errors:?}");
    }
    // The shape the plugin reads is the one the generator writes.
    let parsed = queries::parse(&text).unwrap();
    assert_eq!(parsed, fixture.queries);
    assert_eq!(queries::to_jsonl(&parsed), text);
}

#[test]
fn qrels_name_real_documents_and_only_the_permission_probes_name_restricted_ones() {
    let fixture = fixture::build(DEFAULT_SEED);
    let by_path: BTreeMap<&str, String> = fixture
        .files
        .iter()
        .map(|f| {
            (
                f.path.as_str(),
                String::from_utf8_lossy(&f.bytes).into_owned(),
            )
        })
        .collect();
    for query in &fixture.queries {
        let mut answers = 0;
        for (key, grade) in &query.qrels {
            let (space, doc) = key.split_once(':').unwrap();
            let path = format!("spaces/{space}/{doc}.md");
            let text = by_path
                .get(path.as_str())
                .unwrap_or_else(|| panic!("{key} is not a file"));
            let restricted = text.contains("group:restricted");
            assert_eq!(
                restricted,
                query.kind == Kind::Permission,
                "{}: {key} restricted = {restricted}",
                query.id
            );
            if *grade == 2 {
                answers += 1;
            }
        }
        if query.kind.is_answerable() || query.kind == Kind::Permission {
            assert_eq!(answers, 1, "{} has one answer", query.id);
        }
        if query.kind == Kind::CrossSpace {
            assert_eq!(query.spaces, ["alpha", "beta"]);
            assert!(query.qrels.keys().any(|k| k.starts_with("beta:")));
        }
    }
}

#[test]
fn key_terms_and_never_emitted_words_stay_distinct_under_en_stem() {
    let fixture = fixture::build(DEFAULT_SEED);

    // Every topic's key term stems to a token no other topic's key term or alias stems to.
    let mut owner: BTreeMap<String, String> = BTreeMap::new();
    for topic in &fixture.topics {
        let mut terms = vec![("key", topic.key.clone())];
        for (n, alias) in topic.aliases.iter().enumerate() {
            terms.push(if n == 0 {
                ("alias0", alias.clone())
            } else {
                ("alias1", alias.clone())
            });
        }
        for (role, term) in terms {
            let stems = tokens(&term);
            assert_eq!(stems.len(), 1, "{term} is one token");
            let label = format!("{}:{}:{role}", topic.space, topic.number);
            if let Some(previous) = owner.insert(stems[0].clone(), label.clone()) {
                panic!(
                    "{term} stems to {} which {previous} and {label} share",
                    stems[0]
                );
            }
        }
        for term in topic.phrase.iter().chain(std::iter::once(&topic.bridge)) {
            if term.is_empty() {
                continue;
            }
            let stems = tokens(term);
            assert_eq!(stems.len(), 1, "{term} is one token");
            let label = format!("{}:{}:planted", topic.space, topic.number);
            if let Some(previous) = owner.insert(stems[0].clone(), label.clone()) {
                panic!(
                    "{term} stems to {} which {previous} and {label} share",
                    stems[0]
                );
            }
        }
    }

    // No word of an unanswerable query stems to a token the generator emits anywhere.
    let emitted: BTreeSet<String> = tokens(&text_of(&fixture)).into_iter().collect();
    assert!(
        emitted.len() > 1000,
        "the corpus is not trivial: {}",
        emitted.len()
    );
    let queries: Vec<&String> = fixture
        .queries
        .iter()
        .filter(|q| q.kind == Kind::Unanswerable)
        .map(|q| &q.query)
        .collect();
    assert_eq!(queries.len(), fixture.unanswerable_words.len());
    for query in queries {
        let stems = tokens(query);
        assert!(!stems.is_empty());
        for stem in stems {
            assert!(
                !emitted.contains(&stem),
                "{query} stems to {stem}, which the corpus holds"
            );
        }
    }
}

#[test]
fn the_only_real_words_are_a_fixed_scaffold_and_no_name_is_among_them() {
    let fixture = fixture::build(DEFAULT_SEED);
    // The prose is pseudo-words. What is not one is the Markdown and code syntax, the frontmatter
    // keys and the fixed sentence frames the planting uses, and nothing in it names anything.
    const SCAFFOLD: &[&str] = &[
        "a",
        "above",
        "agent",
        "all",
        "always",
        "and",
        "are",
        "at",
        "before",
        "beside",
        "by",
        "call",
        "class",
        "compare",
        "def",
        "disregard",
        "drains",
        "earlier",
        "elsewhere",
        "entry",
        "follow",
        "forget",
        "gate",
        "gateway",
        "helper",
        "here",
        "ignore",
        "impl",
        "in",
        "is",
        "keep",
        "leads",
        "message",
        "note",
        "noted",
        "of",
        "on",
        "open",
        "other",
        "output",
        "previous",
        "prompt",
        "pub",
        "read",
        "return",
        "reversed",
        "rewritten",
        "route",
        "run",
        "self",
        "split",
        "stays",
        "step",
        "struct",
        "system",
        "tagged",
        "text",
        "that",
        "the",
        "then",
        "this",
        "to",
        "tool",
        "use",
        "value",
        "while",
        "with",
        "you",
        "fn",
        "u32",
        "see",
        "type",
        "title",
        "description",
        "tags",
        "aliases",
        "owners",
        "status",
        "deprecated",
        "superseded",
        "by",
        "stale",
        "after",
        "generated",
        "gen",
        "verified",
        "access",
        "group",
        "restricted",
        "human",
        "process",
        "nightly",
        "check",
        "md",
        "handbook",
        "entries",
        "topics",
        "runbooks",
        "notes",
        "concept",
        "runbook",
        "decision",
        "glossary",
        "bridges",
        "code",
        "src",
        "rs",
        "py",
    ];
    let emitted: BTreeSet<String> = text_of(&fixture)
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|w| w.len() > 1 || ["a"].contains(w))
        .map(str::to_ascii_lowercase)
        .collect();
    let foreign: Vec<&String> = emitted
        .iter()
        .filter(|word| !is_emittable(word) && !SCAFFOLD.contains(&word.as_str()))
        .collect();
    assert!(
        foreign.is_empty(),
        "words that are neither pseudo-words nor scaffold: {foreign:?}"
    );
}

#[test]
fn exactly_twelve_documents_are_planted_for_the_write_scan() {
    let fixture = fixture::build(DEFAULT_SEED);
    let mut instruction_like = 0;
    let mut hidden_text = 0;
    for file in fixture.files.iter().filter(|f| f.path.ends_with(".md")) {
        let scan = umbel_scan::scan_content(&String::from_utf8_lossy(&file.bytes));
        instruction_like += usize::from(scan.is_instruction_like());
        hidden_text += usize::from(scan.has_hidden_text());
        // Planted documents are one kind or the other.
        assert!(
            !(scan.is_instruction_like() && scan.has_hidden_text()),
            "{} is both",
            file.path
        );
    }
    assert_eq!(instruction_like, fixture.manifest.planted.instruction_like);
    assert_eq!(hidden_text, fixture.manifest.planted.hidden_text);
    assert_eq!((instruction_like, hidden_text), (8, 4));
}

/// Three queries over three documents with scores that do not tie, scored by hand:
///
/// 1. `zorplat`, answer A (2) and B (1): A has the term three times in a short text, B once in a
///    longer one, so the list is [A, B] and every metric is 1.
/// 2. `zorplat`, answer B (2) and A (1): the same list; recall 1, MRR 1/2, DCG = 1 + 3/log2(3) =
///    2.8928, ideal = 3 + 1/log2(3) = 3.6309, nDCG 0.7967.
/// 3. `lumikan`, answer A: only C matches, so recall, MRR and nDCG are 0.
///
/// Means: recall 2/3 = 0.6667, nDCG (1 + 0.7967 + 0)/3 = 0.5989, MRR (1 + 0.5 + 0)/3 = 0.5.
#[tokio::test]
async fn metrics_on_a_hand_computed_three_query_case() {
    let config = CONFIG.replace(
        "[spaces.beta]\n",
        "[spaces.main.collections.eval]\nroot = \"spaces/main/eval\"\n\n[spaces.beta]\n",
    );
    let fx = Fx::with(&config);
    fx.handbook("a.md", "# Zorplat\n\nzorplat zorplat zorplat\n");
    fx.handbook(
        "b.md",
        "# Other\n\nthe long plain text mentions zorplat once among many many other plain words here\n",
    );
    fx.handbook("c.md", "# Third\n\nlumikan only\n");
    let set = [
        json!({"version": 1, "id": "q-0001", "kind": "exact", "query": "zorplat", "spaces": ["main"],
            "principal": "human:eval-reader", "filters": {},
            "qrels": {"main:handbook/a": 2, "main:handbook/b": 1}, "unanswerable": false}),
        json!({"version": 1, "id": "q-0002", "kind": "exact", "query": "zorplat", "spaces": ["main"],
            "principal": "human:eval-reader", "filters": {},
            "qrels": {"main:handbook/b": 2, "main:handbook/a": 1}, "unanswerable": false}),
        json!({"version": 1, "id": "q-0003", "kind": "exact", "query": "lumikan", "spaces": ["main"],
            "principal": "human:eval-reader", "filters": {},
            "qrels": {"main:handbook/a": 2}, "unanswerable": false}),
    ];
    let lines: Vec<String> = set.iter().map(Value::to_string).collect();
    fx.write(
        "spaces/main/eval/queries.jsonl",
        lines.join("\n").as_bytes(),
    );
    fx.refresh("main").await;

    let result = fx.cli("knowledge-eval", json!({ "expand": "off" })).await;
    let report = data(&result);
    let off = &report["metrics"]["overall"]["off"];
    assert_eq!(off["queries"], 3);
    assert_eq!(off["recall"], 0.6667);
    assert_eq!(off["ndcg"], 0.5989);
    assert_eq!(off["mrr"], 0.5);
    assert!(report["metrics"]["overall"].get("on").is_none());
    let first = &report["results"][0]["runs"]["off"];
    assert_eq!(first[0]["doc"], "handbook/a");
    assert_eq!(first[1]["doc"], "handbook/b");
    assert!(first[0]["score"].as_f64().unwrap() > first[1]["score"].as_f64().unwrap());
    assert_eq!(report["results"][2]["runs"]["off"][0]["doc"], "handbook/c");
    assert_eq!(
        report["queries"],
        json!({"total": 3, "answerable": 3, "unanswerable": 0, "permission": 0, "skipped": 0})
    );
    assert_eq!(report["leaks"], 0);
}
