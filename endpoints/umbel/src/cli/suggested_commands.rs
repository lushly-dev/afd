//! Every `umbel …` command line that Umbel's own text tells a reader to run parses as written.
//!
//! An error's suggestion, a warning, a doctor check, a guide or a shipped skill that spells a
//! command as `umbel store-check` sends the reader to a refusal: the command line takes a single
//! word as a domain with no action ([`super::parse::project`]). This test reads Umbel's shipped
//! sources (each crate's `src/`, the plugins' skills and READMEs, the templates and the published
//! schemas; never `docs/`, which keeps history, or `tests/`), finds each `umbel <words>` a reader
//! could run, and puts it through the same parser the binary uses. The command it names must be a
//! built-in of a freshly initialised workspace's host or a command a first-party plugin's manifest
//! declares, exposed on the command line (`expose.cli`), and each `key=value` or JSON key it
//! passes must be a property of that command's input schema. Whether the line passes every
//! input the schema requires is not checked: `umbel store documents-hold` passes without the
//! `collection` it requires.
//!
//! The scan reads `#[cfg(test)]` code under `src/` too, so a unit test that quotes an old spelling
//! on purpose belongs under `tests/`, which is skipped.
//!
//! Which words are a command: after `umbel ` and any global flags (`--workspace <dir>`, `--log
//! <filter>`, `--format json|text`) comes `call` and a command name, a hyphenated word, or a word
//! that is part of a registered command's name (`umbel doctor`, for `workspace-doctor`), whether
//! or not the command line runs that command. Other words (`umbel reads configuration`) are
//! prose, and the verbs that name no command (`init`, `serve`, `help`, `docs`, `schema`,
//! `batch`) are not checked. In a backtick span (`` `umbel plugin show plugin=<id>` ``) every
//! word up to the closing backtick is the command line, and after `umbel call <command>` every
//! following word is its input. Elsewhere the input is the run of words after the command that
//! look like input: `key=value`, a JSON object, `@-`, a `--flag` or a `<placeholder>`; the first
//! other word ends it, so a bare positional word that reads as prose outside backticks
//! (`umbel plugin show notes`) is not caught; its `<placeholder>` form is.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use afd::{CommandContext, CommandRegistry, CommandResult};
use clap::Parser;
use serde_json::Value;

use super::args;
use super::parse::{self, Cli, Verb};
use super::stdin;

/// Phrases that start like a command but are output, not something to run.
const NOT_COMMANDS: &[&str] = &[
    // The line `umbel serve` prints when the person page listens in mode gateway.
    "umbel person page listening on",
];

/// The global flags `Cli` takes before the verb, each with a value.
const GLOBAL_FLAGS: &[&str] = &["--workspace", "--log", "--format"];

/// Directories never read: build output, history, and tests (which quote old spellings on
/// purpose, to say what changed).
const SKIPPED_DIRS: &[&str] = &["target", "docs", "tests", "node_modules", ".git"];

/// Each command the host or a first-party plugin registers on the command line, with its input
/// properties when the schema names them.
type Known = BTreeMap<String, Option<BTreeSet<String>>>;

/// What the host and the first-party plugins register.
#[derive(Debug, Default)]
struct Registered {
    /// Every command and pipeline name, run on the command line or not.
    names: BTreeSet<String>,
    /// Those the command line runs: the verdict on a command line reads only these.
    known: Known,
}

impl Registered {
    /// The words of every registered name. A word after `umbel ` that is one of these starts a
    /// command line, so a misspelt command hidden from the command line is refused, not read as
    /// prose.
    fn segments(&self) -> BTreeSet<&str> {
        self.names.iter().flat_map(|name| name.split('-')).collect()
    }
}

fn properties(schema: &Value) -> Option<BTreeSet<String>> {
    schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| properties.keys().cloned().collect())
}

/// The built-in commands of a host over a new workspace.
fn builtins(registered: &mut Registered) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = crate::workspace::Workspace::init(dir.path(), None).unwrap();
    let host = crate::host::HostBuilder::from_workspace(workspace)
        .seal()
        .unwrap();
    registry_commands(&host.registry(), registered);
}

/// The commands `registry` holds, and of those the ones the command line runs (`expose.cli`,
/// false unless the definition sets it), with their input schemas.
fn registry_commands(registry: &CommandRegistry, registered: &mut Registered) {
    for definition in registry.list() {
        registered.names.insert(definition.name.clone());
        if !definition.expose.cli {
            continue;
        }
        let schema = registry
            .get_tool(&definition.name)
            .and_then(|tool| tool.get("inputSchema").cloned())
            .unwrap_or(Value::Null);
        registered
            .known
            .insert(definition.name.clone(), properties(&schema));
    }
}

/// The commands and pipelines (each runs as a command) that each first-party plugin's
/// `umbel-plugin.toml` declares.
fn plugin_commands(root: &Path, registered: &mut Registered) {
    for entry in std::fs::read_dir(root.join("plugins")).unwrap() {
        let dir = entry.unwrap().path();
        let Ok(text) = std::fs::read_to_string(dir.join("umbel-plugin.toml")) else {
            continue;
        };
        manifest_commands(&toml::from_str(&text).unwrap(), &dir, registered);
    }
}

/// The commands and pipelines one manifest declares, and of those the ones on the command line
/// (`expose.cli`, true unless the entry sets it false), with their input schemas: a file in
/// `dir`, beside the manifest, or a table written inline.
fn manifest_commands(manifest: &toml::Table, dir: &Path, registered: &mut Registered) {
    let declared = ["commands", "pipelines"]
        .iter()
        .filter_map(|table| manifest.get(*table).and_then(toml::Value::as_array))
        .flatten();
    for command in declared {
        let name = command["name"].as_str().unwrap().to_owned();
        registered.names.insert(name.clone());
        let cli = command
            .get("expose")
            .and_then(|expose| expose.get("cli"))
            .and_then(toml::Value::as_bool)
            .unwrap_or(true);
        if !cli {
            continue;
        }
        let schema = match command.get("input_schema") {
            Some(toml::Value::String(path)) => {
                let text = std::fs::read_to_string(dir.join(path)).unwrap();
                serde_json::from_str::<Value>(&text).unwrap()
            }
            Some(inline) => serde_json::to_value(inline).unwrap(),
            None => Value::Null,
        };
        registered.known.insert(name, properties(&schema));
    }
}

fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if path.is_dir() {
            if !SKIPPED_DIRS.contains(&name.as_str()) {
                sources(&path, out);
            }
        } else if name != "suggested_commands.rs"
            && name != "CHANGELOG.md"
            && ["rs", "md", "tmpl", "toml", "json"]
                .iter()
                .any(|extension| name.ends_with(&format!(".{extension}")))
        {
            out.push(path);
        }
    }
}

/// Split a command's text the way a shell would for these lines: on spaces, with a `'…'` word
/// kept whole (and its quotes removed).
fn shell_words(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        let mut word = String::new();
        let mut quoted = false;
        while let Some(&c) = chars.peek() {
            if c == '\'' {
                quoted = true;
                chars.next();
                for c in chars.by_ref() {
                    if c == '\'' {
                        break;
                    }
                    word.push(c);
                }
                continue;
            }
            if c.is_whitespace() {
                break;
            }
            word.push(c);
            chars.next();
        }
        if !quoted {
            while word.ends_with(['.', ',', ';', ':', ')']) {
                word.pop();
            }
        }
        words.push(word);
    }
    words
}

fn is_name(word: &str) -> bool {
    word.starts_with(|c: char| c.is_ascii_lowercase())
        && word
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn looks_like_input(word: &str) -> bool {
    let key = word.split_once('=').map(|(key, _)| key);
    word.starts_with("--")
        || word.starts_with('{')
        || word == "@-"
        || (word.starts_with('<') && word.ends_with('>'))
        || key.is_some_and(|key| {
            key.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
                && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
}

/// What is wrong with the command line `words` (after `umbel`), if anything.
fn check(words: &[String], known: &Known) -> Option<String> {
    let cli = match Cli::try_parse_from(std::iter::once("umbel".to_owned()).chain(words.to_vec())) {
        Ok(cli) => cli,
        Err(error) => return Some(error.kind().to_string()),
    };
    let (command, rest) = match cli.command {
        Verb::Call { words } => {
            let (words, _) = parse::split_flags(&words);
            let (command, rest) = words.split_first()?;
            if !is_name(command) {
                return None; // `umbel call <command>`, `umbel call {name}`: a placeholder.
            }
            (command.clone(), rest.to_vec())
        }
        Verb::External(words) => {
            let (words, _) = parse::split_flags(&words);
            // A registered command's full name as the first word (`umbel store-check for the
            // space`) is the old spelling, unless the projection happens to name a command too.
            let one_word = words
                .first()
                .filter(|first| first.contains('-') && known.contains_key(first.as_str()))
                .map(|first| {
                    let (domain, action) = first.split_once('-').unwrap();
                    format!(
                        "names the command `{first}` as one word: spell it `umbel {domain} {action}` or `umbel call {first}`"
                    )
                });
            match (parse::project(&words), one_word) {
                (Ok((command, _)), Some(spelling)) if !known.contains_key(&command) => {
                    return Some(spelling);
                }
                (Ok(projected), _) => projected,
                (Err(_), Some(spelling)) => return Some(spelling),
                (Err(message), None) => return Some(message),
            }
        }
        _ => return None,
    };
    let Some(schema) = known.get(&command) else {
        return Some(format!(
            "runs `{command}`, which no host or plugin registers on the command line"
        ));
    };
    // `@-` reads the input from stdin, which the binary checks before parsing any words.
    if stdin::is_stdin(&rest) {
        return None;
    }
    let input = match args::parse_input(&rest) {
        Ok(input) => input,
        Err(reason) => return Some(args::describe_error(&reason)),
    };
    let keys: Vec<&String> = input
        .as_object()
        .into_iter()
        .flat_map(|o| o.keys())
        .collect();
    let unknown: Vec<&&String> = keys
        .iter()
        .filter(|key| schema.as_ref().is_some_and(|names| !names.contains(**key)))
        .collect();
    (!unknown.is_empty()).then(|| format!("`{command}` takes no input {unknown:?}"))
}

/// The `umbel …` command lines in one line of `file`, as the words after `umbel`.
fn commands_in(line: &str, json_like: bool, segments: &BTreeSet<&str>) -> Vec<Vec<String>> {
    // In a Rust or JSON string, `\"` is a quote inside the text and `"` ends it.
    let line = if json_like {
        line.replace("\\\"", "\u{1}")
    } else {
        line.to_owned()
    };
    let mut found = Vec::new();
    for (at, _) in line.match_indices("umbel ") {
        let before = line[..at].chars().next_back();
        if before.is_some_and(|c| c.is_alphanumeric() || "-_/.".contains(c)) {
            continue;
        }
        // A backtick span holds a command line and nothing else.
        let in_backticks = before == Some('`');
        if NOT_COMMANDS
            .iter()
            .any(|phrase| line[at..].starts_with(phrase))
        {
            continue;
        }
        let tail = &line[at + "umbel ".len()..];
        let end = tail
            .find(|c| c == '`' || (json_like && c == '"'))
            .unwrap_or(tail.len());
        let text = tail[..end].replace('\u{1}', "\"");
        let words = shell_words(&text);
        // Global flags come before the verb, as `Cli` reads them: `--workspace <dir>`, `--log
        // <filter>`, `--format json|text`, or each with `=` and its value.
        let mut start = 0;
        while let Some(word) = words.get(start) {
            if GLOBAL_FLAGS.contains(&word.as_str()) {
                start += 2;
            } else if GLOBAL_FLAGS
                .iter()
                .any(|flag| word.starts_with(&format!("{flag}=")))
            {
                start += 1;
            } else {
                break;
            }
        }
        let (globals, words) = words.split_at(start.min(words.len()));
        let Some(first) = words.first() else {
            continue;
        };
        // The other verbs name no command, and a global flag or a synopsis (`umbel [--workspace
        // <dir>]`) is the command line's own usage: neither is what this test is for.
        if matches!(
            first.as_str(),
            "init" | "serve" | "help" | "docs" | "schema" | "batch"
        ) || first.starts_with(['-', '['])
        {
            continue;
        }
        if first == "call" {
            if !words.get(1).is_some_and(|name| is_name(name)) {
                continue; // `umbel call <command>`, `umbel call {name}`, a bare `umbel call`.
            }
        } else if !first.contains('-') && !segments.contains(first.as_str()) {
            continue; // Prose: "umbel reads configuration".
        }
        let mut command = globals.to_vec();
        if in_backticks || first == "call" {
            // The whole span, or `call`, the command and every word after it as its input.
            command.extend(words.iter().cloned());
        } else {
            command.push(first.clone());
            let mut rest = words[1..].iter().peekable();
            if let Some(next) = rest.next_if(|word| !looks_like_input(word)) {
                command.push(next.clone());
            }
            command.extend(rest.take_while(|word| looks_like_input(word)).cloned());
        }
        found.push(command);
    }
    found
}

#[test]
fn every_command_umbel_tells_a_reader_to_run_parses_and_exists() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut registered = Registered::default();
    builtins(&mut registered);
    plugin_commands(root, &mut registered);
    let segments = registered.segments();

    let mut files = Vec::new();
    sources(root, &mut files);
    let mut checked = 0;
    let mut problems = Vec::new();
    for file in &files {
        let Ok(text) = std::fs::read_to_string(file) else {
            continue;
        };
        let json_like = file
            .extension()
            .is_some_and(|extension| extension == "rs" || extension == "json");
        for (number, line) in text.lines().enumerate() {
            for words in commands_in(line, json_like, &segments) {
                checked += 1;
                if let Some(problem) = check(&words, &registered.known) {
                    problems.push(format!(
                        "{}:{}: `umbel {}`: {problem}",
                        file.strip_prefix(root).unwrap().display(),
                        number + 1,
                        words.join(" ")
                    ));
                }
            }
        }
    }
    assert!(
        problems.is_empty(),
        "{} of {checked} command lines would be refused:\n{}",
        problems.len(),
        problems.join("\n")
    );
    // The scan finds what it is for: these are among the suggestions it reads.
    assert!(checked > 40, "only {checked} command lines found");
}

#[test]
fn the_check_refuses_what_the_command_line_refuses() {
    let mut known = Known::new();
    known.insert(
        "plugin-show".into(),
        Some(BTreeSet::from(["plugin".to_owned()])),
    );
    known.insert("workspace-doctor".into(), Some(BTreeSet::new()));
    known.insert(
        "store-check".into(),
        Some(BTreeSet::from(["space".to_owned()])),
    );
    known.insert(
        "memory-show".into(),
        Some(BTreeSet::from(["id".to_owned()])),
    );
    // No command here is hidden from the command line, so every registered name is in `known`.
    let segments: BTreeSet<&str> = known.keys().flat_map(|name| name.split('-')).collect();
    let verdict = |line: &str| {
        commands_in(line, true, &segments)
            .into_iter()
            .map(|words| check(&words, &known))
            .collect::<Vec<_>>()
    };
    // The spellings this test was written for.
    assert!(verdict("\"Run umbel workspace-doctor.\"")[0].is_some());
    assert!(verdict("\"run umbel doctor and fix it\"")[0].is_some());
    assert!(verdict("\"with `umbel plugin-show components`\"")[0].is_some());
    assert!(verdict("\"umbel plugin show <plugin>\"")[0].is_some());
    assert!(verdict("\"umbel plugin show --plugin x\"")[0].is_some());
    assert!(verdict("\"umbel plugin show name=x\"")[0].is_some());
    // A backtick span is a command line to its end, and `call`'s input is every word after it.
    assert!(verdict("\"`umbel plugin show components`\"")[0].is_some());
    assert!(verdict("\"run umbel call plugin-show notes to see it\"")[0].is_some());
    // A global flag before the command does not hide it.
    assert!(verdict("\"umbel --workspace <dir> workspace-doctor\"")[0].is_some());
    // An old spelling followed by prose says how to spell it.
    let one_word = verdict("\"Run umbel store-check for the space.\"");
    let message = one_word[0].as_deref().unwrap();
    assert!(
        message.contains("`umbel store check`") && message.contains("`umbel call store-check`"),
        "{message}"
    );
    // And what the command line takes.
    assert_eq!(verdict("\"Run umbel workspace doctor.\""), vec![None]);
    assert_eq!(
        verdict(
            "\"see `umbel plugin show plugin=notes` and umbel call plugin-show '{\\\"plugin\\\": \\\"x\\\"}'\""
        ),
        vec![None, None]
    );
    assert_eq!(verdict("\"pipe it to `umbel memory show @-`\""), vec![None]);
    assert_eq!(
        verdict("\"umbel --workspace <dir> workspace doctor\""),
        vec![None]
    );
    assert!(verdict("\"umbel reads configuration from umbel.toml\"").is_empty());
}

#[test]
fn a_command_hidden_from_the_command_line_is_not_known() {
    let manifest: toml::Table = toml::from_str(
        r#"
            [[commands]]
            name = "notes-list"
            input_schema = { type = "object", properties = { space = { type = "string" } } }

            [[commands]]
            name = "notes-sync"
            expose = { mcp = true, agent = false, cli = false }

            [[pipelines]]
            name = "notes-tidy"
            expose = { cli = false }
        "#,
    )
    .unwrap();
    let mut registered = Registered::default();
    manifest_commands(&manifest, Path::new("."), &mut registered);
    let known = &registered.known;
    assert_eq!(
        known.keys().collect::<Vec<_>>(),
        vec!["notes-list"],
        "{known:?}"
    );
    assert_eq!(
        registered.names.iter().collect::<Vec<_>>(),
        vec!["notes-list", "notes-sync", "notes-tidy"]
    );
    let words = |line: &str| line.split(' ').map(str::to_owned).collect::<Vec<_>>();
    assert_eq!(check(&words("notes list space=main"), known), None);
    assert!(check(&words("notes sync"), known).is_some());
    assert!(check(&words("call notes-tidy"), known).is_some());
    // A hidden command's word starts a command line too: `tidy` names only `notes-tidy`, so
    // the line is refused rather than read as prose.
    let lines = commands_in("\"Run umbel tidy.\"", true, &registered.segments());
    assert_eq!(lines, vec![vec!["tidy".to_owned()]]);
    assert!(check(&lines[0], known).is_some());
}

/// A handler for definitions that are listed, never run.
struct Unused;

#[async_trait::async_trait]
impl afd::CommandHandler for Unused {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        afd::success(Value::Null)
    }
}

#[test]
fn a_builtin_hidden_from_the_command_line_is_not_known() {
    let registry = CommandRegistry::new();
    for (name, expose) in [
        ("vault-seal", afd::ExposeOptions::new()),
        ("vault-show", afd::ExposeOptions::new().with_cli(true)),
    ] {
        let definition =
            afd::CommandDefinition::new(name, "A command.", vec![], Unused).with_expose(expose);
        registry.register(definition).unwrap();
    }
    let mut registered = Registered::default();
    registry_commands(&registry, &mut registered);
    assert_eq!(
        registered.known.keys().collect::<Vec<_>>(),
        vec!["vault-show"],
        "{:?}",
        registered.known
    );
    assert_eq!(
        registered.names.iter().collect::<Vec<_>>(),
        vec!["vault-seal", "vault-show"]
    );
}
