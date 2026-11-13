//! Proving a person (phase 5 specification, sections 7.1 to 7.5; D115, D116; owner decisions 6
//! and 7).
//!
//! A `confirm = "require-human"` command names, per surface, the least assurance it accepts
//! (manifest version 5's `person`): `terminal`, the CLI's check (unchanged, and not an
//! attestation), or `verified`, a decision made on the **person page** after a fresh login at the
//! namespace's identity provider with user verification, by the person the call is for. This
//! module holds what every build needs: the shape of a decision's `for`, the host-owned context
//! field a decided call carries ([`PERSON_DECISION_KEY`]), and the plugin gate's check of it
//! ([`admit`]). With the `auth` feature, [`service`] begins, decides and resumes decisions,
//! [`oidc`] is the relying party, [`page`] serves the routes, and [`relay`] is Umbel's
//! `HumanRelay`.
//!
//! **What a verified call carries.** After a decision is spent (once, in the shared nonce store,
//! by the relay's `resume` or the CLI), the call runs with two host-owned `extra` fields: the
//! principal with `humanPresent` set (`verified`, `person-page`, the decision's time, the login's
//! `auth_time` and `acr`), and [`PERSON_DECISION_KEY`], naming the decision, its command, its
//! input digest and its surface. Over MCP the relay sets them through AFD's
//! `HumanRelay::approved_context`; at the CLI the CLI sets them. No request can: the context hook
//! builds an MCP call's `extra` from nothing, and every other surface sets its own.
//!
//! **The plugin gate's check** ([`admit`]) accepts a `verified` surface only on such a mark that
//! names this command, this surface and the digest of this validated input, on a caller whose
//! `for` it can build, and then asks the ledger, which reads the decision back (approved, for
//! this `for`, this command and digest) and spends `person-run:<id>` once, so one decision runs
//! one call even if a handler runs the command again in process with the same context.

#[cfg(feature = "auth")]
pub(crate) mod oidc;
#[cfg(feature = "auth")]
pub(crate) mod page;
#[cfg(feature = "auth")]
pub(crate) mod relay;
#[cfg(feature = "auth")]
pub(crate) mod service;

use afd::{ActorKind, CommandContext, CommandError, CommandInterface, error_codes};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::principal::{Authentication, Principal, Transport};
use crate::workspace::Config;

/// The `CommandContext.extra` key a call decided on the person page carries ([`PersonMark`]).
/// Only the host sets it.
pub(crate) const PERSON_DECISION_KEY: &str = "dev.umbel/person-decision";

/// The `CommandContext.extra` key of the host's own run of a gated command's `confirm_preview`,
/// as the caller, before a decision is begun (step 6): `{ "command", "preview", "surface" }`. The
/// plugin sees it as `CallContext::person_check` ([`check_of`]) and answers a failure for a call
/// it would refuse, so no person is asked about it. It only ever adds refusals; even so, only the
/// host sets it (the context hook clears it on every MCP call).
pub(crate) const PERSON_CHECK_KEY: &str = "dev.umbel/person-check";

/// The `CommandContext.extra` key of the person page's own run of a gated command's
/// `confirm_preview` to render one page of it (the Ideas host-review specification, section 2):
/// `{ "preview", "page" }`. The plugin sees it as `CallContext::preview_page` ([`page_of`]). It
/// carries no authority, and only the host sets it (the context hook clears it on every MCP
/// call).
pub(crate) const PREVIEW_PAGE_KEY: &str = "dev.umbel/preview-page";

/// The CLI's decision expired before it was decided (section 10.5): retryable.
#[cfg_attr(not(all(feature = "auth", feature = "cli")), allow(dead_code))]
pub(crate) const PERSON_DECISION_EXPIRED: &str = "PERSON_DECISION_EXPIRED";
/// The login's ID token lacks a configured `acr` or a user-verification `amr` (section 10.5):
/// retryable, by logging in again with user verification.
#[cfg_attr(not(feature = "auth"), allow(dead_code))]
pub(crate) const PERSON_VERIFICATION_INSUFFICIENT: &str = "PERSON_VERIFICATION_INSUFFICIENT";

/// ISO 8601 UTC with milliseconds, as Umbel's records write times (amendment from step 1).
#[cfg_attr(not(feature = "auth"), allow(dead_code))]
pub(crate) fn iso(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// The actor a decision is for: AFD's actor without its `label`, the members the principal binding
/// holds (`spec/authorization.md`, M8).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ActorRef {
    pub(crate) kind: ActorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) on_behalf_of: Option<String>,
}

impl ActorRef {
    /// The members of `actor` a decision binds.
    pub(crate) fn of(actor: &afd::Actor) -> Self {
        Self {
            kind: actor.kind,
            id: actor.id.clone(),
            on_behalf_of: actor.on_behalf_of.clone(),
        }
    }
}

/// `for`: who a decision is for (section 7.2, step 1). Over MCP from the verified call (the
/// issuer alias and the client id); at the CLI from the namespaced `principal.local_id`, with
/// `issuer` and `clientId` `null`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DecisionFor {
    pub(crate) actor: ActorRef,
    pub(crate) client_id: Option<String>,
    pub(crate) issuer: Option<String>,
    pub(crate) namespace: String,
    /// The namespaced id's subject part, as section 4.1 maps it (literal or hashed).
    pub(crate) subject: String,
}

/// Where a person decided for a call: the surface whose `person` assurance it meets.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Surface {
    Mcp,
    Cli,
}

/// What a call decided on the person page carries under [`PERSON_DECISION_KEY`]: ids and the
/// assurance, never content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PersonMark {
    pub(crate) id: String,
    pub(crate) command: String,
    pub(crate) input_digest: String,
    pub(crate) surface: Surface,
    /// Always `verified`.
    pub(crate) level: String,
    /// Always `person-page`.
    pub(crate) method: String,
    pub(crate) namespace: String,
    /// The login's `auth_time`, ISO 8601 UTC.
    pub(crate) auth_time: String,
    pub(crate) acr: String,
    /// When the person decided, ISO 8601 UTC.
    pub(crate) at: String,
    /// The ids of the preview's items the person pulled out (the Ideas host-review
    /// specification, section 3); empty, and then absent, when there were none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) excluded: Vec<String>,
}

impl PersonMark {
    /// The mark on `context`, if a well-formed one is there.
    pub(crate) fn of(context: &CommandContext) -> Option<Self> {
        serde_json::from_value(context.extra.get(PERSON_DECISION_KEY)?.clone()).ok()
    }
}

/// `PERSON_VERIFICATION_UNAVAILABLE` (section 10.5): the call names a `verified` command and no
/// person can be proven for it here: no namespaced caller, no person login, or a login that
/// fails `auth.person` (7.1).
#[cfg_attr(not(any(feature = "auth", feature = "cli")), allow(dead_code))]
pub(crate) fn unavailable(command: &str, why: &str) -> CommandError {
    CommandError::new(
        crate::auth::PERSON_VERIFICATION_UNAVAILABLE,
        format!("'{command}' needs a person verified on the person page, and {why}"),
    )
    .with_suggestion(
        "A person-verified command needs a hosted workspace (auth.mode oauth or gateway), a caller in a namespace whose person login passes the doctor's auth.person, and at the CLI a namespaced principal.local_id. Ask the operator to fix the configuration; do not retry until then.",
    )
    .with_retryable(false)
}

/// The refusal of a call to a `verified` surface that no decision on the person page covers.
pub(crate) fn not_decided(command: &str) -> CommandError {
    CommandError::new(
        error_codes::CONFIRMATION_REQUIRED,
        format!("'{command}' must be decided by a person on the person page"),
    )
    .with_suggestion(
        "Call it on its own (over MCP from a client that supports URL-mode elicitation, or with the umbel command at a terminal) and have the person open the link it gives and decide there.",
    )
    .with_retryable(false)
}

/// `for` of a verified MCP caller (section 7.2, step 1): a namespaced agent acting for a
/// namespaced person, from a verified token or a gateway assertion, with the issuer (or the
/// gateway's) alias and the client id the credentials carry. A service has no person, and a
/// caller without credentials (stdio, the library) has none to bind.
pub(crate) fn for_of_mcp(context: &CommandContext) -> Result<DecisionFor, &'static str> {
    let principal = Principal::from_context(context).ok_or("no principal")?;
    if !matches!(
        principal.authentication,
        Authentication::Verified | Authentication::Gateway
    ) || principal.transport != Transport::Http
    {
        return Err("the caller is not a verified caller over HTTP");
    }
    let credentials = context.credentials.as_deref().ok_or("no credentials")?;
    let namespace = principal.namespace.clone().ok_or("no namespace")?;
    let issuer = principal.issuer.clone().ok_or("no issuer")?;
    if principal.actor.kind != ActorKind::Agent {
        return Err("the caller acts for no person");
    }
    let person = principal
        .actor
        .on_behalf_of
        .as_deref()
        .ok_or("the caller acts for no person")?;
    let subject = person
        .strip_prefix(&format!("{namespace}/"))
        .filter(|subject| !subject.is_empty())
        .ok_or("the person is not in the caller's namespace")?;
    if credentials.client_id.is_empty() {
        return Err("no client id");
    }
    Ok(DecisionFor {
        actor: ActorRef::of(&principal.actor),
        client_id: Some(credentials.client_id.clone()),
        issuer: Some(issuer),
        namespace,
        subject: subject.to_owned(),
    })
}

/// `for` of the person at the CLI (section 7.1): the operator's namespaced `principal.local_id`,
/// in a namespace with a person login, with `issuer` and `clientId` `null`.
pub(crate) fn for_of_cli(
    config: &Config,
    context: &CommandContext,
) -> Result<DecisionFor, &'static str> {
    if !crate::access::is_operator(context) {
        return Err("not the CLI's caller");
    }
    let principal = Principal::from_context(context).ok_or("no principal")?;
    if principal.actor.kind != ActorKind::Human {
        return Err("the CLI's caller is not a person");
    }
    let local = principal.actor.id.as_deref().ok_or("no local_id")?;
    let (namespace, subject) = local
        .split_once('/')
        .filter(|(namespace, subject)| !namespace.is_empty() && !subject.is_empty())
        .ok_or("principal.local_id is not namespaced")?;
    let declared = config
        .auth
        .namespaces
        .iter()
        .any(|declared| declared.id == namespace && declared.person.is_some());
    if !declared {
        return Err("principal.local_id's namespace has no person login");
    }
    Ok(DecisionFor {
        actor: ActorRef::of(&principal.actor),
        client_id: None,
        issuer: None,
        namespace: namespace.to_owned(),
        subject: subject.to_owned(),
    })
}

/// The person decision `context` carries for a run of `command` with the validated `input`, as
/// the host attests it to the plugin (`CallContext::person_decision`, step 6): the mark the relay
/// (or the CLI) set names this command, the surface the call came on and the digest of this
/// input, `humanPresent` says the same, and the person the caller acts for is in the mark's
/// namespace. The plugin gate has already admitted (and spent) the decision for this call; this
/// repeats its checks without the ledger, so that no other call (a command the handler runs in
/// process with the same context, another input) is told a person decided it.
pub(crate) fn attested(
    config: &Config,
    command: &str,
    input: &Value,
    context: &CommandContext,
) -> Option<umbel_sdk::PersonDecision> {
    let mark = PersonMark::of(context)?;
    let (surface, interface) = match mark.surface {
        Surface::Mcp => ("mcp", CommandInterface::Mcp),
        Surface::Cli => ("cli", CommandInterface::Cli),
    };
    let digest = afd::input_digest(input).ok()?;
    if mark.command != command
        || context.interface != Some(interface)
        || mark.input_digest != digest
        || mark.level != "verified"
        || mark.method != "person-page"
    {
        return None;
    }
    let present = Principal::from_context(context)
        .and_then(|principal| principal.human_present)
        .is_some_and(|present| present.level == "verified" && present.method == "person-page");
    if !present {
        return None;
    }
    let who = match mark.surface {
        Surface::Mcp => for_of_mcp(context),
        Surface::Cli => for_of_cli(config, context),
    }
    .ok()?;
    if who.namespace != mark.namespace {
        return None;
    }
    Some(umbel_sdk::PersonDecision {
        surface: surface.to_owned(),
        person: format!("{}/{}", who.namespace, who.subject),
        namespace: mark.namespace,
        auth_time: mark.auth_time,
        acr: mark.acr,
        level: mark.level,
        excluded: mark.excluded,
    })
}

/// The proof the plugin gate's person gate accepted for this run of `command` with the validated
/// `input`, as the assurance a standing fact records (the records host specification, section
/// 6.1, check 2; D115, D161): `None` when the call carries none. `person` is the least assurance
/// the command's manifest names for each surface.
///
/// It has the person gate's own arms (`middleware::person_gate`), with [`attested`] in place of
/// [`admit`]: the same checks, without spending the decision again, which the gate did for this
/// call before the handler ran, and at a terminal one check more than the gate makes. So it
/// answers by surface and never by what a call says of itself:
///
/// - at the CLI, for a command whose `person.cli` is `verified`: a decision on the person page
///   for this command, this surface and the digest of this input, by the person the caller is;
/// - at the CLI otherwise: the mark the CLI set after its prompt was answered, naming this
///   command, **and** the CLI's human-present mark naming it (`authority::cli_mark`), which
///   the CLI withholds when an agent variable is set. Standing is at least as strict as
///   memory's `person` (D86): a process at a terminal that carries an agent variable passes
///   the plugin gate and still has no proof;
/// - over MCP, for a command whose `person.mcp` is `verified`: a decision on the person page, as
///   at the CLI;
/// - anywhere else (a batch, an in-process agent, the library, a surface the command names no
///   assurance for): nothing. The terminal mark never stands in for `verified`.
///
/// Both marks are host-owned context fields: the CLI's single-command path and the relay set
/// them, the context hook clears them on every MCP call, and `umbel batch` drops a request's
/// context. A mark names one command, so a call made under another command's context (a
/// pipeline's step, a command a handler runs in process) carries none for its own name, and a
/// decision's mark names one input, so the same command with another input carries none either.
///
/// Only the caller decides which command and input it asks about: the host asks for the command
/// it is running and the input it validated (`Services::build`), and gives a call that names no
/// command no proof at all.
pub(crate) fn gate_proof(
    config: &Config,
    command: &str,
    person: crate::plugins::PersonDecl,
    input: &Value,
    context: &CommandContext,
) -> Option<umbel_store::Assurance> {
    use crate::plugins::Assurance as Level;
    let verified = |surface: &str| {
        attested(config, command, input, context)
            .filter(|decision| decision.surface == surface)
            .map(|decision| {
                umbel_store::Assurance::verified(
                    &decision.namespace,
                    &decision.auth_time,
                    &decision.acr,
                )
            })
    };
    match context.interface {
        Some(CommandInterface::Cli) if person.cli == Level::Verified => verified("cli"),
        Some(CommandInterface::Cli) => (crate::middleware::confirmed_by_a_person(command, context)
            && crate::authority::cli_mark(context) == Some(command))
        .then(umbel_store::Assurance::terminal),
        Some(CommandInterface::Mcp) if person.mcp == Some(Level::Verified) => verified("mcp"),
        _ => None,
    }
}

/// The call a person is about to be asked to decide, when this run of `command` is that call's
/// preview run by the host before begin ([`PERSON_CHECK_KEY`]); `None` otherwise.
pub(crate) fn check_of(command: &str, context: &CommandContext) -> Option<umbel_sdk::PersonCheck> {
    let value = context.extra.get(PERSON_CHECK_KEY)?;
    let preview = value.get("preview").and_then(Value::as_str)?;
    let gated = value.get("command").and_then(Value::as_str)?;
    let surface = value
        .get("surface")
        .and_then(Value::as_str)
        .filter(|surface| matches!(*surface, "mcp" | "cli"))?;
    (preview == command && !gated.is_empty()).then(|| umbel_sdk::PersonCheck {
        command: gated.to_owned(),
        surface: surface.to_owned(),
    })
}

/// The page of its preview the person page asks `command` for, when this run is that page's
/// rendering ([`PREVIEW_PAGE_KEY`]): `Some(n)` from 1; `None` otherwise, where the preview answers
/// exactly `{ preview }`.
pub(crate) fn page_of(command: &str, context: &CommandContext) -> Option<u32> {
    let value = context.extra.get(PREVIEW_PAGE_KEY)?;
    let preview = value.get("preview").and_then(Value::as_str)?;
    let page = value.get("page").and_then(Value::as_u64)?;
    let page = u32::try_from(page).ok().filter(|page| *page >= 1)?;
    (preview == command).then_some(page)
}

/// What the plugin gate asks of the shared stores for a person-decided call: the decision, read
/// back, is approved, for `who`, for `command` with `input_digest`; and it is spent for this run
/// (`person-run:<id>`), once.
pub(crate) trait DecisionLedger: Send + Sync {
    /// # Errors
    /// [`not_decided`] when the decision does not cover the call or was already run, or the
    /// shared store's failure.
    fn admit(
        &self,
        mark: &PersonMark,
        who: &DecisionFor,
        command: &str,
        input_digest: &str,
    ) -> Result<(), CommandError>;
}

/// The plugin gate's check of a `verified` surface (section 7.2, step 5): the call carries a mark
/// for this command, surface and validated input, on a caller whose `for` the decision names, and
/// the ledger admits it once. `None` for `ledger` (a build without the `auth` feature, or mode
/// `none`) admits nothing.
pub(crate) fn admit(
    config: &Config,
    command: &str,
    input: &Value,
    context: &CommandContext,
    surface: Surface,
    ledger: Option<&dyn DecisionLedger>,
) -> Result<(), CommandError> {
    let refuse = || not_decided(command);
    let interface = match surface {
        Surface::Mcp => CommandInterface::Mcp,
        Surface::Cli => CommandInterface::Cli,
    };
    if context.interface != Some(interface) {
        return Err(refuse());
    }
    let Some(mark) = PersonMark::of(context) else {
        return Err(refuse());
    };
    let digest = afd::input_digest(input).map_err(|_| refuse())?;
    if mark.command != command
        || mark.surface != surface
        || mark.input_digest != digest
        || mark.level != "verified"
        || mark.method != "person-page"
    {
        return Err(refuse());
    }
    let present = Principal::from_context(context)
        .and_then(|principal| principal.human_present)
        .is_some_and(|present| present.level == "verified" && present.method == "person-page");
    if !present {
        return Err(refuse());
    }
    let who = match surface {
        Surface::Mcp => for_of_mcp(context),
        Surface::Cli => for_of_cli(config, context),
    }
    .map_err(|_| refuse())?;
    if who.namespace != mark.namespace {
        return Err(refuse());
    }
    match ledger {
        Some(ledger) => ledger.admit(&mark, &who, command, &digest),
        None => Err(refuse()),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use afd::{Actor, Credentials};
    use std::sync::Mutex;

    /// A ledger that admits what it is told and records what it was asked.
    struct Fake {
        admit: bool,
        asked: Mutex<Vec<(DecisionFor, String, String)>>,
    }

    impl DecisionLedger for Fake {
        fn admit(
            &self,
            _mark: &PersonMark,
            who: &DecisionFor,
            command: &str,
            input_digest: &str,
        ) -> Result<(), CommandError> {
            self.asked.lock().unwrap().push((
                who.clone(),
                command.to_owned(),
                input_digest.to_owned(),
            ));
            if self.admit {
                Ok(())
            } else {
                Err(not_decided(command))
            }
        }
    }

    fn config() -> Config {
        crate::workspace::ConfigFile::parse("config_version = 5\n")
            .and_then(|file| file.into_config(std::path::Path::new("/w")))
            .expect("a valid configuration")
    }

    fn input() -> Value {
        serde_json::json!({ "proposal": "p-1" })
    }

    /// An MCP context of a verified agent `corp/client` acting for `corp/ada`, decided for
    /// `command` with `input`'s digest, with `humanPresent` when `present`.
    fn context(command: &str, input: &Value, present: bool) -> CommandContext {
        let mut context = CommandContext::new();
        context.interface = Some(CommandInterface::Mcp);
        context.credentials = Some(std::sync::Arc::new(Credentials::new(
            "https://as.example.com",
            "ada",
            "client",
            "https://umbel.example.com/mcp",
            0,
            60,
        )));
        let mut principal = Principal::new(
            Actor::new(ActorKind::Agent)
                .with_id("corp/client")
                .with_on_behalf_of("corp/ada"),
            Transport::Http,
            Authentication::Verified,
        );
        principal.namespace = Some("corp".into());
        principal.issuer = Some("as".into());
        if present {
            principal.human_present = Some(crate::principal::HumanPresent {
                level: "verified".into(),
                method: "person-page".into(),
                at: "2026-11-08T00:00:00.000Z".into(),
                auth_time: Some("2026-11-08T00:00:00.000Z".into()),
                acr: Some("phr".into()),
            });
        }
        principal.apply(&mut context);
        let mark = PersonMark {
            id: "a".repeat(26),
            command: command.into(),
            input_digest: afd::input_digest(input).unwrap(),
            surface: Surface::Mcp,
            level: "verified".into(),
            method: "person-page".into(),
            namespace: "corp".into(),
            auth_time: "2026-11-08T00:00:00.000Z".into(),
            acr: "phr".into(),
            at: "2026-11-08T00:00:00.000Z".into(),
            excluded: Vec::new(),
        };
        context.extra.insert(
            PERSON_DECISION_KEY.to_owned(),
            serde_json::to_value(mark).unwrap(),
        );
        context
    }

    fn fake(admit: bool) -> Fake {
        Fake {
            admit,
            asked: Mutex::new(Vec::new()),
        }
    }

    #[test]
    fn a_mark_admits_only_its_command_input_surface_and_caller_once_the_ledger_agrees() {
        let config = config();
        let ledger = fake(true);
        let admitted = |context: &CommandContext, command: &str, input: &Value, surface| {
            admit(&config, command, input, context, surface, Some(&ledger)).is_ok()
        };
        let good = context("gate-approve", &input(), true);
        assert!(admitted(&good, "gate-approve", &input(), Surface::Mcp));
        let asked = ledger.asked.lock().unwrap().pop().unwrap();
        assert_eq!(asked.0.subject, "ada");
        assert_eq!(asked.0.client_id.as_deref(), Some("client"));
        // Another command, another input, another surface: refused before the ledger.
        assert!(!admitted(&good, "gate-reject", &input(), Surface::Mcp));
        assert!(!admitted(
            &good,
            "gate-approve",
            &serde_json::json!({ "proposal": "p-2" }),
            Surface::Mcp
        ));
        assert!(!admitted(&good, "gate-approve", &input(), Surface::Cli));
        // No humanPresent, no mark, or the CLI interface: refused.
        assert!(!admitted(
            &context("gate-approve", &input(), false),
            "gate-approve",
            &input(),
            Surface::Mcp
        ));
        let mut unmarked = good.clone();
        unmarked.extra.remove(PERSON_DECISION_KEY);
        assert!(!admitted(&unmarked, "gate-approve", &input(), Surface::Mcp));
        let mut cli = good.clone();
        cli.interface = Some(CommandInterface::Cli);
        assert!(!admitted(&cli, "gate-approve", &input(), Surface::Mcp));
        assert!(ledger.asked.lock().unwrap().is_empty());
        // A ledger that refuses (another for, not approved, already run), or none: refused.
        let refusing = fake(false);
        assert!(
            admit(
                &config,
                "gate-approve",
                &input(),
                &good,
                Surface::Mcp,
                Some(&refusing)
            )
            .is_err()
        );
        assert!(admit(&config, "gate-approve", &input(), &good, Surface::Mcp, None).is_err());
    }

    #[test]
    fn the_plugin_is_told_of_a_decision_for_its_own_call_only() {
        let config = config();
        let good = context("gate-approve", &input(), true);
        let decided = attested(&config, "gate-approve", &input(), &good).unwrap();
        assert_eq!(decided.person, "corp/ada");
        assert_eq!(decided.surface, "mcp");
        assert_eq!(decided.namespace, "corp");
        assert_eq!(decided.acr, "phr");
        assert_eq!(decided.auth_time, "2026-11-08T00:00:00.000Z");
        // Another command (one the handler runs in process with the same context), another
        // input, no humanPresent, another interface or no mark: not told.
        assert!(attested(&config, "gate-reject", &input(), &good).is_none());
        assert!(
            attested(
                &config,
                "gate-approve",
                &serde_json::json!({ "proposal": "p-2" }),
                &good
            )
            .is_none()
        );
        let absent = context("gate-approve", &input(), false);
        assert!(attested(&config, "gate-approve", &input(), &absent).is_none());
        let mut cli = good.clone();
        cli.interface = Some(CommandInterface::Cli);
        assert!(attested(&config, "gate-approve", &input(), &cli).is_none());
        let mut unmarked = good.clone();
        unmarked.extra.remove(PERSON_DECISION_KEY);
        assert!(attested(&config, "gate-approve", &input(), &unmarked).is_none());
        // A mark of another namespace than the person the caller acts for.
        let mut elsewhere = good.clone();
        let mut mark = PersonMark::of(&good).unwrap();
        mark.namespace = "else".into();
        elsewhere.extra.insert(
            PERSON_DECISION_KEY.to_owned(),
            serde_json::to_value(mark).unwrap(),
        );
        assert!(attested(&config, "gate-approve", &input(), &elsewhere).is_none());
    }

    /// The records host specification, section 6.1, check 2: the proof a standing fact is
    /// written under is the one the person gate accepted for this command, on this surface, for
    /// this input, by this caller. Every other call gets none.
    #[test]
    fn the_gate_proof_is_for_this_command_surface_input_and_caller() {
        use crate::plugins::{Assurance as Level, PersonDecl};
        let config = config();
        let terminal = PersonDecl::default();
        let over_mcp = PersonDecl {
            mcp: Some(Level::Verified),
            ..terminal
        };
        let at_page = PersonDecl {
            cli: Level::Verified,
            ..terminal
        };
        let proof = |command: &str, person: PersonDecl, input: &Value, context: &CommandContext| {
            gate_proof(&config, command, person, input, context)
        };

        // Over MCP: a decision on the person page for this very call.
        let good = context("notes-review", &input(), true);
        let assurance = proof("notes-review", over_mcp, &input(), &good).unwrap();
        assert_eq!(
            assurance,
            umbel_store::Assurance::verified("corp", "2026-11-08T00:00:00.000Z", "phr")
        );
        assert!(assurance.is_valid(3));
        // A decision for another command: one the handler runs in process, or a pipeline's
        // step, under the decided call's context.
        assert!(proof("notes-capture", over_mcp, &input(), &good).is_none());
        // For another input.
        let other = serde_json::json!({ "proposal": "p-2" });
        assert!(proof("notes-review", over_mcp, &other, &good).is_none());
        // For another person: a mark of a namespace the caller is not in, and a caller with no
        // person behind it.
        let mut elsewhere = good.clone();
        let mut mark = PersonMark::of(&good).unwrap();
        mark.namespace = "else".into();
        elsewhere.extra.insert(
            PERSON_DECISION_KEY.to_owned(),
            serde_json::to_value(mark).unwrap(),
        );
        assert!(proof("notes-review", over_mcp, &input(), &elsewhere).is_none());
        let mut service = good.clone();
        let mut principal = Principal::from_context(&good).unwrap();
        principal.actor = Actor::new(ActorKind::Service).with_id("corp/sync");
        principal.apply(&mut service);
        assert!(proof("notes-review", over_mcp, &input(), &service).is_none());
        // Without `humanPresent`, without the mark, or with a mark that is not the page's.
        let absent = context("notes-review", &input(), false);
        assert!(proof("notes-review", over_mcp, &input(), &absent).is_none());
        let mut unmarked = good.clone();
        unmarked.extra.remove(PERSON_DECISION_KEY);
        assert!(proof("notes-review", over_mcp, &input(), &unmarked).is_none());
        let mut forged = good.clone();
        forged.extra.insert(
            PERSON_DECISION_KEY.to_owned(),
            serde_json::json!({ "command": "notes-review", "level": "verified" }),
        );
        assert!(proof("notes-review", over_mcp, &input(), &forged).is_none());
        // A command that names no assurance over MCP takes none there, whatever the call
        // carries; nor does a decision made for MCP stand at the CLI, or the other way.
        assert!(proof("notes-review", terminal, &input(), &good).is_none());
        assert!(proof("notes-review", at_page, &input(), &good).is_none());
        let mut moved = good.clone();
        moved.interface = Some(CommandInterface::Cli);
        assert!(proof("notes-review", at_page, &input(), &moved).is_none());
        assert!(proof("notes-review", over_mcp, &input(), &moved).is_none());

        // At a terminal: the mark the CLI set after its prompt, naming this command.
        // What the CLI sets for a person at a terminal who answered the prompt of `confirmed`:
        // the confirmed mark and the human-present mark, both naming the command it ran.
        let cli = |confirmed: Option<&str>| {
            let mut context = CommandContext::new();
            context.interface = Some(CommandInterface::Cli);
            Principal::new(
                Actor::new(ActorKind::Human).with_id("local"),
                Transport::Cli,
                Authentication::Process,
            )
            .apply(&mut context);
            if let Some(confirmed) = confirmed {
                context.extra.insert(
                    crate::middleware::HUMAN_CONFIRMED_KEY.to_owned(),
                    Value::from(confirmed),
                );
                context.extra.insert(
                    crate::authority::HUMAN_PRESENT_KEY.to_owned(),
                    Value::from(confirmed),
                );
            }
            context
        };
        let confirmed = cli(Some("notes-review"));
        assert_eq!(
            proof("notes-review", terminal, &input(), &confirmed),
            Some(umbel_store::Assurance::terminal())
        );
        // The terminal's mark is not bound to an input: one confirmation is one command.
        assert!(proof("notes-review", terminal, &other, &confirmed).is_some());
        // No mark; a mark naming another command, as a pipeline's step runs under its
        // pipeline's; and a mark that is not a command's name.
        assert!(proof("notes-review", terminal, &input(), &cli(None)).is_none());
        assert!(proof("notes-review", terminal, &input(), &cli(Some("notes-pipe"))).is_none());
        let mut truthy = cli(None);
        truthy.extra.insert(
            crate::middleware::HUMAN_CONFIRMED_KEY.to_owned(),
            Value::Bool(true),
        );
        assert!(proof("notes-review", terminal, &input(), &truthy).is_none());
        // An agent variable: the CLI asks and marks the confirmation, and withholds the
        // human-present mark. The plugin gate passes such a call; it carries no proof.
        let mut agent_variable = confirmed.clone();
        agent_variable
            .extra
            .remove(crate::authority::HUMAN_PRESENT_KEY);
        assert!(proof("notes-review", terminal, &input(), &agent_variable).is_none());
        // Nor does a human-present mark for another command, a caller that is not a human, or
        // one that did not come through the CLI's own transport.
        let mut elsewhere_present = confirmed.clone();
        elsewhere_present.extra.insert(
            crate::authority::HUMAN_PRESENT_KEY.to_owned(),
            Value::from("notes-pipe"),
        );
        assert!(proof("notes-review", terminal, &input(), &elsewhere_present).is_none());
        for (kind, transport) in [
            (ActorKind::Agent, Transport::Cli),
            (ActorKind::Human, Transport::Library),
        ] {
            let mut other = confirmed.clone();
            let authentication = if transport == Transport::Cli {
                Authentication::Process
            } else {
                Authentication::Embedder
            };
            Principal::new(Actor::new(kind).with_id("local"), transport, authentication)
                .apply(&mut other);
            assert!(proof("notes-review", terminal, &input(), &other).is_none());
        }
        // The terminal mark never stands in for `verified`, at the CLI or over MCP.
        assert!(proof("notes-review", at_page, &input(), &confirmed).is_none());
        let mut over = confirmed.clone();
        over.interface = Some(CommandInterface::Mcp);
        assert!(proof("notes-review", over_mcp, &input(), &over).is_none());
        assert!(proof("notes-review", terminal, &input(), &over).is_none());
        // Anything that is neither the CLI nor MCP (a batch, an in-process agent, the library)
        // has no proof, whatever marks it carries.
        for interface in [None, Some(CommandInterface::Agent)] {
            let mut context = confirmed.clone();
            context.interface = interface;
            for person in [terminal, at_page, over_mcp] {
                assert!(proof("notes-review", person, &input(), &context).is_none());
            }
            let mut decided = good.clone();
            decided.interface = interface;
            for person in [terminal, at_page, over_mcp] {
                assert!(proof("notes-review", person, &input(), &decided).is_none());
            }
        }
    }

    #[test]
    fn the_page_asked_for_is_named_only_to_the_preview_it_runs() {
        let mut context = CommandContext::new();
        assert!(page_of("gate-preview", &context).is_none());
        context.extra.insert(
            PREVIEW_PAGE_KEY.to_owned(),
            serde_json::json!({ "preview": "gate-preview", "page": 3 }),
        );
        assert_eq!(page_of("gate-preview", &context), Some(3));
        assert!(page_of("gate-approve", &context).is_none());
        for value in [
            serde_json::json!({ "preview": "gate-preview", "page": 0 }),
            serde_json::json!({ "preview": "gate-preview", "page": "2" }),
            Value::Null,
        ] {
            context.extra.insert(PREVIEW_PAGE_KEY.to_owned(), value);
            assert!(page_of("gate-preview", &context).is_none());
        }
    }

    #[test]
    fn the_hosts_check_is_named_only_to_the_preview_it_runs() {
        let mut context = CommandContext::new();
        assert!(check_of("gate-preview", &context).is_none());
        context.extra.insert(
            PERSON_CHECK_KEY.to_owned(),
            serde_json::json!({ "command": "gate-approve", "preview": "gate-preview", "surface": "mcp" }),
        );
        let check = check_of("gate-preview", &context).unwrap();
        assert_eq!(check.command, "gate-approve");
        assert_eq!(check.surface, "mcp");
        // Any other command run with the context, or a surface that is not one: none.
        assert!(check_of("gate-approve", &context).is_none());
        context.extra.insert(
            PERSON_CHECK_KEY.to_owned(),
            serde_json::json!({ "command": "gate-approve", "preview": "gate-preview", "surface": "web" }),
        );
        assert!(check_of("gate-preview", &context).is_none());
        context
            .extra
            .insert(PERSON_CHECK_KEY.to_owned(), Value::Null);
        assert!(check_of("gate-preview", &context).is_none());
    }

    #[test]
    fn a_service_or_a_caller_without_credentials_has_no_person() {
        let mut service = context("gate-approve", &input(), true);
        let mut principal = Principal::from_context(&service).unwrap();
        principal.actor = Actor::new(ActorKind::Service).with_id("corp/bot");
        principal.apply(&mut service);
        assert!(for_of_mcp(&service).is_err());
        let mut bare = context("gate-approve", &input(), true);
        bare.credentials = None;
        assert!(for_of_mcp(&bare).is_err());
        // A person outside the caller's namespace.
        let mut other = context("gate-approve", &input(), true);
        let mut principal = Principal::from_context(&other).unwrap();
        principal.actor = Actor::new(ActorKind::Agent)
            .with_id("corp/client")
            .with_on_behalf_of("else/ada");
        principal.apply(&mut other);
        assert!(for_of_mcp(&other).is_err());
    }
}
