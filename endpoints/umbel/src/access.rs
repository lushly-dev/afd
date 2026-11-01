//! Who may read a space and what: the reader filter the host builds for every store read
//! (phase 2 specification, section 6, D53).
//!
//! The effective principal of a call is the person behind it when there is one, else the actor
//! (`provenance::effective_principal`). It must match an entry of the space's `readers` or the
//! call fails before the handler with `SPACE_NOT_READABLE`; otherwise its tokens are `space`,
//! `principal:<effective>` and `group:<g>` for every group that holds it. Before phase 5 nothing
//! verifies who a stdio or loopback caller is, so filtering is exact only for embedders and
//! tests (owner decision 1 of 2026-11-01): the README and `workspace-show` say so.

use afd::{CommandContext, CommandError};
use umbel_store::ReaderFilter;

use crate::principal::Principal;
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

fn group_holds(config: &Config, group: &str, principal: Option<&str>) -> bool {
    config
        .access
        .groups
        .iter()
        .find(|candidate| candidate.id == group)
        .is_some_and(|group| {
            group
                .members
                .iter()
                .any(|member| member == "*" || Some(member.as_str()) == principal)
        })
}

/// Whether `principal` may read the space `space`: it matches an entry of `readers`.
#[must_use]
pub fn may_read_space(config: &Config, space: &SpaceConfig, principal: Option<&str>) -> bool {
    space
        .readers
        .iter()
        .filter_map(|entry| ReaderEntry::parse(entry).ok())
        .any(|entry| match entry {
            ReaderEntry::Anyone => true,
            ReaderEntry::Principal(text) => Some(text.as_str()) == principal,
            ReaderEntry::Group(group) => group_holds(config, &group, principal),
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

/// The reader filter of `principal` in `space`.
///
/// # Errors
/// `SPACE_NOT_READABLE` when the principal matches no entry of the space's `readers`, or the
/// space is not declared.
pub fn reader_filter(
    config: &Config,
    space: &str,
    principal: Option<&str>,
) -> Result<ReaderFilter, CommandError> {
    let declared = config
        .spaces
        .iter()
        .find(|candidate| candidate.id.as_str() == space)
        .ok_or_else(|| not_readable(space))?;
    if !may_read_space(config, declared, principal) {
        return Err(not_readable(space));
    }
    let mut tokens = vec!["space".to_owned()];
    if let Some(principal) = principal {
        tokens.push(format!("principal:{principal}"));
    }
    tokens.extend(
        config
            .access
            .groups
            .iter()
            .filter(|group| group_holds(config, &group.id, principal))
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
        assert!(reader_filter(&config, "main", None).is_ok());
        assert!(reader_filter(&config, "hidden", Some("human:ada")).is_ok());
        assert!(reader_filter(&config, "hidden", Some("agent:ci")).is_ok());
        for refused in [None, Some("human:bob"), Some("agent:loopback")] {
            let error = reader_filter(&config, "hidden", refused).unwrap_err();
            assert_eq!(error.code, SPACE_NOT_READABLE);
        }
        assert_eq!(
            reader_filter(&config, "nowhere", None).unwrap_err().code,
            SPACE_NOT_READABLE
        );
    }

    #[test]
    fn tokens_are_the_space_the_principal_and_its_groups() {
        let config = config(TEXT);
        let filter = reader_filter(&config, "main", Some("agent:ci")).unwrap();
        assert_eq!(
            filter.token_list().unwrap(),
            [
                "group:everyone",
                "group:platform",
                "principal:agent:ci",
                "space"
            ]
        );
        let anonymous = reader_filter(&config, "main", None).unwrap();
        assert_eq!(anonymous.token_list().unwrap(), ["group:everyone", "space"]);
    }
}
