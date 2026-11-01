//! `skill-export`: write the skills of the loaded plugins to a directory (the CLI delivery path
//! of specification section 8.3).
//!
//! Each skill goes to `<dir>/<name>/`, with the files at their paths and an origin file beside
//! them. An existing file that differs is never overwritten unless `force` is true, and nothing
//! is written when any file would be refused. Skills are untrusted content: the files are copied
//! as bytes and never read for instructions.

use super::{Builtin, blocking, returns_object};
use crate::plugins::{LoadedPlugins, LoadedSkill, ORIGIN_FILE, origin_file};
use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

struct Handler {
    loaded: Arc<OnceLock<Arc<LoadedPlugins>>>,
}

/// One file to write: where, what, and what is there now.
struct Target {
    skill: String,
    relative: String,
    path: PathBuf,
    bytes: Vec<u8>,
    state: State,
}

#[derive(PartialEq, Eq)]
enum State {
    Absent,
    Same,
    Differs,
}

fn invalid(message: String, suggestion: &str) -> CommandError {
    CommandError::new(afd::error_codes::VALIDATION_ERROR, message)
        .with_suggestion(suggestion)
        .with_retryable(false)
}

fn io_error(path: &Path, error: &std::io::Error) -> CommandError {
    CommandError::new(
        afd::error_codes::INTERNAL_ERROR,
        format!("cannot write {}: {error}", path.display()),
    )
    .with_suggestion("Check that the directory is writable and has room.")
    .with_retryable(false)
}

/// The files of `skills`, each with the state of its target under `root`.
fn targets(root: &Path, skills: &[&LoadedSkill]) -> Result<Vec<Target>, CommandError> {
    let mut targets = Vec::new();
    for skill in skills {
        let mut files: Vec<(String, Vec<u8>)> = skill
            .files
            .iter()
            .map(|file| (file.path.clone(), file.bytes.clone()))
            .collect();
        files.push((ORIGIN_FILE.to_owned(), origin_file(skill)));
        for (relative, bytes) in files {
            let path = root.join(&skill.name).join(&relative);
            let state = match fs::symlink_metadata(&path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => State::Absent,
                Err(error) => return Err(io_error(&path, &error)),
                Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() => {
                    return Err(invalid(
                        format!(
                            "{} exists and is not a regular file, so the export will not write through it",
                            path.display()
                        ),
                        "Remove it or export to another directory.",
                    ));
                }
                Ok(_) => match fs::read(&path) {
                    Ok(existing) if existing == bytes => State::Same,
                    Ok(_) => State::Differs,
                    Err(error) => return Err(io_error(&path, &error)),
                },
            };
            targets.push(Target {
                skill: skill.name.clone(),
                relative,
                path,
                bytes,
                state,
            });
        }
    }
    Ok(targets)
}

/// Refuse to write below a path component that is a symbolic link or a file.
fn check_parents(root: &Path, target: &Path) -> Result<(), CommandError> {
    let Ok(below) = target.strip_prefix(root) else {
        return Ok(());
    };
    let mut current = root.to_path_buf();
    let parents = below.parent().into_iter().flat_map(Path::components);
    for component in parents {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(io_error(&current, &error)),
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Err(invalid(
                    format!(
                        "{} is a symbolic link or not a directory, so the export will not write through it",
                        current.display()
                    ),
                    "Remove it or export to another directory.",
                ));
            }
            Ok(_) => {}
        }
    }
    Ok(())
}

fn export(
    dir: &str,
    skills: &[LoadedSkill],
    only: Option<&str>,
    force: bool,
) -> Result<Value, CommandError> {
    let selected: Vec<&LoadedSkill> = skills
        .iter()
        .filter(|skill| only.is_none_or(|name| skill.name == name))
        .collect();
    if let Some(name) = only
        && selected.is_empty()
    {
        let known: Vec<&str> = skills.iter().map(|skill| skill.name.as_str()).collect();
        return Err(CommandError::new(
            afd::error_codes::NOT_FOUND,
            format!("There is no skill named `{name}`"),
        )
        .with_suggestion(if known.is_empty() {
            "No loaded plugin ships a skill; enable one in plugins.enabled.".to_owned()
        } else {
            format!("Name one of: {}.", known.join(", "))
        })
        .with_retryable(false));
    }
    let root = PathBuf::from(dir);
    let targets = targets(&root, &selected)?;
    let refused: Vec<String> = targets
        .iter()
        .filter(|target| target.state == State::Differs)
        .map(|target| target.path.display().to_string())
        .collect();
    if !refused.is_empty() && !force {
        let mut details = HashMap::new();
        details.insert("differs".to_owned(), json!(refused));
        return Err(CommandError::new(
            afd::error_codes::ALREADY_EXISTS,
            format!(
                "{} file(s) already exist with other content; nothing was written",
                refused.len()
            ),
        )
        .with_suggestion("Pass force=true to overwrite them, or export to another directory.")
        .with_retryable(false)
        .with_details(details));
    }
    for target in &targets {
        check_parents(&root, &target.path)?;
    }
    let mut written: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut unchanged: HashMap<&str, usize> = HashMap::new();
    for target in &targets {
        if target.state == State::Same {
            *unchanged.entry(&target.skill).or_default() += 1;
            continue;
        }
        if let Some(parent) = target.path.parent() {
            fs::create_dir_all(parent).map_err(|error| io_error(parent, &error))?;
        }
        fs::write(&target.path, &target.bytes).map_err(|error| io_error(&target.path, &error))?;
        written
            .entry(&target.skill)
            .or_default()
            .push(&target.relative);
    }
    let exported: Vec<Value> = selected
        .iter()
        .map(|skill| {
            json!({
                "name": skill.name,
                "instance": skill.instance,
                "version": skill.version,
                "path": root.join(&skill.name).display().to_string(),
                "written": written.get(skill.name.as_str()).cloned().unwrap_or_default(),
                "unchanged": unchanged.get(skill.name.as_str()).copied().unwrap_or(0),
            })
        })
        .collect();
    Ok(json!({ "dir": dir, "skills": exported }))
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let Some(dir) = input
            .get("dir")
            .and_then(Value::as_str)
            .filter(|d| !d.is_empty())
        else {
            return failure(invalid(
                "dir is required".to_owned(),
                "Pass dir=<path>: the directory the skills are written to.",
            ));
        };
        let dir = dir.to_owned();
        let only = input
            .get("skill")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let force = input.get("force").and_then(Value::as_bool).unwrap_or(false);
        let loaded = self.loaded.get().cloned().unwrap_or_default();
        match blocking(move || export(&dir, &loaded.skills, only.as_deref(), force)).await {
            Ok(data) => success(data),
            Err(error) => failure(error),
        }
    }
}

/// `skill-export`: writes files, so only the CLI and trusted host code reach it.
pub(crate) fn skill_export(loaded: Arc<OnceLock<Arc<LoadedPlugins>>>) -> Builtin {
    let mut definition = CommandDefinition::new(
        "skill-export",
        "Write the loaded plugins' skills to a directory, one subdirectory each, with an origin file; refuses to overwrite a file that differs unless force is true",
        vec![],
        Handler { loaded },
    )
    .with_category("plugins")
    .with_returns(returns_object(
        "dir and skills (name, instance, version, path, the files written, the count unchanged)",
    ))
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    definition.mutation = true;
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "dir": {
                    "type": "string",
                    "description": "The directory to write to; each skill goes to <dir>/<name>/"
                },
                "skill": {
                    "type": "string",
                    "description": "Export only the skill with this name; default: every skill"
                },
                "force": {
                    "type": "boolean",
                    "description": "Overwrite files that differ; default false"
                },
            },
            "required": ["dir"],
            "additionalProperties": false,
        }),
    }
}
