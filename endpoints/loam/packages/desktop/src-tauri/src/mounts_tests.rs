use super::*;
use serde_json::json;

#[test]
fn events_split_on_either_line_ending_and_join_their_data() {
    let mut bytes =
        b"event: message\ndata: {\"a\":\ndata: 1}\n\nid: 2\r\ndata: {}\r\n\r\npartial".to_vec();
    let first = next_event(&mut bytes).unwrap();
    assert_eq!(event_data(&first).unwrap(), Some(json!({ "a": 1 })));
    let second = next_event(&mut bytes).unwrap();
    assert_eq!(event_data(&second).unwrap(), Some(json!({})));
    assert!(next_event(&mut bytes).is_none());
    assert_eq!(bytes, b"partial");
    assert_eq!(event_data(b": comment\n\n").unwrap(), None);
}

#[test]
fn requests_responses_and_notifications_are_told_apart() {
    assert_eq!(
        response_id(&json!({ "jsonrpc": "2.0", "id": 3, "result": {} })),
        Some("3".into())
    );
    assert_eq!(
        response_id(&json!({ "jsonrpc": "2.0", "id": "a", "error": {} })),
        Some("\"a\"".into())
    );
    assert_eq!(
        response_id(&json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" })),
        None
    );
    assert!(is_notification(
        &json!({ "jsonrpc": "2.0", "method": "notifications/message" })
    ));
    assert!(!is_notification(
        &json!({ "jsonrpc": "2.0", "id": 1, "method": "roots/list" })
    ));
}

#[test]
fn mounts_json_is_read_strictly() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mounts.json");
    assert!(read(&path).unwrap().is_empty());
    // No file serves nothing inbound (10.8).
    assert!(!read_deployed(&path).unwrap().inbound);
    std::fs::write(&path, r#"{"mounts":[{"instance":"a","url":"http://127.0.0.1:1/mcp","bearer":"t"},{"instance":"b","transport":"stdio","command":["hello-mcp"]}]}"#).unwrap();
    restrict(&path);
    assert_eq!(read(&path).unwrap().len(), 2);
    // `inbound` (10.8): off when absent, on only when the file says so, refused unless a boolean.
    assert!(!read_deployed(&path).unwrap().inbound);
    std::fs::write(&path, r#"{"mounts":[],"inbound":true}"#).unwrap();
    assert!(read_deployed(&path).unwrap().inbound);
    std::fs::write(&path, r#"{"mounts":[],"inbound":false}"#).unwrap();
    assert!(!read_deployed(&path).unwrap().inbound);
    std::fs::write(&path, r#"{"mounts":[],"inbound":"yes"}"#).unwrap();
    assert_eq!(read_deployed(&path).err(), Some(MOUNTS_INVALID));
    for bad in [
        r#"{"mounts":[{"instance":"a","url":"file:///etc/passwd"}]}"#,
        r#"{"mounts":[{"instance":"a","transport":"stdio","command":[]}]}"#,
        r#"{"mounts":[{"instance":"a","url":"http://x/"},{"instance":"a","url":"http://y/"}]}"#,
        r#"{"mounts":[],"extra":1}"#,
    ] {
        std::fs::write(&path, bad).unwrap();
        assert_eq!(read(&path).err(), Some(MOUNTS_INVALID), "{bad}");
    }
}

#[cfg(unix)]
pub(super) fn restrict(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
}

#[cfg(windows)]
pub(super) fn restrict(path: &Path) {
    let system = Path::new(&std::env::var_os("SystemRoot").unwrap()).join("System32");
    let user = std::process::Command::new(system.join("whoami.exe"))
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .unwrap();
    let sid = String::from_utf8(user.stdout)
        .unwrap()
        .trim()
        .rsplit(',')
        .next()
        .unwrap()
        .trim_matches('"')
        .to_owned();
    let icacls = system.join("icacls.exe");
    // Reset any explicit ACEs first (e.g., `BUILTIN\Administrators:(F)` expanded from
    // `CREATOR OWNER` on elevated tokens) before stripping inherited ACEs.
    let reset = std::process::Command::new(&icacls)
        .arg(path)
        .arg("/reset")
        .stdout(Stdio::null())
        .status()
        .unwrap();
    assert!(reset.success());
    let status = std::process::Command::new(&icacls)
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(format!("*{sid}:F"))
        .stdout(Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
    // Elevated tokens (such as `windows-latest`) create files owned by BUILTIN\Administrators;
    // set the file owner to this user's SID so `handle_owner_only` matches.
    let owner = std::process::Command::new(&icacls)
        .arg(path)
        .args(["/setowner", &format!("*{sid}")])
        .stdout(Stdio::null())
        .status()
        .unwrap();
    assert!(owner.success());
}

#[test]
fn p6_d2_a_mounts_json_others_can_read_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mounts.json");
    std::fs::write(&path, r#"{"mounts":[]}"#).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    // On Windows a new file in a temporary directory inherits entries for SYSTEM and Administrators.
    assert_eq!(read(&path).err(), Some(PERMISSIONS));
    restrict(&path);
    assert!(read(&path).is_ok());
}

#[cfg(windows)]
#[test]
fn p6_d2_windows_acl_refuses_other_allow_aces_directories_and_links() {
    let dir = tempfile::tempdir().unwrap();
    let system = Path::new(&std::env::var_os("SystemRoot").unwrap()).join("System32");
    let icacls = system.join("icacls.exe");
    let make = |name: &str| {
        let path = dir.path().join(name);
        std::fs::write(&path, r#"{"mounts":[]}"#).unwrap();
        restrict(&path);
        path
    };

    // Owner-only passes, including after clearing a pre-existing explicit `BUILTIN\Administrators:(F)`
    // ACE (the shape `CREATOR OWNER` leaves on elevated Windows accounts).
    let owned = make("owned.json");
    assert!(
        std::process::Command::new(&icacls)
            .arg(&owned)
            .args(["/grant", "*S-1-5-32-544:F"])
            .stdout(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    assert!(!owner_only(&owned));
    restrict(&owned);
    if !owner_only(&owned) {
        let acl = std::process::Command::new(&icacls)
            .arg(&owned)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        let owner = std::process::Command::new(system.join("cmd.exe"))
            .args(["/c", "dir", "/Q"])
            .arg(&owned)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        panic!("owner_only(&owned) returned false;\nicacls:\n{acl}\nowner:\n{owner}");
    }
    assert!(read(&owned).is_ok());

    // Granting Users read fails.
    let users = make("users.json");
    assert!(
        std::process::Command::new(&icacls)
            .arg(&users)
            .args(["/grant", "*S-1-5-32-545:R"])
            .stdout(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    assert!(!owner_only(&users));
    assert_eq!(read(&users).err(), Some(PERMISSIONS));

    // Granting Everyone read fails.
    let everyone = make("everyone.json");
    assert!(
        std::process::Command::new(&icacls)
            .arg(&everyone)
            .args(["/grant", "*S-1-1-0:R"])
            .stdout(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    assert!(!owner_only(&everyone));
    assert_eq!(read(&everyone).err(), Some(PERMISSIONS));

    // Adding a Deny ACE for Guests (a principal the current user is not in) alongside the owner's Allow
    // still passes: Deny ACEs restrict access and never grant it.
    let denied = make("denied.json");
    assert!(
        std::process::Command::new(&icacls)
            .arg(&denied)
            .args(["/deny", "*S-1-5-32-546:R"])
            .stdout(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    assert!(owner_only(&denied));
    assert!(read(&denied).is_ok());

    // A directory is refused.
    assert!(!owner_only(dir.path()));
    assert_eq!(
        read_owner_only(dir.path(), REQUEST_MAX),
        Err(Unread::Denied)
    );

    // A symlink to an owner-only file is refused (when the account has symlink privilege).
    let link = dir.path().join("link.json");
    if std::os::windows::fs::symlink_file(&owned, &link).is_ok() {
        assert!(!owner_only(&link));
        assert_eq!(read_owner_only(&link, REQUEST_MAX), Err(Unread::Denied));
    }
}

#[tokio::test]
async fn an_unknown_instance_and_a_refused_file_open_nothing() {
    let notify: Notify = Arc::new(|_, _| {});
    let mounts = Mounts::new(Ok(Vec::new()));
    assert_eq!(
        mounts.open("nope", notify.clone()).await.err(),
        Some(INSTANCE_UNKNOWN)
    );
    let refused = Mounts::new(Err(PERMISSIONS));
    assert_eq!(
        refused.open("any", notify.clone()).await.err(),
        Some(PERMISSIONS)
    );
    assert_eq!(
        mounts.send(9, json!({}), notify).await.err(),
        Some(UNREACHABLE)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_opens_take_at_most_four_handles_per_instance() {
    let entry: Access =
        serde_json::from_value(json!({ "instance": "a", "url": "http://127.0.0.1:1/mcp" }))
            .unwrap();
    let mounts = Arc::new(Mounts::new(Ok(vec![entry])));
    let notify: Notify = Arc::new(|_, _| {});
    let opens = (0..8).map(|_| {
        let mounts = mounts.clone();
        let notify = notify.clone();
        tokio::spawn(async move { mounts.open("a", notify).await })
    });
    let results = futures_util::future::join_all(opens).await;
    let opened = results
        .iter()
        .filter(|result| matches!(result, Ok(Ok(_))))
        .count();
    let limited = results
        .iter()
        .filter(|result| matches!(result, Ok(Err(LIMIT))))
        .count();
    assert_eq!(
        (opened, limited),
        (HANDLES_PER_INSTANCE, 8 - HANDLES_PER_INSTANCE)
    );
}

#[tokio::test]
async fn a_message_over_one_mebibyte_is_refused_before_it_is_sent() {
    let notify: Notify = Arc::new(|_, _| {});
    let mounts = Mounts::new(Ok(Vec::new()));
    let big = json!({ "jsonrpc": "2.0", "id": 1, "method": "x", "params": { "p": "x".repeat(REQUEST_MAX) } });
    assert_eq!(mounts.send(1, big, notify).await.err(), Some(TOO_LARGE));
}

#[tokio::test]
async fn p5_s9_6_singleton_mounts_config_swap_preserves_live_handles_and_refreshes_bearer() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen_auth = Arc::new(StdMutex::new(Vec::<String>::new()));
    let seen_auth_server = seen_auth.clone();
    let server = tokio::spawn(async move {
        for _ in 0..3 {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            let mut buf = vec![0u8; 4096];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            if let Some(auth_line) = req
                .lines()
                .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
            {
                seen_auth_server
                    .lock()
                    .unwrap()
                    .push(auth_line.trim().to_owned());
            }
            let body = r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(resp.as_bytes()).await;
        }
    });

    let notify: Notify = Arc::new(|_, _| {});
    let initial_entry: Access = serde_json::from_value(json!({
        "instance": "alpha",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "bearer": "tok-initial-01234567"
    }))
    .unwrap();
    let mounts = Arc::new(Mounts::new(Ok(vec![initial_entry])));

    // Open a live handle for `alpha`.
    let handle_a = mounts.open("alpha", notify.clone()).await.unwrap();
    let ping = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" });
    let first = mounts
        .send(handle_a, ping.clone(), notify.clone())
        .await
        .unwrap();
    assert_eq!(first["result"]["ok"], true);

    // Hot-swap entries on the singleton `Mounts`: remove `alpha`, add `beta`.
    let next_entry: Access = serde_json::from_value(json!({
        "instance": "beta",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "bearer": "tok-beta-01234567"
    }))
    .unwrap();
    mounts.update_entries(Ok(vec![next_entry]));

    // Opening `alpha` now fails with INSTANCE_UNKNOWN, while `beta` opens cleanly.
    assert_eq!(
        mounts.open("alpha", notify.clone()).await.err(),
        Some(INSTANCE_UNKNOWN)
    );
    let handle_b = mounts.open("beta", notify.clone()).await.unwrap();

    // The already-open handle for `alpha` stays live and can have its bearer refreshed in place.
    mounts.refresh_bearer("alpha", Some("tok-rotated-89abcdef".into()));
    let second = mounts
        .send(handle_a, ping.clone(), notify.clone())
        .await
        .unwrap();
    assert_eq!(second["result"]["ok"], true);

    // Closing `alpha` drops only `alpha`'s handles; `beta`'s handle remains usable.
    mounts.close_instance("alpha").await;
    assert_eq!(
        mounts
            .send(handle_a, ping.clone(), notify.clone())
            .await
            .err(),
        Some(UNREACHABLE)
    );
    let third = mounts.send(handle_b, ping, notify).await.unwrap();
    assert_eq!(third["result"]["ok"], true);

    mounts.close_all().await;
    server.await.unwrap();

    let observed = seen_auth.lock().unwrap();
    assert_eq!(observed.len(), 3);
    assert!(observed[0].ends_with("Bearer tok-initial-01234567"));
    assert!(observed[1].ends_with("Bearer tok-rotated-89abcdef"));
    assert!(observed[2].ends_with("Bearer tok-beta-01234567"));
}

#[tokio::test]
async fn p5_s9_6_refresh_bearer_and_close_instance_invalidate_in_flight_opens() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // Generate a random per-test proof key (never a hardcoded cryptographic literal).
    let mut key_bytes = [0u8; 32];
    getrandom::fill(&mut key_bytes).expect("OS random source");
    let proof_key: String = key_bytes.iter().map(|b| format!("{b:02x}")).collect();
    let proof_key_server = proof_key.clone();

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        for _ in 0..2 {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            let mut buf = vec![0u8; 4096];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let first_line = req.lines().next().unwrap_or("");
            let nonce = first_line
                .split_whitespace()
                .nth(1)
                .and_then(|uri| uri.strip_prefix("/health?nonce="))
                .unwrap_or("");
            let proof = compute_proof(&proof_key_server, nonce).unwrap();
            let resp =
                format!("HTTP/1.1 200 OK\r\nX-Loam-Proof: {proof}\r\nContent-Length: 0\r\n\r\n");
            let _ = stream.write_all(resp.as_bytes()).await;
            // Keep socket open briefly so `sender.ready()` succeeds on keep-alive.
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    });

    // Case 1: `refresh_bearer` runs while `open` is blocked in keychain resolution.
    let (entered_tx, entered_rx) = std::sync::mpsc::channel::<()>();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let release_rx = Arc::new(StdMutex::new(release_rx));
    let entered_tx = Arc::new(StdMutex::new(entered_tx));
    let reader: KeychainReader = Arc::new(move |_, _| {
        let _ = entered_tx.lock().unwrap().send(());
        let _ = release_rx.lock().unwrap().recv();
        Some("tok-revoked-01234567".to_owned())
    });
    let entry: Access = serde_json::from_value(json!({
        "instance": "mail",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "bearer_keychain": { "keychain": "loam-plugin-mount", "account": "mail.tok1" },
        "proof_key": proof_key,
    }))
    .unwrap();
    let mounts = Arc::new(Mounts::with_test_config(
        Ok(vec![entry.clone()]),
        reader,
        Duration::from_secs(2),
    ));
    let notify: Notify = Arc::new(|_, _| {});
    let mounts_open = mounts.clone();
    let notify_open = notify.clone();
    let open_task = tokio::spawn(async move { mounts_open.open("mail", notify_open).await });

    tokio::task::spawn_blocking(move || entered_rx.recv_timeout(Duration::from_secs(5)))
        .await
        .unwrap()
        .expect("open reached keychain reader");
    mounts.refresh_bearer("mail", Some("tok-fresh-89abcdef".into()));
    release_tx.send(()).unwrap();
    assert_eq!(open_task.await.unwrap().err(), Some(UNREACHABLE));
    assert!(mounts.open.lock().unwrap().handles.is_empty());

    // Case 2: `update_entries` (removing `mail`) + `close_instance("mail")` while `open` is in flight.
    let (entered2_tx, entered2_rx) = std::sync::mpsc::channel::<()>();
    let (release2_tx, release2_rx) = std::sync::mpsc::channel::<()>();
    let release2_rx = Arc::new(StdMutex::new(release2_rx));
    let entered2_tx = Arc::new(StdMutex::new(entered2_tx));
    let reader2: KeychainReader = Arc::new(move |_, _| {
        let _ = entered2_tx.lock().unwrap().send(());
        let _ = release2_rx.lock().unwrap().recv();
        Some("tok-still-valid-0123".to_owned())
    });
    let mounts2 = Arc::new(Mounts::with_test_config(
        Ok(vec![entry]),
        reader2,
        Duration::from_secs(2),
    ));
    let mounts2_open = mounts2.clone();
    let open_task2 = tokio::spawn(async move { mounts2_open.open("mail", notify).await });
    tokio::task::spawn_blocking(move || entered2_rx.recv_timeout(Duration::from_secs(5)))
        .await
        .unwrap()
        .expect("open 2 reached keychain reader");
    mounts2.update_entries(Ok(Vec::new()));
    mounts2.close_instance("mail").await;
    release2_tx.send(()).unwrap();
    assert_eq!(open_task2.await.unwrap().err(), Some(UNREACHABLE));
    assert!(mounts2.open.lock().unwrap().handles.is_empty());

    server.await.unwrap();
}
