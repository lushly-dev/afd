//! Code symbols (specification section 7.4, step 7b): each language's query file on committed
//! fixtures (JavaScript and JSX through the TSX grammar), symbol chunking, the budgets and the
//! clean per-file outcome of hostile input, `defines` and `mentions`, and a restricted file's
//! symbols never reaching a reader who cannot open the file.
#![cfg(feature = "code")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use serde_json::{Value, json};
use support::*;
use umbel_plugin_knowledge::chunk::{MAX_CHUNK_BYTES, PLAIN_LINES};
use umbel_plugin_knowledge::code::{self, Analysis, Budget, Mode, Reason};

const RUST: &str = include_str!("fixtures/code/rust.txt");
const PYTHON: &str = include_str!("fixtures/code/python.txt");
const TYPESCRIPT: &str = include_str!("fixtures/code/typescript.txt");
const JAVASCRIPT: &str = include_str!("fixtures/code/javascript.txt");

fn analyse(path: &str, text: &str) -> Analysis {
    code::analyse(path, text, &Budget::default())
}

/// The invariants of any analysis: chunks in order, inside the text, within the byte cap, with
/// lines that agree with their bytes, and one `code` field each.
fn invariants(text: &str, analysis: &Analysis) {
    assert_eq!(analysis.chunked.chunks.len(), analysis.code.len());
    let mut last_end = 0usize;
    for (index, chunk) in analysis.chunked.chunks.iter().enumerate() {
        assert_eq!(chunk.ordinal as usize, index);
        assert!(chunk.bytes.start >= last_end, "chunks overlap");
        last_end = chunk.bytes.end;
        assert_eq!(&text[chunk.bytes.clone()], chunk.text);
        assert!(chunk.text.len() <= MAX_CHUNK_BYTES);
        assert!(chunk.line_start <= chunk.line_end);
        let line_start = 1 + text[..chunk.bytes.start].matches('\n').count();
        assert_eq!(chunk.line_start as usize, line_start.max(1));
    }
}

/// `(kind, qualified name)` of every symbol.
fn names(analysis: &Analysis) -> Vec<(&str, &str)> {
    analysis
        .symbols
        .iter()
        .map(|symbol| (symbol.kind.as_str(), symbol.qualified.as_str()))
        .collect()
}

#[test]
fn rust_definitions_are_found_and_qualified_with_double_colons() {
    let analysis = analyse("src/lib.rs", RUST);
    assert_eq!(analysis.mode, Mode::Symbols);
    assert_eq!(analysis.language, Some("rust"));
    assert_eq!(analysis.error_bytes, 0);
    assert_eq!(
        names(&analysis),
        [
            ("struct", "RollbackPlan"),
            ("method", "RollbackPlan::new"),
            ("method", "RollbackPlan::apply_step"),
            ("function", "RollbackPlan::apply_step::helper"),
            ("method", "RollbackPlan::fmt"),
            ("trait", "Planner"),
            ("method", "Planner::plan"),
            ("enum", "Mode"),
            ("const", "LIMIT"),
            ("static", "NAME"),
            ("type", "Steps"),
            ("module", "inner"),
            ("function", "inner::deep"),
            ("macro", "shout"),
            ("function", "free_function"),
        ]
    );
    assert_eq!(analysis.symbols[0].node_id(), "symbol:rust:RollbackPlan");
    assert_eq!(analysis.symbols[0].line, 9);
    invariants(RUST, &analysis);
}

#[test]
fn python_definitions_are_found_and_qualified_with_dots() {
    let analysis = analyse("pkg/plan.py", PYTHON);
    assert_eq!(analysis.mode, Mode::Symbols);
    assert_eq!(
        names(&analysis),
        [
            ("function", "top_level"),
            ("function", "top_level.inner"),
            ("class", "Planner"),
            ("method", "Planner.plan"),
            ("method", "Planner.run"),
            ("function", "last"),
        ]
    );
    invariants(PYTHON, &analysis);
}

#[test]
fn typescript_definitions_are_found_including_exported_constants_and_methods() {
    let analysis = analyse("src/plan.ts", TYPESCRIPT);
    assert_eq!(analysis.mode, Mode::Symbols);
    assert_eq!(analysis.language, Some("typescript"));
    assert_eq!(
        names(&analysis),
        [
            ("interface", "Plan"),
            ("method", "Plan.apply"),
            ("type", "Steps"),
            ("enum", "Mode"),
            ("class", "Planner"),
            ("method", "Planner.apply"),
            ("method", "Planner.create"),
            ("function", "build"),
            ("const", "limit"),
            ("const", "make"),
            ("module", "Inner"),
            ("function", "Inner.deep"),
            ("class", "Base"),
            ("method", "Base.run"),
            ("function", "gen"),
        ]
    );
    invariants(TYPESCRIPT, &analysis);
}

#[test]
fn javascript_and_jsx_parse_through_the_tsx_grammar() {
    for path in ["web/app.js", "web/app.jsx", "web/app.mjs", "web/App.JS"] {
        let analysis = analyse(path, JAVASCRIPT);
        assert_eq!(analysis.mode, Mode::Symbols, "{path}");
        assert_eq!(analysis.language, Some("javascript"), "{path}");
        assert_eq!(analysis.error_bytes, 0, "{path}: JSX is not an error");
        assert_eq!(
            names(&analysis),
            [
                ("function", "App"),
                ("class", "Widget"),
                ("method", "Widget.render"),
                ("const", "Button"),
            ],
            "{path}"
        );
        assert_eq!(analysis.symbols[0].node_id(), "symbol:javascript:App");
        invariants(JAVASCRIPT, &analysis);
    }
    // The same source as TSX is typescript.
    let tsx = analyse("web/app.tsx", JAVASCRIPT);
    assert_eq!(tsx.mode, Mode::Symbols);
    assert_eq!(tsx.symbols[0].node_id(), "symbol:typescript:App");
}

#[test]
fn chunks_are_one_per_top_level_definition_with_its_comments_and_the_text_between() {
    let analysis = analyse("src/lib.rs", RUST);
    let chunks = &analysis.chunked.chunks;
    let first_lines: Vec<&str> = chunks
        .iter()
        .map(|chunk| chunk.text.lines().next().unwrap_or(""))
        .collect();
    assert_eq!(
        first_lines,
        [
            // The text before the first definition.
            "//! The rollback module.",
            // Doc comments and the attribute belong to the struct below them.
            "/// A rollback plan.",
            "impl RollbackPlan {",
            "impl fmt::Display for RollbackPlan {",
            "pub trait Planner {",
            "pub enum Mode {",
            "pub const LIMIT: usize = 3;",
            "static NAME: &str = \"plan\";",
            "pub type Steps = Vec<String>;",
            "mod inner {",
            "macro_rules! shout {",
            // A comment directly above a function is part of its chunk.
            "// Not a doc comment, but directly above.",
        ]
    );
    // The struct's chunk holds its attribute, and the impl's chunk its nested definitions.
    assert!(chunks[1].text.contains("#[derive(Debug, Default)]"));
    assert!(chunks[1].text.contains("pub struct RollbackPlan"));
    assert!(chunks[2].text.contains("fn helper() {}"));
    // Lines are 1-based and whole.
    assert_eq!((chunks[1].line_start, chunks[1].line_end), (5, 11));
    // The `code` field names the symbols a chunk defines, whole and as words.
    assert_eq!(analysis.code[0], "");
    assert_eq!(analysis.code[1], "RollbackPlan Rollback Plan");
    assert!(analysis.code[2].contains("RollbackPlan::apply_step apply step"));
    assert!(analysis.code[2].contains("RollbackPlan::apply_step::helper"));
    assert_eq!(analysis.code[4], "Planner Planner::plan plan");

    // Python: a decorator belongs to its class; a comment directly above to its function.
    let python = analyse("a.py", PYTHON);
    let starts: Vec<&str> = python
        .chunked
        .chunks
        .iter()
        .map(|chunk| chunk.text.lines().next().unwrap_or(""))
        .collect();
    assert_eq!(
        starts,
        [
            "\"\"\"The rollback module.\"\"\"",
            "def top_level(a, b):",
            "@decorator",
            "# A comment above",
        ]
    );
}

#[test]
fn a_long_stretch_between_definitions_is_cut_into_pieces_of_sixty_lines() {
    let filler: String = (0..150).map(|n| format!("// line {n}\n")).collect();
    let text = format!("fn first() {{}}\n\n{filler}\nfn last() {{}}\n");
    let analysis = analyse("a.rs", &text);
    assert_eq!(analysis.mode, Mode::Symbols);
    let sizes: Vec<usize> = analysis
        .chunked
        .chunks
        .iter()
        .map(|chunk| chunk.text.lines().count())
        .collect();
    // `fn first`, then the blank line and comments in 60-line pieces, then the comment that sits
    // directly above `fn last` with it.
    assert!(sizes.iter().all(|lines| *lines <= PLAIN_LINES), "{sizes:?}");
    assert_eq!(analysis.chunked.chunks[0].text.trim(), "fn first() {}");
    assert!(
        analysis
            .chunked
            .chunks
            .last()
            .unwrap()
            .text
            .contains("fn last()")
    );
    invariants(&text, &analysis);
}

#[test]
fn a_definition_over_the_byte_cap_is_cut_into_plain_pieces_that_keep_their_names() {
    let body: String = (0..4000)
        .map(|n| format!("    let value_{n} = {n};\n"))
        .collect();
    let text = format!("fn huge() {{\n{body}}}\n\nfn small() {{}}\n");
    assert!(text.len() > MAX_CHUNK_BYTES);
    let analysis = analyse("a.rs", &text);
    assert_eq!(analysis.mode, Mode::Symbols);
    assert!(analysis.chunked.chunks.len() > 2);
    invariants(&text, &analysis);
    // `huge` is named in the piece its name is in; `small` in its own chunk.
    assert!(analysis.code.iter().any(|field| field.contains("huge")));
    assert!(analysis.code.last().unwrap().contains("small"));
}

#[test]
fn a_file_with_no_definition_is_still_chunked_and_an_empty_one_has_a_chunk() {
    let comments = analyse("a.py", "# only a comment\n# and another\n");
    assert_eq!(comments.mode, Mode::Symbols);
    assert!(comments.symbols.is_empty());
    assert_eq!(comments.chunked.chunks.len(), 1);
    let empty = analyse("a.rs", "");
    assert_eq!(empty.mode, Mode::Symbols);
    assert_eq!(empty.chunked.chunks.len(), 1);
    assert_eq!(empty.code, [""]);
}

#[test]
fn a_file_with_a_few_errors_keeps_its_symbols_and_reports_them() {
    let good: String = (0..30).map(|n| format!("fn fine_{n}() {{}}\n")).collect();
    let text = format!("{good}\nfn broken() {{ let = 5 ; }}\n\nfn also_fine() {{}}\n");
    let analysis = analyse("a.rs", &text);
    assert_eq!(analysis.mode, Mode::Symbols);
    assert!(analysis.error_bytes > 0);
    assert!(
        analysis
            .symbols
            .iter()
            .any(|symbol| symbol.qualified == "fine_3")
    );
    invariants(&text, &analysis);
}

#[test]
fn a_file_over_a_quarter_errors_is_plain_text_with_its_reason() {
    for (path, text) in [
        ("a.rs", "@#$%^&*(){}[]<>;;; ".repeat(2000)),
        ("a.py", "def (((( :: \n".repeat(2000)),
        ("a.ts", "{ { { ) ) ] ] =>> ".repeat(2000)),
    ] {
        let analysis = analyse(path, &text);
        assert_eq!(analysis.mode, Mode::PlainText(Reason::ErrorRate), "{path}");
        assert!(analysis.symbols.is_empty());
        assert!(Reason::ErrorRate.degraded());
        assert_eq!(Reason::ErrorRate.code(), "error-rate");
        // Plain text still chunks and stays within the cap.
        invariants(&text, &analysis);
        assert!(analysis.code.iter().all(String::is_empty));
    }
}

#[test]
fn a_file_over_one_mebibyte_is_not_parsed() {
    let text = "fn a() {}\n".repeat(120_000);
    assert!(text.len() > 1 << 20);
    let analysis = analyse("a.rs", &text);
    assert_eq!(analysis.mode, Mode::PlainText(Reason::TooLarge));
    invariants(&text, &analysis);
}

#[test]
fn a_parse_cancelled_by_its_time_bound_is_plain_text() {
    let text = "fn a() {}\n".repeat(50_000);
    let budget = Budget {
        parse: Duration::ZERO,
        ..Budget::default()
    };
    let analysis = code::analyse("a.rs", &text, &budget);
    assert_eq!(analysis.mode, Mode::PlainText(Reason::ParseTimeout));
    invariants(&text, &analysis);
}

#[test]
fn a_query_cancelled_by_its_time_bound_is_plain_text() {
    let text = "fn a() {}\n".repeat(50_000);
    let budget = Budget {
        query: Duration::ZERO,
        ..Budget::default()
    };
    let analysis = code::analyse("a.rs", &text, &budget);
    assert_eq!(analysis.mode, Mode::PlainText(Reason::QueryTimeout));
    invariants(&text, &analysis);
}

#[test]
fn a_query_over_its_match_limit_is_plain_text() {
    // Exported constants and impls hold several matches open at once while the cursor descends.
    let budget = Budget {
        match_limit: 1,
        ..Budget::default()
    };
    let typescript = "export const a = 1;\n".repeat(50);
    let analysis = code::analyse("a.ts", &typescript, &budget);
    assert_eq!(analysis.mode, Mode::PlainText(Reason::MatchLimit));
    let rust = "impl<T> Foo<T> where T: Copy { fn a() {} }\n".repeat(200);
    let analysis = code::analyse("a.rs", &rust, &budget);
    assert_eq!(analysis.mode, Mode::PlainText(Reason::MatchLimit));
    // The specification's limit does not trouble an ordinary file.
    assert_eq!(analyse("a.ts", &typescript).mode, Mode::Symbols);
}

#[test]
fn more_definitions_than_the_symbol_limit_is_plain_text() {
    let text = "fn a() {} ".repeat(5001);
    let analysis = analyse("a.rs", &text);
    assert_eq!(analysis.mode, Mode::PlainText(Reason::SymbolLimit));
    invariants(&text, &analysis);
}

#[test]
fn a_file_of_an_unparsed_language_is_plain_text_without_a_degraded_reason() {
    let analysis = analyse("notes.txt", "alpha\nbeta\n");
    assert_eq!(analysis.mode, Mode::PlainText(Reason::Unsupported));
    assert!(!Reason::Unsupported.degraded());
    assert_eq!(analysis.language, None);
    assert_eq!(code::language_of("a.mjs"), Some("javascript"));
    assert_eq!(code::language_of("a.tsx"), Some("typescript"));
    assert_eq!(code::language_of("Makefile"), None);
}

/// Run `body` on a thread with a 1 MiB stack, smaller than a Tokio blocking thread's, so any
/// recursion over the depth of a tree would overflow it.
fn on_small_stack<T: Send + 'static>(body: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(1 << 20)
        .spawn(body)
        .unwrap()
        .join()
        .unwrap()
}

#[test]
fn deep_nesting_is_a_clean_outcome_on_a_small_stack() {
    let deep = 200_000;
    let cases: Vec<(&str, String)> = vec![
        (
            "a.ts",
            format!("const x = {}1{};\n", "(".repeat(deep), ")".repeat(deep)),
        ),
        (
            "a.rs",
            format!("fn f() {}{}\n", "{".repeat(deep), "}".repeat(deep)),
        ),
        (
            "a.py",
            format!("x = {}1{}\n", "[".repeat(deep), "]".repeat(deep)),
        ),
        ("a.js", "{".repeat(500_000)),
        (
            "a.rs",
            format!("{}{}", "fn f() { ".repeat(20_000), "}".repeat(20_000)),
        ),
        (
            "a.py",
            (0..400)
                .map(|n| format!("{}def f{n}():\n", " ".repeat(n)))
                .collect(),
        ),
    ];
    for (path, text) in cases {
        let moved = text.clone();
        let analysis = on_small_stack(move || code::analyse(path, &moved, &Budget::default()));
        // Either its definitions or plain text; never a panic, never a chunk over the cap.
        match analysis.mode {
            Mode::Symbols | Mode::PlainText(_) => {}
        }
        invariants(&text, &analysis);
    }
}

#[test]
fn very_long_lines_and_many_definitions_on_one_line_are_bounded() {
    // Generous time bounds: these cases are about the shape, not the clock, so a loaded machine
    // must not reach a timeout first (#1043). The timeouts have tests of their own.
    let patient = Budget {
        parse: Duration::from_secs(120),
        query: Duration::from_secs(120),
        ..Budget::default()
    };
    // One line, a megabyte of statements.
    let line = "x = 1; ".repeat(140_000);
    let analysis = analyse("a.py", &line);
    invariants(&line, &analysis);
    // A hundred thousand definitions on one line, just under the size bound: over the symbol
    // limit, so plain text, and the line cut into units that share its number.
    let many = "fn a(){} ".repeat(100_000);
    let analysis = code::analyse("a.rs", &many, &patient);
    assert_eq!(analysis.mode, Mode::PlainText(Reason::SymbolLimit));
    invariants(&many, &analysis);
    // A few hundred definitions on a line a megabyte wide are found and chunked by line.
    let sparse = format!("{}{}", "fn a(){}".repeat(100), " ".repeat(900_000));
    let analysis = code::analyse("a.rs", &sparse, &patient);
    assert_eq!(analysis.mode, Mode::Symbols);
    invariants(&sparse, &analysis);
}

#[test]
fn a_comment_on_a_very_long_line_does_not_make_attaching_comments_quadratic() {
    // A hundred thousand block comments on one line before a definition.
    let text = format!("{}\nfn target() {{}}\n", "/*c*/ ".repeat(100_000));
    let started = std::time::Instant::now();
    let analysis = analyse("a.rs", &text);
    invariants(&text, &analysis);
    assert!(
        started.elapsed() < Duration::from_secs(20),
        "{:?}",
        started.elapsed()
    );
}

#[test]
fn text_with_replacement_characters_nul_and_crlf_is_read_like_any_other() {
    // What the indexer sees for a file with invalid UTF-8: the lossy text.
    let bytes = b"fn ok() {}\r\n\xff\xfe fn z() {}\r\n\0\0\r\nfn tail() {}\r\n";
    let text = String::from_utf8_lossy(bytes).into_owned();
    assert!(text.contains('\u{fffd}'));
    let analysis = analyse("a.rs", &text);
    invariants(&text, &analysis);
    assert!(
        analysis
            .symbols
            .iter()
            .any(|symbol| symbol.qualified == "ok")
    );
    let crlf = analyse(
        "a.py",
        "def a():\r\n    pass\r\n\r\ndef b():\r\n    pass\r\n",
    );
    assert_eq!(crlf.mode, Mode::Symbols);
    assert_eq!(names(&crlf), [("function", "a"), ("function", "b")]);
}

// ---------------------------------------------------------------------------------------------
// Through the host: indexing, search, the graph and access.

fn symbol_edges(result: &Value) -> Vec<(String, String, String, u64)> {
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

impl Fx {
    fn code_file(&self, path: &str, text: &str) {
        self.write(&format!("spaces/main/code/{path}"), text.as_bytes());
    }

    async fn neighbors(&self, actor: afd::Actor, input: Value) -> Value {
        self.as_actor(actor, "knowledge-neighbors", input).await
    }
}

const HANDBOOK_MENTIONS: &str = "---\ntitle: Rollback guide\n---\n# Rollback guide\n\nCall `RollbackPlan::apply_step` on a `RollbackPlan`, then another `RollbackPlan`. Run `cargo test` and `--verbose`. A Python `Planner.plan()` and `main` are not defined here.\n";

#[tokio::test]
async fn code_is_indexed_by_symbol_searched_and_linked_by_defines_and_mentions() {
    let fx = Fx::new();
    fx.code_file("src/rollback.rs", RUST);
    fx.code_file("pkg/plan.py", PYTHON);
    fx.handbook("guide.md", HANDBOOK_MENTIONS);
    let sync = fx.cli("sources-sync", json!({})).await;
    assert_eq!(data(&sync)["totals"]["added"], 3, "{sync}");
    let run = fx.cli("knowledge-index", json!({})).await;
    let report = data(&run);
    assert_eq!(report["code"]["documents"], 2, "{run}");
    assert_eq!(report["code"]["degraded"], 0);
    assert_eq!(report["code"]["symbols"], 15 + 6);
    assert!(warning(&run, "CODE_PARSE_DEGRADED").is_none());

    // A symbol's name finds the file, through the `code` field and through the body.
    let by_field = fx
        .search(
            human("local"),
            json!({ "query": "code:apply", "filters": { "collection": "code" } }),
        )
        .await;
    assert_eq!(hit_ids(&by_field), ["code/src/rollback.rs"]);
    let by_word = fx
        .search(
            human("local"),
            json!({ "query": "rollbackplan", "filters": { "type": "code" } }),
        )
        .await;
    assert_eq!(hit_ids(&by_word)[0], "code/src/rollback.rs");
    let python = fx
        .search(
            human("local"),
            json!({ "query": "lang:python AND Planner" }),
        )
        .await;
    assert_eq!(hit_ids(&python), ["code/pkg/plan.py"]);
    let rust = fx
        .search(
            human("local"),
            json!({ "query": "lang:rust AND code:planner" }),
        )
        .await;
    assert_eq!(hit_ids(&rust), ["code/src/rollback.rs"]);
    // The hit is the chunk of the definition.
    let hit = &data(&by_field)["hits"][0];
    assert!(hit["lines"].is_object() || hit["lines"].is_array() || hit.get("locator").is_some());

    // `defines`: the file to each symbol it defines, once each.
    let defined = fx
        .neighbors(
            human("local"),
            json!({ "doc": "code/src/rollback.rs", "kinds": ["defines"], "direction": "out", "limit": 200 }),
        )
        .await;
    let out = symbol_edges(&defined);
    assert_eq!(out.len(), 15, "{out:?}");
    for symbol in [
        "RollbackPlan",
        "RollbackPlan::new",
        "RollbackPlan::apply_step::helper",
        "Planner::plan",
        "inner::deep",
        "free_function",
    ] {
        assert!(
            out.contains(&edge("out", "defines", &format!("symbol:rust:{symbol}"), 1)),
            "{symbol} missing from {out:?}"
        );
    }
    // The symbol node says only its qualified name.
    let node = fx
        .neighbors(
            human("local"),
            json!({ "node": "symbol:rust:RollbackPlan" }),
        )
        .await;
    assert_eq!(data(&node)["node"]["label"], "RollbackPlan");
    assert_eq!(data(&node)["node"]["kind"], "symbol");

    // `mentions`: the guide's inline code, counted, to the symbols it names (never to a symbol
    // that is not defined, and never to a span that is not a name).
    let mentions = fx
        .neighbors(
            human("local"),
            json!({ "doc": "handbook/guide", "kinds": ["mentions"], "direction": "out" }),
        )
        .await;
    let mut got = symbol_edges(&mentions);
    got.sort();
    assert_eq!(
        got,
        [
            edge("out", "mentions", "symbol:python:Planner.plan", 1),
            edge("out", "mentions", "symbol:rust:RollbackPlan", 2),
            edge("out", "mentions", "symbol:rust:RollbackPlan::apply_step", 1),
        ]
    );
    // From the symbol's side: its definer and the document that mentions it.
    let both = fx
        .neighbors(
            human("local"),
            json!({ "node": "symbol:rust:RollbackPlan", "direction": "in" }),
        )
        .await;
    let mut inward = symbol_edges(&both);
    inward.sort();
    assert_eq!(
        inward,
        [
            edge("in", "defines", "doc:code/src/rollback.rs", 1),
            edge("in", "mentions", "doc:handbook/guide", 2),
        ]
    );

    // The path from the guide to the file goes through the symbol.
    let path = fx
        .as_actor(
            human("local"),
            "knowledge-path",
            json!({ "from": "handbook/guide", "to": "code/src/rollback.rs" }),
        )
        .await;
    assert_eq!(data(&path)["hops"], 2, "{path}");

    // Describing the file says how it was indexed.
    let described = fx
        .as_actor(
            human("local"),
            "knowledge-describe",
            json!({ "doc": "code/src/rollback.rs" }),
        )
        .await;
    assert_eq!(data(&described)["codeIndexing"], "symbols");
    assert_eq!(data(&described)["code"]["language"], "rust");
    assert_eq!(data(&described)["code"]["symbols"], 15);
}

#[tokio::test]
async fn a_mention_counts_from_the_day_the_symbol_exists_and_stops_when_it_goes() {
    let fx = Fx::new();
    fx.handbook("guide.md", HANDBOOK_MENTIONS);
    // A code collection exists but nothing defines the symbols yet.
    fx.refresh("main").await;
    let none = fx
        .neighbors(
            human("local"),
            json!({ "doc": "handbook/guide", "kinds": ["mentions"] }),
        )
        .await;
    assert!(symbol_edges(&none).is_empty());

    // The file arrives; the guide is not touched, and its mention now counts.
    fx.code_file("src/rollback.rs", RUST);
    fx.refresh("main").await;
    let found = fx
        .neighbors(
            human("local"),
            json!({ "doc": "handbook/guide", "kinds": ["mentions"] }),
        )
        .await;
    assert_eq!(symbol_edges(&found).len(), 2);

    // The file goes; so do the symbols, and the mention is not served.
    fx.remove("spaces/main/code/src/rollback.rs");
    fx.refresh("main").await;
    let gone = fx
        .neighbors(
            human("local"),
            json!({ "doc": "handbook/guide", "kinds": ["mentions"] }),
        )
        .await;
    assert!(symbol_edges(&gone).is_empty());
    let node = fx
        .neighbors(
            human("local"),
            json!({ "node": "symbol:rust:RollbackPlan" }),
        )
        .await;
    assert_eq!(code(&node), "NODE_NOT_FOUND");
}

#[tokio::test]
async fn a_degraded_parse_is_reported_by_the_index_run_and_the_description() {
    let fx = Fx::new();
    fx.code_file("src/good.rs", "pub fn good_function() {}\n");
    fx.code_file("src/garbage.rs", &"@#$%^&*(){}[]<>;;; ".repeat(500));
    fx.code_file("src/notes.txt", "plain words in a code collection\n");
    fx.handbook("note.md", "# Note\n\nNothing.\n");
    let config = CONFIG.replace(
        "kind = \"code\"",
        "kind = \"code\"\ninclude = [\"**/*.rs\", \"**/*.txt\"]",
    );
    let mut fx = fx;
    fx.reopen(&config);
    let sync = fx.cli("sources-sync", json!({})).await;
    assert_eq!(sync["success"], true, "{sync}");
    let run = fx.cli("knowledge-index", json!({})).await;
    let report = data(&run);
    assert_eq!(report["code"]["documents"], 3);
    assert_eq!(report["code"]["degraded"], 1);
    let degraded = warning(&run, "CODE_PARSE_DEGRADED").expect("a degraded warning");
    assert_eq!(degraded["details"]["count"], 1);
    assert_eq!(
        degraded["details"]["files"],
        json!([{ "id": "code/src/garbage.rs", "reason": "error-rate" }])
    );
    // The message holds no content.
    never_mentions(degraded, &["@#$%"]);

    // The degraded file is still found by its words; the good one by its symbol.
    let described = fx
        .as_actor(
            human("local"),
            "knowledge-describe",
            json!({ "doc": "code/src/garbage.rs" }),
        )
        .await;
    assert_eq!(data(&described)["codeIndexing"], "plain-text");
    assert_eq!(data(&described)["code"]["reason"], "error-rate");
    let notes = fx
        .as_actor(
            human("local"),
            "knowledge-describe",
            json!({ "doc": "code/src/notes.txt" }),
        )
        .await;
    assert_eq!(data(&notes)["codeIndexing"], "plain-text");
    assert_eq!(data(&notes)["code"]["reason"], "language-unsupported");
    let good = fx
        .search(human("local"), json!({ "query": "code:good_function" }))
        .await;
    assert_eq!(hit_ids(&good), ["code/src/good.rs"]);
    // No symbol came from the degraded file.
    let defined = fx
        .neighbors(
            human("local"),
            json!({ "doc": "code/src/garbage.rs", "kinds": ["defines"] }),
        )
        .await;
    assert!(symbol_edges(&defined).is_empty());
}

#[tokio::test]
async fn hostile_files_leave_the_run_succeeding_with_the_others_indexed() {
    let mut fx = Fx::new();
    let config = CONFIG.replace(
        "kind = \"code\"",
        "kind = \"code\"\nmax_file_bytes = 4194304",
    );
    fx.reopen(&config);
    fx.code_file("ok.rs", "pub fn survivor() {}\n");
    fx.code_file(
        "deep.ts",
        &format!(
            "const x = {}1{};\n",
            "(".repeat(150_000),
            ")".repeat(150_000)
        ),
    );
    fx.code_file("wide.py", &"x = 1; ".repeat(140_000));
    fx.code_file("huge.rs", &"fn a() {}\n".repeat(150_000));
    fx.code_file(
        "nested.rs",
        &format!("{}{}", "fn f() { ".repeat(20_000), "}".repeat(20_000)),
    );
    fx.code_file("noise.js", &"{ ) ] ?? ".repeat(30_000));
    // Not UTF-8: the sync refuses it, and the run goes on.
    fx.write(
        "spaces/main/code/binary.rs",
        b"fn ok() {}\n\xff\xfe\xfd fn z() {}\n",
    );
    fx.write("spaces/main/code/nul.rs", b"fn nul() {}\n\0\0\0\n");
    let sync = fx.cli("sources-sync", json!({})).await;
    assert_eq!(sync["success"], true, "{sync}");
    let run = fx.cli("knowledge-index", json!({})).await;
    assert_eq!(run["success"], true, "{run}");
    let found = fx
        .search(human("local"), json!({ "query": "code:survivor" }))
        .await;
    assert_eq!(hit_ids(&found), ["code/ok.rs"]);
    // Every document the run indexed has chunks within the cap.
    let listed = fx
        .as_actor(
            human("local"),
            "knowledge-list",
            json!({ "collection": "code" }),
        )
        .await;
    assert!(data(&listed)["documents"].as_array().unwrap().len() >= 5);
}

fn restricted_config() -> String {
    CONFIG.to_owned()
}

/// A workspace where `secret/` of the code collection is readable by `group:platform` only.
async fn with_secrets() -> Fx {
    let fx = Fx::with(&restricted_config());
    fx.code_file(".umbel-access.toml", "access = [\"space\"]\n");
    fx.code_file(
        "secret/.umbel-access.toml",
        "access = [\"group:platform\"]\n",
    );
    fx.code_file(
        "secret/vault.py",
        "class SecretVault:\n    def unseal_master_key(self):\n        return 'zebra-cipher-token'\n\n\ndef shared_helper():\n    return 1\n",
    );
    fx.code_file(
        "public/open.py",
        "def shared_helper():\n    return 2\n\n\nclass OpenThing:\n    pass\n",
    );
    fx.handbook(
        "mentions.md",
        "---\ntitle: Mentions\n---\n# Mentions\n\nThe `SecretVault` and `SecretVault.unseal_master_key` and `OpenThing` and `shared_helper`.\n",
    );
    fx.handbook(
        "private.md",
        "---\ntitle: Private notes\naccess: [group:platform]\n---\n# Private notes\n\nAlso `OpenThing`, privately.\n",
    );
    fx.refresh_as(member(), "main").await;
    fx
}

#[tokio::test]
async fn a_restricted_files_symbols_never_reach_an_outsider() {
    let fx = with_secrets().await;
    // What the restricted file holds that nothing public repeats, and the ids of its nodes. (The
    // public guide does write the symbols' names in its own text; that is its own content.)
    let text = ["zebra-cipher-token", "secret/vault"];
    let graph = [
        "symbol:python:SecretVault",
        "doc:code/secret/vault.py",
        "code/secret/vault.py",
        "zebra-cipher-token",
    ];

    // A member sees everything.
    let member_search = fx
        .search(member(), json!({ "query": "code:secretvault" }))
        .await;
    assert_eq!(hit_ids(&member_search), ["code/secret/vault.py"]);
    let member_edges = fx
        .neighbors(
            member(),
            json!({ "doc": "handbook/mentions", "kinds": ["mentions"] }),
        )
        .await;
    let mut seen: Vec<String> = symbol_edges(&member_edges)
        .into_iter()
        .map(|(_, _, node, _)| node)
        .collect();
    seen.sort();
    assert_eq!(
        seen,
        [
            "symbol:python:OpenThing",
            "symbol:python:SecretVault",
            "symbol:python:SecretVault.unseal_master_key",
            "symbol:python:shared_helper",
        ]
    );

    // An outsider: search, by field, by word, by symbol syntax and with expansion.
    for query in [
        "code:secretvault",
        "SecretVault",
        "unseal master key",
        "zebra-cipher-token",
        "lang:python AND code:unseal",
        "path:secret",
        "secret*",
    ] {
        for expand in [false, true] {
            let result = fx
                .search(outsider(), json!({ "query": query, "expand": expand }))
                .await;
            if result["success"] == true {
                assert!(
                    hit_ids(&result)
                        .iter()
                        .all(|id| id != "code/secret/vault.py"),
                    "{query}: {result}"
                );
                never_mentions(&result["data"]["hits"], &text);
            }
        }
    }
    // Neighbors: of the public guide, of the symbol and of the unreadable file.
    let guide = fx
        .neighbors(
            outsider(),
            json!({ "doc": "handbook/mentions", "limit": 200 }),
        )
        .await;
    never_mentions(&guide, &graph);
    let mut visible: Vec<String> = symbol_edges(
        &fx.neighbors(
            outsider(),
            json!({ "doc": "handbook/mentions", "kinds": ["mentions"] }),
        )
        .await,
    )
    .into_iter()
    .map(|(_, _, node, _)| node)
    .collect();
    visible.sort();
    assert_eq!(
        visible,
        ["symbol:python:OpenThing", "symbol:python:shared_helper"]
    );
    for node in [
        "symbol:python:SecretVault",
        "symbol:python:SecretVault.unseal_master_key",
        "doc:code/secret/vault.py",
    ] {
        let result = fx.neighbors(outsider(), json!({ "node": node })).await;
        // One code for a node that is absent and one that is unreadable, by its kind.
        let expected = if node.starts_with("doc:") {
            "DOCUMENT_NOT_FOUND"
        } else {
            "NODE_NOT_FOUND"
        };
        assert_eq!(code(&result), expected, "{node}");
    }
    let by_doc = fx
        .neighbors(outsider(), json!({ "doc": "code/secret/vault.py" }))
        .await;
    assert_eq!(code(&by_doc), "DOCUMENT_NOT_FOUND");
    // Paths, related documents, outlines, lists, finds and opens.
    let path = fx
        .as_actor(
            outsider(),
            "knowledge-path",
            json!({ "from": "handbook/mentions", "to": "symbol:python:SecretVault" }),
        )
        .await;
    assert_eq!(code(&path), "PATH_NOT_FOUND");
    let related = fx
        .as_actor(
            outsider(),
            "knowledge-related",
            json!({ "doc": "handbook/mentions" }),
        )
        .await;
    never_mentions(&related, &graph);
    let outline = fx
        .as_actor(
            outsider(),
            "knowledge-outline",
            json!({ "collection": "code" }),
        )
        .await;
    never_mentions(&outline, &graph);
    let listed = fx
        .as_actor(
            outsider(),
            "knowledge-list",
            json!({ "collection": "code" }),
        )
        .await;
    never_mentions(&listed, &graph);
    let find = fx
        .as_actor(
            outsider(),
            "knowledge-find",
            json!({ "pattern": "SecretVault" }),
        )
        .await;
    never_mentions(&find, &text);
    for command in ["knowledge-open", "knowledge-describe"] {
        let result = fx
            .as_actor(
                outsider(),
                command,
                json!({ "doc": "code/secret/vault.py" }),
            )
            .await;
        assert_eq!(code(&result), "DOCUMENT_NOT_FOUND", "{command}");
    }
    // The shared symbol is public through the public file: one node, and only the public file
    // defines it for the outsider.
    let shared = fx
        .neighbors(outsider(), json!({ "node": "symbol:python:shared_helper" }))
        .await;
    assert_eq!(
        symbol_edges(&shared)
            .into_iter()
            .filter(|(_, kind, _, _)| kind == "defines")
            .collect::<Vec<_>>(),
        [edge("in", "defines", "doc:code/public/open.py", 1)]
    );
    never_mentions(&shared, &graph);
    // The restricted note's mention of a public symbol is invisible to the outsider.
    let open_thing = fx
        .neighbors(
            outsider(),
            json!({ "node": "symbol:python:OpenThing", "direction": "in" }),
        )
        .await;
    let mentioners: Vec<String> = symbol_edges(&open_thing)
        .into_iter()
        .filter(|(_, kind, _, _)| kind == "mentions")
        .map(|(_, _, node, _)| node)
        .collect();
    assert_eq!(mentioners, ["doc:handbook/mentions"]);
    let for_member = fx
        .neighbors(
            member(),
            json!({ "node": "symbol:python:OpenThing", "direction": "in" }),
        )
        .await;
    let mut both: Vec<String> = symbol_edges(&for_member)
        .into_iter()
        .filter(|(_, kind, _, _)| kind == "mentions")
        .map(|(_, _, node, _)| node)
        .collect();
    both.sort();
    assert_eq!(both, ["doc:handbook/mentions", "doc:handbook/private"]);
}

#[tokio::test]
async fn tightening_a_files_access_hides_its_symbols_at_once() {
    let fx = Fx::new();
    fx.handbook("g.md", "# G\n\nSee `Hidden`.\n");
    fx.code_file("a/thing.py", "class Hidden:\n    pass\n");
    fx.refresh_as(member(), "main").await;
    let before = fx
        .neighbors(outsider(), json!({ "node": "symbol:python:Hidden" }))
        .await;
    assert_eq!(symbol_edges(&before).len(), 2);
    fx.code_file("a/.umbel-access.toml", "access = [\"group:platform\"]\n");
    fx.refresh_as(member(), "main").await;
    let after = fx
        .neighbors(outsider(), json!({ "node": "symbol:python:Hidden" }))
        .await;
    assert_eq!(code(&after), "NODE_NOT_FOUND");
    let search = fx.search(outsider(), json!({ "query": "Hidden" })).await;
    assert!(hit_ids(&search).iter().all(|id| id != "code/a/thing.py"));
}

#[tokio::test]
async fn an_index_run_lists_only_readable_files_among_the_degraded_ones() {
    let mut fx = Fx::new();
    fx.reopen(&CONFIG.replace(
        "kind = \"code\"",
        "kind = \"code\"\ninclude = [\"**/*.rs\"]",
    ));
    fx.code_file(
        "secret/.umbel-access.toml",
        "access = [\"group:platform\"]\n",
    );
    fx.code_file("secret/noise.rs", &"@#$%^&*(){}[]<>;;; ".repeat(500));
    fx.code_file("open_noise.rs", &"@#$%^&*(){}[]<>;;; ".repeat(500));
    let sync = fx.cli("sources-sync", json!({})).await;
    assert_eq!(sync["success"], true, "{sync}");
    // An outsider runs the index: both files degrade, and only the open one is named.
    let run = fx.as_actor(outsider(), "knowledge-index", json!({})).await;
    let degraded = warning(&run, "CODE_PARSE_DEGRADED").expect("a degraded warning");
    assert_eq!(degraded["details"]["count"], 2);
    assert_eq!(
        degraded["details"]["files"],
        json!([{ "id": "code/open_noise.rs", "reason": "error-rate" }])
    );
    never_mentions(&run, &["secret/noise"]);
}
