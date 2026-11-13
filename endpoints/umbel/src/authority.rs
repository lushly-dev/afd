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
use crate::workspace::Config;

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

/// The command a CLI call's human-present mark names, when the call is a human's at the host's
/// own command line (sealed, [`is_cli`]; interface, transport and authentication all the CLI's).
fn cli_mark(context: &CommandContext) -> Option<&str> {
    if !is_cli(context) {
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
pub(crate) fn embedder_human(context: &CommandContext) -> bool {
    Principal::from_context(context).is_some_and(|principal| {
        principal.actor.kind == ActorKind::Human
            && principal.transport == Transport::Library
            && principal.authentication == Authentication::Embedder
    })
}

/// Whether `principal` is the operator's person: `human:<principal.local_id>`, or a legacy
/// principal `[principal.equivalents]` maps to it.
pub(crate) fn is_operators_person(config: &Config, principal: &str) -> bool {
    let operator = format!("human:{}", config.principal.local_id);
    crate::access::identities(config, Some(&operator))
        .iter()
        .any(|identity| identity == principal)
}

/// A human through the library whom the library's word makes a person: only the operator's
/// person (phase 5 step 10, the owner's settlement of 2026-11-09, extended to D86 on
/// 2026-11-10). Any other library human is the embedder's unchecked word, and no person.
pub(crate) fn embedder_person(context: &CommandContext, config: &Config) -> bool {
    embedder_human(context)
        && Principal::from_context(context)
            .and_then(|principal| crate::provenance::effective_principal(&principal.actor))
            .is_some_and(|principal| is_operators_person(config, &principal))
}

/// A human actor at the host's own command line ([`is_cli`]), whatever the marks.
fn cli_human(context: &CommandContext) -> bool {
    is_cli(context)
        && Principal::from_context(context).is_some_and(|principal| {
            principal.actor.kind == ActorKind::Human && principal.transport == Transport::Cli
        })
}

/// Whether the caller "has authority `person`" for the checks of sections 6.3 and 8.7: the
/// terminal check alone. The operator's person through the library (step 10), or a human at the
/// host's own command line whose human-present mark covers `command`.
pub(crate) fn caller_is_person(
    context: &CommandContext,
    config: &Config,
    command: Option<&str>,
    prompts: &Prompts,
) -> bool {
    if embedder_person(context, config) {
        return true;
    }
    match (cli_mark(context), command) {
        (Some(marked), Some(command)) => prompts.covers(marked, command),
        _ => false,
    }
}

/// Whether the caller is a person at the CLI's terminal for `command`: the host's own command line
/// ([`seal_cli`]), a human there whose human-present mark covers it (the terminal check alone,
/// never the library).
pub(crate) fn terminal_person(
    context: &CommandContext,
    command: Option<&str>,
    prompts: &Prompts,
) -> bool {
    match (cli_mark(context), command) {
        (Some(marked), Some(command)) => prompts.covers(marked, command),
        _ => false,
    }
}

/// `CommandContext.extra` key: the seal of a context the host's own command line built
/// ([`seal_cli`]). Only the host computes it, from a key drawn in this process that never leaves
/// it; no surface returns a context's `extra` (a plugin sees `CallContext`), and it is no declared
/// context field, so no journal keeps it. An embedding application that writes `interface: cli`,
/// the CLI's principal and its marks into a library context cannot make it, and is treated as the
/// library (phase 5 step 10). Contexts derived from a sealed one (a batch item, a pipeline step)
/// keep it, as they keep the CLI's other fields.
pub(crate) const CLI_SEAL_KEY: &str = "dev.umbel/cli-seal";

/// This process's seal: the hex SHA-256 of a label and 32 bytes from the operating system, drawn
/// once. `None` when the operating system gave none, so nothing is sealed and no context is the
/// CLI's.
fn cli_seal() -> Option<&'static str> {
    static SEAL: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    SEAL.get_or_init(|| {
        use sha2::{Digest, Sha256};
        let mut key = [0_u8; 32];
        getrandom::fill(&mut key).ok()?;
        let mut digest = Sha256::new();
        digest.update(b"umbel-cli-seal-v1\0");
        digest.update(key);
        Some(
            digest
                .finalize()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        )
    })
    .as_deref()
}

/// Seal `context`, which the host's own command line built, as the CLI's.
#[cfg_attr(not(feature = "cli"), allow(dead_code))]
pub(crate) fn seal_cli(context: &mut CommandContext) {
    if let Some(seal) = cli_seal() {
        context
            .extra
            .insert(CLI_SEAL_KEY.to_owned(), Value::String(seal.to_owned()));
    }
}

/// Whether `context` is the host's own command line's: the CLI interface **and** this process's
/// seal. A context that sets the CLI interface without the seal is the library's, whatever its
/// principal and marks say; every check that trusts the CLI asks this.
pub(crate) fn is_cli(context: &CommandContext) -> bool {
    context.interface == Some(CommandInterface::Cli)
        && cli_seal().is_some_and(|seal| {
            context.extra.get(CLI_SEAL_KEY).and_then(Value::as_str) == Some(seal)
        })
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

/// The authority the host fills into a memory write on `path` (section 3.3's table), whatever
/// the plugin sent.
pub(crate) fn write_authority(
    path: MemoryPath,
    context: &CommandContext,
    config: &Config,
    command: Option<&str>,
    prompts: &Prompts,
) -> Authority {
    let human = Principal::from_context(context)
        .is_some_and(|principal| principal.actor.kind == ActorKind::Human);
    // The library's word makes a person only of the operator's person (step 10, extending the
    // 2026-11-09 settlement to D86); any other library human writes as an agent does.
    let embedder = embedder_person(context, config);
    match path {
        MemoryPath::Import => Authority::Import,
        MemoryPath::Capture if human && (cli_human(context) || embedder) => Authority::Transcript,
        MemoryPath::Capture => Authority::Agent,
        MemoryPath::Remember if embedder => Authority::Person,
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
        seal_cli(&mut context);
        context
    }

    /// Mode `none`, the operator `ada`.
    fn config() -> Config {
        crate::workspace::ConfigFile::parse("config_version = 4\n[principal]\nlocal_id = \"ada\"\n")
            .and_then(|file| file.into_config(std::path::Path::new("/w")))
            .expect("a valid configuration")
    }

    /// A library context of the human `id`.
    fn library_of(id: &str) -> CommandContext {
        let mut library = CommandContext::new();
        Principal::new(
            Actor::new(ActorKind::Human).with_id(id),
            Transport::Library,
            Authentication::Embedder,
        )
        .apply(&mut library);
        library
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
        let config = config();
        let remember = |c: &CommandContext, cmd: &str| {
            write_authority(MemoryPath::Remember, c, &config, Some(cmd), &p)
        };
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
        // The marks with the CLI interface but without the host's seal: the library's, not the
        // terminal (step 10).
        let mut unsealed = yes.clone();
        unsealed.extra.remove(CLI_SEAL_KEY);
        assert!(!is_cli(&unsealed));
        assert_eq!(remember(&unsealed, "mem-remember"), Authority::Agent);
        let mut forged = yes.clone();
        forged
            .extra
            .insert(CLI_SEAL_KEY.to_owned(), Value::from("0".repeat(64)));
        assert_eq!(remember(&forged, "mem-remember"), Authority::Agent);
        // The library's human is a person only when it is the operator's (step 10's extension of
        // the 2026-11-09 settlement to D86); any other library human writes as an agent.
        let library = library_of("ada");
        assert_eq!(remember(&library, "mem-remember"), Authority::Person);
        let other = library_of("bo");
        assert_eq!(remember(&other, "mem-remember"), Authority::Agent);
        let capture =
            |c: &CommandContext| write_authority(MemoryPath::Capture, c, &config, None, &p);
        assert_eq!(capture(&cli(ActorKind::Human)), Authority::Transcript);
        assert_eq!(capture(&library), Authority::Transcript);
        assert_eq!(capture(&other), Authority::Agent);
        assert_eq!(capture(&unsealed), Authority::Agent);
        assert_eq!(capture(&cli(ActorKind::Agent)), Authority::Agent);
        assert_eq!(
            write_authority(
                MemoryPath::Import,
                &cli(ActorKind::Agent),
                &config,
                None,
                &p
            ),
            Authority::Import
        );
    }

    #[test]
    fn a_callers_authority_is_the_terminal_check_alone() {
        let p = prompts();
        let config = config();
        let person = |c: &CommandContext, cmd: Option<&str>| caller_is_person(c, &config, cmd, &p);
        let present = marked(cli(ActorKind::Human), "mem-forget", None);
        assert!(person(&present, Some("mem-forget")));
        assert!(!person(&present, Some("mem-other")));
        assert!(!person(&present, None));
        assert!(!person(&cli(ActorKind::Human), Some("mem-forget")));
        // Without the seal, the same context is no terminal.
        let mut unsealed = present.clone();
        unsealed.extra.remove(CLI_SEAL_KEY);
        assert!(!person(&unsealed, Some("mem-forget")));
        assert!(!terminal_person(&unsealed, Some("mem-forget"), &p));
        assert!(terminal_person(&present, Some("mem-forget"), &p));
        // The library: the operator's person only.
        assert!(person(&library_of("ada"), Some("mem-forget")));
        assert!(!person(&library_of("bo"), Some("mem-forget")));
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
