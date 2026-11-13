//! Removing an account (`mail-account-remove`): its mail goes from the store,
//! a message another account shows stays, nothing at the provider changes,
//! and its sign-in leaves the keychain.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use afd::{CommandRegistry, CommandResult};
use async_trait::async_trait;
use loam_mail::cli::{Local, Runner};
use loam_mail::engine::Engine;
use loam_mail::forward::Server as Forward;
use loam_mail::home::Home;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::provider::{Connector, Provider, ProviderError};
use loam_mail::secrets::account_key;
use loam_mail::serve::running;
use loam_mail::store::AccountRow;
use loam_mail::sync::Options;
use serde_json::{Value, json};
use support::imap::{PASSWORD, Server, USER, large_message, message};

const A: &str = "a@example.com";
const B: &str = "b@example.com";

/// Each account's provider: `a@` the first server, `b@` the second.
struct Two {
    a: ImapConnector,
    b: ImapConnector,
}

fn connector(server: &Server) -> ImapConnector {
    ImapConnector::new(
        Endpoint {
            host: "127.0.0.1".to_string(),
            port: server.address.port(),
            tls: false,
        },
        ICLOUD_NAMES,
        |_| {
            Ok(Credentials {
                user: USER.to_string(),
                password: PASSWORD.to_string(),
            })
        },
    )
}

#[async_trait]
impl Connector for Two {
    async fn connect(&self, account: &AccountRow) -> Result<Box<dyn Provider>, ProviderError> {
        if account.address == A {
            self.a.connect(account).await
        } else {
            self.b.connect(account).await
        }
    }
}

struct Fixture {
    _directory: tempfile::TempDir,
    home: Home,
    a: Server,
    b: Server,
    engine: Arc<Engine>,
    registry: CommandRegistry,
}

impl Fixture {
    fn new() -> Self {
        let a = Server::start(true, true);
        let b = Server::start(true, true);
        // The same message in both accounts, and one of each account's own.
        for (server, own) in [(&a, "Only A"), (&b, "Only B")] {
            let mut world = server.world();
            world.mailbox("INBOX", &[]);
            world.add("INBOX", message(1, "Shared", None, "both"), &[]);
            world.add("INBOX", message(2, own, None, "own"), &[]);
        }
        {
            // Account A's other mail: one held in parts, whose file has the
            // same bytes as one of B's; one whose body never comes; and one
            // that leaves the mailbox after the first pass.
            let mut world = a.world();
            world.add("INBOX", large_message(40, "Large A", "only a", 6_000), &[]);
            let never = world.add("INBOX", message(41, "Bodiless", None, "never"), &[]);
            world.find("INBOX").never_return_body.insert(never);
            world.add("INBOX", message(42, "Gone later", None, "gone"), &[]);
        }
        b.world()
            .add("INBOX", large_message(50, "Large B", "only b", 6_000), &[]);
        let directory = tempfile::tempdir().unwrap();
        let home = Home::at(directory.path().join("data"));
        let engine = Engine::new(Some(home.clone()))
            .with_connector(Arc::new(Two {
                a: connector(&a),
                b: connector(&b),
            }))
            .with_sync_options(Options {
                backoff: Duration::ZERO,
                every: Duration::from_secs(3600),
                // A message over 2 000 bytes is held in parts.
                whole_limit: 2_000,
                ..Options::default()
            });
        engine
            .with_store(|store| {
                store.add_account("icloud", A, 0)?;
                store.add_account("icloud", B, 0)?;
                Ok(())
            })
            .unwrap();
        for address in [A, B] {
            engine
                .secrets()
                .set(&account_key("icloud", address), "app-password")
                .unwrap();
        }
        let engine = Arc::new(engine);
        let registry = loam_mail::registry(&engine).unwrap();
        Self {
            _directory: directory,
            home,
            a,
            b,
            engine,
            registry,
        }
    }

    fn files(&self) -> usize {
        fn count(path: &std::path::Path) -> usize {
            std::fs::read_dir(path).map_or(0, |entries| {
                entries
                    .map(|entry| entry.unwrap().path())
                    .map(|path| if path.is_dir() { count(&path) } else { 1 })
                    .sum()
            })
        }
        count(&self.home.root().join("blobs"))
    }
}

/// Runs a person's command through `runner` at the terminal, saying yes.
async fn approved(runner: &dyn Runner, name: &str, input: Value) -> (Value, CommandResult<Value>) {
    let held = runner.run(name, input.clone(), true, None).await;
    let error = held.error.clone().expect("held for approval");
    assert_eq!(error.code, "APPROVAL_REQUIRED", "{error:?}");
    let approval = error.details.unwrap()["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let summary = json!(error.suggestion);
    (summary, runner.run(name, input, true, Some(approval)).await)
}

async fn status(forward: &Forward) -> Value {
    forward
        .run("mail-status", json!({}), false, None)
        .await
        .data
        .unwrap_or(Value::Null)
}

async fn hits(runner: &dyn Runner, query: &str) -> usize {
    let found = runner
        .run("mail-search", json!({ "query": query }), false, None)
        .await;
    found.data.expect("search runs")["hits"]
        .as_array()
        .unwrap()
        .len()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_account_and_its_own_mail_go_and_mail_another_account_shows_stays() {
    let fixture = Fixture::new();
    let local = Local(&fixture.registry);
    let synced = local.run("mail-sync", json!({}), false, None).await;
    assert!(synced.success, "{synced:?}");
    assert_eq!(hits(&local, "Shared").await, 1, "one message, in both");
    // One of A's messages leaves its mailbox; it was only ever A's.
    let gone = *fixture
        .a
        .world()
        .find("INBOX")
        .messages
        .keys()
        .max()
        .unwrap();
    fixture.a.world().expunge("INBOX", gone);
    assert!(local.run("mail-sync", json!({}), false, None).await.success);
    // Both large messages' files are opened, so the log holds their bytes
    // once, for two messages.
    let mut places = Vec::new();
    for subject in ["Large A", "Large B"] {
        let message = local
            .run("mail-search", json!({ "query": subject }), false, None)
            .await
            .data
            .unwrap()["hits"][0]["message"]
            .clone();
        let opened = local
            .run(
                "mail-message-open",
                json!({ "message": message }),
                false,
                None,
            )
            .await;
        let place = opened.data.unwrap()["content"]["files"][0]["place"].clone();
        let file = local
            .run(
                "mail-attachment-open",
                json!({ "message": message, "place": place }),
                false,
                None,
            )
            .await;
        assert!(file.success, "{file:?}");
        places.push((message, place));
    }
    // The rows removal must handle are there to handle.
    {
        let database = rusqlite::Connection::open_with_flags(
            fixture.home.database(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let count = |sql: &str| -> i64 { database.query_row(sql, [], |row| row.get(0)).unwrap() };
        assert!(
            count("SELECT count(*) FROM structure") >= 2,
            "held in parts"
        );
        assert!(
            count("SELECT count(*) FROM body_missing") >= 1,
            "a body never returned"
        );
        assert!(
            count("SELECT count(*) FROM observation WHERE ended_at IS NOT NULL") >= 1,
            "a message that left"
        );
        assert!(
            count(
                "SELECT count(*) FROM (SELECT blob FROM held GROUP BY blob
                 HAVING count(DISTINCT message_id) > 1)"
            ) >= 1,
            "a file two messages hold"
        );
    }
    let files_before = fixture.files();
    let connections = (fixture.a.world().connections, fixture.b.world().connections);

    let (summary, removed) = approved(&local, "mail-account-remove", json!({ "account": 1 })).await;
    // The person reads which account, and what goes, before saying yes.
    let summary = summary.to_string();
    assert!(summary.contains(A), "{summary}");
    assert!(
        summary.contains("delete its 1 mailbox and the 4 messages only it has shown"),
        "{summary}"
    );
    assert!(summary.contains("Nothing changes at iCloud"), "{summary}");
    let removed = removed
        .data
        .clone()
        .unwrap_or_else(|| panic!("{removed:?}"));
    // Only A, the large one, the bodiless one, the one that left; nothing
    // of the message both accounts show.
    assert_eq!(removed["messages"], json!(4), "{removed}");
    // Removing reached neither provider.
    assert_eq!(
        (fixture.a.world().connections, fixture.b.world().connections),
        connections
    );
    assert_eq!(removed["signInRemoved"], json!(true));
    assert_eq!(removed["rebuild"]["resumed"], json!(false), "{removed}");
    let files = removed["files"].as_u64().unwrap();
    assert!(files >= 1, "{removed}");
    assert_eq!(
        fixture.files(),
        files_before - usize::try_from(files).unwrap()
    );

    // Only the other account is left, with all of its mail.
    let accounts = local.run("mail-account-list", json!({}), false, None).await;
    let accounts = accounts.data.unwrap()["accounts"].clone();
    assert_eq!(accounts.as_array().unwrap().len(), 1);
    assert_eq!(accounts[0]["address"], json!(B));
    assert_eq!(hits(&local, "Bodiless").await, 0);
    assert_eq!(hits(&local, "Large").await, 1);
    assert_eq!(hits(&local, "Shared").await, 1);
    let shared = local
        .run("mail-search", json!({ "query": "Shared" }), false, None)
        .await
        .data
        .unwrap()["hits"][0]["message"]
        .clone();
    let opened = local
        .run(
            "mail-message-open",
            json!({ "message": shared }),
            false,
            None,
        )
        .await;
    assert!(opened.success, "the shared message's bytes are still held");
    // B's file is still held, though a message of A's held the same bytes:
    // with B's provider down, it is read from the log.
    fixture.b.world().down = true;
    let (message, place) = &places[1];
    let file = local
        .run(
            "mail-attachment-open",
            json!({ "message": message, "place": place }),
            false,
            None,
        )
        .await;
    assert!(file.success, "{file:?}");
    fixture.b.world().down = false;
    // The sign-in went with the account; the other stays.
    let secrets = fixture.engine.secrets();
    assert_eq!(secrets.get(&account_key("icloud", A)).unwrap(), None);
    assert!(secrets.get(&account_key("icloud", B)).unwrap().is_some());
    // Nothing at either provider changed.
    for server in [&fixture.a, &fixture.b] {
        for command in server.take_log() {
            let upper = command.to_ascii_uppercase();
            assert!(
                !upper.contains("STORE")
                    && !upper.contains("EXPUNGE")
                    && !upper.starts_with("SELECT"),
                "{command}"
            );
        }
    }

    // An account that is not there is refused after the person's yes.
    let (_, refused) = approved(&local, "mail-account-remove", json!({ "account": 1 })).await;
    assert_eq!(refused.error.unwrap().code, "ACCOUNT_NOT_FOUND");
    // With no terminal, it is never run.
    let script = local
        .run("mail-account-remove", json!({ "account": 2 }), false, None)
        .await;
    assert_eq!(script.error.unwrap().code, "APPROVAL_REQUIRED");
    assert_eq!(
        local
            .run("mail-account-list", json!({}), false, None)
            .await
            .data
            .unwrap()["accounts"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn on_a_server_removal_waits_for_no_work_and_leaves_a_rebuild_to_it() {
    let fixture = Fixture::new();
    let registry = Arc::new(loam_mail::registry(&fixture.engine).unwrap());
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(loam_mail::serve::serve(
        Arc::clone(&fixture.engine),
        registry,
        0,
        async move {
            let _ = stopped.await;
        },
        |_| {},
    ));
    let started = Instant::now();
    while running(&fixture.home).is_none() {
        assert!(started.elapsed() < Duration::from_secs(10));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let forward = Forward::find(&fixture.home).unwrap();
    let started = Instant::now();
    while status(&forward).await["work"]["sync"]["last"].is_null() {
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "the first pass"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    // While the server's work is held back by something else, removing
    // waits its turn.
    {
        let _held = fixture.engine.work().pause().unwrap();
        let (_, busy) = approved(&forward, "mail-account-remove", json!({ "account": 1 })).await;
        assert_eq!(busy.error.unwrap().code, "WORK_RUNNING");
    }
    let (summary, removed) =
        approved(&forward, "mail-account-remove", json!({ "account": 1 })).await;
    assert!(summary.to_string().contains(A), "{summary}");
    let removed = removed
        .data
        .clone()
        .unwrap_or_else(|| panic!("{removed:?}"));
    assert_eq!(removed["rebuild"]["work"], json!("rebuild"), "{removed}");
    assert_eq!(removed["rebuild"]["queued"], json!(true), "{removed}");
    let started = Instant::now();
    while status(&forward).await["work"]["rebuild"]["last"].is_null() {
        assert!(started.elapsed() < Duration::from_secs(30), "the rebuild");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(hits(&forward, "Shared").await, 1);
    assert_eq!(hits(&forward, "Bodiless").await, 0);
    assert_eq!(hits(&forward, "Large").await, 1);
    stop.send(()).unwrap();
    server.await.unwrap().unwrap();
}
