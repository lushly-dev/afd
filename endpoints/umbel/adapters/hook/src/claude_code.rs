//! The `claude-code` profile (section 10.3).
//!
//! | Event | What it does |
//! | --- | --- |
//! | `SessionStart`, source `startup`, `clear` or `compact` | `context-bundle`, printed as `additionalContext` |
//! | `SessionStart`, any other source | Nothing: the context is already in that transcript |
//! | `Stop` | Captures closed windows not yet sent; starts no process when none closed |
//! | `PreCompact` | Captures every closed window not sent, and the open tail |
//! | `SessionEnd` | The same, then `memory-sweep` with `--sweep` |
//!
//! It reads `transcript_path` itself, because it runs as the person in their harness. No plugin
//! ever reads a path a caller named, and no path, `cwd`, email or account field is ever sent.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::Environment;
use crate::child;
use crate::failure::{Failure, Outcome};
use crate::project;
use crate::state::{self, State};
use crate::transcript::{self, Scan, Turn};
use crate::window::{self, Call, WINDOW_TURNS};

/// The harness name in the contract and its keys.
const HARNESS: &str = "claude-code";
/// The largest transcript read: 64 MiB.
const MAX_TRANSCRIPT_BYTES: u64 = 64 * 1024 * 1024;
/// A session-start bundle's limit, under the hook's 10-second timeout.
const BUNDLE_TIMEOUT: Duration = Duration::from_secs(9);
/// A capture call's limit, under the hook's 30-second timeout.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(25);
/// The bundle's `maxChars`, under Claude Code's 10 000-character limit on `additionalContext`.
const BUNDLE_CHARS: u64 = 9000;
/// The most characters of `UMBEL_TASK` sent as the bundle's task.
const TASK_CHARS: usize = 4000;

/// The fields of Claude Code's hook input that the hook reads. Every other field is ignored.
#[derive(Deserialize)]
struct Input {
    session_id: Option<String>,
    transcript_path: Option<String>,
    cwd: Option<String>,
    source: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Event {
    SessionStart,
    Stop,
    PreCompact,
    SessionEnd,
}

impl Event {
    fn parse(word: &str) -> Option<Self> {
        match word {
            "session-start" | "SessionStart" => Some(Self::SessionStart),
            "stop" | "Stop" => Some(Self::Stop),
            "pre-compact" | "PreCompact" => Some(Self::PreCompact),
            "session-end" | "SessionEnd" => Some(Self::SessionEnd),
            _ => None,
        }
    }

    /// The contract's `event`.
    fn contract(self) -> &'static str {
        match self {
            Self::SessionStart => "manual",
            Self::Stop => "stop",
            Self::PreCompact => "pre-compact",
            Self::SessionEnd => "session-end",
        }
    }
}

fn invalid(message: &str) -> Failure {
    Failure::new("invalid-stdin", message)
}

pub(crate) fn run(
    event: &str,
    sweep: bool,
    input: &[u8],
    environment: &Environment,
    stdout: &mut dyn Write,
) -> Outcome {
    let event = Event::parse(event).ok_or_else(|| {
        Failure::new(
            "invalid-arguments",
            "the claude-code events are session-start, stop, pre-compact and session-end",
        )
    })?;
    if sweep && event != Event::SessionEnd {
        return Err(Failure::new(
            "invalid-arguments",
            "--sweep is for session-end only",
        ));
    }
    let input: Input = serde_json::from_slice(input)
        .map_err(|_| invalid("stdin is not Claude Code's hook input"))?;
    let session = input
        .session_id
        .as_deref()
        .filter(|id| project::is_label(id))
        .ok_or_else(|| invalid("session_id is missing or does not match the session pattern"))?;
    let cwd = input.cwd.as_deref().map(PathBuf::from);
    // Only an absolute working directory names a repository.
    let project = cwd
        .as_deref()
        .filter(|cwd| cwd.is_absolute())
        .and_then(project::of);
    match event {
        Event::SessionStart => {
            session_start(&input, session, project.as_deref(), environment, stdout)
        }
        _ => capture(
            event,
            sweep,
            &input,
            session,
            project.as_deref(),
            cwd.as_deref(),
            environment,
        ),
    }
}

fn session_start(
    input: &Input,
    session: &str,
    project: Option<&str>,
    environment: &Environment,
    stdout: &mut dyn Write,
) -> Outcome {
    // A resumed or forked session already holds the context it was given.
    if !matches!(
        input.source.as_deref(),
        Some("startup" | "clear" | "compact")
    ) {
        return Ok(None);
    }
    let mut bundle = json!({ "render": "text", "maxChars": BUNDLE_CHARS, "session": session });
    if let Some(project) = project {
        bundle["project"] = json!(project);
    }
    if let Some(task) = environment
        .task
        .as_deref()
        .map(str::trim)
        .filter(|task| !task.is_empty())
    {
        bundle["task"] = json!(task.chars().take(TASK_CHARS).collect::<String>());
    }
    let data = child::call(environment, "context-bundle", &bundle, BUNDLE_TIMEOUT)?;
    if let Some(text) = data.get("text").and_then(Value::as_str) {
        let output = json!({
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": text,
            }
        });
        let _ = writeln!(stdout, "{output}");
    }
    Ok(None)
}

/// The transcript, checked: a regular file of at most 64 MiB. A relative path is taken from `cwd`.
fn transcript_file(input: &Input, cwd: Option<&Path>) -> Result<(std::fs::File, u64), Failure> {
    let unreadable = |message: &str| Failure::new("transcript-unreadable", message);
    let path = PathBuf::from(
        input
            .transcript_path
            .as_deref()
            .filter(|path| !path.is_empty())
            .ok_or_else(|| invalid("transcript_path is missing"))?,
    );
    let path = if path.is_absolute() {
        path
    } else {
        cwd.filter(|cwd| cwd.is_absolute())
            .ok_or_else(|| invalid("transcript_path is relative and cwd is not absolute"))?
            .join(path)
    };
    let meta = std::fs::metadata(&path).map_err(|_| unreadable("the transcript cannot be read"))?;
    if !meta.is_file() {
        return Err(unreadable("the transcript is not a regular file"));
    }
    if meta.len() > MAX_TRANSCRIPT_BYTES {
        return Err(unreadable("the transcript is over 64 MiB"));
    }
    let file =
        std::fs::File::open(&path).map_err(|_| unreadable("the transcript cannot be read"))?;
    Ok((file, meta.len()))
}

/// The transcript's bytes from `from` to `len`.
fn read_from(file: &mut std::fs::File, from: u64, len: u64) -> Result<Vec<u8>, Failure> {
    let mut bytes = Vec::new();
    file.seek(SeekFrom::Start(from))
        .and_then(|_| file.take(len.saturating_sub(from)).read_to_end(&mut bytes))
        .map_err(|_| Failure::new("transcript-unreadable", "the transcript cannot be read"))?;
    Ok(bytes)
}

/// Counts for stderr, when a line was left out for not parsing or an unknown value.
fn notes(scan: &Scan) -> Option<String> {
    (scan.unparsed > 0 || scan.unknown > 0).then(|| {
        format!(
            "{} transcript line(s) did not parse and {} were left out for a value the reader does not know",
            scan.unparsed, scan.unknown
        )
    })
}

fn capture(
    event: Event,
    sweep: bool,
    input: &Input,
    session: &str,
    project: Option<&str>,
    cwd: Option<&Path>,
    environment: &Environment,
) -> Outcome {
    let (mut file, len) = transcript_file(input, cwd)?;
    let dir = state::ensure_dir(environment.state_dir.as_deref())?;
    let mut state = state::load(&dir, session);
    // A transcript shorter than what was read is not the one the state describes: read it again.
    if len < state.scanned || state.next_window_offset > state.scanned {
        state = State::default();
    }
    // The cheap scan: only the bytes after `scanned`, counting turns and keeping no text.
    let tail = read_from(&mut file, state.scanned, len)?;
    let counted = transcript::scan(
        &tail,
        state.scanned,
        state.turns,
        &mut state.message_ids,
        false,
    );
    state.scanned = counted.resume_offset;
    state.turns = counted.resume_turns;
    let total = counted.total;
    let first_open = WINDOW_TURNS * state.next_window;
    let closed = total > first_open + WINDOW_TURNS;
    let with_tail = matches!(event, Event::PreCompact | Event::SessionEnd) && total > first_open;
    if !closed && !with_tail {
        // No window closed: no process starts.
        state::save(&dir, session, &state)?;
        return Ok(notes(&counted));
    }
    // Read the unsent turns' text again, from the first unsent window's first turn.
    let bytes = read_from(&mut file, state.next_window_offset, len)?;
    let mut ids = state.message_ids.clone();
    let read = transcript::scan(&bytes, state.next_window_offset, first_open, &mut ids, true);
    let version = read.version.as_deref().or(counted.version.as_deref());
    let mut turns: &[Turn] = &read.turns;
    let call = |window: u64, tail: Option<u64>| Call {
        harness: HARNESS,
        version,
        event: event.contract(),
        session,
        project,
        window,
        tail,
    };
    // Every closed window, in order; each send advances the state once it succeeds.
    while turns.len() as u64 > WINDOW_TURNS {
        let (window_turns, rest) = turns.split_at(WINDOW_TURNS as usize);
        let window = state.next_window;
        send(&call(window, None), window_turns, environment)?;
        state.next_window = window + 1;
        state.next_window_offset = rest.first().map_or(state.next_window_offset, |t| t.offset);
        state::save(&dir, session, &state)?;
        turns = rest;
    }
    state::save(&dir, session, &state)?;
    if with_tail && !turns.is_empty() {
        let window = state.next_window;
        send(&call(window, Some(turns.len() as u64)), turns, environment)?;
    }
    if sweep {
        child::call(environment, "memory-sweep", &json!({}), CAPTURE_TIMEOUT)?;
    }
    Ok(notes(&read).or_else(|| notes(&counted)))
}

/// Send one window's parts, one call per group of them.
fn send(call: &Call<'_>, turns: &[Turn], environment: &Environment) -> Result<(), Failure> {
    for input in call.inputs(&window::parts(turns)) {
        child::call(environment, "memory-capture", &input, CAPTURE_TIMEOUT)?;
    }
    Ok(())
}
