//! Who a call may be taken for (phase 3 specification, section 3.3, D86): the terminal marks the
//! CLI sets, the agent environment variables that withhold them, and the authority the host fills
//! into a memory write.
//!
//! **Not an attestation.** `person` rests on a terminal check until phase 5: a process that runs
//! the CLI in a pseudo-terminal with the agent variables removed passes it. It stops the ordinary
//! case, an agent shelling out to the CLI or a hook being recorded as a person's word.
//!
//! The marks are `CommandContext.extra` keys the host owns. Only the CLI's single-command path
//! sets them, in the context it builds; `umbel batch` drops a request's context (#688) and the MCP
//! surface builds its own, and every check here also requires a human actor at the CLI, so a
//! mark arriving any other way counts for nothing. Plugins never set them: the plugin gate strips
//! every `dev.umbel/` result key a plugin returns.

// The memory services (feature `store-embedded`) and the CLI (feature `cli`) use these.
#![cfg_attr(
    not(all(feature = "cli", feature = "store-embedded")),
    allow(dead_code)
)]

use std::collections::{BTreeMap, BTreeSet};

use afd::{ActorKind, CommandContext, CommandInterface};
use serde_json::Value;
use umbel_sdk::MemoryPath;
use umbel_store::Authority;

use crate::middleware::HUMAN_CONFIRMED_KEY;
use crate::principal::{Authentication, Principal, Transport};

/// `CommandContext.extra` key: the command the CLI ran, set when a person is at the terminal
/// (stdin and stderr are terminals, the input is not `@-`, neither `--yes` nor `--approve`, no
/// agent variable) and, for a command with an `authority_prompt`, answered yes.
pub const HUMAN_PRESENT_KEY: &str = "dev.umbel/human-present";

/// The environment variables that mark the CLI's caller as an agent, beside the workspace's
/// `principal.agent_env` (seen in a harness's child process on 2026-11-02).
pub const AGENT_ENV: &[&str] = &["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT"];

/// What a terminal mark may cover: for each command that declares an `authority_prompt`
/// (directly, or a pipeline inheriting its steps'), the prompt; and for each pipeline, the
/// commands its steps run under the context the CLI built for it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Prompts {
    pub(crate) prompts: BTreeMap<String, String>,
    pub(crate) steps: BTreeMap<String, BTreeSet<String>>,
}

impl Prompts {
    /// Whether a mark naming `marked` covers a call of `command`: the same command, or a step of
    /// the pipeline `marked`.
    fn covers(&self, marked: &str, command: &str) -> bool {
        marked == command
            || self
                .steps
                .get(marked)
                .is_some_and(|steps| steps.contains(command))
    }
}

/// The command a CLI call's human-present mark names, when the call is a human's at the CLI
/// (interface, transport and authentication all the CLI's).
fn cli_mark(context: &CommandContext) -> Option<&str> {
    if context.interface != Some(CommandInterface::Cli) {
        return None;
    }
    let principal = Principal::from_context(context)?;
    if principal.actor.kind != ActorKind::Human
        || principal.transport != Transport::Cli
        || principal.authentication != Authentication::Process
    {
        return None;
    }
    context.extra.get(HUMAN_PRESENT_KEY).and_then(Value::as_str)
}

/// A human through the library: the embedder vouches for the person behind every call.
fn embedder_human(context: &CommandContext) -> bool {
    Principal::from_context(context).is_some_and(|principal| {
        principal.actor.kind == ActorKind::Human
            && principal.transport == Transport::Library
            && principal.authentication == Authentication::Embedder
    })
}

/// A human actor at the CLI, whatever the marks.
fn cli_human(context: &CommandContext) -> bool {
    context.interface == Some(CommandInterface::Cli)
        && Principal::from_context(context).is_some_and(|principal| {
            principal.actor.kind == ActorKind::Human && principal.transport == Transport::Cli
        })
}

/// Whether the caller "has authority `person`" for the checks of sections 6.3 and 8.7: the
/// terminal check alone. A human through the library, or a human at the CLI whose
/// human-present mark covers `command`.
pub(crate) fn caller_is_person(
    context: &CommandContext,
    command: Option<&str>,
    prompts: &Prompts,
) -> bool {
    if embedder_human(context) {
        return true;
    }
    match (cli_mark(context), command) {
        (Some(marked), Some(command)) => prompts.covers(marked, command),
        _ => false,
    }
}

/// Whether a remember at the CLI reaches `person` (D86): the human-present mark and the
/// human-confirmed mark name the same command, that command carries an `authority_prompt`
/// (which the CLI asked and was answered yes), and it covers `command`.
fn answered_authority_prompt(
    context: &CommandContext,
    command: Option<&str>,
    prompts: &Prompts,
) -> bool {
    let (Some(marked), Some(command)) = (cli_mark(context), command) else {
        return false;
    };
    let confirmed = context
        .extra
        .get(HUMAN_CONFIRMED_KEY)
        .and_then(Value::as_str);
    confirmed == Some(marked)
        && prompts.prompts.contains_key(marked)
        && prompts.covers(marked, command)
}

/// The authority the host fills into a put of a standing record (the records host
/// specification, section 4.2, step 3), whatever the plugin sent: `person` for a human through
/// the library, `tool` for any other human actor and `agent` for any other actor. The table's
/// first row, a call that carries the person gate's proof, joins with that specification's step
/// B3, which is where the proof is made.
pub(crate) fn record_authority(context: &CommandContext) -> Authority {
    if embedder_human(context) {
        return Authority::Person;
    }
    let human = Principal::from_context(context)
        .is_some_and(|principal| principal.actor.kind == ActorKind::Human);
    if human {
        Authority::Tool
    } else {
        Authority::Agent
    }
}

/// The authority the host fills into a memory write on `path` (section 3.3's table), whatever
/// the plugin sent.
pub(crate) fn write_authority(
    path: MemoryPath,
    context: &CommandContext,
    command: Option<&str>,
    prompts: &Prompts,
) -> Authority {
    let human = Principal::from_context(context)
        .is_some_and(|principal| principal.actor.kind == ActorKind::Human);
    match path {
        MemoryPath::Import => Authority::Import,
        MemoryPath::Capture if human && (cli_human(context) || embedder_human(context)) => {
            Authority::Transcript
        }
        MemoryPath::Capture => Authority::Agent,
        MemoryPath::Remember if embedder_human(context) => Authority::Person,
        MemoryPath::Remember if cli_human(context) => {
            if answered_authority_prompt(context, command, prompts) {
                Authority::Person
            } else {
                Authority::Tool
            }
        }
        MemoryPath::Remember => Authority::Agent,
    }
}

/// Whether one of the agent environment variables is set: the built-in ones and the
/// workspace's `principal.agent_env`. Set means present, whatever its value.
pub(crate) fn agent_env_set(
    is_set: impl Fn(&str) -> bool,
    configured: &[String],
) -> Option<String> {
    AGENT_ENV
        .iter()
        .map(|name| (*name).to_owned())
        .chain(configured.iter().cloned())
        .find(|name| is_set(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use afd::Actor;

    fn cli(kind: ActorKind) -> CommandContext {
        let mut context = CommandContext::new();
        context.interface = Some(CommandInterface::Cli);
        Principal::new(
            Actor::new(kind).with_id("ada"),
            Transport::Cli,
            Authentication::Process,
        )
        .apply(&mut context);
        context
    }

    fn marked(
        mut context: CommandContext,
        present: &str,
        confirmed: Option<&str>,
    ) -> CommandContext {
        context
            .extra
            .insert(HUMAN_PRESENT_KEY.to_owned(), Value::from(present));
        if let Some(confirmed) = confirmed {
            context
                .extra
                .insert(HUMAN_CONFIRMED_KEY.to_owned(), Value::from(confirmed));
        }
        context
    }

    fn prompts() -> Prompts {
        let mut prompts = Prompts::default();
        prompts
            .prompts
            .insert("mem-remember".into(), "Your own word?".into());
        prompts
            .prompts
            .insert("mem-pipe".into(), "mem-remember: Your own word?".into());
        prompts.steps.insert(
            "mem-pipe".into(),
            ["mem-remember".to_owned()].into_iter().collect(),
        );
        prompts
    }

    #[test]
    fn the_table_of_section_3_3() {
        let p = prompts();
        let remember =
            |c: &CommandContext, cmd: &str| write_authority(MemoryPath::Remember, c, Some(cmd), &p);
        let yes = marked(cli(ActorKind::Human), "mem-remember", Some("mem-remember"));
        assert_eq!(remember(&yes, "mem-remember"), Authority::Person);
        // Present but not answered, a mark naming another command, no prompt: tool.
        let present = marked(cli(ActorKind::Human), "mem-remember", None);
        assert_eq!(remember(&present, "mem-remember"), Authority::Tool);
        let other = marked(cli(ActorKind::Human), "mem-other", Some("mem-other"));
        assert_eq!(remember(&other, "mem-remember"), Authority::Tool);
        assert_eq!(
            remember(&cli(ActorKind::Human), "mem-remember"),
            Authority::Tool
        );
        // A pipeline that inherits the prompt covers its step.
        let pipe = marked(cli(ActorKind::Human), "mem-pipe", Some("mem-pipe"));
        assert_eq!(remember(&pipe, "mem-remember"), Authority::Person);
        // An agent, whatever marks it carries.
        let agent = marked(cli(ActorKind::Agent), "mem-remember", Some("mem-remember"));
        assert_eq!(remember(&agent, "mem-remember"), Authority::Agent);
        // The marks without the CLI interface count for nothing.
        let mut mcp = yes.clone();
        mcp.interface = Some(CommandInterface::Mcp);
        assert_eq!(remember(&mcp, "mem-remember"), Authority::Agent);
        // The library's human is the embedder's person.
        let mut library = CommandContext::new();
        Principal::new(
            Actor::new(ActorKind::Human).with_id("ada"),
            Transport::Library,
            Authentication::Embedder,
        )
        .apply(&mut library);
        assert_eq!(remember(&library, "mem-remember"), Authority::Person);
        let capture = |c: &CommandContext| write_authority(MemoryPath::Capture, c, None, &p);
        assert_eq!(capture(&cli(ActorKind::Human)), Authority::Transcript);
        assert_eq!(capture(&library), Authority::Transcript);
        assert_eq!(capture(&cli(ActorKind::Agent)), Authority::Agent);
        assert_eq!(
            write_authority(MemoryPath::Import, &cli(ActorKind::Agent), None, &p),
            Authority::Import
        );
    }

    #[test]
    fn a_callers_authority_is_the_terminal_check_alone() {
        let p = prompts();
        let present = marked(cli(ActorKind::Human), "mem-forget", None);
        assert!(caller_is_person(&present, Some("mem-forget"), &p));
        assert!(!caller_is_person(&present, Some("mem-other"), &p));
        assert!(!caller_is_person(&present, None, &p));
        assert!(!caller_is_person(
            &cli(ActorKind::Human),
            Some("mem-forget"),
            &p
        ));
    }

    #[test]
    fn agent_variables_include_the_configured_ones() {
        let set = |name: &str| name == "MY_AGENT";
        assert_eq!(agent_env_set(set, &[]), None);
        assert_eq!(
            agent_env_set(set, &["MY_AGENT".to_owned()]),
            Some("MY_AGENT".to_owned())
        );
        assert_eq!(
            agent_env_set(|name| name == "CLAUDECODE", &[]),
            Some("CLAUDECODE".to_owned())
        );
    }
}
