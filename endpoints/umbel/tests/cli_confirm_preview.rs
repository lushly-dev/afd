//! The CLI's confirmation preview (phase 4 specification, sections 8.1 and 10.2, D97): for a
//! command that declares `confirm_preview`, the CLI runs the preview **before** the prompt,
//! passes it **only the properties it declares**, runs it under a **fresh trace id** without the
//! marks, shows it **sanitised** and **capped with the count** of lines not shown, and a
//! **failure refuses** the call before anything runs. Nothing changes on MCP.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use support::mcp::Client;
use support::plugins::{Raw, closure, config, seal};
use support::{Run, cli_with};
use umbel::cli::Console;

const HUMAN_CONFIRMED: &str = "dev.umbel/human-confirmed";
const HUMAN_PRESENT: &str = "dev.umbel/human-present";

const MANIFEST: &str = r#"manifest_version = 4
protocol = 1

[plugin]
id = "gate"
title = "Gate"
version = "0.1.0"
description = "Commands a person confirms after a preview."
kind = "compiled"
domains = ["gate"]

[[commands]]
name = "gate-approve"
description = "Apply a proposal, confirmed by a person at a terminal."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { space = { type = "string" }, proposal = { type = "string" }, reason = { type = "string" } }, required = ["proposal"], additionalProperties = false }
confirm_prompt = "Apply this proposal?"
confirm = "require-human"
expose = { mcp = false, agent = false, cli = true }
confirm_preview = "gate-preview"

[[commands]]
name = "gate-confirm"
description = "A confirmation any surface may give, previewed on the CLI."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { space = { type = "string" }, proposal = { type = "string" } }, required = ["proposal"], additionalProperties = false }
confirm_prompt = "Really confirm?"
confirm_preview = "gate-preview"

[[commands]]
name = "gate-plain"
description = "A confirmation with no preview."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { proposal = { type = "string" } }, additionalProperties = false }
confirm_prompt = "Plainly?"

[[commands]]
name = "gate-preview"
description = "Render what is about to be confirmed."
effects = ["inspect"]
input_schema = { type = "object", properties = { space = { type = "string" }, proposal = { type = "string" } }, additionalProperties = false }
expose = { mcp = false, agent = false, cli = true }
journal = { mode = "digest", keep = ["proposal"] }
returns = { type = "object", properties = { preview = { type = "string" } }, required = ["preview"], additionalProperties = false }
"#;

/// What the commands saw: each call's command, input, trace id and marks.
#[derive(Clone, Default)]
struct Seen(Arc<Mutex<Vec<Value>>>);

impl Seen {
    fn of(&self, command: &str) -> Vec<Value> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call["command"] == command)
            .cloned()
            .collect()
    }
}

fn long_preview() -> String {
    (0..200).map(|i| format!("{i:049}\n")).collect()
}

fn preview_for(proposal: &str) -> afd::CommandResult<Value> {
    match proposal {
        "dirty" => afd::success(json!({
            "preview": "id \u{1b}[31mp-1\u{1b}[0m\r\nop\u{2028}update\u{2029}\nfrom \u{202e}evil\u{202c} \u{2066}x\u{2069}\u{200f}\n\u{1b}]0;title\u{7}diff\u{85}\n",
        })),
        "long" => afd::success(json!({ "preview": long_preview() })),
        "fail" => afd::failure(
            afd::CommandError::new("PREVIEW_BROKEN", "the preview broke")
                .with_suggestion("Fix the preview."),
        ),
        "shape" => afd::success(json!({ "text": "not a preview" })),
        "extra" => afd::success(json!({ "preview": "a preview", "more": 1 })),
        other => afd::success(json!({ "preview": format!("Proposal {other}\nline two") })),
    }
}

fn plugin(seen: &Seen) -> Raw {
    let seen = seen.clone();
    Raw::new(MANIFEST.to_owned(), move |_| {
        let record = |name: &'static str, seen: Seen| {
            closure(name, move |input, context| {
                let mark = |key: &str| context.extra.get(key).cloned().unwrap_or(Value::Null);
                seen.0.lock().unwrap().push(json!({
                    "command": name,
                    "input": input,
                    "trace": context.trace_id,
                    "confirmed": mark(HUMAN_CONFIRMED),
                    "present": mark(HUMAN_PRESENT),
                }));
                if name == "gate-preview" {
                    preview_for(input["proposal"].as_str().unwrap_or_default())
                } else {
                    afd::success(json!({ "applied": input["proposal"] }))
                }
            })
        };
        Ok(vec![
            record("gate-approve", seen.clone()),
            record("gate-confirm", seen.clone()),
            record("gate-plain", seen.clone()),
            record("gate-preview", seen.clone()),
        ])
    })
}

/// A terminal that records what it showed and asked, in order.
struct Terminal {
    interactive: bool,
    answer: bool,
    events: Mutex<Vec<(&'static str, String)>>,
}

impl Terminal {
    fn new(interactive: bool, answer: bool) -> Arc<Self> {
        Arc::new(Self {
            interactive,
            answer,
            events: Mutex::new(Vec::new()),
        })
    }

    fn events(&self) -> Vec<(&'static str, String)> {
        self.events.lock().unwrap().clone()
    }

    fn kinds(&self) -> Vec<&'static str> {
        self.events().into_iter().map(|(kind, _)| kind).collect()
    }

    fn shown(&self) -> String {
        self.events()
            .into_iter()
            .find(|(kind, _)| *kind == "show")
            .map(|(_, text)| text)
            .unwrap_or_default()
    }
}

impl Console for Terminal {
    fn is_interactive(&self) -> bool {
        self.interactive
    }

    fn ask(&self, text: &str) -> bool {
        self.events.lock().unwrap().push(("ask", text.to_owned()));
        self.answer
    }

    fn show(&self, text: &str) {
        self.events.lock().unwrap().push(("show", text.to_owned()));
    }
}

struct Fixture {
    dir: tempfile::TempDir,
    seen: Seen,
}

fn fixture() -> Fixture {
    let dir = support::workspace(&config(&[("gate", "")], ""));
    Fixture {
        dir,
        seen: Seen::default(),
    }
}

impl Fixture {
    async fn run(&self, terminal: &Arc<Terminal>, args: &[&str]) -> Run {
        let console: Arc<dyn Console> = terminal.clone();
        cli_with(self.dir.path(), args, console, |b| {
            b.with_compiled(plugin(&self.seen))
        })
        .await
    }
}

fn is_trace(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|t| t.len() == 32 && t.chars().all(|c| c.is_ascii_hexdigit()))
}

// ── Before the prompt, with only the declared properties ─────────────────────────────────────

#[tokio::test]
async fn the_preview_is_shown_before_the_prompt_with_only_its_declared_properties() {
    let fx = fixture();
    let terminal = Terminal::new(true, true);
    let run = fx
        .run(
            &terminal,
            &[
                "call",
                "gate-approve",
                "proposal=ok",
                "reason=a reason the preview must not see",
            ],
        )
        .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(terminal.kinds(), ["show", "ask"]);
    assert_eq!(terminal.shown(), "> Proposal ok\n> line two\n");
    let asked = &terminal.events()[1].1;
    assert!(asked.contains("Apply this proposal?"), "{asked}");

    // `reason` is the gated command's, not the preview's: it never reaches the preview.
    let previews = fx.seen.of("gate-preview");
    assert_eq!(previews.len(), 1);
    assert_eq!(previews[0]["input"], json!({ "proposal": "ok" }));
    let approved = fx.seen.of("gate-approve");
    assert_eq!(approved.len(), 1);
    assert_eq!(
        approved[0]["input"]["reason"],
        "a reason the preview must not see"
    );
    // The preview's own text is not the command's result.
    assert!(!run.stdout.contains("line two"), "{}", run.stdout);

    // A declared property the gated call has is passed.
    let terminal = Terminal::new(true, true);
    let run = fx
        .run(
            &terminal,
            &["call", "gate-approve", "space=main", "proposal=ok"],
        )
        .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(
        fx.seen.of("gate-preview")[1]["input"],
        json!({ "space": "main", "proposal": "ok" })
    );
}

#[tokio::test]
async fn the_preview_runs_under_a_fresh_trace_without_the_marks() {
    let fx = fixture();
    let terminal = Terminal::new(true, true);
    let run = fx
        .run(&terminal, &["call", "gate-approve", "proposal=ok"])
        .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let preview = fx.seen.of("gate-preview")[0].clone();
    let approve = fx.seen.of("gate-approve")[0].clone();
    assert!(is_trace(&preview["trace"]), "{preview}");
    assert!(is_trace(&approve["trace"]), "{approve}");
    assert_ne!(preview["trace"], approve["trace"]);
    assert_eq!(preview["confirmed"], Value::Null, "{preview}");
    assert_eq!(preview["present"], Value::Null, "{preview}");
    // The gated call carries the person's confirmation; the preview never did.
    assert_eq!(approve["confirmed"], "gate-approve");

    // The preview's journal entry is its own, under its own trace id, and digest.
    let journal = support::journal_entries(fx.dir.path());
    let entry = journal
        .iter()
        .find(|entry| entry.command == "gate-preview")
        .unwrap();
    assert_eq!(
        entry.trace_id.as_ref(),
        preview["trace"].as_str().map(str::to_owned).as_ref()
    );
    assert!(!serde_json::to_string(entry).unwrap().contains("line two"));
}

// ── Sanitised and capped ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_preview_is_sanitised() {
    let fx = fixture();
    let terminal = Terminal::new(true, true);
    let run = fx
        .run(&terminal, &["call", "gate-approve", "proposal=dirty"])
        .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let shown = terminal.shown();
    assert_eq!(shown, "> id p-1\n> opupdate\n> from evil x\n> diff\n");
    for bad in [
        '\u{1b}', '\r', '\u{7}', '\u{85}', '\u{2028}', '\u{2029}', '\u{202e}', '\u{202c}',
        '\u{2066}', '\u{2069}', '\u{200f}',
    ] {
        assert!(!shown.contains(bad), "{bad:?} in {shown:?}");
    }
}

#[tokio::test]
async fn a_long_preview_is_capped_with_the_count_of_lines_not_shown() {
    let fx = fixture();
    let terminal = Terminal::new(true, true);
    let run = fx
        .run(&terminal, &["call", "gate-approve", "proposal=long"])
        .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let shown = terminal.shown();
    let lines: Vec<&str> = shown.lines().collect();
    let previewed: Vec<&&str> = lines.iter().filter(|line| line.starts_with("> ")).collect();
    // 49 characters a line; whole lines while they fit in 6000 characters.
    assert_eq!(previewed.len(), 122);
    let characters: usize = previewed.iter().map(|line| line.chars().count() - 2).sum();
    assert!(characters <= 6000, "{characters}");
    assert_eq!(lines.last(), Some(&"(78 lines not shown)"));
    assert_eq!(terminal.kinds(), ["show", "ask"]);
}

// ── A failure refuses ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_failed_preview_refuses_the_call_and_nothing_runs() {
    let fx = fixture();
    for (proposal, cause) in [
        ("fail", "PREVIEW_BROKEN"),
        ("shape", "PREVIEW_SHAPE"),
        ("extra", "PREVIEW_SHAPE"),
    ] {
        let terminal = Terminal::new(true, true);
        let argument = format!("proposal={proposal}");
        let run = fx
            .run(&terminal, &["call", "gate-approve", &argument])
            .await;
        assert_eq!(run.code, 1, "{proposal}: {}", run.stdout);
        assert_eq!(
            run.error_code(),
            "CONFIRMATION_PREVIEW_FAILED",
            "{proposal}"
        );
        let details = run.json()["error"]["details"].clone();
        assert_eq!(details["preview"], "gate-preview", "{details}");
        assert_eq!(details["command"], "gate-approve", "{details}");
        assert_eq!(details["cause"], cause, "{details}");
        assert_eq!(run.json()["error"]["retryable"], false);
        // Nothing was shown or asked, and the gated command never ran.
        assert!(
            terminal.events().is_empty(),
            "{proposal}: {:?}",
            terminal.events()
        );
    }
    assert_eq!(fx.seen.of("gate-preview").len(), 3);
    assert!(fx.seen.of("gate-approve").is_empty());
}

#[tokio::test]
async fn a_declined_prompt_after_the_preview_runs_nothing() {
    let fx = fixture();
    let terminal = Terminal::new(true, false);
    let run = fx
        .run(&terminal, &["call", "gate-approve", "proposal=ok"])
        .await;
    assert_eq!(run.error_code(), "CONFIRMATION_DECLINED", "{}", run.stdout);
    assert_eq!(terminal.kinds(), ["show", "ask"]);
    assert!(fx.seen.of("gate-approve").is_empty());
}

#[tokio::test]
async fn without_a_terminal_nothing_is_shown_and_a_failed_preview_still_refuses() {
    let fx = fixture();
    let terminal = Terminal::new(false, true);
    let run = fx
        .run(&terminal, &["call", "gate-approve", "proposal=ok"])
        .await;
    assert_eq!(run.error_code(), "CONFIRMATION_REQUIRED", "{}", run.stdout);
    assert!(terminal.events().is_empty());
    assert_eq!(fx.seen.of("gate-preview").len(), 1);
    let run = fx
        .run(&terminal, &["call", "gate-approve", "proposal=fail"])
        .await;
    assert_eq!(
        run.error_code(),
        "CONFIRMATION_PREVIEW_FAILED",
        "{}",
        run.stdout
    );
    // `--yes` is refused for a require-human command before any preview runs.
    let run = fx
        .run(&terminal, &["call", "gate-approve", "proposal=ok", "--yes"])
        .await;
    assert_eq!(run.error_code(), "CONFIRMATION_REQUIRED", "{}", run.stdout);
    assert_eq!(fx.seen.of("gate-preview").len(), 2);
    assert!(fx.seen.of("gate-approve").is_empty());
}

// ── Other commands, and MCP ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_plain_confirmation_is_previewed_and_a_command_without_a_preview_is_not() {
    let fx = fixture();
    let terminal = Terminal::new(true, true);
    let run = fx
        .run(&terminal, &["call", "gate-confirm", "proposal=ok"])
        .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(terminal.kinds(), ["show", "ask"]);
    assert_eq!(fx.seen.of("gate-preview").len(), 1);

    let terminal = Terminal::new(true, true);
    let run = fx
        .run(&terminal, &["call", "gate-plain", "proposal=ok"])
        .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(terminal.kinds(), ["ask"]);
    assert_eq!(fx.seen.of("gate-preview").len(), 1);
}

#[tokio::test]
async fn nothing_changes_on_mcp() {
    let fx = fixture();
    let host = seal(fx.dir.path(), |b| b.with_compiled(plugin(&fx.seen))).unwrap();
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let answer = client
            .afd_call("gate-confirm", json!({ "proposal": "ok" }))
            .await;
        assert!(
            !answer.to_string().contains("Proposal ok"),
            "{label}: {answer}"
        );
    }
    assert!(fx.seen.of("gate-preview").is_empty());
}
