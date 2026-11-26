//! Step F0 tests: `test-doubles` feature, file-backed `Secrets`, loopback-only
//! endpoints, both-or-neither env check, `loam-mail test-world` (`mail-f-base`
//! seed, private tokens, store release, `received.jsonl`), start-up banner,
//! `mail-status` build flag and `--version` features (plugin.spec.md sections
//! 12.4, 18 and 19: test F-T14).

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::process::Command;

#[cfg(not(feature = "test-doubles"))]
mod without_feature {
    use super::*;
    use std::sync::Arc;

    use loam_mail::cli::{Local, Runner};
    use loam_mail::engine::Engine;
    use loam_mail::home::Home;
    use serde_json::json;

    #[test]
    fn ft14_build_without_feature_has_no_test_world_ignores_vars_and_reports_no_feature() {
        let program = env!("CARGO_BIN_EXE_loam-mail");
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");

        // `--version` reports no `test-doubles` feature.
        let version = Command::new(program).arg("--version").output().unwrap();
        assert!(version.status.success());
        let ver_text = String::from_utf8_lossy(&version.stdout);
        assert_eq!(
            ver_text,
            format!("loam-mail {}\n", env!("CARGO_PKG_VERSION"))
        );
        assert!(!ver_text.contains("test-doubles"));

        // `test-world` is not recognized.
        let tw = Command::new(program)
            .args([
                "test-world",
                "--seed",
                "mail-f-base",
                "--home",
                "h",
                "--out",
                "o",
            ])
            .output()
            .unwrap();
        assert_eq!(tw.status.code(), Some(2));

        // Setting only one of the two env vars (or invalid endpoints) is completely ignored.
        let out = Command::new(program)
            .arg("mail-account-list")
            .env("LOAM_MAIL_HOME", &home)
            .env("LOAM_MAIL_TEST_SECRETS", dir.path().join("nope.json"))
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "env var should be ignored without test-doubles: {}",
            String::from_utf8_lossy(&out.stderr)
        );

        // `mail-status` does not include `build`.
        let engine = Arc::new(Engine::new(Some(Home::at(dir.path().join("status-home")))));
        engine
            .with_store(|store| {
                store.add_account("icloud", "me@example.com", 0)?;
                Ok(())
            })
            .unwrap();
        let registry = loam_mail::registry(&engine).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let status = rt.block_on(Local(&registry).run("mail-status", json!({}), true, None));
        assert!(status.success, "{status:?}");
        assert!(status.data.unwrap().get("build").is_none());
    }
}

#[cfg(feature = "test-doubles")]
mod with_feature {
    use super::*;
    #[cfg(unix)]
    use std::ffi::OsString;
    #[cfg(unix)]
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use std::sync::Arc;
    #[cfg(unix)]
    use std::sync::Mutex;

    use loam_mail::cli::{Caller, EXIT_OK, Local, Person, Runner, run};
    use loam_mail::doubles::config::{
        EndpointAddr, FileSecrets, RefusingPoster, TEST_ENDPOINTS_VAR, TEST_SECRETS_VAR,
        TestDoubleConfig, TestEndpoints,
    };
    use loam_mail::doubles::imap::Server as ImapServer;
    #[cfg(unix)]
    use loam_mail::doubles::world::WorldOutputs;
    use loam_mail::doubles::world::{
        SEED_LOAM_DESKTOP, SEED_MAIL_F_BASE, SEED_PASSWORD, SEED_USER, STRANGER_INSTRUCTION,
        start_world,
    };
    use loam_mail::engine::Engine;
    use loam_mail::home::Home;
    use loam_mail::provider::ProviderError;
    #[cfg(unix)]
    use loam_mail::provider::http::HttpsPoster;
    use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
    #[cfg(unix)]
    use loam_mail::provider::smtp::{SmtpEndpoint, SmtpSender};
    use loam_mail::secrets::{Secrets, account_key};
    use loam_mail::serve::running;
    #[cfg(unix)]
    use serde_json::Value;
    use serde_json::json;

    struct ChildGuard(std::process::Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    struct ApproveWithPassword(String);
    impl Person for ApproveWithPassword {
        fn confirm(&mut self, _question: &str) -> std::io::Result<bool> {
            Ok(true)
        }
        fn secret(&mut self, _prompt: &str) -> std::io::Result<String> {
            Ok(self.0.clone())
        }
    }

    #[test]
    fn ft14_version_reports_test_doubles_and_env_guard_refuses_bad_configs() {
        let program = env!("CARGO_BIN_EXE_loam-mail");
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let secrets = dir.path().join("secrets.json");
        let endpoints = dir.path().join("endpoints.json");

        // `--version` names `test-doubles`.
        let version = Command::new(program).arg("--version").output().unwrap();
        assert!(version.status.success());
        let ver_text = String::from_utf8_lossy(&version.stdout);
        assert!(ver_text.contains("test-doubles"), "{ver_text}");

        // Setting only LOAM_MAIL_TEST_SECRETS refuses to start.
        let only_secrets = Command::new(program)
            .arg("mail-account-list")
            .env("LOAM_MAIL_HOME", &home)
            .env(TEST_SECRETS_VAR, &secrets)
            .env_remove(TEST_ENDPOINTS_VAR)
            .output()
            .unwrap();
        assert!(!only_secrets.status.success());

        // Setting only LOAM_MAIL_TEST_ENDPOINTS refuses to start.
        std::fs::write(&endpoints, r#"{"imap":{"host":"127.0.0.1","port":10143}}"#).unwrap();
        let only_endpoints = Command::new(program)
            .arg("mail-account-list")
            .env("LOAM_MAIL_HOME", &home)
            .env_remove(TEST_SECRETS_VAR)
            .env(TEST_ENDPOINTS_VAR, &endpoints)
            .output()
            .unwrap();
        assert!(!only_endpoints.status.success());

        // Endpoints file naming localhost, a domain, or non-loopback IP refuses to start.
        for bad_host in ["localhost", "imap.example.com", "10.0.0.1", "8.8.8.8", "::"] {
            std::fs::write(
                &endpoints,
                format!(r#"{{"imap":{{"host":"{bad_host}","port":10143}}}}"#),
            )
            .unwrap();
            let refused = Command::new(program)
                .arg("mail-account-list")
                .env("LOAM_MAIL_HOME", &home)
                .env(TEST_SECRETS_VAR, &secrets)
                .env(TEST_ENDPOINTS_VAR, &endpoints)
                .output()
                .unwrap();
            assert!(
                !refused.status.success(),
                "host `{bad_host}` must be refused"
            );
        }

        // Neither variable set -> TestDoubleConfig::from_env returns None (uses keychain).
        assert!(TestDoubleConfig::from_env(|_| None).unwrap().is_none());

        // Valid loopback IPv4 and IPv6 literals are accepted.
        let valid = TestEndpoints {
            imap: EndpointAddr {
                host: "127.0.0.2".to_string(),
                port: 10143,
            },
            smtp: Some(EndpointAddr {
                host: "::1".to_string(),
                port: 10025,
            }),
            http: Some(EndpointAddr {
                host: "127.0.0.1".to_string(),
                port: 10080,
            }),
        };
        assert!(valid.validate().is_ok());
    }

    #[test]
    fn ft14_mail_account_add_writes_file_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let imap = ImapServer::start(true, true);
        {
            let mut world = imap.world();
            world.user = SEED_USER.to_string();
            world.password = SEED_PASSWORD.to_string();
            world.mailbox("INBOX", &[]);
        }
        let secrets_path = dir.path().join("secrets.json");
        let secrets = Arc::new(FileSecrets::new(&secrets_path));
        let lookup = Arc::clone(&secrets);
        let connector = ImapConnector::new(
            Endpoint {
                host: "127.0.0.1".to_string(),
                port: imap.address.port(),
                tls: false,
            },
            ICLOUD_NAMES,
            move |account| match lookup.get(&account_key(&account.provider, &account.address)) {
                Ok(Some(password)) => Ok(Credentials {
                    user: account.address.clone(),
                    password,
                }),
                Ok(None) => Err(ProviderError::NoCredential),
                Err(_) => Err(ProviderError::Keychain),
            },
        );
        let engine = Arc::new(
            Engine::new(Some(Home::at(dir.path().join("home"))))
                .with_connector(Arc::new(connector))
                .with_secrets(Arc::clone(&secrets) as Arc<dyn Secrets>),
        );
        let registry = loam_mail::registry(&engine).unwrap();
        let mut person = ApproveWithPassword(SEED_PASSWORD.to_string());
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run(
            &[
                "mail-account-add".to_string(),
                format!(r#"{{"provider":"icloud","address":"{SEED_USER}"}}"#),
            ],
            &registry,
            Caller::Terminal(&mut person),
            secrets.as_ref(),
            &mut out,
            &mut err,
        )
        .unwrap();
        assert_eq!(code, EXIT_OK, "{}", String::from_utf8_lossy(&err));
        assert_eq!(
            secrets.get(&account_key("icloud", SEED_USER)).unwrap(),
            Some(SEED_PASSWORD.to_string())
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&secrets_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ft14_test_world_seeds_mail_f_base_releases_store_and_logs_received() {
        let dir = tempfile::tempdir().unwrap();
        let home_dir = dir.path().join("home");
        let out_dir = dir.path().join("out");

        // Refuses to seed an existing, populated mail directory.
        let existing_home = dir.path().join("existing-home");
        let existing_out = dir.path().join("existing-out");
        std::fs::create_dir_all(&existing_home).unwrap();
        std::fs::write(existing_home.join("mail.db"), b"existing").unwrap();
        assert!(
            start_world(SEED_MAIL_F_BASE, &existing_home, &existing_out)
                .await
                .is_err(),
            "test-world must refuse a populated --home"
        );
        assert_eq!(
            std::fs::read(existing_home.join("mail.db")).unwrap(),
            b"existing"
        );

        let world = start_world(SEED_MAIL_F_BASE, &home_dir, &out_dir)
            .await
            .expect("test-world seeds mail-f-base");

        // Verify token files exist, have expected prefixes, and are private on Unix.
        let agent_secret = std::fs::read_to_string(&world.outputs.agent_token).unwrap();
        let approver_secret = std::fs::read_to_string(&world.outputs.approver_token).unwrap();
        assert!(agent_secret.starts_with("lmail_agent_"));
        assert!(approver_secret.starts_with("lmail_approver_"));
        for path in [
            &world.outputs.agent_token,
            &world.outputs.approver_token,
            &world.outputs.secrets,
        ] {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "{}", path.display());
        }

        // Load config via TestDoubleConfig (just as `loam-mail serve` does) and
        // verify the store was released by starting `serve::serve` on `--home`.
        let config = TestDoubleConfig::from_env(|name| match name {
            TEST_SECRETS_VAR => Some(OsString::from(&world.outputs.secrets)),
            TEST_ENDPOINTS_VAR => Some(OsString::from(&world.outputs.endpoints)),
            _ => None,
        })
        .unwrap()
        .unwrap();
        let secrets: Arc<dyn Secrets> = Arc::new(config.secrets);
        let imap_secrets = Arc::clone(&secrets);
        let connector = ImapConnector::new(
            Endpoint {
                host: config.endpoints.imap.ip().to_string(),
                port: config.endpoints.imap.port(),
                tls: false,
            },
            ICLOUD_NAMES,
            move |account| match imap_secrets.get(&account_key(&account.provider, &account.address))
            {
                Ok(Some(password)) => Ok(Credentials {
                    user: account.address.clone(),
                    password,
                }),
                Ok(None) => Err(ProviderError::NoCredential),
                Err(_) => Err(ProviderError::Keychain),
            },
        );
        let smtp_secrets = Arc::clone(&secrets);
        let smtp_addr = config.endpoints.smtp.unwrap();
        let sender = SmtpSender::new(
            SmtpEndpoint::plain(smtp_addr.ip().to_string(), smtp_addr.port()),
            move |account| match smtp_secrets.get(&account_key(&account.provider, &account.address))
            {
                Ok(Some(password)) => Ok(Credentials {
                    user: account.address.clone(),
                    password,
                }),
                Ok(None) => Err(ProviderError::NoCredential),
                Err(_) => Err(ProviderError::Keychain),
            },
        );
        let http_addr = config.endpoints.http.unwrap();
        let home = Home::at(&home_dir);
        let engine = Arc::new(
            Engine::new(Some(home.clone()))
                .with_connector(Arc::new(connector))
                .with_sender(Arc::new(sender))
                .with_unsubscribe_poster(Arc::new(HttpsPoster::for_test_endpoint(http_addr)))
                .with_secrets(secrets),
        );
        let registry = loam_mail::registry(&engine).unwrap();

        // Start `serve` and capture banner announcements.
        let announcements: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let announcements_cb = Arc::clone(&announcements);
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        let server_task = tokio::spawn(loam_mail::serve::serve(
            Arc::clone(&engine),
            Arc::clone(&registry),
            0,
            async move {
                let _ = stop_rx.await;
            },
            move |line| {
                announcements_cb.lock().unwrap().push(line.to_string());
            },
        ));
        for _ in 0..200 {
            if running(&home).is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(running(&home).is_some(), "serve started on released store");
        let lines = announcements.lock().unwrap().clone();
        assert!(
            lines.iter().any(|l| l.contains("test build: scripted servers and file sign-ins are available")),
            "missing test build banner: {lines:?}"
        );

        // `mail-status` reports `build: { testDoubles: true }` and `tokens: { agents: 1, approvers: 1 }`.
        let status = Local(&registry)
            .run("mail-status", json!({}), true, None)
            .await;
        assert!(status.success, "{status:?}");
        let status_data = status.data.unwrap();
        assert_eq!(status_data["build"]["testDoubles"], true);
        assert_eq!(status_data["tokens"]["agents"], 1);
        assert_eq!(status_data["tokens"]["approvers"], 1);

        // `mail-token-list` lists both roles, and `is_approver` distinguishes them.
        let listed = Local(&registry)
            .run("mail-token-list", json!({}), true, None)
            .await;
        assert!(listed.success, "{listed:?}");
        let tokens = listed.data.unwrap()["tokens"].as_array().unwrap().clone();
        assert_eq!(tokens.len(), 2);
        let agent_id = tokens.iter().find(|t| t["role"] == "agent").unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();
        let approver_id = tokens.iter().find(|t| t["role"] == "approver").unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!loam_mail::is_approver(
            &engine,
            &afd::CommandContext::new()
                .with_interface(afd::CommandInterface::Mcp)
                .with_actor(afd::Actor::new(afd::ActorKind::Agent).with_id(&agent_id))
        ));
        assert!(loam_mail::is_approver(
            &engine,
            &afd::CommandContext::new()
                .with_interface(afd::CommandInterface::Mcp)
                .with_actor(afd::Actor::new(afd::ActorKind::Agent).with_id(&approver_id))
        ));

        // Verify `mail-f-base` seeded records:
        // - account 1 is me@example.com
        // - thread 7 is Ada asking about Thursday
        // - mailbox 9 is Notifications with 120 messages
        // - message 41 is the one-click newsletter (https://lists.example.com/u/41)
        let thread7 = Local(&registry)
            .run("mail-thread-open", json!({ "thread": 7 }), true, None)
            .await;
        assert!(thread7.success, "{thread7:?}");
        assert!(
            thread7
                .data
                .unwrap()
                .to_string()
                .contains("ada@example.com"),
            "thread 7 should be Ada's thread"
        );

        let sel9 = Local(&registry)
            .run(
                "mail-selection-create",
                json!({ "account": 1, "mailbox": 9 }),
                true,
                None,
            )
            .await;
        assert!(sel9.success, "{sel9:?}");
        assert_eq!(sel9.data.unwrap()["count"], 120);

        let unsub41 = Local(&registry)
            .run(
                "mail-unsubscribe-show",
                json!({ "message": 41 }),
                true,
                None,
            )
            .await;
        assert!(unsub41.success, "{unsub41:?}");
        let unsub_data = unsub41.data.unwrap();
        assert_eq!(unsub_data["unsubscribe"]["method"], "one-click");
        assert_eq!(
            unsub_data["unsubscribe"]["content"]["target"],
            "https://lists.example.com/u/41"
        );
        let unsub_digest = unsub_data["unsubscribe"]["digest"]
            .as_str()
            .unwrap()
            .to_string();

        // Send a draft replying to Ada through the scripted SMTP server and
        // check `received.jsonl` records it once.
        let created = Local(&registry)
            .run(
                "mail-draft-create",
                json!({
                    "account": 1,
                    "answers": 7,
                    "to": ["ada@example.com"],
                    "subject": "Re: Thursday",
                    "body": "Thursday works for me."
                }),
                true,
                None,
            )
            .await;
        assert!(created.success, "{created:?}");
        let draft_id = created.data.unwrap()["draft"].as_i64().unwrap();
        let held_send = Local(&registry)
            .run(
                "mail-draft-send",
                json!({ "draft": draft_id, "revision": 1 }),
                true,
                None,
            )
            .await;
        let send_tok = held_send.error.unwrap().details.unwrap()["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        let sent = Local(&registry)
            .run(
                "mail-draft-send",
                json!({ "draft": draft_id, "revision": 1 }),
                true,
                Some(send_tok),
            )
            .await;
        assert!(sent.success, "{sent:?}");

        // Also run one-click unsubscribe on message 41 and check `received.jsonl`.
        let held_unsub = Local(&registry)
            .run(
                "mail-unsubscribe",
                json!({ "message": 41, "digest": unsub_digest }),
                true,
                None,
            )
            .await;
        let unsub_tok = held_unsub.error.unwrap().details.unwrap()["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        let unsubbed = Local(&registry)
            .run(
                "mail-unsubscribe",
                json!({ "message": 41, "digest": unsub_digest }),
                true,
                Some(unsub_tok),
            )
            .await;
        assert!(unsubbed.success, "{unsubbed:?}");

        let received_text = std::fs::read_to_string(&world.outputs.received).unwrap();
        let entries: Vec<Value> = received_text
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(entries.len(), 2, "{received_text}");
        assert_eq!(entries[0]["kind"], "smtp");
        assert_eq!(entries[0]["from"], SEED_USER);
        assert_eq!(entries[0]["to"], json!(["ada@example.com"]));
        assert!(entries[0]["bodyDigest"].as_str().unwrap().len() == 64);
        assert_eq!(entries[1]["kind"], "http");
        assert_eq!(entries[1]["method"], "POST");
        assert_eq!(entries[1]["target"], "/u/41");

        let _ = stop_tx.send(());
        server_task.await.unwrap().unwrap();
        drop(world);
    }

    #[cfg(unix)]
    #[test]
    fn ft14_built_binary_test_world_prints_paths_and_releases_store() {
        let program = env!("CARGO_BIN_EXE_loam-mail");
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let out = dir.path().join("out");

        let mut child = ChildGuard(
            Command::new(program)
                .args([
                    "test-world",
                    "--seed",
                    SEED_MAIL_F_BASE,
                    "--home",
                    home.to_str().unwrap(),
                    "--out",
                    out.to_str().unwrap(),
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("test-world starts"),
        );

        let mut reader = BufReader::new(child.0.stdout.take().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).expect("reads ready line");
        let outputs: WorldOutputs = serde_json::from_str(line.trim())
            .unwrap_or_else(|e| panic!("invalid JSON `{line}`: {e}"));
        assert_eq!(outputs.seed, SEED_MAIL_F_BASE);
        assert!(outputs.endpoints.exists());
        assert!(outputs.secrets.exists());
        assert!(outputs.agent_token.exists());
        assert!(outputs.approver_token.exists());
        assert!(outputs.received.exists());

        // The store lock is released, so another `loam-mail` invocation reads it cleanly.
        let status = Command::new(program)
            .arg("mail-status")
            .env("LOAM_MAIL_HOME", &outputs.home)
            .env(TEST_SECRETS_VAR, &outputs.secrets)
            .env(TEST_ENDPOINTS_VAR, &outputs.endpoints)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "mail-status failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );
        let parsed: Value = serde_json::from_slice(&status.stdout).unwrap();
        assert_eq!(parsed["success"], true);
        assert_eq!(parsed["data"]["build"]["testDoubles"], true);
        assert_eq!(parsed["data"]["tokens"]["agents"], 1);
        assert_eq!(parsed["data"]["tokens"]["approvers"], 1);
    }

    /// Opens `thread` with the built binary on a world `test-world` seeded, as a script reads it.
    #[cfg(unix)]
    fn open_seeded_thread(program: &str, outputs: &WorldOutputs, thread: u32) -> Value {
        let status = Command::new(program)
            .args(["mail-thread-open", &json!({ "thread": thread }).to_string()])
            .env("LOAM_MAIL_HOME", &outputs.home)
            .env(TEST_SECRETS_VAR, &outputs.secrets)
            .env(TEST_ENDPOINTS_VAR, &outputs.endpoints)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "mail-thread-open failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );
        serde_json::from_slice(&status.stdout).unwrap()
    }

    /// Loam's desktop seed (its phase 5 step 7): message 9 is a stranger's instruction and
    /// thread 7 is still Ada's; `mail-f-base`'s own message 9 stays the plain note. Both seeds
    /// are built by the same code, which differs only in message 9.
    #[cfg(unix)]
    #[test]
    fn ft14_loam_desktop_seed_is_mail_f_base_with_a_strangers_instruction() {
        let program = env!("CARGO_BIN_EXE_loam-mail");
        for (seed, stranger) in [(SEED_LOAM_DESKTOP, true), (SEED_MAIL_F_BASE, false)] {
            let dir = tempfile::tempdir().unwrap();
            let home = dir.path().join("home");
            let out = dir.path().join("out");
            let mut child = ChildGuard(
                Command::new(program)
                    .args([
                        "test-world",
                        "--seed",
                        seed,
                        "--home",
                        home.to_str().unwrap(),
                        "--out",
                        out.to_str().unwrap(),
                    ])
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn()
                    .expect("test-world starts"),
            );
            let mut reader = BufReader::new(child.0.stdout.take().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).expect("reads ready line");
            let outputs: WorldOutputs = serde_json::from_str(line.trim())
                .unwrap_or_else(|e| panic!("invalid JSON `{line}`: {e}"));
            assert_eq!(outputs.seed, seed);

            let nine = open_seeded_thread(program, &outputs, 9).to_string();
            assert_eq!(
                nine.contains(STRANGER_INSTRUCTION),
                stranger,
                "{seed}: {nine}"
            );
            assert_eq!(
                nine.contains("desk@unknown.example.net"),
                stranger,
                "{seed}"
            );
            let seven = open_seeded_thread(program, &outputs, 7).to_string();
            assert!(
                seven.contains("ada@example.com"),
                "{seed}: thread 7 is Ada's"
            );
            drop(child);
        }
    }

    #[cfg(not(unix))]
    #[tokio::test]
    async fn ft14_test_world_is_refused_on_windows_before_creating_files() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let out = dir.path().join("out");
        let err = start_world(SEED_MAIL_F_BASE, &home, &out)
            .await
            .err()
            .expect("Windows must refuse test-world");
        assert!(err.contains("refused"), "{err}");
        assert!(!home.exists());
        assert!(!out.exists());

        let program = env!("CARGO_BIN_EXE_loam-mail");
        let status = Command::new(program)
            .args([
                "test-world",
                "--seed",
                SEED_MAIL_F_BASE,
                "--home",
                home.to_str().unwrap(),
                "--out",
                out.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(!status.status.success());
        assert!(!home.exists());
        assert!(!out.exists());
    }

    #[tokio::test]
    async fn ft14_omitting_smtp_or_http_never_falls_back_to_real_network() {
        let dir = tempfile::tempdir().unwrap();
        let imap = ImapServer::start(true, true);
        {
            let mut world = imap.world();
            world.user = SEED_USER.to_string();
            world.password = SEED_PASSWORD.to_string();
            world.mailbox("INBOX", &[]);
            world.add(
                "INBOX",
                b"From: News <news@lists.example.com>\r\n\
                  To: me@example.com\r\n\
                  Message-ID: <no-http-1@example.org>\r\n\
                  Subject: Weekly\r\n\
                  List-Id: <news.lists.example.com>\r\n\
                  List-Unsubscribe: <https://lists.example.com/u/99>\r\n\
                  List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\
                  Content-Type: text/plain\r\n\r\nHello\r\n"
                    .to_vec(),
                &[],
            );
        }
        let secrets = Arc::new(FileSecrets::new(dir.path().join("secrets.json")));
        secrets
            .set(&account_key("icloud", SEED_USER), SEED_PASSWORD)
            .unwrap();
        let lookup = Arc::clone(&secrets);
        let connector = ImapConnector::new(
            Endpoint {
                host: "127.0.0.1".to_string(),
                port: imap.address.port(),
                tls: false,
            },
            ICLOUD_NAMES,
            move |account| match lookup.get(&account_key(&account.provider, &account.address)) {
                Ok(Some(password)) => Ok(Credentials {
                    user: account.address.clone(),
                    password,
                }),
                Ok(None) => Err(ProviderError::NoCredential),
                Err(_) => Err(ProviderError::Keychain),
            },
        );
        // Mirror `main.rs` when `LOAM_MAIL_TEST_ENDPOINTS` omits both `smtp` and `http`:
        // no `sender` and `RefusingPoster` installed instead of `HttpsPoster::new()`.
        let engine = Arc::new(
            Engine::new(Some(Home::at(dir.path().join("home"))))
                .with_connector(Arc::new(connector))
                .with_unsubscribe_poster(Arc::new(RefusingPoster))
                .with_secrets(secrets),
        );
        let registry = loam_mail::registry(&engine).unwrap();
        let local = Local(&registry);
        // Add account & sync.
        let held = local
            .run(
                "mail-account-add",
                json!({ "provider": "icloud", "address": SEED_USER }),
                true,
                None,
            )
            .await;
        let tok = held.error.unwrap().details.unwrap()["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(
            local
                .run(
                    "mail-account-add",
                    json!({ "provider": "icloud", "address": SEED_USER }),
                    true,
                    Some(tok),
                )
                .await
                .success
        );
        assert!(local.run("mail-sync", json!({}), true, None).await.success);

        // Sending a draft fails cleanly without any SMTP connection.
        let draft = local
            .run(
                "mail-draft-create",
                json!({
                    "account": 1,
                    "to": ["news@lists.example.com"],
                    "subject": "Hi",
                    "body": "Test"
                }),
                true,
                None,
            )
            .await;
        assert!(draft.success, "{draft:?}");
        let draft_id = draft.data.unwrap()["draft"].as_i64().unwrap();
        let held_send = local
            .run(
                "mail-draft-send",
                json!({ "draft": draft_id, "revision": 1 }),
                true,
                None,
            )
            .await;
        let send_tok = held_send.error.unwrap().details.unwrap()["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        let send_res = local
            .run(
                "mail-draft-send",
                json!({ "draft": draft_id, "revision": 1 }),
                true,
                Some(send_tok),
            )
            .await;
        assert!(!send_res.success, "send must fail when smtp is omitted");

        // Unsubscribing fails cleanly via `RefusingPoster` without any real HTTP connection.
        let preview = local
            .run("mail-unsubscribe-show", json!({ "message": 1 }), true, None)
            .await;
        assert!(preview.success, "{preview:?}");
        let digest = preview.data.unwrap()["unsubscribe"]["digest"]
            .as_str()
            .unwrap()
            .to_string();
        let held_unsub = local
            .run(
                "mail-unsubscribe",
                json!({ "message": 1, "digest": digest }),
                true,
                None,
            )
            .await;
        let unsub_tok = held_unsub.error.unwrap().details.unwrap()["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        let unsub_res = local
            .run(
                "mail-unsubscribe",
                json!({ "message": 1, "digest": digest }),
                true,
                Some(unsub_tok),
            )
            .await;
        assert!(
            !unsub_res.success,
            "unsubscribe must fail when http is omitted"
        );
    }

    #[test]
    fn ft14_cli_refuses_to_forward_across_mismatched_transports() {
        let program = env!("CARGO_BIN_EXE_loam-mail");
        let dir = tempfile::tempdir().unwrap();
        let home_dir = dir.path().join("home");
        let home = Home::at(&home_dir);
        let secrets = dir.path().join("secrets.json");
        let endpoints = dir.path().join("endpoints.json");
        std::fs::write(&endpoints, r#"{"imap":{"host":"127.0.0.1","port":10143}}"#).unwrap();

        // Start `loam-mail serve` with real transport (no test-doubles env vars).
        let _server = ChildGuard(
            Command::new(program)
                .arg("serve")
                .env("LOAM_MAIL_HOME", &home_dir)
                .env_remove(TEST_SECRETS_VAR)
                .env_remove(TEST_ENDPOINTS_VAR)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("serve starts"),
        );
        for _ in 0..200 {
            if running(&home).is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let entry = running(&home).expect("server.json written");
        assert_eq!(entry.transport.as_deref(), Some("real"));

        // A CLI call configured for test-doubles must refuse to forward to the real server.
        let mismatched = Command::new(program)
            .arg("mail-account-list")
            .env("LOAM_MAIL_HOME", &home_dir)
            .env(TEST_SECRETS_VAR, &secrets)
            .env(TEST_ENDPOINTS_VAR, &endpoints)
            .output()
            .unwrap();
        assert!(!mismatched.status.success());
        let stderr = String::from_utf8_lossy(&mismatched.stderr);
        assert!(
            stderr.contains("different transport configuration"),
            "expected transport mismatch refusal, got: {stderr}"
        );
    }
}
