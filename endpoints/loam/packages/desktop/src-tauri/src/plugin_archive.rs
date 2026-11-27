//! Canonical `.loam-plugin` archive reader, directory bundler staging, and staged-only bundle
//! inspection (phase 5 no-terminal amendment, 4.4 & 7.1; P5-S9-2).
//!
//! Enforces the exact canonical zip form written by `loam plugin pack` (`zip.ts` / `plugin-archive.ts`)
//! with identical refusal codes, keys, ordering, and stable `reason` tags across all shared cases
//! in `loam-plugin-cases.json`. Zero plugin code is ever executed here.
use crate::plugin_manifest::{PluginManifest, Target};
use crate::plugin_validate::{
    BUNDLE_BYTES_MAX, BUNDLE_FILES_MAX, BUNDLE_PATH_MAX_BYTES, MANIFEST_MAX_BYTES,
    PackedAppSummary, ValidationRefusal, bundle_digest, bundle_path_problem, check_path_collisions,
    parse_packed_app_manifest, sha256_hex, validate_plugin_apps, validate_plugin_manifest,
};
use crate::plugins_error::{
    PLUGIN_BUNDLE_TOO_LARGE, PLUGIN_HASH_MISMATCH, PLUGIN_MANIFEST_INVALID,
    PLUGIN_MANIFEST_MISSING, PLUGIN_PATH_ESCAPE,
};
use flate2::{Decompress, FlushDecompress, Status};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// File extension of a packed `.loam-plugin` archive.
pub const PLUGIN_ARCHIVE_EXTENSION: &str = ".loam-plugin";

/// Bundle bounds enforced during staging and archive inspection (amendment 4.4, rule 3).
#[derive(Debug, Clone, Copy)]
pub struct BundleLimits {
    pub bytes: usize,
    pub files: usize,
}

impl Default for BundleLimits {
    fn default() -> Self {
        Self {
            bytes: BUNDLE_BYTES_MAX,
            files: BUNDLE_FILES_MAX,
        }
    }
}

/// Exact allowance above `limits.bytes` that a canonical archive of a valid bundle can occupy
/// (matching `plugin-archive.ts` `archiveAllowance`: 3,319,950 bytes at 256 MiB / 2,000 files).
pub fn archive_allowance(limits: BundleLimits) -> usize {
    let headers = limits.files * (30 + 46 + 2 * BUNDLE_PATH_MAX_BYTES);
    let deflate = (limits.bytes / 4096)
        + (limits.bytes / 16384)
        + (limits.bytes / 33_554_432)
        + 7 * limits.files;
    headers + deflate + 22
}

/// One entry decoded from a canonical `.loam-plugin` archive.
#[derive(Debug, Clone)]
pub struct ZipEntry {
    pub path: String,
    pub data: Vec<u8>,
    pub executable: bool,
}

const LOCAL_SIG: u32 = 0x0403_4b50;
const CENTRAL_SIG: u32 = 0x0201_4b50;
const EOCD_SIG: u32 = 0x0605_4b50;

const CANONICAL_VERSION_NEEDED: u16 = 20;
const CANONICAL_MADE_BY: u16 = (3 << 8) | 20;
const CANONICAL_FLAGS: u16 = 0x0800;
const CANONICAL_METHOD: u16 = 8;
const CANONICAL_TIME: u16 = 0;
const CANONICAL_DATE: u16 = (1 << 5) | 1; // 1980-01-01
const CANONICAL_MODE_FILE: u32 = 0o100644 << 16;
const CANONICAL_MODE_EXEC: u32 = 0o100755 << 16;
const S_IFMT: u32 = 0o170000;

const SIGNATURES: [[u8; 4]; 6] = [
    0x0403_4b50u32.to_le_bytes(),
    0x0201_4b50u32.to_le_bytes(),
    0x0605_4b50u32.to_le_bytes(),
    0x0606_4b50u32.to_le_bytes(),
    0x0706_4b50u32.to_le_bytes(),
    0x0807_4b50u32.to_le_bytes(),
];

fn u16_le(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([buf[off], buf[off + 1]])
}

fn u32_le(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
}

fn malformed(reason: &'static str, message: impl Into<String>) -> ValidationRefusal {
    ValidationRefusal::new(PLUGIN_MANIFEST_INVALID, "(archive)", reason, message)
}

fn too_large(reason: &'static str, message: impl Into<String>) -> ValidationRefusal {
    ValidationRefusal::new(PLUGIN_BUNDLE_TOO_LARGE, "(archive)", reason, message)
}

fn not_regular_kind(external: u32) -> Option<&'static str> {
    match (external >> 16) & S_IFMT {
        0o120000 => Some("a symbolic link"),
        0o040000 => Some("a directory"),
        0o010000 => Some("a FIFO"),
        0o020000 => Some("a character device"),
        0o060000 => Some("a block device"),
        0o140000 => Some("a socket"),
        _ => None,
    }
}

fn contains_bytes(haystack: &[u8], needle: &[u8; 4]) -> bool {
    haystack.windows(4).any(|w| w == needle)
}

struct CentralEntry {
    name: String,
    name_bytes: Vec<u8>,
    crc: u32,
    compressed: usize,
    declared: usize,
    start: usize,
    executable: bool,
}

fn inflate_raw_exact(input: &[u8], declared: usize) -> Result<Vec<u8>, &'static str> {
    let mut decompressor = Decompress::new(false);
    let cap = declared.saturating_add(1);
    let mut out = Vec::with_capacity(declared.min(64 * 1024));
    let mut chunk = [0u8; 16 * 1024];
    let mut in_pos = 0usize;
    loop {
        let before_in = decompressor.total_in();
        let before_out = decompressor.total_out();
        let room = cap.saturating_sub(out.len()).min(chunk.len());
        let status = decompressor
            .decompress(&input[in_pos..], &mut chunk[..room], FlushDecompress::None)
            .map_err(|_| "stream-corrupt")?;
        let consumed = (decompressor.total_in() - before_in) as usize;
        let produced = (decompressor.total_out() - before_out) as usize;
        in_pos += consumed;
        out.extend_from_slice(&chunk[..produced]);
        if out.len() > declared {
            return Err("stream-too-long");
        }
        match status {
            Status::StreamEnd => {
                if in_pos != input.len() {
                    return Err("stream-trailing");
                }
                return Ok(out);
            }
            Status::Ok | Status::BufError => {
                if out.len() >= cap {
                    return Err("stream-too-long");
                }
                if consumed == 0 && produced == 0 {
                    return Err("stream-unfinished");
                }
            }
        }
    }
}

/// Parses and inflates a canonical `.loam-plugin` zip buffer in the exact refusal order of
/// amendment 4.4 / `zip.ts`: structure (end record, central + local entries, central directory
/// signatures), bounds (`too-many-entries`, `declared-size`), then data inflation & CRC-32.
pub fn read_canonical_zip(
    zip: &[u8],
    budget: usize,
    max_entries: usize,
) -> Result<Vec<ZipEntry>, ValidationRefusal> {
    if zip.len() < 22 {
        return Err(malformed(
            "end-record",
            "last 22 bytes are not an end record",
        ));
    }
    let end = zip.len() - 22;
    if u32_le(zip, end) != EOCD_SIG {
        return Err(malformed(
            "end-record",
            "last 22 bytes are not an end record",
        ));
    }
    let after = &zip[end + 1..];
    if SIGNATURES.iter().any(|sig| contains_bytes(after, sig)) {
        return Err(malformed(
            "signature-in-end-record",
            "end record holds a record signature in its fields",
        ));
    }
    let disk = u16_le(zip, end + 4);
    let dir_disk = u16_le(zip, end + 6);
    let count_here = u16_le(zip, end + 8);
    let count = u16_le(zip, end + 10);
    let size = u32_le(zip, end + 12);
    let offset = u32_le(zip, end + 16);
    let comment_len = u16_le(zip, end + 20);
    if count == 0xffff || size == 0xffff_ffff || offset == 0xffff_ffff {
        return Err(malformed("zip64", "ZIP64 archive is refused"));
    }
    if disk != 0 || dir_disk != 0 {
        return Err(malformed("disk", "multi-disk archive is refused"));
    }
    if count_here != count {
        return Err(malformed("entry-counts", "entry count mismatch"));
    }
    if comment_len != 0 {
        return Err(malformed("comment", "end record comment is refused"));
    }
    let size_usize = size as usize;
    let offset_usize = offset as usize;
    if offset_usize.checked_add(size_usize) != Some(end) {
        return Err(malformed(
            "directory-size",
            "central directory does not end at end record",
        ));
    }

    let mut centrals = Vec::with_capacity(usize::from(count).min(max_entries + 1));
    let mut at = offset_usize;
    let mut expected = 0usize;
    let mut previous_name: Option<&[u8]> = None;

    for _ in 0..count {
        if at + 46 > end || u32_le(zip, at) != CENTRAL_SIG {
            return Err(malformed(
                "directory-size",
                "central directory entry cut short",
            ));
        }
        let made_by = u16_le(zip, at + 4);
        let version_needed = u16_le(zip, at + 6);
        let flags = u16_le(zip, at + 8);
        let method = u16_le(zip, at + 10);
        let time = u16_le(zip, at + 12);
        let date = u16_le(zip, at + 14);
        let crc = u32_le(zip, at + 16);
        let compressed_u32 = u32_le(zip, at + 20);
        let declared_u32 = u32_le(zip, at + 24);
        let name_len = usize::from(u16_le(zip, at + 28));
        let extra_len = u16_le(zip, at + 30);
        let entry_comment_len = u16_le(zip, at + 32);
        let entry_disk = u16_le(zip, at + 34);
        let internal = u16_le(zip, at + 36);
        let external = u32_le(zip, at + 38);
        let local_u32 = u32_le(zip, at + 42);

        if compressed_u32 == 0xffff_ffff || declared_u32 == 0xffff_ffff || local_u32 == 0xffff_ffff
        {
            return Err(malformed("zip64", "ZIP64 entry is refused"));
        }
        if at + 46 + name_len > end {
            return Err(malformed(
                "directory-size",
                "central directory entry overruns directory",
            ));
        }
        let name_bytes = &zip[at + 46..at + 46 + name_len];
        let name = std::str::from_utf8(name_bytes)
            .map_err(|_| malformed("name-encoding", "entry name is not valid UTF-8"))?;

        if made_by != CANONICAL_MADE_BY {
            return Err(malformed("made-by", "non-canonical version made by"));
        }
        if version_needed != CANONICAL_VERSION_NEEDED {
            return Err(malformed("version-needed", "non-canonical version needed"));
        }
        if flags != CANONICAL_FLAGS {
            return Err(malformed("flags", "non-canonical flags"));
        }
        if method != CANONICAL_METHOD {
            return Err(malformed(
                if method == 0 { "stored" } else { "method" },
                "non-canonical compression method",
            ));
        }
        if time != CANONICAL_TIME || date != CANONICAL_DATE {
            return Err(malformed("time-date", "non-canonical timestamp"));
        }
        if extra_len != 0 {
            return Err(malformed("extra-field", "central extra field is refused"));
        }
        if entry_comment_len != 0 {
            return Err(malformed("comment", "central entry comment is refused"));
        }
        if entry_disk != 0 {
            return Err(malformed("disk", "entry disk is non-zero"));
        }
        if internal != 0 {
            return Err(malformed(
                "internal-attributes",
                "internal attributes are non-zero",
            ));
        }
        if name_len == 0 {
            return Err(malformed("name-empty", "entry has empty name"));
        }

        if external != CANONICAL_MODE_FILE && external != CANONICAL_MODE_EXEC {
            let kind = not_regular_kind(external);
            if kind.is_some() || name.ends_with('/') {
                let key = name.strip_suffix('/').unwrap_or(name);
                return Err(ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    key,
                    "not-regular",
                    format!("entry is {}", kind.unwrap_or("a directory")),
                ));
            }
            return Err(malformed("mode", "non-canonical external attributes"));
        }
        if let Some(key) = name.strip_suffix('/') {
            return Err(ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                key,
                "not-regular",
                "entry is a directory",
            ));
        }
        if let Some(prev) = previous_name
            && prev >= name_bytes
        {
            return Err(malformed(
                "name-order",
                "entry names are not strictly increasing UTF-8 bytes",
            ));
        }
        previous_name = Some(name_bytes);

        let local = local_u32 as usize;
        let compressed = compressed_u32 as usize;
        let declared = declared_u32 as usize;
        if local != expected {
            return Err(malformed(
                "tiling",
                "local record does not tile tightly from offset 0",
            ));
        }
        if local
            .checked_add(30)
            .is_none_or(|end_l| end_l > offset_usize)
            || u32_le(zip, local) != LOCAL_SIG
        {
            return Err(malformed("tiling", "missing local header"));
        }
        if u16_le(zip, local + 4) != CANONICAL_VERSION_NEEDED
            || u16_le(zip, local + 6) != CANONICAL_FLAGS
            || u16_le(zip, local + 8) != CANONICAL_METHOD
            || u16_le(zip, local + 10) != CANONICAL_TIME
            || u16_le(zip, local + 12) != CANONICAL_DATE
            || u32_le(zip, local + 14) != crc
            || u32_le(zip, local + 18) != compressed_u32
            || u32_le(zip, local + 22) != declared_u32
            || usize::from(u16_le(zip, local + 26)) != name_len
        {
            return Err(malformed(
                "local-header",
                "local header disagrees with central header",
            ));
        }
        if u16_le(zip, local + 28) != 0 {
            return Err(malformed("extra-field", "local extra field is refused"));
        }
        let start = local + 30 + name_len;
        if start > offset_usize || &zip[local + 30..start] != name_bytes {
            return Err(malformed("local-header", "local header name mismatch"));
        }
        if start
            .checked_add(compressed)
            .is_none_or(|end_d| end_d > offset_usize)
        {
            return Err(malformed("tiling", "entry data overruns archive"));
        }

        centrals.push(CentralEntry {
            name: name.to_owned(),
            name_bytes: name_bytes.to_vec(),
            crc,
            compressed,
            declared,
            start,
            executable: external == CANONICAL_MODE_EXEC,
        });
        expected = start + compressed;
        at += 46 + name_len;
    }

    if at != end {
        return Err(malformed(
            "directory-size",
            "central directory holds trailing bytes",
        ));
    }
    if expected != offset_usize {
        return Err(malformed(
            "tiling",
            "gap between last local record and central directory",
        ));
    }

    // Structural signature scan across the central directory.
    let mut entry_starts = HashSet::with_capacity(centrals.len());
    let mut cursor = offset_usize;
    for entry in &centrals {
        entry_starts.insert(cursor);
        cursor += 46 + entry.name_bytes.len();
    }
    let directory = &zip[offset_usize..end];
    for (sig_idx, sig) in SIGNATURES.iter().enumerate() {
        for (pos, window) in directory.windows(4).enumerate() {
            if window == sig && !(sig_idx == 1 && entry_starts.contains(&(offset_usize + pos))) {
                return Err(malformed(
                    "signature-in-directory",
                    "central directory holds an unexpected record signature",
                ));
            }
        }
    }

    // Bounds checked before inflating any entry.
    if usize::from(count) > max_entries {
        return Err(too_large("too-many-entries", "too many entries"));
    }
    let total_declared: u64 = centrals.iter().map(|e| e.declared as u64).sum();
    if total_declared > budget as u64 {
        return Err(too_large("declared-size", "declared size exceeds budget"));
    }

    // Inflate entries in central directory order.
    let mut entries = Vec::with_capacity(centrals.len());
    for entry in centrals {
        let compressed_slice = &zip[entry.start..entry.start + entry.compressed];
        let data = inflate_raw_exact(compressed_slice, entry.declared)
            .map_err(|reason| malformed(reason, format!("deflate error in {}", entry.name)))?;
        if data.len() != entry.declared || crc32fast::hash(&data) != entry.crc {
            return Err(malformed(
                "size-crc",
                format!("size or CRC-32 mismatch in {}", entry.name),
            ));
        }
        entries.push(ZipEntry {
            path: entry.name,
            data,
            executable: entry.executable,
        });
    }
    Ok(entries)
}

/// Verified staged bundle produced exclusively from staged bytes inside `staging_dir`.
#[derive(Debug)]
pub struct StagedBundle {
    pub manifest: PluginManifest,
    pub apps: HashMap<String, PackedAppSummary>,
    pub bundle_sha256: String,
    pub engine_digests: BTreeMap<Target, String>,
    pub files: Vec<(String, String)>,
}

/// Creates a new directory owned exclusively by the current user (`0700` on Unix; protected DACL
/// on Windows via `connection::ensure_dir_owner_only`).
pub fn create_owner_only_dir(path: &Path) -> std::io::Result<()> {
    crate::connection::ensure_dir_owner_only(path)
}

fn open_regular_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path)?;
    if file.metadata()?.is_file() {
        Ok(file)
    } else {
        Err(std::io::ErrorKind::InvalidData.into())
    }
}

/// Verified handle-anchored directory reader for staging directory bundles without TOCTOU path
/// re-resolution across intermediate components (mirrors `site::ManagedRoot`).
struct AnchoredDir {
    #[cfg(unix)]
    dir_fd: std::os::fd::OwnedFd,
    #[cfg(not(unix))]
    root: PathBuf,
}

impl AnchoredDir {
    fn open(canonical_root: &Path) -> std::io::Result<Self> {
        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::fd::{FromRawFd, OwnedFd};
            use std::os::unix::ffi::OsStrExt;
            let c_path = CString::new(canonical_root.as_os_str().as_bytes())
                .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
            // SAFETY: `c_path` is NUL-terminated; returns a fresh directory fd owned by `OwnedFd`.
            let fd = unsafe {
                libc::open(
                    c_path.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                )
            };
            if fd < 0 {
                return Err(std::io::Error::last_os_error());
            }
            // SAFETY: `fd >= 0` is uniquely owned here.
            let dir_fd = unsafe { OwnedFd::from_raw_fd(fd) };
            Ok(Self { dir_fd })
        }
        #[cfg(not(unix))]
        {
            Ok(Self {
                root: canonical_root.to_path_buf(),
            })
        }
    }

    fn open_regular_file(&self, rel: &str) -> std::io::Result<std::fs::File> {
        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
            let segments: Vec<&str> = rel.split('/').collect();
            if segments.is_empty() {
                return Err(std::io::Error::from(std::io::ErrorKind::InvalidInput));
            }
            let mut cur: Option<OwnedFd> = None;
            for seg in &segments[..segments.len() - 1] {
                let c_seg = CString::new(*seg)
                    .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
                let parent_fd = cur
                    .as_ref()
                    .map_or_else(|| self.dir_fd.as_raw_fd(), AsRawFd::as_raw_fd);
                // SAFETY: `parent_fd` is a live directory fd and `c_seg` is NUL-terminated.
                let next = unsafe {
                    libc::openat(
                        parent_fd,
                        c_seg.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                    )
                };
                if next < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                // SAFETY: `next >= 0` is uniquely owned here.
                cur = Some(unsafe { OwnedFd::from_raw_fd(next) });
            }
            let leaf = CString::new(segments[segments.len() - 1])
                .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
            let parent_fd = cur
                .as_ref()
                .map_or_else(|| self.dir_fd.as_raw_fd(), AsRawFd::as_raw_fd);
            // SAFETY: `parent_fd` is a live directory fd and `leaf` is NUL-terminated.
            let fd = unsafe {
                libc::openat(
                    parent_fd,
                    leaf.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                )
            };
            if fd < 0 {
                return Err(std::io::Error::last_os_error());
            }
            // SAFETY: `fd >= 0` is uniquely owned here.
            let file = unsafe { std::fs::File::from_raw_fd(fd) };
            if file.metadata()?.is_file() {
                Ok(file)
            } else {
                Err(std::io::Error::from(std::io::ErrorKind::InvalidData))
            }
        }
        #[cfg(windows)]
        {
            use std::ffi::OsString;
            use std::os::windows::ffi::OsStringExt;
            use std::os::windows::fs::MetadataExt;
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Foundation::HANDLE;
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_NAME_NORMALIZED, GetFinalPathNameByHandleW,
            };
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
            let mut path = self.root.clone();
            for seg in rel.split('/') {
                path.push(seg);
            }
            let file = open_regular_no_follow(&path)?;
            let meta = file.metadata()?;
            if !meta.is_file() || (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                return Err(std::io::Error::from(std::io::ErrorKind::InvalidData));
            }
            let handle = file.as_raw_handle() as HANDLE;
            // SAFETY: queries required UTF-16 buffer length for `handle`.
            let needed = unsafe {
                GetFinalPathNameByHandleW(handle, std::ptr::null_mut(), 0, FILE_NAME_NORMALIZED)
            };
            if needed == 0 {
                return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
            }
            let mut buf = vec![0u16; needed as usize];
            // SAFETY: `buf` has length `needed`.
            let written = unsafe {
                GetFinalPathNameByHandleW(handle, buf.as_mut_ptr(), needed, FILE_NAME_NORMALIZED)
            };
            if written == 0 || written >= needed {
                return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
            }
            let final_path = PathBuf::from(OsString::from_wide(&buf[..written as usize]));
            if !final_path.starts_with(&self.root) {
                return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
            }
            Ok(file)
        }
    }
}

fn write_staged_file(staging_root: &Path, relative: &str, data: &[u8]) -> std::io::Result<()> {
    let mut target = staging_root.to_path_buf();
    let segments: Vec<&str> = relative.split('/').collect();
    for seg in &segments[..segments.len().saturating_sub(1)] {
        target.push(seg);
        if std::fs::symlink_metadata(&target).is_err() {
            create_owner_only_dir(&target)?;
        }
    }
    target.push(segments[segments.len() - 1]);
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = opts.open(&target)?;
    file.write_all(data)?;
    file.sync_all()
}

/// Inspects and stages a `.loam-plugin` archive into `staging_dir`, enforcing all canonical zip,
/// path, manifest, app, engine hash, extra-file, and executable-mode rules strictly on staged bytes.
pub fn stage_and_validate_archive(
    archive_path: &Path,
    staging_dir: &Path,
    limits: BundleLimits,
) -> Result<StagedBundle, Vec<ValidationRefusal>> {
    let seen = std::fs::symlink_metadata(archive_path).map_err(|_| {
        vec![ValidationRefusal::new(
            PLUGIN_PATH_ESCAPE,
            "(archive)",
            "archive-file",
            "archive does not exist or cannot be stat'd",
        )]
    })?;
    if seen.file_type().is_symlink() || !seen.is_file() {
        return Err(vec![ValidationRefusal::new(
            PLUGIN_PATH_ESCAPE,
            "(archive)",
            "archive-file",
            "archive is not a regular file",
        )]);
    }
    let max_archive_bytes = limits.bytes.saturating_add(archive_allowance(limits));
    if seen.len() > max_archive_bytes as u64 {
        return Err(vec![too_large(
            "archive-size",
            format!("archive is {} bytes", seen.len()),
        )]);
    }
    let mut file = open_regular_no_follow(archive_path).map_err(|_| {
        vec![ValidationRefusal::new(
            PLUGIN_PATH_ESCAPE,
            "(archive)",
            "archive-file",
            "archive changed while read or is a link",
        )]
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let opened = file.metadata().map_err(|_| {
            vec![ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                "(archive)",
                "archive-file",
                "could not stat opened archive",
            )]
        })?;
        if !opened.is_file() || opened.ino() != seen.ino() || opened.dev() != seen.dev() {
            return Err(vec![ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                "(archive)",
                "archive-file",
                "archive changed while it was read",
            )]);
        }
    }
    let mut bytes = Vec::with_capacity((seen.len() as usize).min(max_archive_bytes));
    Read::by_ref(&mut file)
        .take(max_archive_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            vec![ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                "(archive)",
                "archive-file",
                "failed reading archive",
            )]
        })?;
    if bytes.len() > max_archive_bytes {
        return Err(vec![too_large(
            "archive-size",
            "archive grew past size bound while read",
        )]);
    }

    let entries = read_canonical_zip(&bytes, limits.bytes, limits.files).map_err(|r| vec![r])?;
    let paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
    let path_refusals = check_path_collisions(&paths);
    if !path_refusals.is_empty() {
        return Err(path_refusals);
    }
    let name_set: HashSet<&str> = entries.iter().map(|e| e.path.as_str()).collect();
    if !name_set.contains("plugin-manifest.json") || name_set.contains("loam-plugin.toml") {
        return Err(vec![ValidationRefusal::new(
            PLUGIN_MANIFEST_MISSING,
            "(archive)",
            "manifest-missing",
            "archive must hold plugin-manifest.json and no loam-plugin.toml",
        )]);
    }

    create_owner_only_dir(staging_dir).map_err(|_| {
        vec![ValidationRefusal::new(
            PLUGIN_PATH_ESCAPE,
            "(archive)",
            "staging",
            "could not create staging directory",
        )]
    })?;
    let mut stage_failures = Vec::new();
    for entry in &entries {
        if write_staged_file(staging_dir, &entry.path, &entry.data).is_err() {
            stage_failures.push(ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                &entry.path,
                "staging",
                "entry could not be staged on this system",
            ));
        }
    }
    if !stage_failures.is_empty() {
        return Err(stage_failures);
    }

    let staged = validate_staged_directory(staging_dir, limits)?;
    // Last: verify `100755` marks EXACTLY the manifest's engine artifacts.
    let engine_paths: HashSet<&str> = staged
        .manifest
        .engine
        .as_ref()
        .map(|e| e.artifacts.values().map(|a| a.path.as_str()).collect())
        .unwrap_or_default();
    let mode_refusals: Vec<ValidationRefusal> = entries
        .iter()
        .filter(|entry| entry.executable != engine_paths.contains(entry.path.as_str()))
        .map(|entry| {
            ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                &entry.path,
                if entry.executable {
                    "mode-executable"
                } else {
                    "mode-engine"
                },
                if entry.executable {
                    "non-engine entry has executable mode 100755"
                } else {
                    "engine artifact has mode 100644 instead of 100755"
                },
            )
        })
        .collect();
    if !mode_refusals.is_empty() {
        return Err(mode_refusals);
    }
    Ok(staged)
}

/// Copies a packed directory bundle into `staging_dir` (refusing symlinks, special files, path
/// escapes, case collisions, and bounds), then validates ONLY the staged bytes.
pub fn stage_and_validate_directory(
    source_dir: &Path,
    staging_dir: &Path,
    limits: BundleLimits,
) -> Result<StagedBundle, Vec<ValidationRefusal>> {
    let root_meta = std::fs::symlink_metadata(source_dir).map_err(|_| {
        vec![ValidationRefusal::new(
            PLUGIN_MANIFEST_MISSING,
            "(root)",
            "manifest-missing",
            "bundle directory does not exist",
        )]
    })?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err(vec![ValidationRefusal::new(
            PLUGIN_PATH_ESCAPE,
            "(root)",
            "path",
            "bundle path is not a real directory",
        )]);
    }
    let canonical_root = std::fs::canonicalize(source_dir).map_err(|_| {
        vec![ValidationRefusal::new(
            PLUGIN_PATH_ESCAPE,
            "(root)",
            "path",
            "bundle directory cannot be canonicalized",
        )]
    })?;

    let mut listed: Vec<String> = Vec::new();
    let mut folder_count: usize = 0;
    let mut total_bytes: u64 = 0;
    let mut pending = vec![(source_dir.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = pending.pop() {
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    "(root)",
                    "path",
                    "failed reading bundle directory",
                )]
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    "(root)",
                    "path",
                    "failed reading directory entry",
                )]
            })?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let name = entry.file_name().into_string().map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    "(root)",
                    "path",
                    "entry name is not valid UTF-8",
                )]
            })?;
            let rel = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            if let Some(problem) = bundle_path_problem(&rel) {
                return Err(vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    rel,
                    "path",
                    problem,
                )]);
            }
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path).map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    &rel,
                    "path",
                    "could not stat entry",
                )]
            })?;
            if meta.file_type().is_symlink() {
                return Err(vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    rel,
                    "not-regular",
                    "symbolic links are refused in plugin bundles",
                )]);
            }
            if meta.is_dir() {
                folder_count += 1;
                if folder_count > limits.files {
                    return Err(vec![ValidationRefusal::new(
                        PLUGIN_BUNDLE_TOO_LARGE,
                        "(root)",
                        "too-many-entries",
                        "bundle exceeds folder limit",
                    )]);
                }
                pending.push((path, rel));
            } else if meta.is_file() {
                total_bytes = total_bytes.saturating_add(meta.len());
                if listed.len() + 1 > limits.files || total_bytes > limits.bytes as u64 {
                    return Err(vec![ValidationRefusal::new(
                        PLUGIN_BUNDLE_TOO_LARGE,
                        "(root)",
                        "declared-size",
                        "bundle exceeds 256 MiB or 2,000 files",
                    )]);
                }
                listed.push(rel);
            } else {
                return Err(vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    rel,
                    "not-regular",
                    "non-regular file is refused in plugin bundles",
                )]);
            }
        }
    }

    let collisions = check_path_collisions(&listed);
    if !collisions.is_empty() {
        return Err(collisions);
    }

    create_owner_only_dir(staging_dir).map_err(|_| {
        vec![ValidationRefusal::new(
            PLUGIN_PATH_ESCAPE,
            "(root)",
            "staging",
            "could not create staging directory",
        )]
    })?;

    // Anchor file reads to a verified directory handle (`openat(..., O_NOFOLLOW)` on Unix;
    // `FILE_FLAG_OPEN_REPARSE_POINT` + `GetFinalPathNameByHandleW` on Windows) so a swapped
    // ancestor between directory walk and copy cannot escape `source_dir`.
    let root_handle = AnchoredDir::open(&canonical_root).map_err(|_| {
        vec![ValidationRefusal::new(
            PLUGIN_PATH_ESCAPE,
            "(root)",
            "path",
            "could not anchor bundle root directory",
        )]
    })?;

    let mut copied_bytes: u64 = 0;
    for rel in &listed {
        let mut reader = root_handle.open_regular_file(rel).map_err(|_| {
            vec![ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                rel,
                "not-regular",
                "file is not a regular file within bundle root",
            )]
        })?;
        let remaining = (limits.bytes as u64).saturating_sub(copied_bytes);
        let mut buf = Vec::new();
        Read::by_ref(&mut reader)
            .take(remaining + 1)
            .read_to_end(&mut buf)
            .map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    rel,
                    "staging",
                    "failed reading source file",
                )]
            })?;
        copied_bytes = copied_bytes.saturating_add(buf.len() as u64);
        if copied_bytes > limits.bytes as u64 {
            return Err(vec![ValidationRefusal::new(
                PLUGIN_BUNDLE_TOO_LARGE,
                "(root)",
                "declared-size",
                "bundle grew past 256 MiB while staging",
            )]);
        }
        write_staged_file(staging_dir, rel, &buf).map_err(|_| {
            vec![ValidationRefusal::new(
                PLUGIN_PATH_ESCAPE,
                rel,
                "staging",
                "failed writing staged file",
            )]
        })?;
    }

    validate_staged_directory(staging_dir, limits)
}

/// Validates ONLY the files already staged inside `staging_dir` against every rule in section 4.4
/// (manifest schema & rules, packed app manifests, built files, engine SHA-256s, rule 6 exact
/// file set, bounds) and computes `bundleSha256`.
pub fn validate_staged_directory(
    staging_dir: &Path,
    limits: BundleLimits,
) -> Result<StagedBundle, Vec<ValidationRefusal>> {
    // List every file staged under `staging_dir`.
    let mut all_files: BTreeMap<String, PathBuf> = BTreeMap::new();
    let mut total_bytes: u64 = 0;
    let mut stack = vec![(staging_dir.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|_| {
            vec![ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                "(root)",
                "bundle",
                "could not read staged directory",
            )]
        })?;
        for entry in entries {
            let entry = entry.map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    "(root)",
                    "bundle",
                    "could not read staged entry",
                )]
            })?;
            let name = entry.file_name().into_string().map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    "(root)",
                    "path",
                    "staged name is not UTF-8",
                )]
            })?;
            let rel = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path).map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    &rel,
                    "path",
                    "could not stat staged entry",
                )]
            })?;
            if meta.file_type().is_symlink() {
                return Err(vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    rel,
                    "not-regular",
                    "symlink in staged directory",
                )]);
            }
            if meta.is_dir() {
                stack.push((path, rel));
            } else if meta.is_file() {
                total_bytes = total_bytes.saturating_add(meta.len());
                if all_files.len() + 1 > limits.files || total_bytes > limits.bytes as u64 {
                    return Err(vec![ValidationRefusal::new(
                        PLUGIN_BUNDLE_TOO_LARGE,
                        "(root)",
                        "declared-size",
                        "staged bundle exceeds limits",
                    )]);
                }
                all_files.insert(rel, path);
            } else {
                return Err(vec![ValidationRefusal::new(
                    PLUGIN_PATH_ESCAPE,
                    rel,
                    "not-regular",
                    "non-regular file in staged directory",
                )]);
            }
        }
    }

    if all_files.contains_key("loam-plugin.toml") && all_files.contains_key("plugin-manifest.json")
    {
        return Err(vec![ValidationRefusal::new(
            PLUGIN_MANIFEST_INVALID,
            "plugin-manifest.json",
            "bundle",
            "directory holds both loam-plugin.toml and plugin-manifest.json",
        )]);
    }
    let Some(manifest_path) = all_files.get("plugin-manifest.json") else {
        return Err(vec![ValidationRefusal::new(
            PLUGIN_MANIFEST_MISSING,
            "(root)",
            "manifest-missing",
            "plugin-manifest.json is missing",
        )]);
    };
    let manifest_bytes =
        read_file_bounded(manifest_path, MANIFEST_MAX_BYTES).map_err(|too_big| {
            vec![ValidationRefusal::new(
                if too_big {
                    PLUGIN_BUNDLE_TOO_LARGE
                } else {
                    PLUGIN_MANIFEST_INVALID
                },
                "plugin-manifest.json",
                "bundle",
                "could not read plugin-manifest.json",
            )]
        })?;
    let (manifest, _ordered) = validate_plugin_manifest(&manifest_bytes)?;

    let mut refusals = Vec::new();
    let mut known: HashSet<String> = HashSet::new();
    known.insert("plugin-manifest.json".to_owned());

    let mut apps = HashMap::new();
    for (idx, app) in manifest.apps.iter().enumerate() {
        let key = format!("apps[{idx}].path");
        let app_prefix = format!("{}/", app.path);
        let app_files: Vec<&String> = all_files
            .keys()
            .filter(|p| p.starts_with(&app_prefix))
            .collect();
        if app_files.is_empty() {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                key,
                "bundle",
                format!("app directory `{}` is missing or empty", app.path),
            ));
            continue;
        }
        for p in &app_files {
            if !known.insert((*p).clone()) {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    "apps",
                    "bundle",
                    "overlapping app or engine directory",
                ));
            }
        }
        let manifest_rel = format!("{}/app-manifest.json", app.path);
        let Some(app_manifest_path) = all_files.get(&manifest_rel) else {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                key,
                "bundle",
                "app directory holds no app-manifest.json",
            ));
            continue;
        };
        let Ok(app_bytes) = read_file_bounded(app_manifest_path, limits.bytes) else {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                key,
                "bundle",
                "failed reading app-manifest.json",
            ));
            continue;
        };
        let summary = match parse_packed_app_manifest(&app_bytes) {
            Ok(s) => s,
            Err(why) => {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    key,
                    "bundle",
                    why,
                ));
                continue;
            }
        };
        let held_rel: HashSet<&str> = app_files
            .iter()
            .filter_map(|p| p.strip_prefix(&app_prefix))
            .collect();
        for built in &summary.built_paths {
            if !held_rel.contains(built.as_str()) {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    &key,
                    "bundle",
                    format!("app-manifest.json names `{built}` which is absent"),
                ));
            }
        }
        apps.insert(app.id.clone(), summary);
    }

    refusals.extend(validate_plugin_apps(&manifest, &apps));

    let mut engine_digests = BTreeMap::new();
    let mut precomputed_hashes: HashMap<String, String> = HashMap::new();
    if let Some(engine) = &manifest.engine {
        for (&target, artifact) in &engine.artifacts {
            let key = format!("engine.artifacts[\"{}\"].path", target.as_str());
            let Some(art_path) = all_files.get(&artifact.path) else {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    key,
                    "bundle",
                    "engine artifact file is missing",
                ));
                continue;
            };
            if !known.insert(artifact.path.clone()) {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    "apps",
                    "bundle",
                    "engine artifact overlaps another path",
                ));
            }
            let Ok(art_bytes) = read_file_bounded(art_path, limits.bytes) else {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    key,
                    "bundle",
                    "failed reading engine artifact",
                ));
                continue;
            };
            let digest = sha256_hex(&art_bytes);
            if digest != artifact.sha256 {
                refusals.push(ValidationRefusal::new(
                    PLUGIN_HASH_MISMATCH,
                    format!("engine.artifacts[\"{}\"].sha256", target.as_str()),
                    "bundle",
                    "engine artifact SHA-256 mismatch",
                ));
                continue;
            }
            engine_digests.insert(target, digest.clone());
            precomputed_hashes.insert(artifact.path.clone(), digest);
        }
    }

    // Rule 6: a packed bundle holds what its manifest names, and nothing else.
    for path in all_files.keys() {
        if !known.contains(path) {
            refusals.push(ValidationRefusal::new(
                PLUGIN_MANIFEST_INVALID,
                path,
                "bundle",
                "file is not named by any app or engine in plugin-manifest.json",
            ));
        }
    }

    if !refusals.is_empty() {
        return Err(refusals);
    }

    let mut file_digests: Vec<(String, String)> = Vec::with_capacity(all_files.len());
    for (rel, path) in &all_files {
        let digest = if rel == "plugin-manifest.json" {
            sha256_hex(&manifest_bytes)
        } else if let Some(d) = precomputed_hashes.get(rel) {
            d.clone()
        } else {
            let bytes = read_file_bounded(path, limits.bytes).map_err(|_| {
                vec![ValidationRefusal::new(
                    PLUGIN_MANIFEST_INVALID,
                    rel,
                    "bundle",
                    "failed hashing staged file",
                )]
            })?;
            sha256_hex(&bytes)
        };
        file_digests.push((rel.clone(), digest));
    }
    let bundle_sha256 = bundle_digest(&file_digests);

    Ok(StagedBundle {
        manifest,
        apps,
        bundle_sha256,
        engine_digests,
        files: file_digests,
    })
}

fn read_file_bounded(path: &Path, max: usize) -> Result<Vec<u8>, bool> {
    let mut file = open_regular_no_follow(path).map_err(|_| false)?;
    let mut buf = Vec::new();
    Read::by_ref(&mut file)
        .take(max as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|_| false)?;
    if buf.len() > max { Err(true) } else { Ok(buf) }
}

#[cfg(test)]
#[path = "plugin_archive_tests.rs"]
mod tests;
