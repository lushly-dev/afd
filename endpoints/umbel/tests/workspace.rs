//! Workspace discovery, `umbel.toml` validation, the layout, keys and the lock
//! (specification sections 2 and 10; the rules that need no registry).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

use umbel::workspace::{
    ConfigFile, FoundBy, Located, Overrides, Workspace, WorkspaceError, discover,
};

fn workspace_with(text: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), text).unwrap();
    (dir, root)
}

fn open(text: &str) -> Result<Workspace, WorkspaceError> {
    let (_dir, root) = workspace_with(text);
    Workspace::open(&root)
}

fn invalid(text: &str, key: &str) {
    let error = open(text).expect_err(text);
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
    assert!(
        error.message().contains(key),
        "{text}: {error} does not name {key}"
    );
    assert!(!error.suggestion().is_empty());
}

// ── Discovery ──────────────────────────────────────────────────────────────────────────────────

fn marked(dir: &Path) -> PathBuf {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("umbel.toml"), "config_version = 1\n").unwrap();
    dir.to_path_buf()
}

#[test]
fn discovery_tries_the_flag_then_the_environment_then_the_search() {
    let temp = tempfile::tempdir().unwrap();
    let by_flag = marked(&temp.path().join("flag"));
    let by_env = marked(&temp.path().join("env"));
    let by_search = marked(&temp.path().join("search"));
    let cwd = by_search.join("a/b");
    fs::create_dir_all(&cwd).unwrap();
    let env: OsString = by_env.clone().into_os_string();

    let found = discover(Some(&by_flag), Some(&env), &cwd).unwrap();
    assert_eq!(
        (found.root, found.found_by),
        (by_flag.clone(), FoundBy::Flag)
    );
    let found = discover(None, Some(&env), &cwd).unwrap();
    assert_eq!((found.root, found.found_by), (by_env, FoundBy::Env));
    let found = discover(None, None, &cwd).unwrap();
    assert_eq!(
        (found.root, found.found_by),
        (by_search.clone(), FoundBy::Search)
    );
    // An empty value is unset.
    let empty = OsString::new();
    assert_eq!(
        discover(Some(Path::new("")), Some(&empty), &cwd)
            .unwrap()
            .found_by,
        FoundBy::Search
    );
}

#[test]
fn a_relative_flag_resolves_against_the_current_directory() {
    let temp = tempfile::tempdir().unwrap();
    let root = marked(&temp.path().join("ws"));
    let found = discover(Some(Path::new("ws")), None, temp.path()).unwrap();
    assert_eq!(found.root, root);
}

#[test]
fn the_first_rule_that_applies_decides_with_no_fallback() {
    let temp = tempfile::tempdir().unwrap();
    let real = marked(&temp.path().join("real"));
    let empty = temp.path().join("empty");
    fs::create_dir_all(&empty).unwrap();
    let error = discover(Some(&empty), None, &real).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_NOT_FOUND");
    assert!(error.message().contains("--workspace"));
    let env = empty.clone().into_os_string();
    let error = discover(None, Some(&env), &real).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_NOT_FOUND");
    assert!(error.message().contains("UMBEL_WORKSPACE"));
}

#[test]
fn nothing_found_is_workspace_not_found_with_the_documented_suggestion() {
    let temp = tempfile::tempdir().unwrap();
    let error = discover(None, None, temp.path()).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_NOT_FOUND");
    assert_eq!(
        error.suggestion(),
        "Pass --workspace <dir>, set UMBEL_WORKSPACE, or run umbel init."
    );
    assert!(!error.retryable());
}

// ── Defaults and validation ────────────────────────────────────────────────────────────────────

#[test]
fn the_minimal_file_is_a_complete_workspace_with_one_space_main() {
    let workspace = open("config_version = 1\n").unwrap();
    let config = workspace.config();
    assert_eq!(config.name, "ws");
    assert_eq!(workspace.default_space().as_str(), "main");
    assert_eq!(workspace.spaces().len(), 1);
    assert!(workspace.has_space("main") && !workspace.has_space("other"));
    assert_eq!(config.profile, "team");
    assert_eq!(config.http.bind.to_string(), "127.0.0.1:7410");
    assert_eq!(config.http.path, "/mcp");
    assert_eq!(config.http.max_body_bytes, 1_048_576);
    assert_eq!(config.mcp.tools_list_ttl_ms, 300_000);
    assert!(config.mcp.first_class_tools.is_none());
    assert!(config.journal.record_failures);
    assert_eq!(config.journal.lock_timeout_ms, 10_000);
    assert_eq!(config.log.filter(), "info");
    assert_eq!(config.principal.local_id, "local");
    assert!(config.plugins.enabled.is_empty());
}

#[test]
fn a_hand_written_file_works_without_init_and_opening_creates_state_and_keys() {
    let (_dir, root) = workspace_with(
        "config_version = 1\ndefault_space = \"main\"\n[spaces.main]\n[spaces.notes]\n",
    );
    let workspace = Workspace::open(&root).unwrap();
    let layout = workspace.layout();
    let notes = umbel::SpaceId::parse("notes").unwrap();
    assert!(layout.keys_dir().is_dir());
    assert!(layout.cursors_dir(&notes).is_dir());
    assert_eq!(workspace.approval_key().unwrap().len(), 32);
    assert_eq!(workspace.confirmation_key().unwrap().len(), 32);
    assert!(
        !layout.http_token().exists(),
        "the token waits for the first serve --http"
    );
}

#[test]
fn spaces_keep_the_files_order_and_titles() {
    let workspace = open(
        "config_version = 1\ndefault_space = \"b\"\n[spaces.z]\ntitle = \"Zed\"\n[spaces.b]\n[spaces.a]\n",
    )
    .unwrap();
    let spaces: Vec<_> = workspace
        .spaces()
        .iter()
        .map(|s| (s.id.as_str(), s.title.as_str()))
        .collect();
    assert_eq!(spaces, [("z", "Zed"), ("b", "b"), ("a", "a")]);
}

#[test]
fn every_validation_rule_names_its_key() {
    invalid("config_version = 1\nbogus = 1\n", "bogus");
    invalid("config_version = 1\n[http]\nbogus = 1\n", "http.bogus");
    invalid(
        "config_version = 1\n[spaces.main]\nbogus = 1\n",
        "spaces.main.bogus",
    );
    invalid("config_version = 1\n[spaces.Main]\n", "spaces.Main");
    invalid("config_version = 1\n[spaces.\"1x\"]\n", "spaces.1x");
    invalid(
        "config_version = 1\ndefault_space = \"nope\"\n",
        "default_space",
    );
    invalid(
        "config_version = 1\n[spaces.a]\n[spaces.b]\n",
        "default_space",
    );
    invalid("config_version = 1\nprofile = \"solo\"\n", "profile");
    invalid("config_version = 1\nname = \"\"\n", "name");
    invalid(
        "config_version = 1\n[plugins]\nenabled = [\"x\"]\n",
        "plugins.enabled",
    );
    invalid(
        "config_version = 1\n[mcp]\nfirst_class_tools = []\n",
        "mcp.first_class_tools",
    );
    invalid(
        "config_version = 1\n[mcp]\nfirst_class_tools = [\"a-b\",\"c-d\",\"e-f\",\"g-h\",\"i-j\",\"k-l\",\"m-n\",\"o-p\",\"q-r\"]\n",
        "mcp.first_class_tools",
    );
    invalid(
        "config_version = 1\n[mcp]\nfirst_class_tools = [\"Bad_Name\"]\n",
        "mcp.first_class_tools",
    );
    invalid(
        "config_version = 1\n[mcp]\nconfirmations = \"maybe\"\n",
        "mcp.confirmations",
    );
    invalid(
        "config_version = 1\n[http]\nbind = \"0.0.0.0:7410\"\n",
        "http.bind",
    );
    invalid(
        "config_version = 1\n[http]\nbind = \"localhost\"\n",
        "http.bind",
    );
    invalid(
        "config_version = 1\n[http]\nbind = \"10.0.0.1:1\"\n",
        "http.bind",
    );
    for path in ["mcp", "/", "/health", "/a?b", "/a#b", "/a/../b"] {
        invalid(
            &format!("config_version = 1\n[http]\npath = \"{path}\"\n"),
            "http.path",
        );
    }
    invalid(
        "config_version = 1\n[http]\nallowed_hosts = [\"*\"]\n",
        "http.allowed_hosts",
    );
    invalid(
        "config_version = 1\n[http]\nallowed_hosts = [\"*.example.test\"]\n",
        "http.allowed_hosts",
    );
    invalid(
        "config_version = 1\n[http]\nallowed_origins = [\"*\"]\n",
        "http.allowed_origins",
    );
    invalid(
        "config_version = 1\n[http]\nallowed_origins = [\"null\"]\n",
        "http.allowed_origins",
    );
    invalid(
        "config_version = 1\n[http]\nallowed_origins = [\"example.test\"]\n",
        "http.allowed_origins",
    );
    invalid(
        "config_version = 1\n[http]\nmax_body_bytes = 1023\n",
        "http.max_body_bytes",
    );
    invalid(
        "config_version = 1\n[http]\nmax_body_bytes = 16777217\n",
        "http.max_body_bytes",
    );
    invalid(
        "config_version = 1\n[journal]\nlock_timeout_ms = 99\n",
        "journal.lock_timeout_ms",
    );
    invalid(
        "config_version = 1\n[journal]\nlock_timeout_ms = 600001\n",
        "journal.lock_timeout_ms",
    );
    invalid(
        "config_version = 1\n[journal]\nrecord_failures = \"yes\"\n",
        "journal.record_failures",
    );
    invalid("config_version = 1\n[log]\nlevel = \"loud\"\n", "log.level");
    invalid(
        "config_version = 1\n[log]\nformat = \"xml\"\n",
        "log.format",
    );
    invalid(
        "config_version = 1\n[principal]\nlocal_id = \"\"\n",
        "principal.local_id",
    );
    invalid(
        &format!(
            "config_version = 1\n[principal]\nlocal_id = \"{}\"\n",
            "x".repeat(129)
        ),
        "principal.local_id",
    );
    invalid(
        "config_version = 1\n[principal]\nlocal_id = \"a\\u0007b\"\n",
        "principal.local_id",
    );
    invalid("config_version = 1\nname = 3\n", "name");
    invalid("config_version = 1\nhttp = 3\n", "http");
}

#[test]
fn boundary_values_are_accepted() {
    let workspace = open(
        "config_version = 1\n[http]\nbind = \"[::1]:0\"\nmax_body_bytes = 1024\nallowed_hosts = [\"localhost\", \"[::1]:7410\"]\nallowed_origins = [\"http://localhost:3000\"]\n[journal]\nlock_timeout_ms = 100\n",
    )
    .unwrap();
    assert_eq!(workspace.config().http.bind.port(), 0);
    assert_eq!(workspace.config().journal.lock_timeout_ms, 100);
}

#[test]
fn the_first_class_tools_are_kept_when_valid() {
    let workspace = open("config_version = 1\n[mcp]\nfirst_class_tools = [\"workspace-show\"]\nconfirmations = \"require-human\"\n").unwrap();
    assert_eq!(
        workspace.config().mcp.first_class_tools.as_deref(),
        Some(&["workspace-show".to_owned()][..])
    );
    assert_eq!(
        workspace.config().mcp.confirmations,
        umbel::workspace::Confirmations::RequireHuman
    );
}

#[test]
fn another_config_version_is_unsupported_and_names_the_supported_one() {
    for text in ["config_version = 2\n", "config_version = 0\n"] {
        let error = open(text).unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_CONFIG_UNSUPPORTED");
        assert_eq!(
            error.suggestion(),
            "This umbel reads configuration version 1; upgrade umbel or migrate umbel.toml."
        );
    }
    invalid("name = \"x\"\n", "config_version");
    invalid("config_version = \"1\"\n", "config_version");
    let error = open("config_version = [\n").unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(error.message().contains("not valid TOML"));
}

#[test]
fn reserved_keys_are_accepted_and_reported() {
    let text = "config_version = 1\n[spaces.main]\ncontent_roots = [\"notes\"]\nbackend = \"embedded\"\n[events]\nretention = \"forever\"\n";
    let workspace = open(text).unwrap();
    assert_eq!(workspace.default_space().as_str(), "main");
    let scan = ConfigFile::parse(text).unwrap().scan_keys();
    assert!(scan.unknown.is_empty());
    assert_eq!(
        scan.reserved,
        [
            "events.retention",
            "spaces.main.content_roots",
            "spaces.main.backend"
        ]
    );
}

// ── Precedence ─────────────────────────────────────────────────────────────────────────────────

fn open_with(text: &str, overrides: &Overrides) -> Result<Workspace, WorkspaceError> {
    let (_dir, root) = workspace_with(text);
    Workspace::open_located(
        &Located {
            root,
            found_by: FoundBy::Flag,
        },
        overrides,
    )
}

#[test]
fn flag_beats_environment_beats_file_beats_default() {
    let file = "config_version = 1\n[http]\nbind = \"127.0.0.1:1001\"\n[log]\nlevel = \"warn\"\n";
    let none = Overrides::default();
    assert_eq!(
        open_with(file, &none).unwrap().config().http.bind.port(),
        1001
    );
    assert_eq!(
        open_with("config_version = 1\n", &none)
            .unwrap()
            .config()
            .http
            .bind
            .port(),
        7410
    );

    let env = Overrides {
        http_bind: Some("127.0.0.1:1002".into()),
        log_filter: Some("umbel=debug".into()),
    };
    let flags = Overrides {
        http_bind: Some("127.0.0.1:1003".into()),
        log_filter: None,
    };
    let merged = flags.or(env.clone());
    let workspace = open_with(file, &env).unwrap();
    assert_eq!(workspace.config().http.bind.port(), 1002);
    assert_eq!(workspace.config().log.filter(), "umbel=debug");
    let workspace = open_with(file, &merged).unwrap();
    assert_eq!(workspace.config().http.bind.port(), 1003);
    assert_eq!(workspace.config().log.filter(), "umbel=debug");
}

#[test]
fn a_non_loopback_bind_is_refused_from_the_file_and_from_an_override() {
    invalid(
        "config_version = 1\n[http]\nbind = \"192.168.1.5:7410\"\n",
        "http.bind",
    );
    let overrides = Overrides {
        http_bind: Some("0.0.0.0:7410".into()),
        log_filter: None,
    };
    let error = open_with("config_version = 1\n", &overrides).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(error.message().contains("http.bind") && error.message().contains("UMBEL_HTTP_BIND"));
    let ok = Overrides {
        http_bind: Some("127.0.0.2:0".into()),
        log_filter: None,
    };
    assert!(open_with("config_version = 1\n", &ok).is_ok());
}

// ── init, layout and keys ──────────────────────────────────────────────────────────────────────

#[test]
fn init_creates_the_layout_with_private_keys() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("new/ws");
    let workspace = Workspace::init(&dir, Some("my-team")).unwrap();
    assert_eq!(workspace.config().name, "my-team");
    assert_eq!(
        fs::read_to_string(dir.join("umbel.toml")).unwrap(),
        "config_version = 1\nname = \"my-team\"\n"
    );
    assert!(dir.join("spaces/main").is_dir());
    assert!(dir.join("state/keys").is_dir());
    assert!(dir.join("state/spaces/main/cursors").is_dir());
    assert_eq!(
        fs::read_to_string(dir.join("state/.gitignore")).unwrap(),
        "*\n"
    );
    for key in ["approval.key", "confirmation.key"] {
        let path = dir.join("state/keys").join(key);
        assert_eq!(fs::read(&path).unwrap().len(), 32);
        assert_private(&path);
    }
    assert_ne!(
        fs::read(dir.join("state/keys/approval.key")).unwrap(),
        fs::read(dir.join("state/keys/confirmation.key")).unwrap()
    );
    let leftovers = fs::read_dir(dir.join("state/keys")).unwrap().count();
    assert_eq!(leftovers, 2, "no temporary key file stays behind");
}

#[test]
fn init_without_a_name_writes_only_the_version_and_defaults_the_name() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("team-notes");
    let workspace = Workspace::init(&dir, None).unwrap();
    assert_eq!(
        fs::read_to_string(dir.join("umbel.toml")).unwrap(),
        "config_version = 1\n"
    );
    assert_eq!(workspace.config().name, "team-notes");
}

#[test]
fn init_refuses_an_existing_workspace_and_a_bad_name() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("ws");
    Workspace::init(&dir, None).unwrap();
    let before = fs::read_to_string(dir.join("umbel.toml")).unwrap();
    let error = Workspace::init(&dir, Some("other")).unwrap_err();
    assert_eq!(error.code(), "ALREADY_EXISTS");
    assert_eq!(fs::read_to_string(dir.join("umbel.toml")).unwrap(), before);

    let error = Workspace::init(temp.path().join("bad"), Some("a\nb")).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
    assert!(
        !temp.path().join("bad").exists(),
        "a bad name creates nothing"
    );
}

#[cfg(unix)]
fn assert_private(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "{}", path.display());
}
#[cfg(not(unix))]
fn assert_private(_: &Path) {}

#[test]
fn a_key_under_32_bytes_fails_the_open_and_is_kept() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("ws");
    Workspace::init(&dir, None).unwrap();
    let key = dir.join("state/keys/confirmation.key");
    fs::write(&key, [7u8; 16]).unwrap();
    let error = Workspace::open(&dir).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_KEY_INVALID");
    assert!(error.message().contains("confirmation.key"));
    assert!(error.suggestion().starts_with("Delete "));
    assert_eq!(fs::read(&key).unwrap().len(), 16);
    fs::remove_file(&key).unwrap();
    assert!(
        Workspace::open(&dir).is_ok(),
        "the next open creates a new key"
    );
}

#[test]
fn processes_opening_a_fresh_workspace_at_once_end_with_one_shared_key() {
    let (_dir, root) = workspace_with("config_version = 1\n");
    let threads = 8;
    let barrier = Arc::new(Barrier::new(threads));
    let handles: Vec<_> = (0..threads)
        .map(|_| {
            let (root, barrier) = (root.clone(), barrier.clone());
            thread::spawn(move || {
                barrier.wait();
                let workspace = Workspace::open(&root).unwrap();
                (
                    workspace.approval_key().unwrap(),
                    workspace.confirmation_key().unwrap(),
                )
            })
        })
        .collect();
    let keys: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert!(
        keys.windows(2).all(|pair| pair[0] == pair[1]),
        "every opener read the winner's keys"
    );
    assert_eq!(fs::read_dir(root.join("state/keys")).unwrap().count(), 2);
}

#[test]
fn the_http_token_is_created_once_with_private_permissions() {
    let (_dir, root) = workspace_with("config_version = 1\n");
    let workspace = Workspace::open(&root).unwrap();
    let token = workspace.http_token().unwrap();
    assert_eq!(token.len(), 64);
    assert!(
        token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    );
    assert_eq!(Workspace::open(&root).unwrap().http_token().unwrap(), token);
    assert_private(&workspace.layout().http_token());
    fs::write(workspace.layout().http_token(), "short").unwrap();
    assert_eq!(
        workspace.http_token().unwrap_err().code(),
        "WORKSPACE_KEY_INVALID"
    );
}

#[test]
fn an_unwritable_state_directory_fails_the_open() {
    let (_dir, root) = workspace_with("config_version = 1\n");
    fs::write(root.join("state"), "a file where the directory belongs").unwrap();
    let error = Workspace::open(&root).unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_STATE_UNWRITABLE");
    assert!(error.suggestion().starts_with("Make "));
}

// ── The workspace lock ─────────────────────────────────────────────────────────────────────────

#[test]
fn the_lock_excludes_other_handles_and_times_out_with_the_documented_error() {
    let (_dir, root) = workspace_with("config_version = 1\n[journal]\nlock_timeout_ms = 100\n");
    let first = Workspace::open(&root).unwrap();
    let second = Workspace::open(&root).unwrap();
    let held = first.lock().unwrap();
    let started = Instant::now();
    let error = second.lock().unwrap_err();
    assert!(started.elapsed() >= Duration::from_millis(100));
    assert_eq!(error.code(), "WORKSPACE_LOCK_TIMEOUT");
    assert!(error.retryable());
    assert!(
        error.suggestion().contains("more than"),
        "{}",
        error.suggestion()
    );
    assert!(error.suggestion().contains("umbel workspace doctor"));
    drop(held);
    assert!(second.lock().is_ok(), "released on drop");
}

#[test]
fn the_journal_sink_shares_the_workspace_lock() {
    let (_dir, root) = workspace_with("config_version = 1\n[journal]\nlock_timeout_ms = 100\n");
    let workspace = Workspace::open(&root).unwrap();
    let sink = workspace.journal_sink();
    assert_eq!(sink.path(), workspace.layout().journal_file());
    let held = workspace.lock().unwrap();
    assert!(
        sink.lock().is_err(),
        "the sink's lock is the workspace lock"
    );
    drop(held);
    assert!(sink.lock().is_ok());
}
