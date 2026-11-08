//! Who may read a space and what: the reader filter the host builds for every store read
//! (phase 2 specification, section 6, D53).
//!
//! The effective principal of a call is the person behind it when there is one, else the actor
//! (`provenance::effective_principal`). It must match an entry of the space's `readers` or the
//! call fails before the handler with `SPACE_NOT_READABLE`; otherwise its tokens are `space`,
//! `principal:<effective>` and `group:<g>` for every group that holds it. Before phase 5 nothing
//! verifies who a stdio or loopback caller is, so filtering is exact only for embedders and
//! tests (owner decision 1 of 2026-11-01): the README and `workspace-show` say so.
//!
//! Phase 5 adds two things every comparison here consults (sections 4.5 and 4.6):
//!
//! - **Equivalents.** A principal also stands for every legacy principal string
//!   `[principal.equivalents]` maps to it, one way: it matches their `readers` and group
//!   `members` entries, and its filter gains their `principal:` tokens. A legacy principal gains
//!   nothing from its namespaced one.
//! - **Claim groups.** A verified caller is a member of the groups its token's claims name
//!   ([`CLAIM_GROUPS_KEY`]), beside the static `members`, for that request only.

use afd::{CommandContext, CommandError};
use umbel_store::ReaderFilter;

use crate::auth::Scope;
use crate::principal::{CLAIM_GROUPS_KEY, Principal};
use crate::provenance::effective_principal;
use crate::workspace::{Config, ReaderEntry, SpaceConfig};

/// `SPACE_NOT_READABLE`: the caller's principal matches no entry of the space's `readers`.
pub const SPACE_NOT_READABLE: &str = "SPACE_NOT_READABLE";

/// The effective principal string of a call, or `None` for a call with no principal the host set
/// (a bare `registry.execute`), an actor with no id, or a test actor. Such a caller is
/// anonymous: it matches `readers = ["*"]` and the groups whose members include `*`, and
/// nothing else.
#[must_use]
pub fn effective_principal_of(context: &CommandContext) -> Option<String> {
    let principal = Principal::from_context(context)?;
    effective_principal(&principal.actor)
}

/// The `[access.groups]` a verified caller's token makes it a member of, as the context hook set
/// them; empty for every other caller.
#[must_use]
pub fn claim_groups_of(context: &CommandContext) -> Vec<String> {
    context
        .extra
        .get(CLAIM_GROUPS_KEY)
        .and_then(serde_json::Value::as_array)
        .map(|groups| {
            groups
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The claim groups of a read made for `context`'s caller, or for another principal
/// (`reading_as_other`, a plugin's `as_reader`), which a token's claims never name: none.
#[must_use]
pub fn claim_groups_reading(context: &CommandContext, reading_as_other: bool) -> Vec<String> {
    if reading_as_other {
        Vec::new()
    } else {
        claim_groups_of(context)
    }
}

/// The principal strings `principal` stands for (section 4.6): itself, then every legacy
/// principal `[principal.equivalents]` maps to it. Empty for an anonymous caller.
#[must_use]
pub fn identities(config: &Config, principal: Option<&str>) -> Vec<String> {
    let Some(principal) = principal else {
        return Vec::new();
    };
    let mut identities = vec![principal.to_owned()];
    identities.extend(
        config
            .principal
            .equivalents
            .iter()
            .filter(|(_, target)| target.as_str() == principal)
            .map(|(legacy, _)| legacy.clone()),
    );
    identities
}

fn group_holds(
    config: &Config,
    group: &str,
    identities: &[String],
    claim_groups: &[String],
) -> bool {
    claim_groups.iter().any(|claimed| claimed == group)
        || config
            .access
            .groups
            .iter()
            .find(|candidate| candidate.id == group)
            .is_some_and(|group| {
                group
                    .members
                    .iter()
                    .any(|member| member == "*" || identities.contains(member))
            })
}

/// Whether `principal`, with the claim groups of its token, may read the space `space` by its
/// `readers`: it, or a legacy principal it stands for, matches an entry. No token narrows this
/// answer; [`Caller::reads`] adds the narrowing.
#[must_use]
pub fn may_read_space(
    config: &Config,
    space: &SpaceConfig,
    principal: Option<&str>,
    claim_groups: &[String],
) -> bool {
    readers_admit(config, space, &identities(config, principal), claim_groups)
}

fn readers_admit(
    config: &Config,
    space: &SpaceConfig,
    identities: &[String],
    claim_groups: &[String],
) -> bool {
    space
        .readers
        .iter()
        .filter_map(|entry| ReaderEntry::parse(entry).ok())
        .any(|entry| match entry {
            ReaderEntry::Anyone => true,
            ReaderEntry::Principal(text) => identities.contains(&text),
            ReaderEntry::Group(group) => group_holds(config, &group, identities, claim_groups),
        })
}

/// `SPACE_NOT_READABLE` for `space`, as mode `none` and the operator get it: the space is named.
/// A hosted caller who is not the operator gets [`space_unavailable`] instead, which names
/// nothing (phase 5 section 5.4).
#[must_use]
pub fn not_readable(space: &str) -> CommandError {
    CommandError::new(
        SPACE_NOT_READABLE,
        format!("The caller may not read the space `{space}`"),
    )
    .with_suggestion(
        "Ask the deployer to add your principal or one of your groups to the space's readers in umbel.toml, or use a space you may read.",
    )
    .with_retryable(false)
}

/// The message of section 5.4's one answer.
pub const SPACE_UNAVAILABLE_MESSAGE: &str = "The space does not exist or you may not read it";

/// Section 5.4's one answer, for an undeclared space and for one the caller may not read (by
/// `readers`) or that its token grants no verb in, alike: `SPACE_NOT_READABLE` with one fixed
/// message and suggestion, no space named (the caller may not even have named it: the default
/// space is resolved for it) and no details, so the two can be told apart by nothing. Every hosted
/// caller but the operator gets it, on every surface.
#[must_use]
pub fn space_unavailable() -> CommandError {
    CommandError::new(SPACE_NOT_READABLE, SPACE_UNAVAILABLE_MESSAGE)
        .with_suggestion(
            "Call space-list for the spaces you may read; to read another, ask the deployer for access, and for a token that grants it.",
        )
        .with_retryable(false)
}

/// Whether `context` is the operator's: the CLI, with the CLI interface, transport `cli` and
/// authentication `process` (phase 5 section 4.7, owner decision 17), as the CLI's marks need
/// them (`authority::cli_mark`). Nothing else is: not stdio, not the library, not a verified
/// caller whose person is the operator.
#[must_use]
pub fn is_operator(context: &CommandContext) -> bool {
    use crate::principal::{Authentication, Transport};
    context.interface == Some(afd::CommandInterface::Cli)
        && Principal::from_context(context).is_some_and(|principal| {
            principal.transport == Transport::Cli
                && principal.authentication == Authentication::Process
        })
}

/// What narrows a caller to some spaces (phase 5 sections 4.3 and 5.3): nothing, or the Umbel
/// scopes of its token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Narrowing {
    /// No token: the CLI, stdio, the library, a loopback caller. Nothing narrows.
    None,
    /// The Umbel scopes of a verified token (5.1), under the configured prefix; the others are
    /// ignored. A space is granted when some scope implies `read` there.
    Token(Vec<Scope>),
}

impl Narrowing {
    /// Whether this narrowing leaves `space` open: always without a token; with one, when a
    /// scope implies `read:<space>` (5.1: every verb on a space implies `read` there, and an
    /// unqualified verb implies it on every space).
    #[must_use]
    pub fn grants(&self, space: &str) -> bool {
        match self {
            Self::None => true,
            Self::Token(scopes) => crate::auth::scopes::grants_a_verb(scopes, space),
        }
    }

    /// The Umbel scopes of a token, `None` without one.
    #[must_use]
    pub fn scopes(&self) -> Option<&[Scope]> {
        match self {
            Self::None => None,
            Self::Token(scopes) => Some(scopes),
        }
    }
}

/// Who a call reads as, for every reader filter the host builds (phase 5 section 5.4,
/// `reader_filter(config, space, &Caller)`): the effective principal and every legacy principal
/// it stands for (4.6), the groups its token's claims make it a member of (4.5), what its token
/// narrows it to (5.3), and whether it is the operator (4.7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    /// The effective principal; `None` for an anonymous caller.
    principal: Option<String>,
    /// The principal, then the legacy principals `[principal.equivalents]` maps to it.
    identities: Vec<String>,
    /// The claim groups of the caller's own token; none when reading as another principal.
    claim_groups: Vec<String>,
    /// What the token narrows the caller to.
    narrowing: Narrowing,
    /// The token's scopes as sent, from the same source as `narrowing`, for static `scopes`.
    scope_text: Vec<String>,
    /// Whether the call is the operator's (the CLI).
    operator: bool,
    /// Whether the workspace is hosted (`auth.mode` not `none`).
    hosted: bool,
    /// Whether the call's authentication is `process` (stdio and the CLI), which keeps version 0
    /// cursors and plain positions (phase 5 section 9.3).
    process: bool,
    /// Who positions are sealed for: the actor, and the person it acts for.
    identity: String,
}

impl Caller {
    /// The caller of `context`: its effective principal and claim groups as the surface set them,
    /// narrowed by the Umbel scopes of its token. A principal the hook made from a verified token
    /// or a gateway assertion carries them in `scopes` (`None` there narrows to nothing); any other
    /// call that still carries AFD's admitted credentials is narrowed by those; anything else is
    /// not narrowed.
    #[must_use]
    pub fn of(config: &Config, context: &CommandContext) -> Self {
        use crate::principal::Authentication;
        let prefix = config.auth.scope_prefix.as_str();
        let principal = Principal::from_context(context);
        let parse = |scopes: &[String]| -> Vec<Scope> {
            scopes
                .iter()
                .filter_map(|scope| Scope::parse(prefix, scope))
                .collect()
        };
        let (narrowing, scope_text) = match &principal {
            Some(p)
                if matches!(
                    p.authentication,
                    Authentication::Verified | Authentication::Gateway
                ) =>
            {
                let text = p.scopes.clone().unwrap_or_default();
                (Narrowing::Token(parse(&text)), text)
            }
            _ => match context.credentials.as_deref() {
                Some(credentials) => (
                    Narrowing::Token(parse(&credentials.scopes)),
                    credentials.scopes.clone(),
                ),
                None => (Narrowing::None, Vec::new()),
            },
        };
        let process = principal
            .as_ref()
            .is_some_and(|p| p.authentication == Authentication::Process);
        let identity = principal
            .as_ref()
            .map(|p| position_identity(&p.actor))
            .unwrap_or_default();
        let effective = principal.and_then(|p| effective_principal(&p.actor));
        let mut caller = Self::new(
            config,
            effective,
            claim_groups_of(context),
            narrowing,
            is_operator(context),
        );
        caller.scope_text = scope_text;
        caller.process = process;
        caller.identity = identity;
        caller
    }

    /// A caller from its parts.
    #[must_use]
    pub fn new(
        config: &Config,
        principal: Option<String>,
        claim_groups: Vec<String>,
        narrowing: Narrowing,
        operator: bool,
    ) -> Self {
        Self {
            identities: identities(config, principal.as_deref()),
            principal,
            claim_groups,
            narrowing,
            scope_text: Vec::new(),
            operator,
            hosted: config.auth.mode.is_hosted(),
            process: false,
            identity: String::new(),
        }
    }

    /// This caller reading as `principal` (a plugin's `as_reader`): that principal and its
    /// equivalents, no claim groups (a token's claims name only its own holder), and this call's
    /// narrowing and standing, so a read as another principal is never wider than this call.
    #[must_use]
    pub fn reading_as(&self, config: &Config, principal: Option<String>) -> Self {
        Self {
            identities: identities(config, principal.as_deref()),
            principal,
            claim_groups: Vec::new(),
            narrowing: self.narrowing.clone(),
            scope_text: self.scope_text.clone(),
            operator: self.operator,
            hosted: self.hosted,
            process: self.process,
            identity: self.identity.clone(),
        }
    }

    /// The effective principal.
    #[must_use]
    pub fn principal(&self) -> Option<&str> {
        self.principal.as_deref()
    }

    /// The claim groups.
    #[must_use]
    pub fn claim_groups(&self) -> &[String] {
        &self.claim_groups
    }

    /// What the token narrows the caller to.
    #[must_use]
    pub fn narrowing(&self) -> &Narrowing {
        &self.narrowing
    }

    /// The token's scopes as sent (empty without a token), from the source of
    /// [`Self::narrowing`].
    #[must_use]
    pub fn scope_text(&self) -> &[String] {
        &self.scope_text
    }

    /// Whether the caller is the operator.
    #[must_use]
    pub fn is_operator(&self) -> bool {
        self.operator
    }

    /// Whether this caller gets section 5.4's one answer: a hosted caller who is not the
    /// operator. The operator, and every caller in mode `none` (phases 2 to 4, kept unchanged
    /// locally by section 14's point 10), keep `SPACE_NOT_FOUND` and the named
    /// `SPACE_NOT_READABLE`.
    #[must_use]
    pub fn gets_one_answer(&self) -> bool {
        self.hosted && !self.operator
    }

    /// Whether this caller sees positions sealed (phase 5 sections 9 and 9.3): a hosted caller
    /// that is neither the operator nor a `process` caller (stdio), so the library and every
    /// HTTP caller, as `workspace-show`'s `exact` says. Mode `none`, the operator and stdio keep
    /// plain positions and version 0 cursors (section 14's point 10).
    #[must_use]
    pub fn seals_positions(&self) -> bool {
        self.hosted && !self.operator && !self.process
    }

    /// Who this caller's positions are sealed for: its actor's kind and id and the person it acts
    /// for, so a token opens for nobody else.
    #[must_use]
    pub fn position_identity(&self) -> &str {
        &self.identity
    }

    /// Whether the caller may read `space` by its `readers` (with equivalents and claim groups),
    /// and its token, if any, grants a verb there. A scope never makes an unreadable space
    /// readable (5.3).
    #[must_use]
    pub fn reads(&self, config: &Config, space: &SpaceConfig) -> bool {
        self.narrowing.grants(space.id.as_str())
            && readers_admit(config, space, &self.identities, &self.claim_groups)
    }

    /// The refusal of `space` for this caller: section 5.4's one answer, or the named
    /// `SPACE_NOT_READABLE` of mode `none` and the operator.
    #[must_use]
    pub fn refusal(&self, space: &str) -> CommandError {
        if self.gets_one_answer() {
            space_unavailable()
        } else {
            not_readable(space)
        }
    }
}

/// The identity a sealed position binds (phase 5 section 9.3): `<kind>:<id>`, and the person the
/// actor acts for after a NUL byte, which no principal string holds.
fn position_identity(actor: &afd::Actor) -> String {
    let kind = serde_json::to_value(actor.kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default();
    format!(
        "{kind}:{}\u{0}{}",
        actor.id.as_deref().unwrap_or(""),
        actor.on_behalf_of.as_deref().unwrap_or("")
    )
}

/// The spaces a host built-in may name to `context`'s caller (phase 5 sections 9.4 and 4.7):
/// `None`, meaning every declared space, in mode `none` (phases 2 to 4 list every space to every
/// caller) and to the operator; otherwise the ids of the spaces the caller reads and its token,
/// if any, grants a verb in ([`Caller::reads`]), in declaration order.
#[must_use]
pub fn listed_spaces(config: &Config, context: &CommandContext) -> Option<Vec<String>> {
    listed_for(config, &Caller::of(config, context))
}

/// [`listed_spaces`] for `caller`.
#[must_use]
pub fn listed_for(config: &Config, caller: &Caller) -> Option<Vec<String>> {
    if !caller.gets_one_answer() {
        return None;
    }
    Some(
        config
            .spaces
            .iter()
            .filter(|space| caller.reads(config, space))
            .map(|space| space.id.as_str().to_owned())
            .collect(),
    )
}

/// The reader filter of `caller` in `space` (phase 5 section 5.4): `space`, `principal:` for the
/// principal and each legacy principal it stands for, and `group:` for each group that holds it.
///
/// # Errors
/// `SPACE_NOT_READABLE` when the space is not declared, when the caller matches no entry of its
/// `readers`, or when its token grants no verb there: [`Caller::refusal`], so a hosted caller who
/// is not the operator cannot tell the three apart.
pub fn reader_filter(
    config: &Config,
    space: &str,
    caller: &Caller,
) -> Result<ReaderFilter, CommandError> {
    let declared = config
        .spaces
        .iter()
        .find(|candidate| candidate.id.as_str() == space)
        .ok_or_else(|| caller.refusal(space))?;
    if !caller.reads(config, declared) {
        return Err(caller.refusal(space));
    }
    let mut tokens = vec!["space".to_owned()];
    tokens.extend(
        caller
            .identities
            .iter()
            .map(|identity| format!("principal:{identity}")),
    );
    tokens.extend(
        config
            .access
            .groups
            .iter()
            .filter(|group| {
                group_holds(config, &group.id, &caller.identities, &caller.claim_groups)
            })
            .map(|group| format!("group:{}", group.id)),
    );
    ReaderFilter::tokens(tokens).map_err(|error| {
        tracing::error!(target: "umbel::access", %error, "a caller's access tokens are not valid");
        if caller.gets_one_answer() {
            space_unavailable()
        } else {
            CommandError::new(
                SPACE_NOT_READABLE,
                format!("The caller's access tokens are not valid: {error}"),
            )
            .with_suggestion("Check the principal and the [access.groups] members in umbel.toml.")
            .with_retryable(false)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::ConfigFile;
    use std::path::Path;

    fn filter_of(
        config: &Config,
        space: &str,
        principal: Option<&str>,
        claim_groups: &[String],
    ) -> Result<ReaderFilter, CommandError> {
        let caller = Caller::new(
            config,
            principal.map(str::to_owned),
            claim_groups.to_vec(),
            Narrowing::None,
            false,
        );
        reader_filter(config, space, &caller)
    }

    fn config(text: &str) -> Config {
        ConfigFile::parse(text)
            .and_then(|file| file.into_config(Path::new("/w")))
            .expect("a valid configuration")
    }

    const TEXT: &str = r#"
config_version = 3
default_space = "main"
[spaces.main]
[spaces.hidden]
readers = ["human:ada", "group:platform"]
[access.groups.platform]
members = ["agent:ci"]
[access.groups.everyone]
members = ["*"]
"#;

    #[test]
    fn readers_match_everyone_a_principal_or_a_group() {
        let config = config(TEXT);
        assert!(filter_of(&config, "main", None, &[]).is_ok());
        assert!(filter_of(&config, "hidden", Some("human:ada"), &[]).is_ok());
        assert!(filter_of(&config, "hidden", Some("agent:ci"), &[]).is_ok());
        for refused in [None, Some("human:bob"), Some("agent:loopback")] {
            let error = filter_of(&config, "hidden", refused, &[]).unwrap_err();
            assert_eq!(error.code, SPACE_NOT_READABLE);
        }
        assert_eq!(
            filter_of(&config, "nowhere", None, &[]).unwrap_err().code,
            SPACE_NOT_READABLE
        );
    }

    #[test]
    fn tokens_are_the_space_the_principal_and_its_groups() {
        let config = config(TEXT);
        let filter = filter_of(&config, "main", Some("agent:ci"), &[]).unwrap();
        assert_eq!(
            filter.token_list().unwrap(),
            [
                "group:everyone",
                "group:platform",
                "principal:agent:ci",
                "space"
            ]
        );
        let anonymous = filter_of(&config, "main", None, &[]).unwrap();
        assert_eq!(anonymous.token_list().unwrap(), ["group:everyone", "space"]);
    }

    const HOSTED: &str = r#"
config_version = 5
default_space = "main"
[principal]
local_id = "corp/ada"
[principal.equivalents]
"human:ada" = "human:corp/ada"
"agent:ada-laptop" = "human:corp/ada"
[auth]
mode = "none"
[auth.namespaces.corp]
[spaces.main]
[spaces.legacy]
readers = ["human:ada"]
[spaces.eng]
readers = ["group:eng"]
[access.groups.eng]
members = ["human:ada"]
[access.groups.claimed]
members = []
"#;

    #[test]
    fn equivalents_map_legacy_principals_one_way() {
        let config = config(HOSTED);
        let namespaced = filter_of(&config, "legacy", Some("human:corp/ada"), &[]).unwrap();
        assert_eq!(
            namespaced.token_list().unwrap(),
            [
                "group:eng",
                "principal:agent:ada-laptop",
                "principal:human:ada",
                "principal:human:corp/ada",
                "space"
            ]
        );
        assert!(filter_of(&config, "eng", Some("human:corp/ada"), &[]).is_ok());
        // One way: the legacy principal gains nothing from the namespaced one.
        let legacy = filter_of(&config, "main", Some("human:ada"), &[]).unwrap();
        assert_eq!(
            legacy.token_list().unwrap(),
            ["group:eng", "principal:human:ada", "space"]
        );
        assert!(filter_of(&config, "legacy", Some("human:corp/bo"), &[]).is_err());
    }

    #[test]
    fn claim_groups_add_members_for_the_request() {
        let config = config(HOSTED);
        assert!(filter_of(&config, "eng", Some("human:corp/bo"), &[]).is_err());
        let claimed = ["eng".to_owned(), "claimed".to_owned()];
        let filter = filter_of(&config, "eng", Some("human:corp/bo"), &claimed).unwrap();
        assert_eq!(
            filter.token_list().unwrap(),
            [
                "group:claimed",
                "group:eng",
                "principal:human:corp/bo",
                "space"
            ]
        );
    }

    #[test]
    fn claim_groups_are_the_callers_own_and_never_another_principals() {
        let context = CommandContext::new()
            .with_extra(CLAIM_GROUPS_KEY, serde_json::json!(["eng", 7, "ops"]));
        assert_eq!(claim_groups_of(&context), ["eng", "ops"]);
        assert_eq!(claim_groups_reading(&context, false), ["eng", "ops"]);
        assert!(claim_groups_reading(&context, true).is_empty());
        assert!(claim_groups_of(&CommandContext::new()).is_empty());
    }
    const NARROWED: &str = r#"
config_version = 5
default_space = "main"
[principal]
local_id = "corp/ada"
[http]
public_url = "https://umbel.example.com/mcp"
allowed_hosts = ["umbel.example.com"]
[auth]
mode = "oauth"
[auth.namespaces.corp]
[auth.issuers.as]
issuer = "https://as.example.com"
namespace = "corp"
[spaces.main]
[spaces.alpha]
readers = ["human:corp/ada"]
[spaces.private]
readers = ["human:corp/bo"]
"#;

    fn token(config: &Config, scopes: &[&str]) -> Narrowing {
        Narrowing::Token(
            scopes
                .iter()
                .filter_map(|scope| Scope::parse(&config.auth.scope_prefix, scope))
                .collect(),
        )
    }

    #[test]
    fn a_token_narrows_and_never_widens_and_hosted_callers_get_one_answer() {
        let config = config(NARROWED);
        let ada = |narrowing: Narrowing, operator: bool| {
            Caller::new(
                &config,
                Some("human:corp/ada".to_owned()),
                Vec::new(),
                narrowing,
                operator,
            )
        };
        let narrowed = ada(token(&config, &["umbel:read:main"]), false);
        assert!(reader_filter(&config, "main", &narrowed).is_ok());
        let alpha = reader_filter(&config, "alpha", &narrowed).unwrap_err();
        let private = reader_filter(&config, "private", &narrowed).unwrap_err();
        let ghost = reader_filter(&config, "ghost", &narrowed).unwrap_err();
        for error in [&alpha, &private, &ghost] {
            assert_eq!(
                serde_json::to_value(error).unwrap(),
                serde_json::to_value(space_unavailable()).unwrap()
            );
        }
        // A scope never makes an unreadable space readable.
        let wide = ada(token(&config, &["umbel:read:private", "umbel:read"]), false);
        assert!(reader_filter(&config, "alpha", &wide).is_ok());
        assert_eq!(
            reader_filter(&config, "private", &wide)
                .unwrap_err()
                .message,
            SPACE_UNAVAILABLE_MESSAGE
        );
        // The operator keeps the named answer, and is never narrowed by a token it has not got.
        let operator = ada(Narrowing::None, true);
        assert!(!operator.gets_one_answer());
        assert!(
            reader_filter(&config, "private", &operator)
                .unwrap_err()
                .message
                .contains("private")
        );
        assert_eq!(listed_for(&config, &operator), None);
        assert_eq!(
            listed_for(&config, &narrowed),
            Some(vec!["main".to_owned()])
        );
        // Reading as another principal keeps the call's narrowing and drops its claim groups.
        let claimed = Caller::new(
            &config,
            Some("human:corp/ada".to_owned()),
            vec!["eng".to_owned()],
            token(&config, &["umbel:read:main"]),
            false,
        );
        let other = claimed.reading_as(&config, Some("human:corp/bo".to_owned()));
        assert!(other.claim_groups().is_empty());
        assert!(reader_filter(&config, "private", &other).is_err());
        // In mode none every caller keeps the named answer.
        let none = self::config(TEXT);
        let anonymous = Caller::new(&none, None, Vec::new(), Narrowing::None, false);
        assert!(!anonymous.gets_one_answer());
        assert!(
            reader_filter(&none, "nowhere", &anonymous)
                .unwrap_err()
                .message
                .contains("nowhere")
        );
    }
}
