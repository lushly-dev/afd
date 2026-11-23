//! What a rendered page may reach, and how Chromium is isolated from the system.
//!
//! - Chromium runs in its own sandbox unless it cannot start there: as root on Linux, or on a
//!   Linux kernel that allows no unprivileged user namespaces at all. Under AppArmor's
//!   system-wide restriction a profile may still let it through, so the host tries the sandbox
//!   and, if Chromium closes its connection before answering, starts it once more without.
//!   `SPECIMEN_CHROMIUM_SANDBOX` turns it off (`0`) or keeps it on strictly, with no retry (`1`).
//! - Each browser context sends every request through a proxy, the bench's own server, which
//!   refuses them. Only the bench's origin and the configured `network.allow` origins bypass
//!   it, so a page reaches nothing else, loopback included. `data:` and `blob:` URLs never reach
//!   the network.

use anyhow::{Result, anyhow};

/// The variable that turns Chromium's sandbox off (`0`) or keeps it on (`1`).
pub const SANDBOX_VARIABLE: &str = "SPECIMEN_CHROMIUM_SANDBOX";

/// Whether Chromium runs in its sandbox and, when it does not, why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sandbox {
    pub enabled: bool,
    pub reason: Option<String>,
    /// The restriction that may stop a sandboxed start, so a failed one is retried without.
    pub fallback: Option<&'static str>,
}

/// How a sandboxed Chromium failed to start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartFailure {
    /// It closed its connection before answering, as Chromium does when its sandbox cannot start.
    Closed,
    /// It did not answer in time, or answered with an error.
    Other,
}

/// What to start instead after a failed start, if anything: the sandbox off, saying why, when
/// the sandbox could fall back and Chromium closed its connection.
pub fn retry_without_sandbox(sandbox: &Sandbox, failure: Option<StartFailure>) -> Option<Sandbox> {
    let restriction = sandbox.fallback?;
    if !sandbox.enabled || failure != Some(StartFailure::Closed) {
        return None;
    }
    Some(Sandbox {
        enabled: false,
        reason: Some(format!(
            "its sandbox could not start under {restriction}; to keep the sandbox, give Playwright's headless shell an AppArmor profile that allows user namespaces or set {restriction_off}, and set {SANDBOX_VARIABLE}=1 to fail instead of starting without it",
            restriction_off = restriction.replace("=1", "=0"),
        )),
        fallback: None,
    })
}

/// What decides whether the sandbox can start.
pub struct System {
    pub linux: bool,
    pub root: bool,
    /// The kernel setting that withholds unprivileged user namespaces, if one does.
    pub namespaces: Option<&'static str>,
    /// AppArmor's system-wide restriction, which a profile can lift for one program.
    pub restricted: Option<&'static str>,
}

impl System {
    pub fn current() -> System {
        let linux = cfg!(target_os = "linux");
        System {
            linux,
            root: is_root(),
            namespaces: if linux {
                withheld_namespaces(|path| std::fs::read_to_string(path).ok())
            } else {
                None
            },
            restricted: if linux {
                restricted_namespaces(|path| std::fs::read_to_string(path).ok())
            } else {
                None
            },
        }
    }
}

#[cfg(unix)]
fn is_root() -> bool {
    unsafe { libc::geteuid() == 0 }
}

#[cfg(not(unix))]
fn is_root() -> bool {
    false
}

/// The kernel setting, if any, under which Chromium's Linux sandbox cannot create the user
/// namespace it needs on any terms. Playwright's headless shell has no setuid helper to fall
/// back on.
pub fn withheld_namespaces(read: impl Fn(&str) -> Option<String>) -> Option<&'static str> {
    // AppArmor's system-wide restriction (`kernel.apparmor_restrict_unprivileged_userns=1`) is
    // not one of them: a profile can still let Chromium through, so Chromium is left to try.
    let settings = [
        (
            "/proc/sys/kernel/unprivileged_userns_clone",
            "0",
            "kernel.unprivileged_userns_clone=0",
        ),
        (
            "/proc/sys/user/max_user_namespaces",
            "0",
            "user.max_user_namespaces=0",
        ),
    ];
    settings
        .into_iter()
        .find(|(path, withheld, _)| read(path).is_some_and(|value| value.trim() == *withheld))
        .map(|(_, _, setting)| setting)
}

/// AppArmor's system-wide restriction on unprivileged user namespaces, if it is on. Playwright's
/// headless shell has no profile of its own, so the sandbox usually cannot start under it.
pub fn restricted_namespaces(read: impl Fn(&str) -> Option<String>) -> Option<&'static str> {
    read("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
        .is_some_and(|value| value.trim() == "1")
        .then_some("kernel.apparmor_restrict_unprivileged_userns=1")
}

/// Decide from `SPECIMEN_CHROMIUM_SANDBOX` (`setting`) and the system.
pub fn sandbox(setting: Option<&str>, system: &System) -> Result<Sandbox> {
    let off = |reason: String| Sandbox {
        enabled: false,
        reason: Some(reason),
        fallback: None,
    };
    let on = Sandbox {
        enabled: true,
        reason: None,
        fallback: None,
    };
    match setting.map(str::trim).unwrap_or("") {
        "1" | "true" | "on" => return Ok(on),
        "0" | "false" | "off" => return Ok(off(format!("{SANDBOX_VARIABLE} turns it off"))),
        "" => {}
        other => {
            return Err(anyhow!(
                "{SANDBOX_VARIABLE} is '{other}'; set it to 0 to run Chromium without its sandbox, 1 to keep the sandbox on, or unset it to let Specimen choose"
            ));
        }
    }
    if system.linux && system.root {
        return Ok(off(
            "the host runs as root, where Chromium cannot start its sandbox; run it as another user to keep the sandbox".into(),
        ));
    }
    if system.linux
        && let Some(setting) = system.namespaces
    {
        return Ok(off(format!(
            "this system does not allow the unprivileged user namespaces Chromium's sandbox needs ({setting}); allow them to keep the sandbox"
        )));
    }
    if system.linux
        && let Some(restriction) = system.restricted
    {
        return Ok(Sandbox {
            fallback: Some(restriction),
            ..on
        });
    }
    Ok(on)
}

/// The proxy and bypass list every browser context is created with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Network {
    pub proxy_server: String,
    pub bypass_list: String,
}

impl Network {
    /// `origin` is the bench's own server, `http://127.0.0.1:<port>`: it is the one origin
    /// served directly, and the proxy that refuses every other request.
    pub fn new(origin: &str, allow: &[String]) -> Result<Network> {
        let mut rules = vec!["<-loopback>".to_string(), origin.to_string()];
        // A bypass rule with a scheme matches only that scheme, so an allowed origin also
        // names its WebSocket scheme.
        for entry in allow {
            let allowed = allowed_origin(entry)?;
            let socket = match allowed.strip_prefix("https://") {
                Some(authority) => format!("wss://{authority}"),
                None => allowed.replacen("http://", "ws://", 1),
            };
            // Both name the port, so each admits that port alone.
            rules.extend([allowed, socket]);
        }
        Ok(Network {
            proxy_server: origin.to_string(),
            bypass_list: rules.join(";"),
        })
    }
}

/// An `http` or `https` origin from `network.allow`, lower-cased, with its effective port
/// written out (`https://fonts.example.com:443`): a bypass rule without a port would match every
/// port of the host. No path, credentials or wildcard, and no host starting with `.`, which
/// Chromium's bypass rules read as every subdomain.
pub fn allowed_origin(entry: &str) -> Result<String> {
    let invalid = |why: &str| {
        anyhow!(
            "network.allow entry '{entry}' {why}; list an origin such as https://fonts.example.com or http://127.0.0.1:4000"
        )
    };
    let lowered = entry.trim().trim_end_matches('/').to_ascii_lowercase();
    let Some((scheme, authority)) = lowered.split_once("://") else {
        return Err(invalid("is not an origin"));
    };
    let default_port = match scheme {
        "http" => 80,
        "https" => 443,
        _ => return Err(invalid("is not an http or https origin")),
    };
    if authority.contains('*') {
        return Err(invalid("has a wildcard"));
    }
    if authority.contains(|c: char| {
        c.is_whitespace() || matches!(c, '/' | '?' | '#' | '@' | ';' | ',' | '<' | '>' | '\\')
    }) {
        return Err(invalid("is not an origin"));
    }
    // An IPv6 literal keeps its brackets; a port follows the host after one colon.
    let (host, port) = match authority.strip_prefix('[') {
        Some(rest) => {
            let Some((address, after)) = rest.split_once(']') else {
                return Err(invalid("is not an origin"));
            };
            let literal = !address.is_empty()
                && address
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.');
            if !literal {
                return Err(invalid("is not an origin"));
            }
            let port = match after {
                "" => None,
                _ => Some(
                    after
                        .strip_prefix(':')
                        .ok_or_else(|| invalid("is not an origin"))?,
                ),
            };
            (&authority[..address.len() + 2], port)
        }
        None => match authority.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        },
    };
    if host.is_empty() || (!host.starts_with('[') && host.contains(['[', ']', ':'])) {
        return Err(invalid("is not an origin"));
    }
    // Chromium's bypass rules compare the URL's punycode host, so a Unicode host never matches.
    if !host.is_ascii() {
        return Err(invalid(
            "has a non-ASCII host, which Chromium matches only in punycode (xn--…); write the host in punycode",
        ));
    }
    if host.starts_with('.') {
        return Err(invalid(
            "starts with '.', which would admit every subdomain",
        ));
    }
    let port = match port {
        None => default_port,
        Some(port) => match port.parse::<u16>() {
            Ok(port) if port > 0 => port,
            _ => return Err(invalid("has an invalid port")),
        },
    };
    Ok(format!("{scheme}://{host}:{port}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn system(linux: bool, root: bool, namespaces: Option<&'static str>) -> System {
        System {
            linux,
            root,
            namespaces,
            restricted: None,
        }
    }

    const APPARMOR: &str = "kernel.apparmor_restrict_unprivileged_userns=1";

    #[test]
    fn under_apparmor_the_sandbox_is_tried_and_falls_back_once_if_chromium_closes() {
        let restricted = |linux| System {
            restricted: Some(APPARMOR),
            ..system(linux, false, None)
        };
        let tried = sandbox(None, &restricted(true)).unwrap();
        assert!(tried.enabled);
        assert_eq!(tried.fallback, Some(APPARMOR));

        // Chromium closed its connection before answering: start it again without the sandbox.
        let retried = retry_without_sandbox(&tried, Some(StartFailure::Closed)).unwrap();
        assert!(!retried.enabled);
        assert_eq!(retried.fallback, None);
        let reason = retried.reason.unwrap();
        assert!(
            reason.contains("could not start under kernel.apparmor_restrict_unprivileged_userns=1"),
            "{reason}"
        );
        assert!(reason.contains("AppArmor profile"), "{reason}");
        assert!(
            reason.contains("kernel.apparmor_restrict_unprivileged_userns=0"),
            "{reason}"
        );
        // It started, or failed some other way: no retry.
        assert_eq!(retry_without_sandbox(&tried, None), None);
        assert_eq!(
            retry_without_sandbox(&tried, Some(StartFailure::Other)),
            None
        );

        // `SPECIMEN_CHROMIUM_SANDBOX=1` keeps it strict; `0` turns it off; macOS never retries.
        let strict = sandbox(Some("1"), &restricted(true)).unwrap();
        assert!(strict.enabled && strict.fallback.is_none());
        assert_eq!(
            retry_without_sandbox(&strict, Some(StartFailure::Closed)),
            None
        );
        let off = sandbox(Some("0"), &restricted(true)).unwrap();
        assert!(!off.enabled);
        assert_eq!(
            retry_without_sandbox(&off, Some(StartFailure::Closed)),
            None
        );
        let mac = sandbox(None, &restricted(false)).unwrap();
        assert!(mac.enabled && mac.fallback.is_none());
        assert_eq!(
            retry_without_sandbox(&mac, Some(StartFailure::Closed)),
            None
        );
        // Without the restriction a failed start is reported, not retried.
        let plain = sandbox(None, &system(true, false, None)).unwrap();
        assert_eq!(
            retry_without_sandbox(&plain, Some(StartFailure::Closed)),
            None
        );
    }

    #[test]
    fn reads_apparmor_s_restriction() {
        let path = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
        assert_eq!(
            restricted_namespaces(|asked| (asked == path).then(|| "1\n".into())),
            Some(APPARMOR)
        );
        assert_eq!(
            restricted_namespaces(|asked| (asked == path).then(|| "0\n".into())),
            None
        );
        assert_eq!(restricted_namespaces(|_| None), None);
    }

    #[test]
    fn the_sandbox_is_on_unless_it_cannot_start_or_is_turned_off() {
        let on = Sandbox {
            enabled: true,
            reason: None,
            fallback: None,
        };
        assert_eq!(sandbox(None, &system(false, false, None)).unwrap(), on);
        assert_eq!(sandbox(Some(""), &system(true, false, None)).unwrap(), on);
        // Root on macOS or Windows does not stop the sandbox.
        assert_eq!(sandbox(None, &system(false, true, None)).unwrap(), on);

        let root = sandbox(None, &system(true, true, None)).unwrap();
        assert!(!root.enabled);
        assert!(root.reason.unwrap().contains("root"));

        let namespaces = sandbox(
            None,
            &system(true, false, Some("user.max_user_namespaces=0")),
        )
        .unwrap();
        assert!(!namespaces.enabled);
        assert!(
            namespaces
                .reason
                .unwrap()
                .contains("user.max_user_namespaces=0")
        );

        let off = sandbox(Some("0"), &system(false, false, None)).unwrap();
        assert!(!off.enabled);
        assert!(off.reason.unwrap().contains(SANDBOX_VARIABLE));
        assert_eq!(sandbox(Some("1"), &system(true, true, None)).unwrap(), on);

        let error = sandbox(Some("maybe"), &system(false, false, None)).unwrap_err();
        assert!(error.to_string().contains("set it to 0"));
    }

    #[test]
    fn reads_the_kernel_settings_that_withhold_user_namespaces() {
        let only = |path: &'static str, value: &'static str| {
            move |asked: &str| (asked == path).then(|| format!("{value}\n"))
        };
        assert_eq!(withheld_namespaces(|_| None), None);
        // AppArmor's restriction alone leaves the sandbox to Chromium: a profile may allow it.
        assert_eq!(
            withheld_namespaces(only(
                "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
                "1"
            )),
            None
        );
        assert_eq!(
            withheld_namespaces(only(
                "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
                "0"
            )),
            None
        );
        assert_eq!(
            withheld_namespaces(only("/proc/sys/kernel/unprivileged_userns_clone", "0")),
            Some("kernel.unprivileged_userns_clone=0")
        );
        assert_eq!(
            withheld_namespaces(only("/proc/sys/user/max_user_namespaces", "0")),
            Some("user.max_user_namespaces=0")
        );
        assert_eq!(
            withheld_namespaces(only("/proc/sys/user/max_user_namespaces", "63000")),
            None
        );
    }

    #[test]
    fn only_the_bench_origin_and_allowed_origins_bypass_the_refusing_proxy() {
        let network = Network::new(
            "http://127.0.0.1:4100",
            &[
                "HTTPS://Fonts.Example.com/".into(),
                "http://[::1]:8080".into(),
            ],
        )
        .unwrap();
        assert_eq!(network.proxy_server, "http://127.0.0.1:4100");
        assert_eq!(
            network.bypass_list,
            "<-loopback>;http://127.0.0.1:4100;https://fonts.example.com:443;wss://fonts.example.com:443;http://[::1]:8080;ws://[::1]:8080"
        );
        assert_eq!(
            Network::new("http://127.0.0.1:4100", &[])
                .unwrap()
                .bypass_list,
            "<-loopback>;http://127.0.0.1:4100"
        );
    }

    #[test]
    fn refuses_allow_entries_that_are_not_origins() {
        for entry in [
            "fonts.example.com",
            "ftp://example.com",
            "wss://example.com",
            "https://*.example.com",
            "https://example.com/path",
            "https://user@example.com",
            "https://example.com:0",
            "https://example.com:99999",
            "https://example.com:port",
            "https://",
            "https://a.com;b.com",
            "http://.localhost:4000",
            "https://.example.com",
            "http://::1",
            "http://[::1",
            "http://[::1]x",
            "http://[example]:80",
            "https://bücher.example",
        ] {
            let error = allowed_origin(entry).unwrap_err().to_string();
            assert!(error.contains(entry), "{entry}: {error}");
            assert!(error.contains("such as https://"), "{entry}: {error}");
        }
        for (entry, origin) in [
            ("http://127.0.0.1:4000", "http://127.0.0.1:4000"),
            // A default port, implied or written, is kept, so no rule matches every port.
            ("http://example.com", "http://example.com:80"),
            ("https://example.com", "https://example.com:443"),
            ("https://example.com:443/", "https://example.com:443"),
            ("http://[::1]", "http://[::1]:80"),
            ("http://[::1]:8080", "http://[::1]:8080"),
        ] {
            assert_eq!(allowed_origin(entry).unwrap(), origin, "{entry}");
        }
        let error = allowed_origin("http://.localhost:4000")
            .unwrap_err()
            .to_string();
        assert!(error.contains("every subdomain"), "{error}");
        let error = allowed_origin("https://bücher.example")
            .unwrap_err()
            .to_string();
        assert!(error.contains("punycode"), "{error}");
        assert_eq!(
            allowed_origin("https://xn--bcher-kva.example").unwrap(),
            "https://xn--bcher-kva.example:443"
        );
    }
}
