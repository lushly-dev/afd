//! The files the hosted profile reads (phase 5 specification, sections 2.2, 6.1 and 10.4): PEM
//! certificates with their validity, an issuer's `ca_file` roots, and the permission rules the
//! doctor holds every one of them to.
//!
//! - **Validity.** A certificate's `notBefore` and `notAfter` are read from its DER with
//!   `x509-parser`; nothing here verifies a signature (rustls does, at the handshake).
//! - **An issuer's roots** (`[auth.issuers.<alias>] ca_file`, amendment from step 2c). The file
//!   holds one or more PEM certificates, each of which must parse as X.509 and be within its
//!   validity now; a file that cannot be read, holds no certificate, or holds one that does not
//!   parse, is expired or is not yet valid, is refused, so an expired root is never trusted (a
//!   trust anchor's own validity is not checked by WebPKI).
//! - **Reading.** Every file is read through [`read_limited`]: a regular file (through symbolic
//!   links) of at most 1 MiB, so a FIFO, a device or a huge file named by mistake never hangs or
//!   floods the doctor or the server's start.
//! - **Permissions** (Unix). A private key must not be readable or writable by group or other;
//!   every other file (a certificate, a CA file, a key set) must not be writable by them, since
//!   whoever can write a trust file chooses whom the host trusts. For the same reason every file
//!   must be owned by the user the host runs as, or by root, and the directory holding it (as
//!   named, and as resolved through links) must not be writable by group or other unless it is
//!   sticky, so that no one else can replace the file by a rename.
//! - **Permissions** (Windows). The same rules, judged on each object's owner and DACL by SID
//!   (`umbel-windows`): no allow entry, explicit, inherited or inherit-only, may grant anyone but
//!   this user, SYSTEM (`S-1-5-18`) and Administrators (`S-1-5-32-544`) read or write rights to a
//!   private key, or write rights (write or append data, delete, change permissions, take
//!   ownership, generic write or all) to any other file; the owner of the file, and of each
//!   directory holding it, must be one of those three, since an owner may always rewrite the DACL;
//!   and no one else may add or remove a directory's entries, as there is no sticky bit. An ACL
//!   that cannot be read is refused.
//!
//! No message here ever holds a file's contents or a parser's account of them: only the path and
//! what is wrong.

use std::path::Path;

use std::io::Read;

use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, PrivateKeyDer};

/// The largest file read: 1 MiB, as the outbound fetches' bodies.
pub(crate) const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// How long before `notAfter` a certificate is reported as expiring: 14 days (section 6.1).
pub(crate) const EXPIRY_WARNING_S: i64 = 14 * 24 * 60 * 60;

/// One certificate of a PEM file and its validity, in seconds since the epoch.
#[derive(Debug, Clone)]
pub(crate) struct Certificate {
    pub(crate) der: CertificateDer<'static>,
    pub(crate) not_before: i64,
    pub(crate) not_after: i64,
}

/// Where a certificate stands at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Validity {
    /// Valid now and for more than 14 days.
    Valid,
    /// Valid now, and expiring within 14 days.
    Expiring,
    /// Past its `notAfter`.
    Expired,
    /// Before its `notBefore`.
    NotYetValid,
}

impl Certificate {
    /// Where the certificate stands at `now_s`.
    pub(crate) fn validity(&self, now_s: i64) -> Validity {
        if now_s < self.not_before {
            Validity::NotYetValid
        } else if now_s > self.not_after {
            Validity::Expired
        } else if self.not_after - now_s <= EXPIRY_WARNING_S {
            Validity::Expiring
        } else {
            Validity::Valid
        }
    }

    /// Whether the certificate's subject alternative names hold `host` (a DNS name compared
    /// case-insensitively, a `*.` name matching one leftmost label, or an IP literal, bracketed
    /// or not), as a browser matches a server certificate to the host it asked for (RFC 6125).
    /// A certificate without that extension names no host.
    pub(crate) fn names(&self, host: &str) -> bool {
        use x509_parser::extensions::GeneralName;
        let Ok((_, parsed)) = x509_parser::parse_x509_certificate(self.der.as_ref()) else {
            return false;
        };
        let Ok(Some(names)) = parsed.subject_alternative_name() else {
            return false;
        };
        let bare = host.trim_start_matches('[').trim_end_matches(']');
        let ip: Option<std::net::IpAddr> = bare.parse().ok();
        names
            .value
            .general_names
            .iter()
            .any(|name| match (name, ip) {
                (GeneralName::IPAddress(bytes), Some(ip)) => match ip {
                    std::net::IpAddr::V4(v4) => *bytes == v4.octets().as_slice(),
                    std::net::IpAddr::V6(v6) => *bytes == v6.octets().as_slice(),
                },
                (GeneralName::DNSName(name), None) => dns_matches(name, bare),
                _ => false,
            })
    }

    /// Whether the certificate's subject alternative names hold a wildcard DNS name (`*.`).
    pub(crate) fn has_wildcard(&self) -> bool {
        use x509_parser::extensions::GeneralName;
        let Ok((_, parsed)) = x509_parser::parse_x509_certificate(self.der.as_ref()) else {
            return false;
        };
        let Ok(Some(names)) = parsed.subject_alternative_name() else {
            return false;
        };
        names
            .value
            .general_names
            .iter()
            .any(|name| matches!(name, GeneralName::DNSName(name) if name.starts_with('*')))
    }

    /// `notAfter` as an ISO 8601 UTC date and time.
    pub(crate) fn not_after_text(&self) -> String {
        chrono::DateTime::from_timestamp(self.not_after, 0).map_or_else(
            || self.not_after.to_string(),
            |time| time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        )
    }
}

/// Whether the certificate's DNS name `pattern` matches `host`: exactly, or `*.<rest>` for a host
/// of one more label than `<rest>`, case-insensitively.
fn dns_matches(pattern: &str, host: &str) -> bool {
    match pattern.strip_prefix("*.") {
        Some(rest) => host
            .split_once('.')
            .is_some_and(|(label, tail)| !label.is_empty() && tail.eq_ignore_ascii_case(rest)),
        None => pattern.eq_ignore_ascii_case(host),
    }
}

/// The bytes of the regular file at `path` (through symbolic links), at most
/// [`MAX_FILE_BYTES`].
///
/// # Errors
/// What is wrong, naming the path: it cannot be read, is not a regular file, or is too large.
pub(crate) fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("{} cannot be read: {}", path.display(), error.kind()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a regular file", path.display()));
    }
    let too_large = || format!("{} is larger than 1 MiB", path.display());
    if metadata.len() > MAX_FILE_BYTES {
        return Err(too_large());
    }
    let file = std::fs::File::open(path)
        .map_err(|error| format!("{} cannot be read: {}", path.display(), error.kind()))?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("{} cannot be read: {}", path.display(), error.kind()))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

/// The private key of the PEM file at `path`. The parser's own account of a key file is never
/// given: only that the file cannot be read or holds no key.
///
/// # Errors
/// What is wrong, naming the path.
pub(crate) fn private_key(path: &Path) -> Result<PrivateKeyDer<'static>, String> {
    let bytes = read_limited(path)?;
    PrivateKeyDer::from_pem_slice(&bytes).map_err(|_| {
        format!(
            "{} is not a PEM private key (PKCS #8, PKCS #1 or SEC1)",
            path.display()
        )
    })
}

/// Every certificate of the PEM file at `path`, at least one, each parsed as X.509.
///
/// # Errors
/// What is wrong, naming the path: unreadable, not a regular file of at most 1 MiB, no PEM
/// certificate, or one that is not X.509.
pub(crate) fn certificates(path: &Path) -> Result<Vec<Certificate>, String> {
    let bytes = read_limited(path)?;
    let ders = CertificateDer::pem_slice_iter(&bytes)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| format!("{} is not a readable PEM certificate file", path.display()))?;
    if ders.is_empty() {
        return Err(format!("{} holds no PEM certificate", path.display()));
    }
    ders.into_iter()
        .enumerate()
        .map(|(index, der)| {
            let (not_before, not_after) = match x509_parser::parse_x509_certificate(der.as_ref()) {
                Ok((_, parsed)) => (
                    parsed.validity().not_before.timestamp(),
                    parsed.validity().not_after.timestamp(),
                ),
                Err(_) => {
                    return Err(format!(
                        "{} holds a certificate (number {}) that is not X.509",
                        path.display(),
                        index + 1
                    ));
                }
            };
            Ok(Certificate {
                der,
                not_before,
                not_after,
            })
        })
        .collect()
}

/// The roots of an issuer's `ca_file` at `path`, each within its validity at `now_s`.
///
/// # Errors
/// What is wrong: the file's problems, or a certificate expired or not yet valid.
pub(crate) fn roots(path: &Path, now_s: i64) -> Result<Vec<Certificate>, String> {
    let found = certificates(path)?;
    for (index, certificate) in found.iter().enumerate() {
        match certificate.validity(now_s) {
            Validity::Expired => {
                return Err(format!(
                    "{} holds a certificate (number {}) that expired at {}; an expired root is never trusted",
                    path.display(),
                    index + 1,
                    certificate.not_after_text()
                ));
            }
            Validity::NotYetValid => {
                return Err(format!(
                    "{} holds a certificate (number {}) that is not valid yet",
                    path.display(),
                    index + 1
                ));
            }
            Validity::Valid | Validity::Expiring => {}
        }
    }
    Ok(found)
}

/// What a file the hosted profile reads may allow beyond its owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Secrecy {
    /// A private key: nothing for group or other.
    Secret,
    /// A certificate, a CA file or a key set: readable by anyone, writable by no one else.
    Public,
}

/// Whether this platform's file permissions are checked: Unix by mode and owner, Windows by
/// owner and ACL.
pub(crate) const PERMISSIONS_CHECKED: bool = cfg!(any(unix, windows));

/// The Windows rules ([module documentation](self)), on an owner and DACL as `umbel-windows`
/// reads them. Pure, so that they are unit-tested on every platform.
#[cfg(any(windows, test))]
mod acl {
    use super::Secrecy;

    /// `NT AUTHORITY\SYSTEM`.
    pub(super) const SYSTEM_SID: &str = "S-1-5-18";
    /// `BUILTIN\Administrators`.
    pub(super) const ADMINISTRATORS_SID: &str = "S-1-5-32-544";

    // The access mask's bits (winnt.h). On a directory, `FILE_WRITE_DATA` is `FILE_ADD_FILE`
    // and `FILE_APPEND_DATA` is `FILE_ADD_SUBDIRECTORY`.
    const FILE_READ_DATA: u32 = 0x1;
    const FILE_WRITE_DATA: u32 = 0x2;
    const FILE_APPEND_DATA: u32 = 0x4;
    const FILE_DELETE_CHILD: u32 = 0x40;
    const DELETE: u32 = 0x1_0000;
    const WRITE_DAC: u32 = 0x4_0000;
    const WRITE_OWNER: u32 = 0x8_0000;
    const GENERIC_ALL: u32 = 0x1000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const GENERIC_READ: u32 = 0x8000_0000;

    /// What rewrites or replaces a file, or grants its holder that: POSIX's 0o022.
    const WRITE_RIGHTS: u32 = FILE_WRITE_DATA
        | FILE_APPEND_DATA
        | DELETE
        | WRITE_DAC
        | WRITE_OWNER
        | GENERIC_WRITE
        | GENERIC_ALL;
    /// What reads a file, besides: POSIX's 0o077.
    const SECRET_RIGHTS: u32 = WRITE_RIGHTS | FILE_READ_DATA | GENERIC_READ;
    /// What adds or removes a directory's entries, or replaces the directory, or grants that.
    const DIRECTORY_RIGHTS: u32 = WRITE_RIGHTS | FILE_DELETE_CHILD;

    /// One entry of a DACL.
    #[derive(Debug, Clone, Copy)]
    pub(super) struct Entry<'a> {
        pub(super) sid: &'a str,
        pub(super) allow: bool,
        pub(super) mask: u32,
    }

    /// What an object is, for the rights others must not hold on it.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(super) enum Object {
        File(Secrecy),
        Directory,
    }

    fn rights(object: Object) -> (u32, &'static str) {
        match object {
            Object::File(Secrecy::Secret) => (SECRET_RIGHTS, "read or write access"),
            Object::File(Secrecy::Public) => (WRITE_RIGHTS, "write access"),
            Object::Directory => (DIRECTORY_RIGHTS, "the right to add or remove its entries"),
        }
    }

    /// Whether `sid` is this user (`me`), SYSTEM or Administrators.
    fn trusted(sid: &str, me: &str) -> bool {
        sid == me || sid == SYSTEM_SID || sid == ADMINISTRATORS_SID
    }

    fn powershell_quote(value: &str) -> String {
        format!("'{}'", value.replace('\'', "''"))
    }

    /// The SIDs beyond this user, SYSTEM and Administrators that an allow entry grants one of
    /// `object`'s rights, in the order of the entries, each once. Deny entries never widen
    /// access; inherited and inherit-only entries count as explicit ones do.
    pub(super) fn exposed<'a>(entries: &[Entry<'a>], me: &str, object: Object) -> Vec<&'a str> {
        let (mask, _) = rights(object);
        let mut found: Vec<&str> = Vec::new();
        for entry in entries {
            if entry.allow
                && entry.mask & mask != 0
                && !trusted(entry.sid, me)
                && !found.contains(&entry.sid)
            {
                found.push(entry.sid);
            }
        }
        found
    }

    /// Why the object at `shown` (its path as given in messages) may be read or replaced by
    /// someone it should not: an owner other than this user, SYSTEM or Administrators, or an
    /// allow entry granting another SID one of `object`'s rights. Each problem names the
    /// `icacls` command that removes it.
    pub(super) fn problems(
        shown: &str,
        owner: &str,
        entries: &[Entry<'_>],
        me: &str,
        object: Object,
    ) -> Vec<String> {
        let mut found = Vec::new();
        let quoted_path = powershell_quote(shown);
        if !trusted(owner, me) {
            let owner_argument = powershell_quote(&format!("*{me}"));
            found.push(format!(
                "is owned by {owner}, neither this user ({me}) nor SYSTEM or Administrators (run in PowerShell: icacls {quoted_path} /setowner {owner_argument})"
            ));
        }
        let others = exposed(entries, me, object);
        if !others.is_empty() {
            let (_, what) = rights(object);
            let grant = match object {
                Object::Directory => "(OI)(CI)(F)",
                Object::File(_) => "(F)",
            };
            let grant = powershell_quote(&format!("*{me}:{grant}"));
            let remove: Vec<String> = others
                .iter()
                .map(|sid| powershell_quote(&format!("*{sid}")))
                .collect();
            found.push(format!(
                "grants {} {what} beyond this user, SYSTEM and Administrators (run in PowerShell: icacls {quoted_path} /inheritance:d /grant:r {grant} /remove:g {})",
                others.join(", "),
                remove.join(" ")
            ));
        }
        found
    }
}

/// A path as messages show it: without the `\\?\` prefix `canonicalize` gives on Windows.
#[cfg(windows)]
fn shown(path: &Path) -> String {
    let text = path.display().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_owned(),
        Some(rest) => rest
            .strip_prefix(r"UNC\")
            .map_or_else(|| text.clone(), |unc| format!(r"\\{unc}")),
        None => text,
    }
}

/// The SID of the user the host runs as, read once.
#[cfg(windows)]
fn windows_user() -> Result<&'static str, String> {
    static USER: std::sync::OnceLock<Result<String, String>> = std::sync::OnceLock::new();
    USER.get_or_init(|| {
        umbel_windows::security::current_user()
            .map_err(|error| format!("the user this process runs as cannot be read: {error}"))
    })
    .as_deref()
    .map_err(Clone::clone)
}

/// The problems of one object's owner and DACL, read already, for `object`.
#[cfg(windows)]
fn windows_problems(
    path: &Path,
    security: &umbel_windows::security::Security,
    object: acl::Object,
) -> Vec<String> {
    let me = match windows_user() {
        Ok(me) => me,
        Err(problem) => return vec![format!("cannot be judged, so it is refused: {problem}")],
    };
    let entries: Vec<acl::Entry<'_>> = security
        .aces
        .iter()
        .map(|ace| acl::Entry {
            sid: &ace.sid,
            allow: ace.allow,
            mask: ace.mask,
        })
        .collect();
    acl::problems(&shown(path), &security.owner, &entries, me, object)
}

/// Why the file at `path`, and the directories holding it as named and as resolved, may be read
/// or replaced by someone they should not, on Windows. A file that does not exist has no problem
/// here (reading it reports that); an ACL that cannot be read is one.
#[cfg(windows)]
fn windows_too_open(path: &Path, secrecy: Secrecy) -> Option<String> {
    use umbel_windows::security::security_of_path;
    let mut problems: Vec<String> = match security_of_path(path) {
        Ok(security) => windows_problems(path, &security, acl::Object::File(secrecy)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            return Some(format!(
                "{}'s owner and ACL cannot be read ({error}), so it is refused",
                path.display()
            ));
        }
    };
    problems.extend(windows_directory_problems(path, |path| {
        std::fs::canonicalize(path)
    }));
    (!problems.is_empty()).then(|| format!("{} {}", path.display(), problems.join(" and ")))
}

/// Check every required parent, refusing resolution failures as well as unreadable ACLs.
#[cfg(windows)]
fn windows_directory_problems(
    path: &Path,
    canonicalize: impl Fn(&Path) -> std::io::Result<std::path::PathBuf>,
) -> Vec<String> {
    use umbel_windows::security::security_of_path;
    let resolved = match canonicalize(path) {
        Ok(resolved) => resolved,
        Err(error) => {
            return vec![format!(
                "cannot be resolved to check its directories ({error}), so it is refused"
            )];
        }
    };
    let Some(resolved_parent) = resolved.parent() else {
        return vec!["has no resolved parent directory, so it is refused".into()];
    };
    let directories = [path.parent().unwrap_or(Path::new(".")), resolved_parent];
    let mut problems = Vec::new();
    let mut seen = Vec::new();
    for directory in directories {
        let directory = if directory.as_os_str().is_empty() {
            Path::new(".")
        } else {
            directory
        };
        let canonical = match canonicalize(directory) {
            Ok(canonical) => canonical,
            Err(error) => {
                problems.push(format!(
                    "is in a directory, {}, that cannot be resolved ({error}), so it is refused",
                    shown(directory)
                ));
                continue;
            }
        };
        if seen.contains(&canonical) {
            continue;
        }
        match security_of_path(&canonical) {
            Ok(security) => problems.extend(
                windows_problems(&canonical, &security, acl::Object::Directory)
                    .into_iter()
                    .map(|problem| format!("is in a directory, {}, that {problem}", shown(&canonical))),
            ),
            Err(error) => problems.push(format!(
                "is in a directory, {}, whose owner and ACL cannot be read ({error}), so it is refused",
                shown(&canonical)
            )),
        }
        seen.push(canonical);
    }
    problems
}

/// Why the mode `mode` is too wide for `secrecy`.
#[cfg(any(unix, test))]
fn mode_problem(mode: u32, secrecy: Secrecy) -> Option<String> {
    let mode = mode & 0o777;
    let (mask, what) = match secrecy {
        Secrecy::Secret => (0o077, "readable or writable by group or other"),
        Secrecy::Public => (0o022, "writable by group or other"),
    };
    (mode & mask != 0).then(|| format!("is {what} (mode {mode:o})"))
}

/// Why a file owned by `owner` may be rewritten by someone other than the user `me` the host
/// runs as: an owner that is neither `me` nor root.
#[cfg(any(unix, test))]
fn owner_problem(owner: u32, me: u32) -> Option<String> {
    (owner != me && owner != 0)
        .then(|| format!("is owned by user {owner}, neither this user ({me}) nor root"))
}

/// Why a directory with mode `mode` lets others replace the files in it: writable by group or
/// other without the sticky bit.
#[cfg(any(unix, test))]
fn directory_problem(mode: u32) -> Option<String> {
    (mode & 0o022 != 0 && mode & 0o1000 == 0).then(|| {
        format!(
            "is in a directory writable by group or other without the sticky bit (mode {:o})",
            mode & 0o7777
        )
    })
}

/// Why the file at `path` may be read or replaced by someone it should not, for `secrecy`, or
/// `None` when it may not (or the platform's permissions are not checked; see
/// [`PERMISSIONS_CHECKED`]). The file's mode and owner (on Windows, its owner and ACL) are read
/// through symbolic links, and the directory holding it is checked as named and as resolved.
pub(crate) fn too_open(path: &Path, secrecy: Secrecy) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::metadata(path).ok()?;
        let me = rustix::process::geteuid().as_raw();
        let mut problems: Vec<String> = Vec::new();
        problems.extend(mode_problem(metadata.mode(), secrecy));
        problems.extend(owner_problem(metadata.uid(), me));
        let mut directories = vec![path.parent().map(Path::to_path_buf)];
        directories.push(
            std::fs::canonicalize(path)
                .ok()
                .and_then(|real| real.parent().map(Path::to_path_buf)),
        );
        let mut seen = Vec::new();
        for directory in directories.into_iter().flatten() {
            let directory = if directory.as_os_str().is_empty() {
                std::path::PathBuf::from(".")
            } else {
                directory
            };
            let Ok(canonical) = std::fs::canonicalize(&directory) else {
                continue;
            };
            if seen.contains(&canonical) {
                continue;
            }
            if let Ok(found) = std::fs::metadata(&canonical) {
                problems.extend(directory_problem(found.mode()));
            }
            seen.push(canonical);
        }
        (!problems.is_empty()).then(|| format!("{} {}", path.display(), problems.join(" and ")))
    }
    #[cfg(windows)]
    {
        windows_too_open(path, secrecy)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, secrecy);
        None
    }
}

/// The bytes of the trust file at `path`, as [`read_limited`] reads a file, checked for
/// `secrecy` on the file that was opened (its own `fstat`, or on Windows its handle's owner and
/// ACL, so a file renamed into place after the check cannot be read in its stead) and on the
/// directories holding it, as [`too_open`] checks them.
///
/// # Errors
/// What is wrong, naming the path: it cannot be read, is not a regular file, is too large, or may
/// be rewritten or replaced by someone else.
pub(crate) fn read_trusted(path: &Path, secrecy: Secrecy) -> Result<Vec<u8>, String> {
    let cannot =
        |error: std::io::Error| format!("{} cannot be read: {}", path.display(), error.kind());
    let file = std::fs::File::open(path).map_err(cannot)?;
    let metadata = file.metadata().map_err(cannot)?;
    if !metadata.is_file() {
        return Err(format!("{} is not a regular file", path.display()));
    }
    let too_large = || format!("{} is larger than 1 MiB", path.display());
    if metadata.len() > MAX_FILE_BYTES {
        return Err(too_large());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let me = rustix::process::geteuid().as_raw();
        let problems: Vec<String> = mode_problem(metadata.mode(), secrecy)
            .into_iter()
            .chain(owner_problem(metadata.uid(), me))
            .collect();
        if !problems.is_empty() {
            return Err(format!("{} {}", path.display(), problems.join(" and ")));
        }
    }
    #[cfg(windows)]
    {
        // The opened file's own owner and ACL, from its handle, as Unix reads its `fstat`.
        let problems = match umbel_windows::security::security_of(&file) {
            Ok(security) => windows_problems(path, &security, acl::Object::File(secrecy)),
            Err(error) => vec![format!(
                "has an owner and ACL that cannot be read ({error}), so it is refused"
            )],
        };
        if !problems.is_empty() {
            return Err(format!("{} {}", path.display(), problems.join(" and ")));
        }
        let problems = windows_directory_problems(path, |path| std::fs::canonicalize(path));
        if !problems.is_empty() {
            return Err(format!("{} {}", path.display(), problems.join(" and ")));
        }
    }
    #[cfg(not(windows))]
    if let Some(problem) = too_open(path, secrecy) {
        return Err(problem);
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(cannot)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dns_name_matches_exactly_or_by_one_leftmost_wildcard_label() {
        assert!(dns_matches("person.example.com", "PERSON.example.com"));
        assert!(dns_matches("*.example.com", "person.example.com"));
        assert!(!dns_matches("*.example.com", "example.com"));
        assert!(!dns_matches("*.example.com", "a.person.example.com"));
        assert!(!dns_matches("*.example.com", ".example.com"));
        assert!(!dns_matches(
            "person.example.com",
            "person.example.com.evil"
        ));
        // A certificate that does not parse names nothing.
        assert!(!certificate(0, 1).names("person.example.com"));
    }

    fn certificate(not_before: i64, not_after: i64) -> Certificate {
        Certificate {
            der: CertificateDer::from(Vec::new()),
            not_before,
            not_after,
        }
    }

    #[test]
    fn validity_has_a_fourteen_day_warning() {
        let now = 1_000_000_000;
        assert_eq!(
            certificate(now - 10, now + EXPIRY_WARNING_S + 1).validity(now),
            Validity::Valid
        );
        assert_eq!(
            certificate(now - 10, now + EXPIRY_WARNING_S).validity(now),
            Validity::Expiring
        );
        assert_eq!(
            certificate(now - 10, now - 1).validity(now),
            Validity::Expired
        );
        assert_eq!(
            certificate(now + 1, now + 100).validity(now),
            Validity::NotYetValid
        );
    }

    #[test]
    fn a_file_without_a_certificate_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        let path = dir.join("empty.pem");
        std::fs::write(&path, "not pem\n").unwrap();
        assert!(
            certificates(&path)
                .unwrap_err()
                .contains("holds no PEM certificate")
        );
        let missing = dir.join("missing.pem");
        assert!(
            certificates(&missing)
                .unwrap_err()
                .contains("cannot be read")
        );
        let garbage = dir.join("garbage.pem");
        std::fs::write(
            &garbage,
            "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
        )
        .unwrap();
        assert!(certificates(&garbage).unwrap_err().contains("not X.509"));
    }

    #[test]
    fn modes_owners_and_directories() {
        assert_eq!(mode_problem(0o600, Secrecy::Secret), None);
        assert!(
            mode_problem(0o620, Secrecy::Secret).is_some(),
            "a write bit alone"
        );
        assert!(mode_problem(0o604, Secrecy::Secret).is_some());
        assert_eq!(mode_problem(0o644, Secrecy::Public), None);
        assert!(mode_problem(0o646, Secrecy::Public).is_some());
        assert_eq!(owner_problem(501, 501), None);
        assert_eq!(owner_problem(0, 501), None);
        assert!(owner_problem(502, 501).is_some());
        assert_eq!(directory_problem(0o755), None);
        assert_eq!(directory_problem(0o1777), None);
        assert!(directory_problem(0o777).is_some());
        assert!(directory_problem(0o775).is_some());
    }

    #[test]
    fn reads_are_bounded_to_regular_files_of_a_mebibyte() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        assert!(
            read_limited(dir)
                .unwrap_err()
                .contains("not a regular file")
        );
        let big = dir.join("big.pem");
        std::fs::write(&big, vec![b'a'; 1024 * 1024 + 1]).unwrap();
        assert!(
            read_limited(&big)
                .unwrap_err()
                .contains("larger than 1 MiB")
        );
        assert!(
            certificates(&big)
                .unwrap_err()
                .contains("larger than 1 MiB")
        );
        let exact = dir.join("exact.pem");
        std::fs::write(&exact, vec![b'a'; 1024 * 1024]).unwrap();
        assert_eq!(read_limited(&exact).unwrap().len(), 1024 * 1024);
        let key = dir.join("key.pem");
        std::fs::write(
            &key,
            "secret-looking-line-canary\n-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
        )
        .unwrap();
        let problem = private_key(&key).unwrap_err();
        assert!(problem.contains("is not a PEM private key"), "{problem}");
        assert!(!problem.contains("canary"), "{problem}");
    }

    #[cfg(unix)]
    #[test]
    fn permissions_follow_the_files_secrecy() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file");
        std::fs::write(&path, "x").unwrap();
        let set = |mode| {
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
        };
        set(0o600);
        assert_eq!(too_open(&path, Secrecy::Secret), None);
        set(0o640);
        assert!(too_open(&path, Secrecy::Secret).is_some());
        assert_eq!(too_open(&path, Secrecy::Public), None);
        set(0o644);
        assert_eq!(too_open(&path, Secrecy::Public), None);
        set(0o664);
        assert!(too_open(&path, Secrecy::Public).is_some());
        set(0o602);
        assert!(too_open(&path, Secrecy::Public).is_some());
        set(0o620);
        assert!(too_open(&path, Secrecy::Secret).is_some());
        // A directory others may write, without the sticky bit, lets them replace the file.
        set(0o644);
        let dir = temp.path();
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o777)).unwrap();
        let problem = too_open(&path, Secrecy::Public).unwrap();
        assert!(problem.contains("without the sticky bit"), "{problem}");
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o1777)).unwrap();
        assert_eq!(too_open(&path, Secrecy::Public), None);
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        // Through a link, the directory of the file it resolves to counts too.
        let open_dir = temp.path().join("open");
        std::fs::create_dir(&open_dir).unwrap();
        std::fs::set_permissions(&open_dir, std::fs::Permissions::from_mode(0o777)).unwrap();
        let target = open_dir.join("target");
        std::fs::write(&target, "x").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o644)).unwrap();
        let link = temp.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let problem = too_open(&link, Secrecy::Public).unwrap();
        assert!(problem.contains("without the sticky bit"), "{problem}");
    }

    #[test]
    fn acl_owners_and_grants_follow_the_files_secrecy() {
        use acl::{ADMINISTRATORS_SID, Entry, Object, SYSTEM_SID, exposed, problems};
        const ME: &str = "S-1-5-21-1-2-3-1001";
        const USERS: &str = "S-1-5-32-545";
        const OTHER: &str = "S-1-5-21-1-2-3-1002";
        let allow = |sid, mask| Entry {
            sid,
            allow: true,
            mask,
        };
        let secret = Object::File(Secrecy::Secret);
        let public = Object::File(Secrecy::Public);
        // This user, SYSTEM and Administrators hold everything; nothing is exposed.
        let private = [
            allow(ME, 0x1F_01FF),
            allow(SYSTEM_SID, 0x1F_01FF),
            allow(ADMINISTRATORS_SID, 0x1000_0000),
        ];
        for object in [secret, public, Object::Directory] {
            assert!(problems("f", ME, &private, ME, object).is_empty());
            assert!(problems("f", SYSTEM_SID, &private, ME, object).is_empty());
            assert!(problems("f", ADMINISTRATORS_SID, &private, ME, object).is_empty());
        }
        // Read and execute (FILE_GENERIC_READ | FILE_GENERIC_EXECUTE) for Users: refused for a
        // key, allowed for a certificate and a directory.
        let readable = [allow(ME, 0x1F_01FF), allow(USERS, 0x12_00A9)];
        assert_eq!(exposed(&readable, ME, secret), [USERS]);
        assert!(exposed(&readable, ME, public).is_empty());
        assert!(exposed(&readable, ME, Object::Directory).is_empty());
        // GENERIC_READ alone, as an inherit-only entry carries it, is reading too.
        assert_eq!(exposed(&[allow(USERS, 0x8000_0000)], ME, secret), [USERS]);
        // Each write-type right alone is refused for every object.
        for mask in [
            0x2,
            0x4,
            0x1_0000,
            0x4_0000,
            0x8_0000,
            0x4000_0000,
            0x1000_0000,
        ] {
            for object in [secret, public, Object::Directory] {
                assert_eq!(
                    exposed(&[allow(OTHER, mask)], ME, object),
                    [OTHER],
                    "{mask:#x} {object:?}"
                );
            }
        }
        // FILE_DELETE_CHILD lets others remove a directory's entries; on a file it is nothing.
        assert_eq!(
            exposed(&[allow(OTHER, 0x40)], ME, Object::Directory),
            [OTHER]
        );
        assert!(exposed(&[allow(OTHER, 0x40)], ME, public).is_empty());
        // A deny entry never widens access; one SID is named once.
        let denied = Entry {
            sid: OTHER,
            allow: false,
            mask: 0x1F_01FF,
        };
        assert!(exposed(&[denied], ME, secret).is_empty());
        assert_eq!(
            exposed(&[allow(OTHER, 0x2), allow(OTHER, 0x4)], ME, public),
            [OTHER]
        );
        // An owner other than this user, SYSTEM or Administrators may rewrite the DACL.
        let found = problems("C:\\k.pem", OTHER, &private, ME, secret);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(
            found[0].contains(&format!("is owned by {OTHER}")),
            "{found:?}"
        );
        assert!(
            found[0].contains(&format!("/setowner '*{ME}'")),
            "{found:?}"
        );
        // The remedy names the SIDs to remove.
        let found = problems("C:\\k.pem", ME, &readable, ME, secret);
        assert!(
            found[0].contains("grants S-1-5-32-545 read or write access"),
            "{found:?}"
        );
        assert!(
            found[0].contains(&format!(
                "icacls 'C:\\k.pem' /inheritance:d /grant:r '*{ME}:(F)' /remove:g '*S-1-5-32-545'"
            )),
            "{found:?}"
        );
        let quoted = problems("C:\\owner's & %TEMP%\\k.pem", OTHER, &private, ME, secret);
        assert!(quoted[0].contains("icacls 'C:\\owner''s & %TEMP%\\k.pem'"));
    }

    /// `icacls` on `path` with `args`, which must succeed.
    #[cfg(windows)]
    fn icacls(path: &Path, args: &[&str]) {
        let output = std::process::Command::new("icacls")
            .arg(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{} {args:?}: {output:?}",
            path.display()
        );
    }

    #[cfg(windows)]
    #[test]
    fn directory_resolution_errors_are_refused() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file");
        std::fs::write(&path, "x").unwrap();
        let denied = || std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let problems = windows_directory_problems(&path, |_| Err(denied()));
        assert!(
            problems
                .iter()
                .any(|problem| problem.contains("cannot be resolved"))
        );
        let problems = windows_directory_problems(&path, |requested| {
            if requested == temp.path() {
                Err(denied())
            } else {
                std::fs::canonicalize(requested)
            }
        });
        assert!(problems.iter().any(|problem| {
            problem.contains("is in a directory") && problem.contains("cannot be resolved")
        }));
        assert!(windows_directory_problems(&path, |path| std::fs::canonicalize(path)).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn an_unreadable_acl_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file");
        std::fs::write(&path, "x").unwrap();
        let powershell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        // OWNER RIGHTS suppresses the owner's implicit READ_CONTROL. Keep DELETE allowed:
        // this disposable file is removed before checking the results, even after a panic.
        let inspection = std::panic::catch_unwind(|| {
            let script = r"
$ErrorActionPreference='Stop'
$acl=Get-Acl -LiteralPath $env:UMBEL_ACL_TEST_PATH
$rule=New-Object System.Security.AccessControl.FileSystemAccessRule ([System.Security.Principal.SecurityIdentifier]'S-1-3-4'),([System.Security.AccessControl.FileSystemRights]::ReadPermissions),([System.Security.AccessControl.AccessControlType]::Deny)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $env:UMBEL_ACL_TEST_PATH -AclObject $acl
";
            let output = std::process::Command::new(powershell)
                .args(["-NoProfile", "-NonInteractive", "-Command", script])
                .env("UMBEL_ACL_TEST_PATH", &path)
                .output()
                .unwrap();
            assert!(output.status.success(), "{output:?}");
            (
                umbel_windows::security::security_of_path(&path),
                too_open(&path, Secrecy::Public),
                read_trusted(&path, Secrecy::Public),
            )
        });
        std::fs::remove_file(&path).unwrap();
        let (security, problem, read) = inspection.unwrap();
        assert_eq!(
            security.unwrap_err().kind(),
            std::io::ErrorKind::PermissionDenied
        );
        assert!(problem.unwrap().contains("cannot be read"));
        assert!(read.is_err());
    }

    /// `path`'s ACL replaced by full control for this user, SYSTEM and Administrators alone,
    /// inherited by what is created under it: a temporary directory then holds only what the
    /// test grants, whatever `%TEMP%` inherits (#2169).
    #[cfg(windows)]
    fn private(path: &Path) {
        let me = umbel_windows::security::current_user().unwrap();
        let grants: Vec<String> = [me.as_str(), "S-1-5-18", "S-1-5-32-544"]
            .iter()
            .map(|sid| format!("*{sid}:(OI)(CI)(F)"))
            .collect();
        let mut args = vec!["/inheritance:r", "/grant:r"];
        args.extend(grants.iter().map(String::as_str));
        icacls(path, &args);
    }

    /// A temporary directory made [`private`].
    #[cfg(windows)]
    fn private_tempdir_in(parent: &Path) -> tempfile::TempDir {
        let temp = tempfile::tempdir_in(parent).unwrap();
        private(temp.path());
        temp
    }

    #[cfg(windows)]
    #[test]
    fn a_private_test_directory_drops_the_read_access_its_parent_passes_down() {
        // BUILTIN\Users stands for the `CodexSandboxUsers` read ACE a profile can pass down to
        // `%TEMP%`: every key a test writes under it is too open.
        let parent = tempfile::tempdir().unwrap();
        private(parent.path());
        icacls(parent.path(), &["/grant", "*S-1-5-32-545:(OI)(CI)(RX)"]);
        let open = parent.path().join("key.pem");
        std::fs::write(&open, "x").unwrap();
        let problem = too_open(&open, Secrecy::Secret).unwrap();
        assert!(problem.contains("S-1-5-32-545"), "{problem}");
        let temp = private_tempdir_in(parent.path());
        let key = temp.path().join("key.pem");
        std::fs::write(&key, "x").unwrap();
        assert_eq!(too_open(&key, Secrecy::Secret), None);
    }

    #[cfg(windows)]
    #[test]
    fn acls_follow_the_files_secrecy() {
        // BUILTIN\Users, which every account is a member of.
        const USERS: &str = "*S-1-5-32-545";
        let temp = private_tempdir_in(&std::env::temp_dir());
        let path = temp.path().join("file");
        std::fs::write(&path, "x").unwrap();
        // A new file in a temporary directory: this user, SYSTEM and Administrators only.
        assert_eq!(too_open(&path, Secrecy::Secret), None);
        assert_eq!(too_open(&path, Secrecy::Public), None);
        assert!(read_trusted(&path, Secrecy::Secret).is_ok());
        // Readable by Users: refused for a key, allowed for a certificate.
        icacls(&path, &["/grant", &format!("{USERS}:(R)")]);
        let problem = too_open(&path, Secrecy::Secret).unwrap();
        assert!(
            problem.contains("grants S-1-5-32-545 read or write access"),
            "{problem}"
        );
        assert!(problem.contains("icacls"), "{problem}");
        assert!(
            read_trusted(&path, Secrecy::Secret)
                .unwrap_err()
                .contains("S-1-5-32-545")
        );
        assert_eq!(too_open(&path, Secrecy::Public), None);
        assert!(read_trusted(&path, Secrecy::Public).is_ok());
        // Writable by Users, through one right alone: refused for both.
        for right in ["(W)", "(AD)", "(WDAC)", "(WO)", "(DE)", "(GW)", "(GA)"] {
            icacls(&path, &["/grant:r", &format!("{USERS}:{right}")]);
            let problem = too_open(&path, Secrecy::Public);
            assert!(problem.is_some(), "{right}");
            assert!(read_trusted(&path, Secrecy::Public).is_err(), "{right}");
            assert!(too_open(&path, Secrecy::Secret).is_some(), "{right}");
        }
        // A deny entry never widens access (BUILTIN\Guests, which this user is not in).
        icacls(&path, &["/remove:g", USERS]);
        icacls(&path, &["/deny", "*S-1-5-32-546:(R)"]);
        assert_eq!(too_open(&path, Secrecy::Secret), None);
        icacls(&path, &["/remove:d", "*S-1-5-32-546"]);
        // A directory others may add files to lets them replace the file: there is no sticky
        // bit to stop them.
        let dir = temp.path();
        icacls(dir, &["/grant", &format!("{USERS}:(WD)")]);
        let problem = too_open(&path, Secrecy::Public).unwrap();
        assert!(problem.contains("is in a directory"), "{problem}");
        assert!(
            problem.contains("the right to add or remove its entries"),
            "{problem}"
        );
        assert!(read_trusted(&path, Secrecy::Public).is_err());
        // Removing its entries, too.
        icacls(dir, &["/grant:r", &format!("{USERS}:(DC)")]);
        assert!(too_open(&path, Secrecy::Public).is_some());
        // An inherit-only entry counts as an explicit one.
        icacls(dir, &["/remove:g", USERS]);
        assert_eq!(too_open(&path, Secrecy::Public), None);
        icacls(dir, &["/grant", &format!("{USERS}:(OI)(IO)(W)")]);
        assert!(too_open(&path, Secrecy::Public).is_some());
        icacls(dir, &["/remove:g", USERS]);
        assert_eq!(too_open(&path, Secrecy::Public), None);
        // A missing file is no problem here: reading it reports that.
        assert_eq!(too_open(&dir.join("missing"), Secrecy::Secret), None);
    }
}
