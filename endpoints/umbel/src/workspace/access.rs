//! The access grammar of the phase 2 specification, section 6: principal strings and access
//! tokens. Configuration (`readers`, `[access.groups]`, a collection's `access`) and the
//! provenance envelope share it.

/// The actor kinds a principal string may name (AFD's `ActorKind` without `test`).
pub const PRINCIPAL_KINDS: &[&str] = &["human", "agent", "service", "script"];

/// The longest actor id, in characters (phase 0's rule for `principal.local_id`).
const MAX_ID_CHARS: usize = 128;

/// A principal string `<kind>:<id>`, split at its first colon: `kind` is one of
/// [`PRINCIPAL_KINDS`] and `id` is 1 to 128 characters with no control character, colons allowed.
///
/// # Errors
/// A message naming the rule the text breaks.
pub fn parse_principal(text: &str) -> Result<(&str, &str), String> {
    let Some((kind, id)) = text.split_once(':') else {
        return Err(format!("`{text}` is not a principal string <kind>:<id>"));
    };
    if !PRINCIPAL_KINDS.contains(&kind) {
        return Err(format!(
            "`{text}` has kind `{kind}`; the kind must be human, agent, service or script"
        ));
    }
    check_id(text, id)?;
    Ok((kind, id))
}

fn check_id(text: &str, id: &str) -> Result<(), String> {
    let length = id.chars().count();
    if !(1..=MAX_ID_CHARS).contains(&length) || id.chars().any(char::is_control) {
        return Err(format!(
            "`{text}` must have an id of 1 to {MAX_ID_CHARS} characters without a control character"
        ));
    }
    Ok(())
}

/// Whether `text` is a group id: `^[a-z][a-z0-9-]{0,62}$`.
pub(super) fn is_group_id(text: &str) -> bool {
    super::SpaceId::is_valid(text)
}

/// One access token: `space`, `group:<id>` or `principal:<kind>:<id>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessToken {
    /// Anyone who may read the space.
    Space,
    /// A member of the named group.
    Group(String),
    /// The named principal, a string `<kind>:<id>`.
    Principal(String),
}

impl AccessToken {
    /// Parse a token.
    ///
    /// # Errors
    /// A message naming the rule the text breaks.
    pub fn parse(text: &str) -> Result<Self, String> {
        if text == "space" {
            return Ok(Self::Space);
        }
        if let Some(id) = text.strip_prefix("group:") {
            return if is_group_id(id) {
                Ok(Self::Group(id.to_owned()))
            } else {
                Err(format!(
                    "`{text}` must name a group id matching ^[a-z][a-z0-9-]{{0,62}}$"
                ))
            };
        }
        if let Some(principal) = text.strip_prefix("principal:") {
            parse_principal(principal).map_err(|_| {
                format!("`{text}` must be principal:<kind>:<id> with kind human, agent, service or script and an id of 1 to {MAX_ID_CHARS} characters")
            })?;
            return Ok(Self::Principal(principal.to_owned()));
        }
        Err(format!(
            "`{text}` is not an access token; use space, group:<id> or principal:<kind>:<id>"
        ))
    }

    /// The group this token names, if any.
    pub fn group(&self) -> Option<&str> {
        match self {
            Self::Group(id) => Some(id),
            _ => None,
        }
    }
}

/// One entry of a space's `readers`: `*`, a principal string or `group:<id>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReaderEntry {
    /// Everyone.
    Anyone,
    /// The named principal.
    Principal(String),
    /// A member of the named group.
    Group(String),
}

impl ReaderEntry {
    /// Parse a `readers` entry.
    ///
    /// # Errors
    /// A message naming the rule the text breaks.
    pub fn parse(text: &str) -> Result<Self, String> {
        if text == "*" {
            return Ok(Self::Anyone);
        }
        if let Some(id) = text.strip_prefix("group:") {
            return if is_group_id(id) {
                Ok(Self::Group(id.to_owned()))
            } else {
                Err(format!(
                    "`{text}` must name a group id matching ^[a-z][a-z0-9-]{{0,62}}$"
                ))
            };
        }
        parse_principal(text).map_err(|_| {
            format!("`{text}` must be \"*\", a principal string <kind>:<id> or group:<id>")
        })?;
        Ok(Self::Principal(text.to_owned()))
    }
}

/// A group member: `*` or a principal string.
///
/// # Errors
/// A message naming the rule the text breaks.
pub fn check_member(text: &str) -> Result<(), String> {
    if text == "*" {
        return Ok(());
    }
    parse_principal(text)
        .map(drop)
        .map_err(|_| format!("`{text}` must be \"*\" or a principal string <kind>:<id>"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn principals_split_at_the_first_colon() {
        assert_eq!(parse_principal("human:ada"), Ok(("human", "ada")));
        assert_eq!(parse_principal("agent:a:b"), Ok(("agent", "a:b")));
        for bad in ["ada", "robot:x", "human:", "human:a\nb", ":x"] {
            assert!(parse_principal(bad).is_err(), "{bad}");
        }
        assert!(parse_principal(&format!("human:{}", "x".repeat(129))).is_err());
        assert!(parse_principal(&format!("human:{}", "x".repeat(128))).is_ok());
    }

    #[test]
    fn tokens() {
        assert_eq!(AccessToken::parse("space"), Ok(AccessToken::Space));
        assert_eq!(
            AccessToken::parse("group:kb-owners"),
            Ok(AccessToken::Group("kb-owners".into()))
        );
        assert_eq!(
            AccessToken::parse("principal:human:ada"),
            Ok(AccessToken::Principal("human:ada".into()))
        );
        for bad in [
            "",
            "Space",
            "group:",
            "group:Bad",
            "principal:ada",
            "human:ada",
            "*",
        ] {
            assert!(AccessToken::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn readers_and_members() {
        assert_eq!(ReaderEntry::parse("*"), Ok(ReaderEntry::Anyone));
        assert_eq!(
            ReaderEntry::parse("group:x"),
            Ok(ReaderEntry::Group("x".into()))
        );
        assert_eq!(
            ReaderEntry::parse("human:ada"),
            Ok(ReaderEntry::Principal("human:ada".into()))
        );
        assert!(ReaderEntry::parse("space").is_err());
        assert!(check_member("*").is_ok());
        assert!(check_member("agent:ci").is_ok());
        assert!(check_member("group:x").is_err());
    }
}
