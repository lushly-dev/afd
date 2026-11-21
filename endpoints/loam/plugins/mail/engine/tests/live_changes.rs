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
//! mailbox holds the same messages with the same flags as at its start.
//! While the messages are in the inbox, for a few seconds, a device may show
//! them there, and a mail program's rules may act on them as on new mail.
//!
//! **When a step fails**, the run makes no new change: it finishes each
//! operation it made that is not undone yet, newest first, and undoes it,
//! then fails, printing each operation's id and how its undo went. What it
//! could not put back is put back by hand in a mail client: the messages are
//! in the inbox, the archive or the trash.
//!
//! **What it reads.** The run's mailbox, the inbox, the archive and the
//! trash, headers only: no body is fetched. Those headers, addresses and
//! subjects among them, are kept in the run's data directory, which must be
//! empty or new at the start; delete it after the run.
//!
//! It prints and writes counts, ids and times only: no address, subject,
//! mailbox name or text.
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
    async fn returned(&mut self) -> Result<Vec<String>, ProviderError> {
        self.inner.returned().await
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
/// mailbox or not, message, flags), in order, each place once, so that two
/// places of one message in a mailbox are two. No name and no text.
type Places = Vec<(String, bool, i64, String)>;

struct Run {
    engine: Arc<Engine>,
    registry: CommandRegistry,
    account: AccountRow,
    mailbox: String,
    database: std::path::PathBuf,
    runtime: tokio::runtime::Runtime,
    steps: Vec<Value>,
    /// The operations made and not undone yet, oldest first, each with the
    /// undo of it that stopped part-way, if one did.
    open: Vec<(i64, Option<i64>)>,
}

impl Run {
    /// A pass of sync, which must reach every mailbox; its seconds.
    fn sync(&self) -> f64 {
        let connector = Arc::clone(self.engine.connector().unwrap());
        let started = Instant::now();
        let report = self
            .runtime
            .block_on(sync_account(
                &self.engine,
                connector.as_ref(),
                &self.account,
                self.engine.sync_options(),
                &SystemClock,
                &|_| {},
            ))
            .expect("a pass completes");
        let failed = report
            .mailboxes
            .iter()
            .filter(|mailbox| mailbox.error.is_some())
            .count();
        assert_eq!(failed, 0, "a pass failed in {failed} mailboxes");
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
        let mut places: Places = statement
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
            .collect();
        places.sort();
        places
    }

    /// The person's call of `name`: its whole result.
    fn call(&self, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human);
        let result = self
            .runtime
            .block_on(self.registry.execute(name, input, Some(context)));
        serde_json::to_value(&result).unwrap()
    }

    /// Resumes operation `id` until it is done, a few times at most.
    fn finish(&self, id: &Value) -> Value {
        let mut shown = Value::Null;
        for _ in 0..8 {
            shown = self.call("mail-operation-show", json!({ "operation": id }));
            if shown["data"]["state"] == "done" {
                break;
            }
            self.call("mail-operation-resume", json!({ "operation": id }));
        }
        shown
    }

    /// Finishes and undoes, newest first, each operation the run made and
    /// did not undo; prints how each went.
    fn put_back(&mut self) {
        while let Some((id, stopped_undo)) = self.open.pop() {
            let outcome = if let Some(undo) = stopped_undo {
                // Its undo began: finishing that undo puts it back.
                self.finish(&json!(undo))
            } else {
                self.finish(&json!(id));
                let outcome = self.call("mail-operation-undo", json!({ "operation": id }));
                if outcome["success"] == true && outcome["data"]["state"] != "done" {
                    self.finish(&outcome["data"]["operation"])
                } else {
                    outcome
                }
            };
            eprintln!(
                "{}",
                json!({
                    "putBack": id,
                    "success": outcome["success"],
                    "code": outcome["error"]["code"],
                    "state": outcome["data"]["state"],
                    "changed": outcome["data"]["changed"],
                    "missing": outcome["data"]["missing"],
                })
            );
        }
    }

    /// The person's call of `name`, which must succeed; its data.
    fn person(&self, name: &str, input: Value) -> Value {
        let result = self.call(name, input);
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
        let undoing = input["operation"].as_i64();
        if undoing.is_none() {
            // A change names messages, and acts on every place they have:
            // each must have the one place the run expects, so that nothing
            // that arrived since is changed with them.
            let places = self.places(messages);
            assert!(
                places.len() == messages.len()
                    && messages
                        .iter()
                        .all(|message| places.iter().any(|(_, _, m, _)| m == message)),
                "{label}: a message has other than one place before the change"
            );
        }
        let started = Instant::now();
        let result = self.call(name, input);
        let seconds = started.elapsed().as_secs_f64();
        let data = result["data"].clone();
        // An operation that failed part-way names itself in its failure's
        // details: it is put back as one that ran.
        let made = data["operation"]
            .as_i64()
            .or_else(|| result["error"]["details"]["operation"].as_i64());
        let done = result["success"] == true && data["state"] == "done";
        if let Some(id) = made {
            match undoing {
                Some(undone) if done => self.open.retain(|(open, _)| *open != undone),
                Some(undone) => {
                    for open in &mut self.open {
                        if open.0 == undone {
                            open.1 = Some(id);
                        }
                    }
                }
                None => self.open.push((id, None)),
            }
            eprintln!("{label}: operation {id}");
        }
        assert_eq!(
            result["success"], true,
            "{label}: failed, {}",
            result["error"]["code"]
        );
        assert_eq!(data["state"], "done", "{label}: {}", data["state"]);
        let shown = self.places(messages);
        let pass = self.sync();
        let synced = self.places(messages);
        assert!(
            shown == synced,
            "{label}: the store did not show what sync finds"
        );
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

/// Whether each message has exactly the places `wanted` names, one each,
/// and no other: `run` for the run's mailbox, else a mailbox's role.
fn exactly(places: &Places, messages: &[i64], wanted: &[&str]) -> bool {
    let mut wanted: Vec<&str> = wanted.to_vec();
    wanted.sort_unstable();
    places.len() == messages.len() * wanted.len()
        && messages.iter().all(|message| {
            let mut found: Vec<&str> = places
                .iter()
                .filter(|(_, _, m, _)| m == message)
                .map(|(role, run, _, _)| if *run { "run" } else { role.as_str() })
                .collect();
            found.sort_unstable();
            found == wanted
        })
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
    let server = scripted();
    let before = server.world().contents("Loam run");
    let subjects = server.world().subjects("Loam run");
    let directory = tempfile::tempdir().unwrap();
    let results = round_trip(scripted_live(&server), directory.path());
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

/// The run, synced and ready: its messages, where they start, and the
/// inbox's and the archive's ids.
struct Ready {
    run: Run,
    messages: Vec<i64>,
    start: Places,
    inbox: i64,
    archive: i64,
    first_pass: f64,
}

/// The scripted server without `MOVE`, as iCloud is, with a mailbox for
/// the run and one it must not touch.
fn scripted() -> support::imap::Server {
    use support::synced::mail;
    let server = support::imap::Server::start(true, true);
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
    server
}

fn scripted_live(server: &support::imap::Server) -> Live {
    Live {
        endpoint: Endpoint {
            host: "127.0.0.1".to_string(),
            port: server.address.port(),
            tls: false,
        },
        credentials: Credentials {
            user: support::imap::USER.to_string(),
            password: support::imap::PASSWORD.to_string(),
        },
        mailbox: "Loam run".to_string(),
    }
}

/// When a step fails part-way, the run puts back what it changed: here
/// after a mark, a move to the inbox and an archive, none undone.
#[test]
fn a_failed_run_puts_back_what_it_changed() {
    let server = scripted();
    let before = server.world().contents("Loam run");
    let directory = tempfile::tempdir().unwrap();
    let Ready {
        mut run, messages, ..
    } = ready(scripted_live(&server), directory.path());
    let ids = json!(messages);
    let inbox = run.person("mail-status", json!({}))["accounts"][0]["mailboxes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|mailbox| mailbox["role"] == "inbox")
        .unwrap()["mailbox"]
        .clone();
    run.step(
        "mark",
        "mail-mark",
        json!({ "messages": ids, "flagged": true }),
        &messages,
        |_| true,
    );
    run.step(
        "move",
        "mail-label",
        json!({ "messages": ids, "mailbox": inbox }),
        &messages,
        |_| true,
    );
    run.step(
        "archive",
        "mail-archive",
        json!({ "messages": ids }),
        &messages,
        |_| true,
    );
    assert_eq!(run.open.len(), 3);
    assert_eq!(server.world().subjects("Archive").len(), 2);
    run.put_back();
    assert!(run.open.is_empty());
    let flags = |contents: Vec<(u32, Vec<String>)>| -> Vec<Vec<String>> {
        let mut flags: Vec<Vec<String>> = contents.into_iter().map(|(_, flags)| flags).collect();
        flags.sort();
        flags
    };
    assert_eq!(flags(server.world().contents("Loam run")), flags(before));
    assert_eq!(server.world().subjects("INBOX"), ["About i0"]);
    assert!(server.world().subjects("Archive").is_empty());
}

/// A change that fails part-way, here an archive whose connection drops
/// after its delete flags are set, is put back with the rest: the run's
/// mailbox ends with its messages unflagged and nothing left in the archive.
#[test]
fn a_change_that_fails_part_way_is_put_back_too() {
    let server = scripted();
    let before = server.world().contents("Loam run");
    let directory = tempfile::tempdir().unwrap();
    let Ready {
        mut run,
        messages,
        inbox,
        ..
    } = ready(scripted_live(&server), directory.path());
    let ids = json!(messages);
    run.step(
        "move",
        "mail-label",
        json!({ "messages": ids, "mailbox": inbox }),
        &messages,
        |_| true,
    );
    server.world().drop_after_doing = Some("STORE".to_string());
    let archived = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run.step(
            "archive",
            "mail-archive",
            json!({ "messages": ids }),
            &messages,
            |_| true,
        );
    }));
    assert!(archived.is_err(), "the archive failed part-way");
    assert_eq!(run.open.len(), 2, "the stopped archive is put back too");
    run.put_back();
    let flags = |contents: Vec<(u32, Vec<String>)>| -> Vec<Vec<String>> {
        let mut flags: Vec<Vec<String>> = contents.into_iter().map(|(_, flags)| flags).collect();
        flags.sort();
        flags
    };
    assert_eq!(flags(server.world().contents("Loam run")), flags(before));
    assert!(server.world().subjects("Archive").is_empty());
    assert_eq!(server.world().subjects("INBOX"), ["About i0"]);
}

/// A copy of a run's message that arrives in the inbox while the run's copy
/// is there is never archived with it: the run stops before the change.
#[test]
fn a_copy_that_arrives_mid_run_stops_the_run_before_it_changes_anything() {
    let server = scripted();
    let directory = tempfile::tempdir().unwrap();
    let Ready {
        mut run,
        messages,
        inbox,
        ..
    } = ready(scripted_live(&server), directory.path());
    let ids = json!(messages);
    run.step(
        "move",
        "mail-label",
        json!({ "messages": ids, "mailbox": inbox }),
        &messages,
        |places| exactly(places, &messages, &["inbox"]),
    );
    // The same message again, as another client might put it there.
    server.world().add(
        "INBOX",
        support::synced::mail("D <d@example.net>", "t1", ""),
        &[],
    );
    run.sync();
    let archived = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run.step(
            "archive",
            "mail-archive",
            json!({ "messages": ids }),
            &messages,
            |_| true,
        );
    }));
    assert!(archived.is_err());
    assert!(server.world().subjects("Archive").is_empty());
    assert_eq!(run.open.len(), 1);
}

/// Syncs the scoped account into a store at `directory`, then makes and
/// undoes each change; its counts and times.
fn round_trip(connector: Live, directory: &std::path::Path) -> Value {
    let Ready {
        mut run,
        messages,
        start,
        inbox,
        archive,
        first_pass,
    } = ready(connector, directory);
    let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        changes(&mut run, &messages, &start, inbox, archive);
    }));
    if let Err(failed) = ran {
        eprintln!("a step failed: putting back what the run changed");
        run.put_back();
        std::panic::resume_unwind(failed);
    }
    json!({
        "run": "step D2's four change commands and their undos",
        "messages": messages.len(),
        "firstPassSeconds": first_pass,
        "steps": run.steps,
        "endedAsStarted": true,
    })
}

/// Syncs the scoped account into a new store at `directory`, and checks
/// that the run's mailbox can be run on.
fn ready(connector: Live, directory: &std::path::Path) -> Ready {
    assert!(
        std::fs::read_dir(directory).map_or(true, |mut entries| entries.next().is_none()),
        "the run's data directory is empty or new"
    );
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
    let run = Run {
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
        open: Vec::new(),
    };
    let first_pass = run.sync();

    // The run's messages: what the run's mailbox shows now.
    let (places, unreturned): (i64, i64) = {
        let connection = rusqlite::Connection::open(&run.database).unwrap();
        connection
            .query_row(
                "SELECT
                     (SELECT count(*) FROM observation JOIN mailbox
                          ON mailbox.id = observation.mailbox_id
                      WHERE observation.ended_at IS NULL AND mailbox.provider_key = ?1),
                     (SELECT count(*) FROM unreturned JOIN mailbox
                          ON mailbox.id = unreturned.mailbox_id
                      WHERE mailbox.provider_key = ?1)",
                [&run.mailbox],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
    };
    assert_eq!(
        unreturned, 0,
        "the run's mailbox lists messages the provider did not return"
    );
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
    assert_eq!(
        usize::try_from(places).unwrap(),
        messages.len(),
        "the run's mailbox holds a message twice"
    );
    let start = run.places(&messages);
    let roles: Vec<&str> = start.iter().map(|(role, _, _, _)| role.as_str()).collect();
    assert!(
        roles
            .iter()
            .all(|role| !matches!(*role, "inbox" | "archive" | "trash")),
        "the run's mailbox is not the inbox, the archive or the trash"
    );
    assert!(
        start.iter().all(|(_, run_mailbox, _, _)| *run_mailbox),
        "each of the run's messages is in the run's mailbox alone"
    );
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
    Ready {
        run,
        messages,
        start,
        inbox,
        archive,
        first_pass,
    }
}

/// Each change, checked, and its undo, in the run's order.
fn changes(run: &mut Run, messages: &[i64], start: &Places, inbox: i64, archive: i64) {
    let ids = json!(messages);
    // Mark, and undo.
    let marked = run.step(
        "mark read and flagged",
        "mail-mark",
        json!({ "messages": ids, "read": true, "flagged": true }),
        messages,
        |places| {
            exactly(places, messages, &["run"])
                && places.iter().all(|(_, _, _, flags)| {
                    flags.contains("\\\\Seen") && flags.contains("\\\\Flagged")
                })
        },
    );
    run.step(
        "undo the mark",
        "mail-operation-undo",
        json!({ "operation": marked["operation"] }),
        messages,
        |places| places == start,
    );

    // Copy to the archive, and undo.
    let copied = run.step(
        "copy to the archive",
        "mail-label",
        json!({ "messages": ids, "mailbox": archive, "copy": true }),
        messages,
        |places| exactly(places, messages, &["run", "archive"]),
    );
    run.step(
        "undo the copy",
        "mail-operation-undo",
        json!({ "operation": copied["operation"] }),
        messages,
        |places| places == start,
    );

    // Move to the inbox, archive from there, and undo both.
    let moved = run.step(
        "move to the inbox",
        "mail-label",
        json!({ "messages": ids, "mailbox": inbox }),
        messages,
        |places| exactly(places, messages, &["inbox"]),
    );
    let archived = run.step(
        "archive",
        "mail-archive",
        json!({ "messages": ids }),
        messages,
        |places| exactly(places, messages, &["archive"]),
    );
    run.step(
        "undo the archive",
        "mail-operation-undo",
        json!({ "operation": archived["operation"] }),
        messages,
        |places| exactly(places, messages, &["inbox"]),
    );
    run.step(
        "undo the move",
        "mail-operation-undo",
        json!({ "operation": moved["operation"] }),
        messages,
        |places| places == start,
    );

    // Trash, and undo.
    let trashed = run.step(
        "trash",
        "mail-trash",
        json!({ "messages": ids }),
        messages,
        |places| exactly(places, messages, &["trash"]),
    );
    run.step(
        "undo the trash",
        "mail-operation-undo",
        json!({ "operation": trashed["operation"] }),
        messages,
        |places| places == start,
    );

    let end = run.places(messages);
    assert!(&end == start, "the run's mailbox did not end as it started");
}
