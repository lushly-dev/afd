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

/// Whether this platform's file permissions are checked: Unix only.
pub(crate) const PERMISSIONS_CHECKED: bool = cfg!(unix);

/// Why the mode `mode` is too wide for `secrecy`.
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
fn owner_problem(owner: u32, me: u32) -> Option<String> {
    (owner != me && owner != 0)
        .then(|| format!("is owned by user {owner}, neither this user ({me}) nor root"))
}

/// Why a directory with mode `mode` lets others replace the files in it: writable by group or
/// other without the sticky bit.
fn directory_problem(mode: u32) -> Option<String> {
    (mode & 0o022 != 0 && mode & 0o1000 == 0).then(|| {
        format!(
            "is in a directory writable by group or other without the sticky bit (mode {:o})",
            mode & 0o7777
        )
    })
}

/// Why the file at `path` may be read or replaced by someone it should not, for `secrecy`, or
/// `None` when it may not (or the platform has no Unix permissions; see
/// [`PERMISSIONS_CHECKED`]). The file's mode and owner are read through symbolic links, and the
/// directory holding it is checked as named and as resolved.
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
    #[cfg(not(unix))]
    {
        let _ = (path, secrecy);
        None
    }
}

/// The bytes of the trust file at `path`, as [`read_limited`] reads a file, checked for
/// `secrecy` on the file that was opened (its own `fstat`, so a file renamed into place after the
/// check cannot be read in its stead) and on the directories holding it, as [`too_open`] checks
/// them.
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
}
