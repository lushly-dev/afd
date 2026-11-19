//! Step D2's run against a real iCloud account: the four change commands
//! (the specification's 9.2) and the undo of each (9.3), made by the person
//! at the provider, on a few messages the owner chose, timed. Ignored: it
//! changes the owner's mailbox, so it runs only when the owner runs it, with
//! the sign-in in two files whose paths it is given, so that the sign-in
//! never appears in a command line, an environment variable or its output.
//!
//! **What it changes.** Only the messages of one mailbox the owner names
//! (`LOAM_MAIL_LIVE_MAILBOX_FILE`, a file holding the mailbox's name as the
//! provider writes it), which must hold between 1 and 20 messages. In turn
//! it marks them read and flagged and undoes that; copies them to the
//! archive and undoes that; moves them to the inbox, archives them from
//! there, and undoes both; trashes them and undoes that. Each step is
//! checked against a pass of sync, and the run ends by checking that the
//! mailbox holds the same messages with the same flags as at its start. A
//! step that fails stops the run, and the operations already made can be
//! undone by hand with `mail-operation-undo` against the run's data
//! directory. While the messages are in the inbox, for a few seconds, a
//! device may show them there.
//!
//! **What it reads.** The run's mailbox, the inbox, the archive and the
//! trash, headers only: no body is fetched.
//!
//! It prints and writes counts and times only: no address, subject, mailbox
//! name or text.
//!
//! ```text
//! LOAM_MAIL_LIVE_ADDRESS_FILE=... LOAM_MAIL_LIVE_PASSWORD_FILE=... \
//! LOAM_MAIL_LIVE_MAILBOX_FILE=... LOAM_MAIL_LIVE_DIR=/tmp/live-d2 \
//! LOAM_MAIL_LIVE_OUT=live-icloud-d2.results.json \
//!   cargo test --release --test live_changes -- --ignored --nocapture
//! ```

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Instant;

use afd::{ActorKind, CommandContext, CommandInterface, CommandRegistry, SystemClock};
use async_trait::async_trait;
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::parts::Structure;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, Imap};
use loam_mail::provider::{
    Connector, Copied, Fetched, FlagsSeen, Listing, NextId, Opened, OpenedToChange, PartFetched,
    Provider, ProviderError, RemoteMailbox, Since,
};
use loam_mail::store::{AccountRow, HeaderSeen, Role};
use loam_mail::sync::{Options, sync_account};
use serde_json::{Value, json};

/// The most messages the run's mailbox may hold.
const MOST: usize = 20;

/// A provider that lists only the run's mailbox and the inbox, archive and
/// trash it moves mail to, and fetches no bodies. Every change is passed on.
struct Scoped {
    inner: Imap,
    mailbox: String,
}

#[async_trait]
impl Provider for Scoped {
    async fn mailboxes(&mut self) -> Result<Vec<RemoteMailbox>, ProviderError> {
        let all = self.inner.mailboxes().await?;
        Ok(all
            .into_iter()
            .filter(|mailbox| {
                mailbox.key == self.mailbox
                    || matches!(mailbox.role, Role::Inbox | Role::Archive | Role::Trash)
            })
            .collect())
    }
    async fn open(&mut self, mailbox: &str) -> Result<Opened, ProviderError> {
        self.inner.open(mailbox).await
    }
    async fn list(&mut self) -> Result<Listing, ProviderError> {
        self.inner.list().await
    }
    async fn changes(&mut self, cursor: &str) -> Result<Since, ProviderError> {
        self.inner.changes(cursor).await
    }
    async fn open_since(
        &mut self,
        mailbox: &str,
        validity: &str,
        cursor: &str,
    ) -> Result<(Opened, Option<Since>), ProviderError> {
        self.inner.open_since(mailbox, validity, cursor).await
    }
    async fn flags(&mut self) -> Result<Vec<FlagsSeen>, ProviderError> {
        self.inner.flags().await
    }
    async fn headers(&mut self, ids: &[String]) -> Result<Vec<HeaderSeen>, ProviderError> {
        self.inner.headers(ids).await
    }
    async fn messages(&mut self, _ids: &[String]) -> Result<Vec<Fetched>, ProviderError> {
        // No body: sync takes nothing returned as "not now".
        Ok(Vec::new())
    }
    async fn structure(&mut self, _id: &str) -> Result<Option<Structure>, ProviderError> {
        Ok(None)
    }
    async fn parts(
        &mut self,
        _id: &str,
        _places: &[String],
    ) -> Result<Vec<PartFetched>, ProviderError> {
        Ok(Vec::new())
    }
    async fn open_to_change(&mut self, mailbox: &str) -> Result<OpenedToChange, ProviderError> {
        self.inner.open_to_change(mailbox).await
    }
    async fn next_id(&mut self, mailbox: &str) -> Result<NextId, ProviderError> {
        self.inner.next_id(mailbox).await
    }
    async fn present(&mut self, ids: &[String]) -> Result<Vec<String>, ProviderError> {
        self.inner.present(ids).await
    }
    async fn ids_from(&mut self, from: &str) -> Result<Vec<String>, ProviderError> {
        self.inner.ids_from(from).await
    }
    async fn flags_of(&mut self, ids: &[String]) -> Result<Vec<FlagsSeen>, ProviderError> {
        self.inner.flags_of(ids).await
    }
    async fn copy(&mut self, ids: &[String], to: &str) -> Result<Copied, ProviderError> {
        self.inner.copy(ids, to).await
    }
    fn moves(&self) -> bool {
        self.inner.moves()
    }
    async fn move_to(&mut self, ids: &[String], to: &str) -> Result<Copied, ProviderError> {
        self.inner.move_to(ids, to).await
    }
    async fn set_flags(
        &mut self,
        ids: &[String],
        flags: &[&str],
        on: bool,
    ) -> Result<(), ProviderError> {
        self.inner.set_flags(ids, flags, on).await
    }
    async fn remove(&mut self, ids: &[String]) -> Result<(), ProviderError> {
        self.inner.remove(ids).await
    }
    async fn close(&mut self) {
        self.inner.close().await;
    }
}

struct Live {
    endpoint: Endpoint,
    credentials: Credentials,
    mailbox: String,
}

#[async_trait]
impl Connector for Live {
    async fn connect(&self, _account: &AccountRow) -> Result<Box<dyn Provider>, ProviderError> {
        let inner = Imap::connect(&self.endpoint, &self.credentials, ICLOUD_NAMES).await?;
        Ok(Box::new(Scoped {
            inner,
            mailbox: self.mailbox.clone(),
        }))
    }
}

fn read_secret(variable: &str) -> String {
    let path = std::env::var(variable).unwrap_or_else(|_| panic!("{variable} names a file"));
    std::fs::read_to_string(path)
        .expect("the file can be read")
        .trim()
        .to_string()
}

/// Where each message is and with which flags: (mailbox role, the run's
/// mailbox or not, message, flags), in order. No name and no text.
type Places = BTreeSet<(String, bool, i64, String)>;

struct Run {
    engine: Arc<Engine>,
    registry: CommandRegistry,
    account: AccountRow,
    mailbox: String,
    database: std::path::PathBuf,
    runtime: tokio::runtime::Runtime,
    steps: Vec<Value>,
}

impl Run {
    fn sync(&self) -> f64 {
        let connector = Arc::clone(self.engine.connector().unwrap());
        let started = Instant::now();
        self.runtime
            .block_on(sync_account(
                &self.engine,
                connector.as_ref(),
                &self.account,
                self.engine.sync_options(),
                &SystemClock,
                &|_| {},
            ))
            .expect("a pass completes");
        started.elapsed().as_secs_f64()
    }

    /// Where the store shows the messages `messages`.
    fn places(&self, messages: &[i64]) -> Places {
        let connection = rusqlite::Connection::open(&self.database).unwrap();
        let mut statement = connection
            .prepare(
                "SELECT mailbox.role, mailbox.provider_key, observation.message_id,
                        observation.flags
                 FROM observation JOIN mailbox ON mailbox.id = observation.mailbox_id
                 WHERE observation.ended_at IS NULL",
            )
            .unwrap();
        let wanted: BTreeSet<i64> = messages.iter().copied().collect();
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .filter(|(_, _, message, _)| wanted.contains(message))
            .map(|(role, key, message, flags)| (role, key == self.mailbox, message, flags))
            .collect()
    }

    /// The person's call of `name`, which must succeed; its data.
    fn person(&self, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human);
        let result = self
            .runtime
            .block_on(self.registry.execute(name, input, Some(context)));
        let result = serde_json::to_value(&result).unwrap();
        assert_eq!(
            result["success"], true,
            "{name} failed: {}",
            result["error"]
        );
        result["data"].clone()
    }

    /// Runs `name` and checks that the store shows what a pass of sync then
    /// finds, and that `expect` holds of the places; records the step.
    fn step(
        &mut self,
        label: &str,
        name: &str,
        input: Value,
        messages: &[i64],
        expect: impl Fn(&Places) -> bool,
    ) -> Value {
        let started = Instant::now();
        let data = self.person(name, input);
        let seconds = started.elapsed().as_secs_f64();
        assert_eq!(data["state"], "done", "{label}: {data}");
        eprintln!("{label}: {data}");
        let shown = self.places(messages);
        let pass = self.sync();
        let synced = self.places(messages);
        assert_eq!(shown, synced, "{label}: the store showed what sync finds");
        assert!(
            expect(&synced),
            "{label}: the messages are not where expected"
        );
        let record = json!({
            "step": label,
            "command": name,
            "seconds": seconds,
            "changed": data["changed"],
            "unchanged": data["unchanged"],
            "missing": data["missing"],
            "ignored": data["ignored"],
            "passSeconds": pass,
        });
        eprintln!("{record}");
        self.steps.push(record);
        data
    }
}

fn each_in(places: &Places, messages: &[i64], role: &str) -> bool {
    messages
        .iter()
        .all(|message| places.iter().any(|(r, _, m, _)| m == message && r == role))
}

fn each_in_run(places: &Places, messages: &[i64]) -> bool {
    messages
        .iter()
        .all(|message| places.iter().any(|(_, run, m, _)| m == message && *run))
}

#[test]
#[ignore = "changes a real iCloud account; the owner runs it with the sign-in files named"]
fn the_four_changes_and_their_undos_on_icloud() {
    let credentials = Credentials {
        user: read_secret("LOAM_MAIL_LIVE_ADDRESS_FILE"),
        password: read_secret("LOAM_MAIL_LIVE_PASSWORD_FILE"),
    };
    let mailbox = read_secret("LOAM_MAIL_LIVE_MAILBOX_FILE");
    let directory = std::env::var("LOAM_MAIL_LIVE_DIR").expect("LOAM_MAIL_LIVE_DIR is set");
    let results = round_trip(
        Live {
            endpoint: Endpoint::icloud(),
            credentials,
            mailbox,
        },
        std::path::Path::new(&directory),
    );
    eprintln!("{results}");
    if let Ok(out) = std::env::var("LOAM_MAIL_LIVE_OUT") {
        std::fs::write(out, serde_json::to_string_pretty(&results).unwrap()).unwrap();
    }
}

/// The run itself, on the scripted IMAP server without `MOVE`, as iCloud
/// is: what the owner runs is tested here first.
#[test]
fn the_round_trip_on_the_scripted_server_ends_as_it_started() {
    use support::imap::{PASSWORD, Server, USER};
    use support::synced::mail;
    let server = Server::start(true, true);
    {
        let mut world = server.world();
        world.mailbox("INBOX", &[]);
        world.mailbox("Archive", &["\\Archive"]);
        world.mailbox("Deleted Messages", &["\\Trash"]);
        world.mailbox("Receipts", &[]);
        world.mailbox("Loam run", &[]);
        world.add("INBOX", mail("A <a@example.net>", "i0", ""), &[]);
        world.add("Receipts", mail("B <b@example.net>", "r0", ""), &[]);
        world.add("Loam run", mail("C <c@example.net>", "t0", ""), &["\\Seen"]);
        world.add("Loam run", mail("D <d@example.net>", "t1", ""), &[]);
    }
    let before = server.world().contents("Loam run");
    let subjects = server.world().subjects("Loam run");
    let directory = tempfile::tempdir().unwrap();
    let results = round_trip(
        Live {
            endpoint: Endpoint {
                host: "127.0.0.1".to_string(),
                port: server.address.port(),
                tls: false,
            },
            credentials: Credentials {
                user: USER.to_string(),
                password: PASSWORD.to_string(),
            },
            mailbox: "Loam run".to_string(),
        },
        directory.path(),
    );
    assert_eq!(results["messages"], 2);
    assert_eq!(results["steps"].as_array().unwrap().len(), 10);
    // The mailbox the run did not name was neither read nor changed.
    let log = server.take_log();
    assert!(
        !log.iter()
            .any(|line| line.contains("Receipts") && !line.starts_with("LIST")),
        "{log:?}"
    );
    // Ids change with each move; the messages and their flags do not.
    let flags = |contents: Vec<(u32, Vec<String>)>| -> Vec<Vec<String>> {
        let mut flags: Vec<Vec<String>> = contents.into_iter().map(|(_, flags)| flags).collect();
        flags.sort();
        flags
    };
    assert_eq!(flags(server.world().contents("Loam run")), flags(before));
    assert_eq!(server.world().subjects("Loam run"), subjects);
    assert_eq!(server.world().subjects("INBOX"), ["About i0"]);
    assert!(server.world().subjects("Archive").is_empty());
    assert!(server.world().subjects("Deleted Messages").is_empty());
}

/// Syncs the scoped account into a store at `directory`, then makes and
/// undoes each change; its counts and times.
fn round_trip(connector: Live, directory: &std::path::Path) -> Value {
    let home = Home::at(directory);
    let mailbox = connector.mailbox.clone();
    let engine = Arc::new(
        Engine::new(Some(home))
            .with_connector(Arc::new(connector))
            .with_sync_options(Options::default()),
    );
    let account = engine
        .with_store(|store| {
            // The address is not needed: the connector holds the sign-in.
            store.add_account("icloud", "live", 0)?;
            Ok(store.accounts()?.remove(0))
        })
        .unwrap();
    let registry = loam_mail::registry(&engine).unwrap();
    let mut run = Run {
        database: directory.join("mail.sqlite3"),
        engine,
        registry,
        account,
        mailbox,
        runtime: tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap(),
        steps: Vec::new(),
    };
    let first_pass = run.sync();

    // The run's messages: what the run's mailbox shows now.
    let messages: Vec<i64> = {
        let connection = rusqlite::Connection::open(&run.database).unwrap();
        let mut statement = connection
            .prepare(
                "SELECT DISTINCT observation.message_id FROM observation
                 JOIN mailbox ON mailbox.id = observation.mailbox_id
                 WHERE observation.ended_at IS NULL AND mailbox.provider_key = ?1",
            )
            .unwrap();
        statement
            .query_map([&run.mailbox], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    assert!(
        !messages.is_empty() && messages.len() <= MOST,
        "the run's mailbox holds {} messages: it must hold 1 to {MOST}",
        messages.len()
    );
    let start = run.places(&messages);
    assert!(
        start.iter().all(|(_, run_mailbox, _, _)| *run_mailbox),
        "each of the run's messages is in the run's mailbox alone"
    );
    let ids = json!(messages);
    let mailboxes = run.person("mail-status", json!({}))["accounts"][0]["mailboxes"].clone();
    let mailbox_id = |role: &str| -> i64 {
        mailboxes
            .as_array()
            .unwrap()
            .iter()
            .find(|mailbox| mailbox["role"] == role)
            .unwrap_or_else(|| panic!("the account has a mailbox in the role {role}"))["mailbox"]
            .as_i64()
            .unwrap()
    };
    let (inbox, archive) = (mailbox_id("inbox"), mailbox_id("archive"));

    // Mark, and undo.
    let marked = run.step(
        "mark read and flagged",
        "mail-mark",
        json!({ "messages": ids, "read": true, "flagged": true }),
        &messages,
        |places| {
            places
                .iter()
                .all(|(_, _, _, flags)| flags.contains("\\\\Seen") && flags.contains("\\\\Flagged"))
        },
    );
    run.step(
        "undo the mark",
        "mail-operation-undo",
        json!({ "operation": marked["operation"] }),
        &messages,
        |places| places == &start,
    );

    // Copy to the archive, and undo.
    let copied = run.step(
        "copy to the archive",
        "mail-label",
        json!({ "messages": ids, "mailbox": archive, "copy": true }),
        &messages,
        |places| each_in(places, &messages, "archive") && each_in_run(places, &messages),
    );
    run.step(
        "undo the copy",
        "mail-operation-undo",
        json!({ "operation": copied["operation"] }),
        &messages,
        |places| places == &start,
    );

    // Move to the inbox, archive from there, and undo both.
    let moved = run.step(
        "move to the inbox",
        "mail-label",
        json!({ "messages": ids, "mailbox": inbox }),
        &messages,
        |places| each_in(places, &messages, "inbox") && !each_in_run(places, &messages),
    );
    let archived = run.step(
        "archive",
        "mail-archive",
        json!({ "messages": ids }),
        &messages,
        |places| each_in(places, &messages, "archive"),
    );
    run.step(
        "undo the archive",
        "mail-operation-undo",
        json!({ "operation": archived["operation"] }),
        &messages,
        |places| each_in(places, &messages, "inbox"),
    );
    run.step(
        "undo the move",
        "mail-operation-undo",
        json!({ "operation": moved["operation"] }),
        &messages,
        |places| places == &start,
    );

    // Trash, and undo.
    let trashed = run.step(
        "trash",
        "mail-trash",
        json!({ "messages": ids }),
        &messages,
        |places| each_in(places, &messages, "trash"),
    );
    run.step(
        "undo the trash",
        "mail-operation-undo",
        json!({ "operation": trashed["operation"] }),
        &messages,
        |places| places == &start,
    );

    let end = run.places(&messages);
    assert_eq!(end, start, "the run's mailbox ends as it started");
    json!({
        "run": "step D2's four change commands and their undos",
        "messages": messages.len(),
        "firstPassSeconds": first_pass,
        "steps": run.steps,
        "endedAsStarted": true,
    })
}
