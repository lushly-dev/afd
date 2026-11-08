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

/// Whether `principal`, with the claim groups of its token, may read the space `space`: it, or
/// a legacy principal it stands for, matches an entry of `readers`.
#[must_use]
pub fn may_read_space(
    config: &Config,
    space: &SpaceConfig,
    principal: Option<&str>,
    claim_groups: &[String],
) -> bool {
    let identities = identities(config, principal);
    space
        .readers
        .iter()
        .filter_map(|entry| ReaderEntry::parse(entry).ok())
        .any(|entry| match entry {
            ReaderEntry::Anyone => true,
            ReaderEntry::Principal(text) => identities.contains(&text),
            ReaderEntry::Group(group) => group_holds(config, &group, &identities, claim_groups),
        })
}

/// `SPACE_NOT_READABLE` for `space`.
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

/// The reader filter of `principal`, with the claim groups of its token, in `space`: `space`,
/// `principal:` for the principal and each legacy principal it stands for, and `group:` for each
/// group that holds it.
///
/// # Errors
/// `SPACE_NOT_READABLE` when the principal matches no entry of the space's `readers`, or the
/// space is not declared.
pub fn reader_filter(
    config: &Config,
    space: &str,
    principal: Option<&str>,
    claim_groups: &[String],
) -> Result<ReaderFilter, CommandError> {
    let declared = config
        .spaces
        .iter()
        .find(|candidate| candidate.id.as_str() == space)
        .ok_or_else(|| not_readable(space))?;
    if !may_read_space(config, declared, principal, claim_groups) {
        return Err(not_readable(space));
    }
    let identities = identities(config, principal);
    let mut tokens = vec!["space".to_owned()];
    tokens.extend(
        identities
            .iter()
            .map(|identity| format!("principal:{identity}")),
    );
    tokens.extend(
        config
            .access
            .groups
            .iter()
            .filter(|group| group_holds(config, &group.id, &identities, claim_groups))
            .map(|group| format!("group:{}", group.id)),
    );
    ReaderFilter::tokens(tokens).map_err(|error| {
        CommandError::new(
            SPACE_NOT_READABLE,
            format!("The caller's access tokens are not valid: {error}"),
        )
        .with_suggestion("Check the principal and the [access.groups] members in umbel.toml.")
        .with_retryable(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::ConfigFile;
    use std::path::Path;

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
        assert!(reader_filter(&config, "main", None, &[]).is_ok());
        assert!(reader_filter(&config, "hidden", Some("human:ada"), &[]).is_ok());
        assert!(reader_filter(&config, "hidden", Some("agent:ci"), &[]).is_ok());
        for refused in [None, Some("human:bob"), Some("agent:loopback")] {
            let error = reader_filter(&config, "hidden", refused, &[]).unwrap_err();
            assert_eq!(error.code, SPACE_NOT_READABLE);
        }
        assert_eq!(
            reader_filter(&config, "nowhere", None, &[])
                .unwrap_err()
                .code,
            SPACE_NOT_READABLE
        );
    }

    #[test]
    fn tokens_are_the_space_the_principal_and_its_groups() {
        let config = config(TEXT);
        let filter = reader_filter(&config, "main", Some("agent:ci"), &[]).unwrap();
        assert_eq!(
            filter.token_list().unwrap(),
            [
                "group:everyone",
                "group:platform",
                "principal:agent:ci",
                "space"
            ]
        );
        let anonymous = reader_filter(&config, "main", None, &[]).unwrap();
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
        let namespaced = reader_filter(&config, "legacy", Some("human:corp/ada"), &[]).unwrap();
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
        assert!(reader_filter(&config, "eng", Some("human:corp/ada"), &[]).is_ok());
        // One way: the legacy principal gains nothing from the namespaced one.
        let legacy = reader_filter(&config, "main", Some("human:ada"), &[]).unwrap();
        assert_eq!(
            legacy.token_list().unwrap(),
            ["group:eng", "principal:human:ada", "space"]
        );
        assert!(reader_filter(&config, "legacy", Some("human:corp/bo"), &[]).is_err());
    }

    #[test]
    fn claim_groups_add_members_for_the_request() {
        let config = config(HOSTED);
        assert!(reader_filter(&config, "eng", Some("human:corp/bo"), &[]).is_err());
        let claimed = ["eng".to_owned(), "claimed".to_owned()];
        let filter = reader_filter(&config, "eng", Some("human:corp/bo"), &claimed).unwrap();
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
}
