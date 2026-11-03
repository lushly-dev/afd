//! The `claude-code` profile (section 10.3) on the committed fixture and on transcripts built
//! here: each event's mapping, every included and excluded line kind, turns and `message.id`,
//! windows, parts and keys, a torn line, the state, the project, paths and the printed settings.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::{FIXTURE, Fx, SESSION, assistant_line, sent_text, turns, user_line};

fn key(window: &str) -> String {
    format!("claude-code:{SESSION}:{window}")
}

#[test]
fn stop_then_session_end_capture_the_fixture_in_windows() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    let stop = fx.run(&["claude-code", "Stop"], &fx.stdin("Stop", &transcript));
    assert_eq!(stop.code, 0);
    assert_eq!(stop.stdout, "", "a capture event prints nothing");
    // One unparsable line and one unknown origin, counted on stderr.
    assert!(
        stop.stderr
            .contains("1 transcript line(s) did not parse and 1 were left out"),
        "{}",
        stop.stderr
    );
    let captures = fx.captures();
    assert_eq!(captures.len(), 3, "65 turns close windows 0, 1 and 2");
    for (n, capture) in captures.iter().enumerate() {
        assert_eq!(capture["version"], 1);
        assert_eq!(
            capture["harness"],
            json!({ "name": "claude-code", "version": "2.1.316" })
        );
        assert_eq!(capture["event"], "stop");
        assert_eq!(capture["session"], SESSION);
        assert_eq!(capture["project"], "example");
        assert_eq!(capture["window"], n);
        assert_eq!(capture["idempotencyKey"], key(&format!("w{n}:p0")));
        assert_eq!(capture["captureKey"], key(&format!("w{n}")));
        assert!(capture.get("share").is_none() && capture.get("space").is_none());
        let episodes = capture["episodes"].as_array().unwrap();
        assert_eq!(episodes.len(), 1);
        assert_eq!(
            episodes[0]["subject"],
            format!("Session {SESSION} window {n}")
        );
        assert_eq!(episodes[0]["part"], 0);
        assert_eq!(episodes[0]["turns"], json!([20 * n, 20 * n + 19]));
        assert!(
            episodes[0]["startedAt"]
                .as_str()
                .unwrap()
                .starts_with("2026-11-02T09:")
        );
        let text = episodes[0]["text"].as_str().unwrap();
        assert!(
            text.starts_with(if n == 2 { "[assistant]\n" } else { "[user]\n" }),
            "{text}"
        );
        assert!(
            text.contains("\n[assistant]\n") && text.contains("\n[user]\n"),
            "{text}"
        );
    }

    let end = fx.run(
        &["claude-code", "SessionEnd"],
        &fx.stdin("SessionEnd", &transcript),
    );
    assert_eq!(end.code, 0);
    let captures = fx.captures();
    assert_eq!(captures.len(), 4, "the open tail of five turns");
    let tail = &captures[3];
    assert_eq!(tail["event"], "session-end");
    assert_eq!(tail["window"], 3);
    assert_eq!(tail["idempotencyKey"], key("w3:t5:p0"));
    assert_eq!(tail["captureKey"], key("w3"));
    assert_eq!(tail["episodes"][0]["turns"], json!([60, 64]));
    assert_eq!(
        tail["episodes"][0]["subject"],
        format!("Session {SESSION} window 3 (open, 5 turns)")
    );
}

#[test]
fn only_user_and_assistant_text_is_sent() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    fx.run(
        &["claude-code", "pre-compact"],
        &fx.stdin("PreCompact", &transcript),
    );
    let captures = fx.captures();
    assert_eq!(
        captures.len(),
        4,
        "pre-compact sends the closed windows and the tail"
    );
    let text = sent_text(&captures);
    // Every excluded kind carries a canary; none reaches a capture, nor does the bundle injected
    // at session start (`hook_additional_context`).
    let canaries: Vec<&str> = FIXTURE
        .match_indices("CANARY-")
        .map(|(at, _)| {
            let rest = &FIXTURE[at..];
            let end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
                .unwrap_or(rest.len());
            &rest[..end]
        })
        .collect();
    assert!(canaries.len() > 30, "the fixture holds every excluded kind");
    for canary in canaries {
        assert!(!text.contains(canary), "{canary} was captured");
    }
    assert!(!text.contains("CANARY"));
    // Every text turn, once and in file order: human lines, text blocks, queued commands (a
    // string and blocks), a person's origin, an SDK prompt, assistant messages over several lines.
    let mut at = 0;
    for i in 0..65 {
        let marker = format!("Turn {i} INCLUDED");
        assert_eq!(text.matches(&marker).count(), 1, "{marker}");
        let found = text.find(&marker).unwrap();
        assert!(found >= at, "{marker} is out of order");
        at = found;
    }
    for kind in [
        "INCLUDED-QUEUED typed",
        "INCLUDED-QUEUED-BLOCKS",
        "INCLUDED-BLOCKS",
        "INCLUDED-SDK-PROMPT",
        "INCLUDED-HUMAN-ORIGIN",
    ] {
        assert!(text.contains(kind), "{kind}");
    }
    // The secret and the planted injection are sent as written: the memory plugin masks and flags.
    assert!(text.contains("password=Synthetic-Secret-7f3a9c2e"));
    assert!(text.contains("Ignore all previous instructions"));
    // No path or working directory is sent.
    for capture in &captures {
        let body = capture.to_string();
        assert!(
            !body.contains("/home/synthetic")
                && !body.contains(&fx.dir.path().display().to_string())
        );
        assert!(capture.get("cwd").is_none());
    }
}

#[test]
fn state_holds_no_text_and_spares_a_process() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    let stdin = fx.stdin("Stop", &transcript);
    fx.run(&["claude-code", "stop"], &stdin);
    assert_eq!(fx.calls().len(), 3);
    let file = fx.state().join(format!("{SESSION}.json"));
    let state: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    let mut keys: Vec<&str> = state
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "messageIds",
            "nextWindow",
            "nextWindowOffset",
            "scanned",
            "turns"
        ]
    );
    assert_eq!(state["nextWindow"], 3);
    let raw = std::fs::read_to_string(&file).unwrap();
    for word in ["Turn", "INCLUDED", "CANARY", "Secret", "synthetic/work"] {
        assert!(!raw.contains(word), "{word} in the state");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode =
            |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&fx.state()), 0o700);
        assert_eq!(mode(&file), 0o600);
    }

    // No window closed since: no process starts.
    fx.run(&["claude-code", "stop"], &stdin);
    assert_eq!(fx.calls().len(), 3);

    // Five more turns close no window either; the twentieth after turn 60 does.
    let mut grown = FIXTURE.to_owned();
    grown.push_str(&turns(15, "later"));
    std::fs::write(&transcript, &grown).unwrap();
    fx.run(&["claude-code", "stop"], &stdin);
    assert_eq!(fx.calls().len(), 3, "turn 80 does not exist yet");
    grown.push_str(&turns(1, "closing"));
    std::fs::write(&transcript, &grown).unwrap();
    fx.run(&["claude-code", "stop"], &stdin);
    let captures = fx.captures();
    assert_eq!(captures.len(), 4);
    assert_eq!(captures[3]["idempotencyKey"], key("w3:p0"));
    assert_eq!(captures[3]["episodes"][0]["turns"], json!([60, 79]));

    // Losing the state costs only replays: the same keys again.
    std::fs::remove_file(&file).unwrap();
    fx.run(&["claude-code", "stop"], &stdin);
    let again: Vec<Value> = fx.captures()[4..]
        .iter()
        .map(|c| c["idempotencyKey"].clone())
        .collect();
    assert_eq!(
        again,
        [key("w0:p0"), key("w1:p0"), key("w2:p0"), key("w3:p0")].map(Value::from)
    );
    // A transcript shorter than what was read is read again from the start.
    std::fs::write(&transcript, turns(25, "short")).unwrap();
    fx.run(&["claude-code", "stop"], &stdin);
    let last = fx.captures().last().cloned().unwrap();
    assert_eq!(last["idempotencyKey"], key("w0:p0"));
    assert!(sent_text(&[last]).contains("short turn 0"));
}

#[test]
fn a_failed_send_does_not_advance_the_state() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    let stdin = fx.stdin("Stop", &transcript);
    fx.set_mode("busy");
    let failed = fx.run(&["claude-code", "stop"], &stdin);
    assert_eq!(failed.code, 0);
    assert_eq!(
        fx.calls().len(),
        1,
        "the first window failed, so nothing more was sent"
    );
    fx.set_mode("ok");
    fx.run(&["claude-code", "stop"], &stdin);
    let keys: Vec<Value> = fx
        .captures()
        .iter()
        .map(|c| c["idempotencyKey"].clone())
        .collect();
    assert_eq!(
        keys,
        [key("w0:p0"), key("w0:p0"), key("w1:p0"), key("w2:p0")].map(Value::from)
    );
}

#[test]
fn session_start_maps_each_source() {
    let fx = Fx::new();
    let transcript = fx.transcript("session.jsonl", FIXTURE);
    std::fs::write(
        fx.workspace().join("bundle-text"),
        "Context for this session.\nLeft out: 2 by authority.",
    )
    .unwrap();
    for source in ["startup", "clear", "compact"] {
        let mut stdin = fx.stdin("SessionStart", &transcript);
        stdin["source"] = json!(source);
        let ran = fx.run(&["claude-code", "SessionStart"], &stdin);
        assert_eq!(ran.code, 0);
        let output: Value = serde_json::from_str(ran.stdout.trim()).unwrap();
        assert_eq!(
            output,
            json!({ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "Context for this session.\nLeft out: 2 by authority." } })
        );
    }
    let calls = fx.calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(support::command_of(&calls[0]), "context-bundle");
    assert_eq!(
        calls[0]["input"],
        json!({ "render": "text", "maxChars": 9000, "session": SESSION, "project": "example" })
    );
    // A resumed or forked session, or a source the hook does not know: nothing.
    for source in [
        json!("resume"),
        json!("fork"),
        json!("future-source"),
        Value::Null,
    ] {
        let mut stdin = fx.stdin("SessionStart", &transcript);
        stdin["source"] = source;
        let ran = fx.run(&["claude-code", "session-start"], &stdin);
        assert_eq!((ran.code, ran.stdout.as_str()), (0, ""));
    }
    assert_eq!(fx.calls().len(), 3);
    // UMBEL_TASK is the task; a null text prints nothing.
    std::fs::remove_file(fx.workspace().join("bundle-text")).unwrap();
    let mut environment = fx.environment();
    environment.task = Some("  Fix the deploy script  ".into());
    let mut stdin = fx.stdin("SessionStart", &transcript);
    stdin["source"] = json!("startup");
    let ran = fx.run_with(
        &environment,
        &["claude-code", "session-start"],
        stdin.to_string().as_bytes(),
    );
    assert_eq!((ran.code, ran.stdout.as_str()), (0, ""));
    assert_eq!(fx.calls()[3]["input"]["task"], "Fix the deploy script");
}

#[test]
fn messages_group_by_id_and_repeats_are_dropped() {
    let fx = Fx::new();
    let thinking = json!({ "type": "assistant", "message": { "id": "msg_a", "content": [{ "type": "thinking", "thinking": "hidden" }] } }).to_string();
    let lines = [
        user_line("question one"),
        thinking,
        assistant_line("msg_a", "first block"),
        json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "out" }] }, "toolUseResult": {} }).to_string(),
        assistant_line("msg_a", "second block"),
        assistant_line("msg_a", "second block"),
        assistant_line("msg_b", "another message"),
        assistant_line("msg_a", "a repeat after another message"),
        user_line("question two"),
        assistant_line("msg_b", "a repeat after a turn"),
        assistant_line("msg_c", "the last answer"),
        json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "no id, its own message" }] }, "uuid": "u-1" }).to_string(),
    ];
    let transcript = fx.transcript("ids.jsonl", &(lines.join("\n") + "\n"));
    fx.run(
        &["claude-code", "pre-compact"],
        &fx.stdin("PreCompact", &transcript),
    );
    let captures = fx.captures();
    assert_eq!(captures.len(), 1);
    assert_eq!(captures[0]["idempotencyKey"], key("w0:t6:p0"));
    assert_eq!(
        captures[0]["episodes"][0]["text"],
        "[user]\nquestion one\n[assistant]\nfirst block\n\nsecond block\n[assistant]\nanother message\n[user]\nquestion two\n[assistant]\nthe last answer\n[assistant]\nno id, its own message\n"
    );
}

#[test]
fn long_windows_split_into_parts_and_calls() {
    let fx = Fx::new();
    // Turn 1 is 100 KiB, with a key block across the 64 KiB mark.
    let mut long = String::new();
    while long.len() < 60 * 1024 {
        long.push_str("a line of ordinary words in a long answer\n");
    }
    long.push_str("-----BEGIN PRIVATE KEY-----\n");
    for _ in 0..100 {
        long.push_str("MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ\n");
    }
    long.push_str("-----END PRIVATE KEY-----\n");
    while long.len() < 100 * 1024 {
        long.push_str("more words after the block\n");
    }
    let mut text = user_line("start") + "\n" + &assistant_line("msg_long", &long) + "\n";
    text.push_str(&turns(19, "rest"));
    let transcript = fx.transcript("long.jsonl", &text);
    fx.run(&["claude-code", "stop"], &fx.stdin("Stop", &transcript));
    let captures = fx.captures();
    assert_eq!(captures.len(), 1);
    let episodes = captures[0]["episodes"].as_array().unwrap();
    assert!(episodes.len() >= 2, "{}", episodes.len());
    for (k, episode) in episodes.iter().enumerate() {
        assert_eq!(episode["part"], k);
        assert!(episode["text"].as_str().unwrap().len() <= 64 * 1024);
    }
    let holding: Vec<usize> = episodes
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            e["text"]
                .as_str()
                .unwrap()
                .contains("-----BEGIN PRIVATE KEY-----")
        })
        .map(|(k, _)| k)
        .collect();
    assert_eq!(holding.len(), 1);
    assert!(
        episodes[holding[0]]["text"]
            .as_str()
            .unwrap()
            .contains("-----END PRIVATE KEY-----")
    );
    // The turn before the long one is a part of its own; the long turn starts the next.
    assert_eq!(episodes[0]["turns"], json!([0, 0]));
    assert_eq!(episodes[1]["turns"], json!([1, 1]));
    assert_eq!(episodes.last().unwrap()["turns"], json!([1, 19]));

    // A window of twenty 60 KiB turns is two calls, each keyed by its first part.
    let fx = Fx::new();
    let big = "x".repeat(60 * 1024);
    let mut text = String::new();
    for i in 0..21 {
        text.push_str(&user_line(&format!("{i} {big}")));
        text.push('\n');
    }
    let transcript = fx.transcript("big.jsonl", &text);
    fx.run(&["claude-code", "stop"], &fx.stdin("Stop", &transcript));
    let captures = fx.captures();
    assert_eq!(captures.len(), 2);
    let first = captures[0]["episodes"].as_array().unwrap().len();
    assert_eq!(captures[0]["idempotencyKey"], key("w0:p0"));
    assert_eq!(captures[1]["idempotencyKey"], key(&format!("w0:p{first}")));
    assert_eq!(captures[1]["episodes"][0]["part"], first);
    for capture in &captures {
        assert!(capture.to_string().len() < 1024 * 1024);
        assert_eq!(capture["captureKey"], key("w0"));
    }
}

#[test]
fn a_torn_last_line_waits_for_the_next_read() {
    let fx = Fx::new();
    let complete = turns(40, "whole");
    let torn = user_line("whole turn 40");
    let (head, rest) = torn.split_at(torn.len() / 2);
    let transcript = fx.transcript("torn.jsonl", &(complete.clone() + head));
    let stdin = fx.stdin("Stop", &transcript);
    let ran = fx.run(&["claude-code", "stop"], &stdin);
    assert_eq!(ran.stderr, "", "a torn last line is not counted");
    assert_eq!(fx.captures().len(), 1, "turn 40 is not there yet");
    std::fs::write(&transcript, complete + head + rest + "\n").unwrap();
    fx.run(&["claude-code", "stop"], &stdin);
    let captures = fx.captures();
    assert_eq!(captures.len(), 2);
    assert_eq!(captures[1]["idempotencyKey"], key("w1:p0"));
}

#[test]
fn the_project_is_the_repository_name_and_every_worktree_shares_it() {
    let fx = Fx::new();
    let root = fx.dir.path();
    // A main checkout and a worktree of it elsewhere, as git lays them out.
    let main = root.join("checkouts/widgets");
    std::fs::create_dir_all(main.join(".git/worktrees/feature")).unwrap();
    std::fs::write(main.join(".git/worktrees/feature/commondir"), "../..\n").unwrap();
    let worktree = root.join("elsewhere/feature-tree");
    std::fs::create_dir_all(worktree.join("deep/dir")).unwrap();
    std::fs::write(
        worktree.join(".git"),
        format!(
            "gitdir: {}\n",
            main.join(".git/worktrees/feature").display()
        ),
    )
    .unwrap();
    // A plain directory with no repository above it inside the temporary directory: walking up
    // stops at the first `.git`, so make one with an unusual name instead.
    let odd = root.join("my repo!");
    std::fs::create_dir_all(odd.join(".git")).unwrap();
    let transcript = fx.transcript("session.jsonl", &turns(3, "p"));
    for (cwd, project) in [
        (main.clone(), json!("widgets")),
        (worktree.join("deep/dir"), json!("widgets")),
        (odd.clone(), json!("my-repo-")),
    ] {
        let mut stdin = fx.stdin("PreCompact", &transcript);
        stdin["cwd"] = json!(cwd.display().to_string());
        fx.run(&["claude-code", "pre-compact"], &stdin);
        assert_eq!(
            fx.captures().last().unwrap()["project"],
            project,
            "{}",
            cwd.display()
        );
    }
    // No working directory: no project.
    let mut stdin = fx.stdin("PreCompact", &transcript);
    stdin.as_object_mut().unwrap().remove("cwd");
    fx.run(&["claude-code", "pre-compact"], &stdin);
    assert_eq!(fx.captures().last().unwrap()["project"], Value::Null);
}

#[test]
fn a_relative_transcript_path_is_taken_from_cwd() {
    let fx = Fx::new();
    std::fs::write(fx.cwd().join("relative.jsonl"), turns(3, "rel")).unwrap();
    let mut stdin = fx.stdin("PreCompact", &fx.cwd().join("unused"));
    stdin["transcript_path"] = json!("relative.jsonl");
    let ran = fx.run(&["claude-code", "pre-compact"], &stdin);
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""));
    let captures = fx.captures();
    assert_eq!(captures.len(), 1);
    assert!(!captures[0].to_string().contains("relative.jsonl"));
    // With a relative cwd too, the hook refuses rather than guess.
    stdin["cwd"] = json!("src");
    let ran = fx.run(&["claude-code", "pre-compact"], &stdin);
    assert!(
        ran.stderr.starts_with("umbel-hook: invalid-stdin:"),
        "{}",
        ran.stderr
    );
    assert_eq!(fx.captures().len(), 1);
}

#[test]
fn print_settings_prints_the_fragment_and_writes_nothing() {
    let fx = Fx::new();
    let ran = fx.run(&["print-settings", "claude-code"], &json!({}));
    assert_eq!(ran.code, 0);
    let settings: Value = serde_json::from_str(&ran.stdout).unwrap();
    let hook = |event: &str| settings["hooks"][event][0]["hooks"][0].clone();
    assert_eq!(
        hook("SessionStart")["command"],
        "umbel-hook claude-code session-start"
    );
    assert_eq!(hook("SessionStart")["timeout"], 10);
    assert_eq!(
        settings["hooks"]["SessionStart"][0]["matcher"],
        "startup|clear|compact"
    );
    assert_eq!(hook("Stop")["async"], true);
    assert!(hook("Stop").get("timeout").is_none());
    assert_eq!(hook("PreCompact")["timeout"], 30);
    assert_eq!(hook("SessionEnd")["timeout"], 30);
    assert_eq!(
        hook("SessionEnd")["command"],
        "umbel-hook claude-code session-end"
    );
    // Nothing written: no state directory, no call.
    assert!(!fx.state().exists());
    assert!(fx.calls().is_empty());
    let generic = fx.run(&["print-settings", "generic"], &json!({}));
    assert_eq!((generic.code, generic.stdout.as_str()), (2, ""));
}
