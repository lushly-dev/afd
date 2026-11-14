//! What configuration version 7 adds (the Ideas host-review specification, sections 4, 6.1 and
//! 6.5; D180): `[person]` with `decision_ttl_s`, `[person.local]` with `enabled`, `bind` and
//! `public_origin` (added later, additively, as D188 adds keys to version 7), and a space's
//! `verified_levels`.
//!
//! This module parses, validates and stores them, each refusal a `WORKSPACE_CONFIG_INVALID`
//! naming the key. The person page reads the decision lifetime (that specification's step H2);
//! the local page and the plugin gate's local arm read `[person.local]`, and a call for verified
//! content reads `verified_levels` (its step H3).

use std::net::SocketAddr;

use toml::{Table, Value};

use super::config::{ConfigFile, KeyScan, Reader, scan_table};
use super::error::WorkspaceError;
use super::hosted::AuthMode;

/// The top-level table configuration version 7 adds.
pub(super) const TOP_KEYS_V7: &[&str] = &["person"];
/// A space's keys from version 7.
pub(super) const SPACE_KEYS_V7: &[&str] = &[
    "title",
    "readers",
    "collections",
    "person",
    "verified_admits",
    "meaning",
    "verified_levels",
];
/// What version 7 adds to a space, for the message an older version gives.
const SPACE_ADDED_V7: &[&str] = &["verified_levels"];
const PERSON_KEYS: &[&str] = &["decision_ttl_s", "local"];
const LOCAL_KEYS: &[&str] = &["enabled", "bind", "public_origin"];

/// The default `person.decision_ttl_s`, in seconds: phase 5's ten minutes.
pub const DEFAULT_DECISION_TTL_S: u64 = crate::auth::PERSON_DECISION_TTL_S;
/// The shortest `person.decision_ttl_s`, in seconds.
pub const PERSON_DECISION_TTL_MIN_S: u64 = 60;
/// The longest `person.decision_ttl_s`, and the most a decision's expiry may move past its
/// beginning, in seconds: 24 hours.
pub const PERSON_DECISION_TTL_MAX_S: u64 = 86_400;
/// The default `person.local.bind`.
pub const DEFAULT_LOCAL_PAGE_BIND: &str = "127.0.0.1:7421";

/// How a person was proven for a decision: the levels an assurance records (phase 5 section 7.1;
/// the Ideas host-review specification, section 6.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum AssuranceLevel {
    /// The CLI's prompt, answered at a terminal with no agent variable set.
    Terminal,
    /// A fresh login with user verification on the hosted person page.
    Verified,
    /// A form posted to the local person page, which has no login.
    Local,
}

impl AssuranceLevel {
    /// Every level, in the order above.
    pub const ALL: [Self; 3] = [Self::Terminal, Self::Verified, Self::Local];

    /// The configuration and record spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Terminal => "terminal",
            Self::Verified => "verified",
            Self::Local => "local",
        }
    }

    /// The level spelled `text`, if any.
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|level| level.as_str() == text)
    }
}

/// The default `spaces.<id>.verified_levels`: a call's `verified_only` admits an affirmation made
/// at a terminal or on the hosted page, and not one made on the local page.
pub const DEFAULT_VERIFIED_LEVELS: [AssuranceLevel; 2] =
    [AssuranceLevel::Terminal, AssuranceLevel::Verified];

/// `[person]`, version 7.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct PersonConfig {
    /// `person.decision_ttl_s`: the lifetime of every person decision begun on this host, in
    /// seconds, 60 to 86 400.
    pub decision_ttl_s: u64,
    /// `[person.local]`: the local person page.
    pub local: LocalPageConfig,
}

impl Default for PersonConfig {
    fn default() -> Self {
        Self {
            decision_ttl_s: DEFAULT_DECISION_TTL_S,
            local: LocalPageConfig::default(),
        }
    }
}

/// `[person.local]`, version 7: the person page served on a loopback address by
/// `umbel person page-serve`, for a workspace in mode `none`, with no login.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct LocalPageConfig {
    /// Whether the local page serves this workspace's decisions; only in mode `none`, and only
    /// in a build with the `auth` feature.
    pub enabled: bool,
    /// Where it listens: a loopback address.
    pub bind: SocketAddr,
    /// `person.local.public_origin`: the page's origin behind a TLS-terminating proxy on this
    /// machine, `https://<host>[:<port>]`, as a browser's `Origin` writes it (lowercase, no path,
    /// no `:443`); `None` when not set. The page then also admits that origin's `Host` and a post
    /// from it, and the links the host hands out name it (the Ideas host-review specification,
    /// A46 to A50).
    pub public_origin: Option<String>,
}

impl Default for LocalPageConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bind: SocketAddr::from(([127, 0, 0, 1], 7421)),
            public_origin: None,
        }
    }
}

impl ConfigFile {
    /// The key scan of what version 7 adds below the tables `config.rs` scans: `[person]` and
    /// `[person.local]`.
    pub(super) fn scan_v7(&self, table: &Table, scan: &mut KeyScan) {
        if let Some(Value::Table(person)) = table.get("person") {
            scan_table(person, "person", PERSON_KEYS, &[], scan);
            if let Some(Value::Table(local)) = person.get("local") {
                scan_table(local, "person.local", LOCAL_KEYS, &[], scan);
            }
        }
    }

    /// `[person]` and `[person.local]`; the defaults before version 7. `mode` is `auth.mode`, which
    /// the local page needs to be `none`.
    pub(super) fn person(&self, mode: AuthMode) -> Result<PersonConfig, WorkspaceError> {
        if self.version() < 7 {
            return Ok(PersonConfig::default());
        }
        let Some(person) = self.section("person")? else {
            return Ok(PersonConfig::default());
        };
        let reader = Reader::new(Some(person), "person");
        let ttl_max = i64::try_from(PERSON_DECISION_TTL_MAX_S).unwrap_or(i64::MAX);
        let ttl_min = i64::try_from(PERSON_DECISION_TTL_MIN_S).unwrap_or_default();
        let decision_ttl_s = reader
            .integer("decision_ttl_s", ttl_min, ttl_max)?
            .unwrap_or(DEFAULT_DECISION_TTL_S);
        let local = match person.get("local") {
            None => LocalPageConfig::default(),
            Some(Value::Table(local)) => local_page(local, mode)?,
            Some(_) => {
                return Err(WorkspaceError::config_invalid(
                    "person.local",
                    "must be a table",
                ));
            }
        };
        Ok(PersonConfig {
            decision_ttl_s,
            local,
        })
    }
}

fn local_page(table: &Table, mode: AuthMode) -> Result<LocalPageConfig, WorkspaceError> {
    let reader = Reader::new(Some(table), "person.local");
    let enabled = reader.boolean("enabled")?.unwrap_or(false);
    let bind = match reader.string("bind")? {
        None => LocalPageConfig::default().bind,
        Some(text) => {
            let bind: SocketAddr = text.parse().map_err(|_| {
                WorkspaceError::config_invalid(
                    "person.local.bind",
                    format!("must be an address and a port such as {DEFAULT_LOCAL_PAGE_BIND}, not `{text}`"),
                )
            })?;
            // One spelling for each address, which the schema's pattern states: no leading zero,
            // `::1` written short, and a port of 1 to 65535.
            if bind.to_string() != text || bind.port() == 0 {
                return Err(WorkspaceError::config_invalid(
                    "person.local.bind",
                    format!(
                        "must be written as {DEFAULT_LOCAL_PAGE_BIND} or [::1]:7421 are, with a port of 1 to 65535, not `{text}`"
                    ),
                ));
            }
            if !bind.ip().is_loopback() {
                return Err(WorkspaceError::config_invalid(
                    "person.local.bind",
                    format!(
                        "must be a loopback address (127.0.0.0/8 or ::1), not `{text}`: the local page has no login, so it is never served to the network"
                    ),
                ));
            }
            bind
        }
    };
    if enabled && mode != AuthMode::None {
        return Err(WorkspaceError::config_invalid(
            "person.local.enabled",
            format!(
                "needs auth.mode = \"none\", not \"{}\": a hosted workspace confirms on its own person page, after a login",
                mode.as_str()
            ),
        ));
    }
    if enabled && !cfg!(feature = "auth") {
        return Err(WorkspaceError::config_invalid(
            "person.local.enabled",
            "the local person page needs a build with the auth feature, such as umbel-first-party",
        ));
    }
    let public_origin = match reader.string("public_origin")? {
        None => None,
        Some(text) => Some(
            public_origin(&text)
                .map_err(|p| WorkspaceError::config_invalid("person.local.public_origin", p))?,
        ),
    };
    Ok(LocalPageConfig {
        enabled,
        bind,
        public_origin,
    })
}

/// `person.local.public_origin`: an `https` origin, `https://<host>[:<port>]`, with no user
/// information, query or fragment, no path but `/`, and a host in its canonical form. Returns it
/// as a browser's `Origin` serialises it: no trailing `/`, no `:443`.
fn public_origin(text: &str) -> Result<String, String> {
    if !text.starts_with("https://") {
        return Err(format!(
            "`{text}` must be an https origin such as https://garden-host.example-tailnet.ts.net:8443: the proxy in front of the local page terminates TLS"
        ));
    }
    let (host, port, path) = super::hosted::split_https_url(text)?;
    if !path.is_empty() && path != "/" {
        return Err(format!(
            "`{text}` must be an origin, https://<host>[:<port>], with no path: the page's routes are /d/... under it"
        ));
    }
    super::hosted::check_canonical_host(host).map_err(|problem| format!("`{text}`: {problem}"))?;
    let port = match port {
        None => None,
        Some(port) => match port.parse::<u16>() {
            Ok(number) if number.to_string() == port => (number != 443).then_some(number),
            _ => {
                return Err(format!(
                    "`{text}` must write its port as a browser's Origin does, with no leading zero"
                ));
            }
        },
    };
    Ok(match port {
        Some(port) => format!("https://{host}:{port}"),
        None => format!("https://{host}"),
    })
}

/// `verified_levels` of the space table `entry` (section 6.5): the default before version 7 or
/// when absent; otherwise one to three levels, each once.
pub(super) fn verified_levels(
    entry: &Table,
    key: &str,
    version: u32,
) -> Result<Vec<AssuranceLevel>, WorkspaceError> {
    if version < 7 {
        return Ok(DEFAULT_VERIFIED_LEVELS.to_vec());
    }
    let at = format!("{key}.verified_levels");
    let Some(names) = Reader::new(Some(entry), key).string_array("verified_levels")? else {
        return Ok(DEFAULT_VERIFIED_LEVELS.to_vec());
    };
    if names.is_empty() {
        return Err(WorkspaceError::config_invalid(
            &at,
            "must name at least one level: \"terminal\", \"verified\" or \"local\"",
        ));
    }
    let mut levels = Vec::new();
    for name in &names {
        let Some(level) = AssuranceLevel::parse(name) else {
            return Err(WorkspaceError::config_invalid(
                &at,
                format!("entry `{name}` is not a level: \"terminal\", \"verified\" or \"local\""),
            ));
        };
        if levels.contains(&level) {
            return Err(WorkspaceError::config_invalid(
                &at,
                format!("names `{name}` twice"),
            ));
        }
        levels.push(level);
    }
    Ok(levels)
}

/// Whether the dotted key `key` is one configuration version 7 adds, for the message an older
/// version gives it.
pub(super) fn is_v7_key(key: &str) -> bool {
    let parts: Vec<&str> = key.split('.').collect();
    match parts.as_slice() {
        [top, ..] if TOP_KEYS_V7.contains(top) => true,
        ["spaces", _, added] => SPACE_ADDED_V7.contains(added),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_are_ten_minutes_and_a_loopback_port() {
        assert_eq!(DEFAULT_DECISION_TTL_S, 600);
        assert_eq!(
            LocalPageConfig::default().bind.to_string(),
            DEFAULT_LOCAL_PAGE_BIND
        );
    }

    #[test]
    fn each_level_reads_back_as_written() {
        for level in AssuranceLevel::ALL {
            assert_eq!(AssuranceLevel::parse(level.as_str()), Some(level));
        }
        assert_eq!(AssuranceLevel::parse("Verified"), None);
    }

    #[test]
    fn a_public_origin_is_kept_as_a_browser_writes_it() {
        let host = "https://garden-host.example-tailnet.ts.net";
        assert_eq!(
            public_origin(&format!("{host}:8443")).unwrap(),
            format!("{host}:8443")
        );
        for written in [host.to_owned(), format!("{host}/"), format!("{host}:443")] {
            assert_eq!(public_origin(&written).unwrap(), host, "{written}");
        }
        for refused in [
            "http://garden-host.example-tailnet.ts.net:8443".to_owned(),
            format!("{host}:8443/d/"),
            format!("{host}/?bed=3"),
            format!("{host}/#bed"),
            "https://gardener@garden-host.example-tailnet.ts.net".to_owned(),
            "https://Garden-Host.example-tailnet.ts.net".to_owned(),
            format!("{host}:08443"),
            format!("{host}:0"),
            "https://".to_owned(),
        ] {
            assert!(public_origin(&refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn version_7_keys_are_named_for_older_versions() {
        assert!(is_v7_key("person"));
        assert!(is_v7_key("person.local.enabled"));
        assert!(is_v7_key("spaces.garden.verified_levels"));
        assert!(!is_v7_key("spaces.garden.person"));
        assert!(!is_v7_key("http.person.bind"));
    }
}
