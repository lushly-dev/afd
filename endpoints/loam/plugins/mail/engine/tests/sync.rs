//! Sync against the scripted IMAP server (the specification's sections 5
//! and 14): order, resuming after a stop, messages listed and not returned,
//! later passes, a new `UIDVALIDITY`, repairs, and the commands a read sends.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use afd::Clock;
use loam_mail::cli::{Caller, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::log::BlobId;
use loam_mail::provider::ProviderError;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::store::{AccountRow, MailboxRow, Role};
use loam_mail::sync::{AccountReport, Options, SyncError, sync_account};
use support::imap::{PASSWORD, Server, USER, forwarding_message, large_message, message};

const HOUR: i64 = 60 * 60 * 1000;

#[derive(Debug, Default)]
struct TestClock(AtomicI64);

impl Clock for TestClock {
    fn now(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct Fixture {
    directory: tempfile::TempDir,
    server: Server,
    engine: Arc<Engine>,
    account: AccountRow,
    clock: TestClock,
}

impl Fixture {
    fn new(condstore: bool, qresync: bool) -> Self {
        Self::with(condstore, qresync, PASSWORD, Options::default())
    }

    fn with(condstore: bool, qresync: bool, password: &str, options: Options) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let server = Server::start(condstore, qresync);
        let endpoint = Endpoint {
            host: "127.0.0.1".to_string(),
            port: server.address.port(),
            tls: false,
        };
        let password = password.to_string();
        let connector = ImapConnector::new(endpoint, ICLOUD_NAMES, move |_| {
            Ok(Credentials {
                user: USER.to_string(),
                password: password.clone(),
            })
        });
        let engine = Engine::new(Some(Home::at(directory.path().join("data"))))
            .with_connector(Arc::new(connector))
            .with_sync_options(Options {
                backoff: Duration::ZERO,
                ..options
            });
        let account = engine
            .with_store(|store| {
                store.add_account("icloud", USER, 0)?;
                Ok(store.accounts()?.remove(0))
            })
            .unwrap();
        Self {
            directory,
            server,
            engine: Arc::new(engine),
            account,
            clock: TestClock(AtomicI64::new(1_000 * HOUR)),
        }
    }

    fn pass(&self) -> Result<AccountReport, SyncError> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let connector = Arc::clone(self.engine.connector().unwrap());
        runtime.block_on(sync_account(
            &self.engine,
            connector.as_ref(),
            &self.account,
            self.engine.sync_options(),
            &self.clock,
            &|_| {},
        ))
    }

    fn later(&self, by: i64) {
        self.clock.0.fetch_add(by, Ordering::SeqCst);
    }

    fn mailbox(&self, name: &str) -> MailboxRow {
        self.engine
            .with_store(|store| store.mailboxes(self.account.id))
            .unwrap()
            .into_iter()
            .find(|row| row.name == name)
            .expect("the mailbox is recorded")
    }

    /// What the store shows of the account, without its row ids.
    fn snapshot(&self) -> Vec<String> {
        self.engine
            .with_store(|store| {
                let mut lines = Vec::new();
                for row in store.mailboxes(self.account.id)? {
                    let status = store.mailbox_status(row.id)?;
                    let mut shown: Vec<String> = store
                        .shown_ids(row.id, &row.validity)?
                        .into_iter()
                        .collect();
                    shown.sort();
                    let mut tried: Vec<String> = store
                        .unreturned_tries(row.id, &row.validity)?
                        .into_iter()
                        .map(|(id, tried)| format!("{id}:{}", tried.tries))
                        .collect();
                    tried.sort();
                    let threads: Vec<String> = store
                        .list_threads(row.id, None, 1_000)?
                        .into_iter()
                        .map(|thread| {
                            format!(
                                "{}/{}/{}/{}",
                                thread.subject, thread.shown, thread.unread, thread.messages
                            )
                        })
                        .collect();
                    lines.push(format!(
                        "{} {} {} cursor={:?} listed={:?} gone={} shown={shown:?} \
                         tried={tried:?} status={status:?} threads={threads:?}",
                        row.name,
                        row.role.as_str(),
                        row.validity,
                        row.cursor,
                        row.listed,
                        row.gone
                    ));
                }
                Ok(lines)
            })
            .unwrap()
    }
}

/// An account like the owner's: an inbox, iCloud's sent and trash mailboxes
/// with their flags, its junk and archive mailboxes without, and a folder.
fn populate(server: &Server) {
    let mut world = server.world();
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.mailbox("Deleted Messages", &["\\Trash"]);
    world.mailbox("Junk", &[]);
    world.mailbox("Archive", &[]);
    world.mailbox("GitHub", &[]);
    world.mailbox("Folders", &["\\Noselect"]);
    world.add("INBOX", message(1, "Plans", None, "first"), &["\\Seen"]);
    world.add("INBOX", message(2, "Plans", Some(1), "second"), &[]);
    world.add("INBOX", message(3, "Invoice", None, "third"), &["\\Seen"]);
    world.add(
        "Sent Messages",
        message(4, "Plans", Some(2), "reply"),
        &["\\Seen"],
    );
    world.add(
        "Deleted Messages",
        message(5, "Old", None, "gone"),
        &["\\Seen"],
    );
    world.add("Junk", message(6, "Win", None, "spam"), &[]);
    world.add("Archive", message(7, "Kept", None, "kept"), &["\\Seen"]);
    for n in 0..5 {
        world.add("GitHub", message(100 + n, "Build", None, "ci"), &[]);
    }
}

/// Every command a read sent leaves the mailbox as it was: it is opened
/// with `EXAMINE`, and a message's bytes are read with `BODY.PEEK`.
fn assert_read_only(log: &[String]) {
    assert!(!log.is_empty());
    for command in log {
        let upper = command.to_ascii_uppercase();
        let verb = upper.split(' ').next().unwrap_or_default();
        let allowed = match verb {
            "CAPABILITY" | "LOGIN" | "ENABLE" | "LIST" | "EXAMINE" | "LOGOUT" => true,
            "UID" => {
                let sub = upper.split(' ').nth(1).unwrap_or_default();
                (sub == "SEARCH" || sub == "FETCH") && !upper.contains("BODY[")
            }
            _ => false,
        };
        assert!(allowed, "a read sent `{command}`");
    }
}

/// Whether a request for headers was sent.
fn headers_fetched(log: &[String]) -> bool {
    log.iter()
        .any(|command| command.contains("BODY.PEEK[HEADER]"))
}

fn fetches(log: &[String]) -> Vec<String> {
    log.iter()
        .filter(|command| command.starts_with("UID FETCH"))
        .cloned()
        .collect()
}

#[test]
fn a_first_sync_holds_each_mailbox_by_its_role() {
    let fixture = Fixture::new(true, true);
    populate(&fixture.server);
    let report = fixture.pass().unwrap();
    assert_eq!(
        report.mailboxes.len(),
        6,
        "the unselectable folder is left out"
    );

    let roles: Vec<(String, Role)> = fixture
        .engine
        .with_store(|store| store.mailboxes(fixture.account.id))
        .unwrap()
        .into_iter()
        .map(|row| (row.name, row.role))
        .collect();
    for (name, role) in [
        ("INBOX", Role::Inbox),
        ("Sent Messages", Role::Sent),
        ("Deleted Messages", Role::Trash),
        ("Junk", Role::Junk),
        ("Archive", Role::Archive),
        ("GitHub", Role::None),
    ] {
        assert!(roles.contains(&(name.to_string(), role)), "{name}");
    }

    let inbox = fixture.mailbox("INBOX");
    assert!(inbox.cursor.is_some(), "listed in full");
    assert_eq!(inbox.listed, Some(3));
    let status = fixture
        .engine
        .with_store(|store| store.mailbox_status(inbox.id))
        .unwrap();
    assert_eq!(
        (status.counts.headers_held, status.counts.bodies_held),
        (3, 3)
    );
    assert_eq!(status.bodies_wanted, 0);

    // Junk and trash are header-only (5.3).
    for name in ["Junk", "Deleted Messages"] {
        let row = fixture.mailbox(name);
        assert!(row.header_only, "{name}");
        let status = fixture
            .engine
            .with_store(|store| store.mailbox_status(row.id))
            .unwrap();
        assert_eq!(
            (status.counts.headers_held, status.counts.bodies_held),
            (1, 0),
            "{name}"
        );
    }

    // The inbox lists two threads; the one with the reply has one of its two
    // messages unread.
    let threads = fixture
        .engine
        .with_store(|store| store.list_threads(inbox.id, None, 50))
        .unwrap();
    let plans = threads
        .iter()
        .find(|thread| thread.subject == "Plans")
        .unwrap();
    assert_eq!((plans.shown, plans.unread, plans.messages), (2, 1, 3));
    assert_read_only(&fixture.server.take_log());
}

#[test]
fn the_inbox_and_the_sent_mailbox_go_first_and_mailboxes_take_turns() {
    let fixture = Fixture::with(
        true,
        true,
        PASSWORD,
        Options {
            header_batch: 2,
            body_batch: 2,
            ..Options::default()
        },
    );
    {
        let mut world = fixture.server.world();
        world.mailbox("GitHub", &[]);
        world.mailbox("Sent Messages", &["\\Sent"]);
        world.mailbox("INBOX", &[]);
        for n in 0..12 {
            world.add("GitHub", message(100 + n, "Build", None, "ci"), &[]);
        }
        for n in 0..4 {
            world.add("INBOX", message(n, "Hello", None, "hi"), &[]);
        }
        world.add("Sent Messages", message(50, "Re", None, "yes"), &[]);
    }
    fixture.pass().unwrap();
    let log = fixture.server.take_log();
    let opened: Vec<&str> = log
        .iter()
        .filter_map(|command| command.strip_prefix("EXAMINE "))
        .collect();
    assert!(opened[0].starts_with("\"INBOX\""), "{opened:?}");
    assert!(opened[1].starts_with("\"Sent Messages\""), "{opened:?}");
    // Each request, with the mailbox open when it was sent.
    let mut open = "";
    let mut requests: Vec<(&str, &str)> = Vec::new();
    for command in &log {
        if let Some(name) = command.strip_prefix("EXAMINE ") {
            open = name.split('"').nth(1).unwrap();
        } else if command.contains("BODY.PEEK[HEADER]") {
            requests.push((open, "headers"));
        } else if command.contains("BODY.PEEK[]") {
            requests.push((open, "bodies"));
        }
    }
    let last = |mailbox: &str, kind: &str| {
        requests
            .iter()
            .rposition(|request| *request == (mailbox, kind))
            .unwrap()
    };
    // The inbox has its bodies while the large mailbox still has headers to
    // fetch: the mailboxes took turns.
    assert!(
        last("INBOX", "bodies") < last("GitHub", "headers"),
        "{requests:?}"
    );
    assert!(last("Sent Messages", "bodies") < last("GitHub", "headers"));
    // A turn with nothing to fetch opens nothing.
    let examines = log
        .iter()
        .filter(|command| command.starts_with("EXAMINE"))
        .count();
    assert!(examines <= requests.len() + 3, "{log:#?}");
}

#[test]
fn a_stop_at_any_point_resumes_to_the_same_store() {
    let options = Options {
        header_batch: 2,
        body_batch: 2,
        retries: 0,
        ..Options::default()
    };
    let complete = Fixture::with(true, true, PASSWORD, options.clone());
    populate(&complete.server);
    complete.pass().unwrap();
    let expected = complete.snapshot();
    let log = complete.server.take_log();
    let commands = log.len();
    assert!(fetches(&log).len() > 5);

    // Every message's headers and body is one FETCH response, and every
    // command a point the connection can drop at: stop at each in turn,
    // then let a later pass finish.
    let mut stopped_passes = 0;
    let stops = (0..24)
        .map(|after| (Some(after), None))
        .chain((0..commands).map(|after| (None, Some(after))));
    for (responses, sent) in stops {
        let fixture = Fixture::with(true, true, PASSWORD, options.clone());
        populate(&fixture.server);
        {
            let mut world = fixture.server.world();
            world.drop_after = responses;
            world.drop_after_commands = sent;
            world.down_on_drop = true;
        }
        let stopped = fixture.pass();
        if stopped.is_ok() {
            // The drop never came.
            assert_eq!(fixture.snapshot(), expected);
            continue;
        }
        assert!(
            matches!(
                stopped,
                Err(SyncError::Provider(ProviderError::Unavailable(_)))
            ),
            "{stopped:?}"
        );
        stopped_passes += 1;
        fixture.server.world().down = false;
        fixture.later(1);
        fixture.pass().unwrap();
        assert_eq!(
            fixture.snapshot(),
            expected,
            "stopped after {responses:?} responses, {sent:?} commands"
        );
        assert_read_only(&fixture.server.take_log());
    }
    assert!(stopped_passes > commands, "{stopped_passes} stops");
}

#[test]
fn flags_that_change_while_a_first_sync_is_stopped_are_read_when_it_resumes() {
    for (condstore, qresync) in [(true, true), (true, false), (false, false)] {
        let options = Options {
            header_batch: 2,
            retries: 0,
            ..Options::default()
        };
        let fixture = Fixture::with(condstore, qresync, PASSWORD, options);
        populate(&fixture.server);
        // Stop after the inbox's first batch of headers is stored.
        {
            let mut world = fixture.server.world();
            world.drop_after = Some(2);
            world.down_on_drop = true;
        }
        assert!(fixture.pass().is_err());
        fixture.server.world().down = false;
        assert!(fixture.mailbox("INBOX").cursor.is_none());
        // The person reads the unread message elsewhere.
        fixture.server.world().set_flags("INBOX", 2, &["\\Seen"]);
        fixture.later(1);
        fixture.pass().unwrap();
        fixture.later(1);
        fixture.pass().unwrap();

        let fresh = Fixture::new(condstore, qresync);
        populate(&fresh.server);
        fresh.server.world().set_flags("INBOX", 2, &["\\Seen"]);
        fresh.pass().unwrap();
        let without_cursor = |lines: Vec<String>| -> Vec<String> {
            lines
                .into_iter()
                .map(|line| {
                    let (before, after) = line.split_once(" cursor=").unwrap();
                    format!("{before} {}", after.split_once(" listed=").unwrap().1)
                })
                .collect()
        };
        assert_eq!(
            without_cursor(fixture.snapshot()),
            without_cursor(fresh.snapshot()),
            "{condstore} {qresync}"
        );
    }
}

#[test]
fn a_dropped_connection_is_opened_again_within_the_pass() {
    let fixture = Fixture::with(
        true,
        true,
        PASSWORD,
        Options {
            header_batch: 2,
            retries: 2,
            ..Options::default()
        },
    );
    populate(&fixture.server);
    fixture.server.world().drop_after = Some(3);
    fixture.pass().unwrap();
    assert_eq!(fixture.server.world().connections, 2);
    let reference = Fixture::new(true, true);
    populate(&reference.server);
    reference.pass().unwrap();
    assert_eq!(fixture.snapshot(), reference.snapshot());
}

#[test]
fn a_message_listed_and_never_returned_stops_holding_the_mailbox_after_three_tries() {
    for (condstore, qresync) in [(true, true), (true, false), (false, false)] {
        listed_and_never_returned(condstore, qresync);
    }
}

fn listed_and_never_returned(condstore: bool, qresync: bool) {
    let fixture = Fixture::new(condstore, qresync);
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        world.add("INBOX", message(1, "One", None, "a"), &[]);
        let missing = world.add("INBOX", message(2, "Two", None, "b"), &[]);
        world.find("INBOX").never_return.insert(missing);
    }
    let counts = |fixture: &Fixture| {
        let inbox = fixture.mailbox("INBOX");
        fixture
            .engine
            .with_store(|store| store.mailbox_counts(inbox.id))
            .unwrap()
    };
    let report = fixture.pass().unwrap();
    assert_eq!(report.mailboxes[0].not_returned, 1);
    assert_eq!(
        (counts(&fixture).awaited, counts(&fixture).unreturned),
        (1, 0)
    );
    assert!(
        fixture.mailbox("INBOX").cursor.is_some(),
        "the listing moved on"
    );

    // Ten minutes later it is not tried: a try counts at most once an hour.
    fixture.later(HOUR / 6);
    fixture.server.take_log();
    fixture.pass().unwrap();
    assert!(
        !headers_fetched(&fixture.server.take_log()),
        "nothing to fetch"
    );
    assert_eq!(counts(&fixture).awaited, 1);

    fixture.later(HOUR);
    fixture.pass().unwrap();
    fixture.later(HOUR);
    fixture.pass().unwrap();
    assert_eq!(
        (counts(&fixture).awaited, counts(&fixture).unreturned),
        (0, 1),
        "three tries in separate passes an hour apart: {condstore} {qresync}"
    );

    // Unreturned now: not tried each pass, but weekly.
    fixture.later(HOUR);
    fixture.server.take_log();
    fixture.pass().unwrap();
    assert!(!headers_fetched(&fixture.server.take_log()));

    // A week on, the provider returns it, and it is stored like any other.
    fixture.server.world().find("INBOX").never_return.clear();
    fixture.later(7 * 24 * HOUR);
    let report = fixture.pass().unwrap();
    assert_eq!(report.mailboxes[0].added, 1);
    assert_eq!(
        (
            counts(&fixture).headers_held,
            counts(&fixture).awaited,
            counts(&fixture).unreturned
        ),
        (2, 0, 0)
    );
}

#[test]
fn later_passes_record_flags_removals_and_new_mail_with_or_without_extensions() {
    for (condstore, qresync) in [(true, true), (true, false), (false, false)] {
        let fixture = Fixture::new(condstore, qresync);
        populate(&fixture.server);
        fixture.pass().unwrap();
        let first = fixture.server.take_log();
        assert_read_only(&first);

        {
            let mut world = fixture.server.world();
            world.set_flags("INBOX", 2, &["\\Seen"]);
            world.expunge("INBOX", 3);
            world.add("INBOX", message(9, "New", None, "new"), &[]);
        }
        fixture.later(1);
        let report = fixture.pass().unwrap();
        let inbox = &report.mailboxes[0];
        assert_eq!(inbox.role, "inbox");
        assert!(!inbox.listed_in_full, "{condstore} {qresync}");
        assert_eq!(
            (inbox.added, inbox.changed, inbox.removed, inbox.bodies),
            (1, 1, 1, 1),
            "{condstore} {qresync}"
        );
        let log = fixture.server.take_log();
        assert_read_only(&log);
        if qresync {
            assert!(
                !log.iter().any(|command| command == "UID SEARCH ALL"),
                "QRESYNC names what vanished: {log:?}"
            );
        }

        // The result is the store a first sync of the changed mailbox makes.
        let fresh = Fixture::new(condstore, qresync);
        populate(&fresh.server);
        {
            let mut world = fresh.server.world();
            world.set_flags("INBOX", 2, &["\\Seen"]);
            world.expunge("INBOX", 3);
            world.add("INBOX", message(9, "New", None, "new"), &[]);
        }
        fresh.pass().unwrap();
        let strip = |lines: Vec<String>| -> Vec<String> {
            lines
                .into_iter()
                .map(|line| line.split(" cursor=").next().unwrap().to_string())
                .collect()
        };
        let threads = |lines: &[String]| -> Vec<String> {
            lines
                .iter()
                .map(|line| line.split(" shown=").nth(1).unwrap().to_string())
                .collect()
        };
        assert_eq!(strip(fixture.snapshot()), strip(fresh.snapshot()));
        assert_eq!(threads(&fixture.snapshot()), threads(&fresh.snapshot()));
    }
}

#[test]
fn a_new_uidvalidity_lists_the_mailbox_again_and_matches_its_messages() {
    let fixture = Fixture::new(true, true);
    populate(&fixture.server);
    fixture.pass().unwrap();
    let before = fixture.mailbox("INBOX");
    fixture.server.take_log();
    fixture.server.world().renumber("INBOX");
    fixture.later(1);
    let report = fixture.pass().unwrap();
    assert!(report.mailboxes[0].listed_in_full);
    assert_eq!(report.mailboxes[0].added, 3);
    let log = fixture.server.take_log();
    assert_read_only(&log);
    assert!(
        !log.iter().any(|command| command.contains("BODY.PEEK[]")),
        "messages already held are matched by their identity, not fetched again: {log:?}"
    );
    let after = fixture.mailbox("INBOX");
    assert_ne!(before.validity, after.validity);
    let shown = fixture
        .engine
        .with_store(|store| store.shown_ids(after.id, &after.validity))
        .unwrap();
    assert_eq!(shown.len(), 3);
    let threads = fixture
        .engine
        .with_store(|store| store.list_threads(after.id, None, 50))
        .unwrap();
    assert_eq!(threads.len(), 2, "no message is shown twice");
}

#[test]
fn a_damaged_file_is_fetched_again_repaired_and_derived_again() {
    let fixture = Fixture::new(true, true);
    populate(&fixture.server);
    fixture.pass().unwrap();
    let expected = fixture.snapshot();
    fixture.server.take_log();
    let bytes = message(3, "Invoice", None, "third");
    let header = &bytes[..bytes.len() - "third\r\n".len()];
    let found = fixture
        .engine
        .with_store(|store| store.find_message(header, bytes.len() as u64))
        .unwrap()
        .expect("the message is held");
    // Both of its files are damaged.
    for held in [header, &bytes[..]] {
        let hex = BlobId::of(held).to_hex();
        let file = fixture
            .directory
            .path()
            .join("data")
            .join("blobs")
            .join(&hex[..2])
            .join(&hex);
        std::fs::write(&file, b"not what was stored").unwrap();
    }
    // A rebuild meets them, and derives what it can: nothing of the message.
    fixture
        .engine
        .with_store(|store| {
            store.rebuild(1, |_| {})?;
            Ok(())
        })
        .unwrap();
    assert_ne!(fixture.snapshot(), expected);
    let found_by_search = |fixture: &Fixture| {
        fixture
            .engine
            .with_store(|store| store.search("invoice", 10))
            .unwrap()
            .len()
    };
    assert_eq!(found_by_search(&fixture), 0);

    fixture.later(1);
    let report = fixture.pass().unwrap();
    let inbox = &report.mailboxes[0];
    assert_eq!(inbox.repaired, 2, "{inbox:?}");
    assert_read_only(&fixture.server.take_log());
    let read = fixture
        .engine
        .with_store(|store| store.read_part(found, "whole"))
        .unwrap();
    assert_eq!(read, bytes);
    // The message is derived again: the store is what it was.
    assert_eq!(fixture.snapshot(), expected);
    assert_eq!(found_by_search(&fixture), 1);
}

#[test]
fn a_body_that_conflicts_is_set_aside_and_the_rest_of_its_batch_recorded() {
    let fixture = Fixture::new(true, true);
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        // Two messages with one header block and one size, and other bodies:
        // one identity, two sets of bytes.
        world.add("INBOX", message(1, "Twin", None, "aaaa"), &[]);
        world.add("INBOX", message(1, "Twin", None, "bbbb"), &[]);
        world.add("INBOX", message(2, "Other", None, "cccc"), &[]);
    }
    let report = fixture.pass().unwrap();
    let inbox = &report.mailboxes[0];
    assert_eq!((inbox.bodies, inbox.set_aside), (2, 1), "{inbox:?}");
    assert_read_only(&fixture.server.take_log());
}

#[test]
fn a_mailbox_the_provider_stops_listing_shows_nothing() {
    let fixture = Fixture::new(true, true);
    populate(&fixture.server);
    fixture.pass().unwrap();
    let archive = fixture.mailbox("Archive");
    fixture.server.world().remove_mailbox("Archive");
    fixture.later(1);
    fixture.pass().unwrap();
    let gone = fixture.mailbox("Archive");
    assert!(gone.gone);
    let (shown, threads) = fixture
        .engine
        .with_store(|store| {
            Ok((
                store.shown_ids(archive.id, &archive.validity)?,
                store.list_threads(archive.id, None, 50)?,
            ))
        })
        .unwrap();
    assert!(shown.is_empty() && threads.is_empty());
}

#[test]
fn a_refused_sign_in_stops_the_pass() {
    let fixture = Fixture::with(true, true, "wrong", Options::default());
    populate(&fixture.server);
    assert!(matches!(
        fixture.pass(),
        Err(SyncError::Provider(ProviderError::SignIn))
    ));
}

fn command(fixture: &Fixture, args: &[&str]) -> (u8, serde_json::Value) {
    let registry = loam_mail::registry(&fixture.engine).unwrap();
    let args: Vec<String> = args.iter().map(ToString::to_string).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(
        &args,
        &registry,
        Caller::Script,
        fixture.engine.secrets().as_ref(),
        &mut out,
        &mut err,
    )
    .unwrap();
    (status, serde_json::from_slice(&out).unwrap())
}

#[test]
fn mail_sync_and_mail_status_run_from_the_command_line() {
    let fixture = Fixture::new(true, true);
    populate(&fixture.server);
    {
        let mut world = fixture.server.world();
        let missing = world.add("GitHub", message(200, "Build", None, "ci"), &[]);
        world.find("GitHub").never_return.insert(missing);
    }
    let (status, before) = command(&fixture, &["mail-status"]);
    assert_eq!(status, 0, "{before}");
    assert_eq!(before["data"]["accounts"][0]["synced"], false);

    let (status, synced) = command(&fixture, &["mail-sync"]);
    assert_eq!(status, 0, "{synced}");
    let mailboxes = synced["data"]["accounts"][0]["mailboxes"]
        .as_array()
        .unwrap();
    assert_eq!(mailboxes.len(), 6);
    assert_eq!(mailboxes[0]["role"], "inbox");

    let (_, after) = command(&fixture, &["mail-status"]);
    let account = &after["data"]["accounts"][0];
    let state = |name: &str| {
        account["mailboxes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|mailbox| mailbox["name"]["text"] == name)
            .unwrap()
            .clone()
    };
    assert_eq!(state("INBOX")["state"], "synced");
    assert_eq!(state("Junk")["state"], "synced", "header-only");
    let github = state("GitHub");
    assert_eq!(
        github["state"], "listing",
        "an awaited message holds it back"
    );
    assert_eq!(github["awaited"], 1);
    assert_eq!(account["synced"], false);

    let (status, refused) = command(&fixture, &["mail-sync", r#"{"account": 99}"#]);
    assert_eq!(status, 1);
    assert_eq!(refused["error"]["code"], "ACCOUNT_NOT_FOUND");
    let (status, refused) = command(&fixture, &["mail-sync", r#"{"account": "one"}"#]);
    assert_eq!(status, 1);
    assert_eq!(refused["error"]["code"], "VALIDATION_ERROR");
}

#[test]
fn a_failed_sign_in_is_sign_in_required() {
    let fixture = Fixture::with(true, true, "wrong", Options::default());
    populate(&fixture.server);
    let (status, result) = command(&fixture, &["mail-sync"]);
    assert_eq!(status, 1);
    assert_eq!(result["error"]["code"], "SIGN_IN_REQUIRED");
    let message = result["error"]["message"].as_str().unwrap();
    assert!(
        !message.contains("Authentication failed"),
        "no text from the provider: {message}"
    );
}

#[test]
fn mail_status_labels_a_mailbox_name_as_content() {
    let fixture = Fixture::new(true, true);
    populate(&fixture.server);
    fixture.pass().unwrap();
    let (_, status) = command(&fixture, &["mail-status"]);
    for mailbox in status["data"]["accounts"][0]["mailboxes"]
        .as_array()
        .unwrap()
    {
        assert_eq!(mailbox["name"]["trust"], "content", "{mailbox}");
    }
}

#[test]
fn a_body_never_returned_stops_holding_the_mailbox_after_three_tries() {
    let fixture = Fixture::new(true, true);
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        world.add("INBOX", message(1, "One", None, "a"), &[]);
        let headless = world.add("INBOX", message(2, "Two", None, "b"), &[]);
        world.find("INBOX").never_return_body.insert(headless);
    }
    let status = |fixture: &Fixture| {
        let inbox = fixture.mailbox("INBOX");
        fixture
            .engine
            .with_store(|store| store.mailbox_status(inbox.id))
            .unwrap()
    };
    fixture.pass().unwrap();
    assert_eq!(
        (
            status(&fixture).bodies_wanted,
            status(&fixture).bodies_unreturned
        ),
        (1, 0)
    );
    // Within the hour it is not asked for again.
    fixture.later(HOUR / 6);
    fixture.server.take_log();
    fixture.pass().unwrap();
    assert!(fetches(&fixture.server.take_log()).is_empty());
    fixture.later(HOUR);
    fixture.pass().unwrap();
    fixture.later(HOUR);
    fixture.pass().unwrap();
    assert_eq!(
        (
            status(&fixture).bodies_wanted,
            status(&fixture).bodies_unreturned
        ),
        (0, 1)
    );
    let (_, result) = command(&fixture, &["mail-status"]);
    assert_eq!(
        result["data"]["accounts"][0]["mailboxes"][0]["state"],
        "synced"
    );
    // A week on it answers, and is held.
    fixture
        .server
        .world()
        .find("INBOX")
        .never_return_body
        .clear();
    fixture.later(7 * 24 * HOUR);
    fixture.pass().unwrap();
    assert_eq!(
        (
            status(&fixture).counts.bodies_held,
            status(&fixture).bodies_unreturned
        ),
        (2, 0)
    );
}

#[test]
fn a_message_the_engine_cannot_read_is_passed_over() {
    let fixture = Fixture::with(
        true,
        true,
        PASSWORD,
        Options {
            header_batch: 3,
            retries: 1,
            ..Options::default()
        },
    );
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        for n in 0..6 {
            world.add("INBOX", message(n, "Hello", None, "hi"), &[]);
        }
        world.find("INBOX").poison.insert(4);
    }
    let report = fixture.pass().unwrap();
    let inbox = &report.mailboxes[0];
    assert_eq!((inbox.added, inbox.not_returned), (5, 1), "{inbox:?}");
    assert!(fixture.mailbox("INBOX").cursor.is_some());
}

#[test]
fn a_generation_that_changes_between_two_openings_begins_the_mailbox_again() {
    let fixture = Fixture::new(true, true);
    populate(&fixture.server);
    fixture.pass().unwrap();
    fixture.server.world().renumber_on_qresync = Some("INBOX".to_string());
    fixture.later(1);
    let report = fixture.pass().unwrap();
    let inbox = &report.mailboxes[0];
    assert!(inbox.listed_in_full && inbox.error.is_none(), "{inbox:?}");
    let row = fixture.mailbox("INBOX");
    assert_eq!(
        row.validity,
        fixture.server.world().find("INBOX").validity.to_string()
    );
    let shown = fixture
        .engine
        .with_store(|store| store.shown_ids(row.id, &row.validity))
        .unwrap();
    assert_eq!(shown.len(), 3);
}

#[test]
fn a_listing_without_the_inbox_retires_nothing() {
    let fixture = Fixture::new(true, true);
    populate(&fixture.server);
    fixture.pass().unwrap();
    fixture.server.world().remove_mailbox("INBOX");
    fixture.later(1);
    fixture.pass().unwrap();
    assert!(!fixture.mailbox("Archive").gone);
    assert!(!fixture.mailbox("INBOX").gone);
}

/// A fixture that fetches whole only messages of 2 000 bytes or less, so
/// that a message of a few kilobytes is fetched in parts (M20).
fn small_whole_limit() -> Fixture {
    Fixture::with(
        true,
        true,
        PASSWORD,
        Options {
            whole_limit: 2_000,
            ..Options::default()
        },
    )
}

#[test]
fn a_message_over_the_whole_limit_is_held_in_parts_and_its_file_waits() {
    let fixture = small_whole_limit();
    let large;
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        world.add("INBOX", message(1, "Small", None, "a short one"), &[]);
        large = world.add(
            "INBOX",
            large_message(2, "Plans", "the garden plan, enclosed", 6_000),
            &[],
        );
    }
    let report = fixture.pass().unwrap();
    let inbox = &report.mailboxes[0];
    assert_eq!(inbox.bodies, 2, "{inbox:?}");
    let log = fixture.server.take_log();
    assert_read_only(&log);
    // Its structure and its two text parts, and nothing else of it.
    let asked: Vec<String> = fetches(&log)
        .into_iter()
        .filter(|command| command.starts_with(&format!("UID FETCH {large} ")))
        .collect();
    assert_eq!(
        asked,
        [
            format!("UID FETCH {large} (UID BODYSTRUCTURE)"),
            format!("UID FETCH {large} (UID BODY.PEEK[1.1] BODY.PEEK[1.2])"),
        ]
    );
    let row = fixture.mailbox("INBOX");
    let status = fixture
        .engine
        .with_store(|store| store.mailbox_status(row.id))
        .unwrap();
    assert_eq!(status.bodies_wanted, 0, "{status:?}");
    assert_eq!(status.counts.bodies_held, 2);
    let found = fixture
        .engine
        .with_store(|store| store.search("garden", 10))
        .unwrap();
    assert_eq!(found.len(), 1);
    let message = found[0].message;
    let (listed, parts) = fixture
        .engine
        .with_store(|store| {
            Ok((
                store.message_listed(message)?.unwrap(),
                store.message_parts(message)?,
            ))
        })
        .unwrap();
    assert!(listed.held_in_parts && !listed.held_whole);
    assert_eq!(listed.attachments, 1);
    assert_eq!(listed.snippet, "the garden plan, enclosed");
    assert_eq!(listed.evidence.hidden_chars, "unseen".len() as u64);
    let file = parts.iter().find(|part| part.place == "2").unwrap();
    assert_eq!(file.name, "plan.pdf");
    // Its bytes are not read until someone opens it.
    assert_eq!(file.detected, "");
    assert!(file.size.abs_diff(6_000) < 100, "{file:?}");

    // A later pass asks for nothing more of it.
    fixture.later(HOUR);
    fixture.pass().unwrap();
    let log = fixture.server.take_log();
    assert!(
        !fetches(&log)
            .iter()
            .any(|command| command.contains("BODY.PEEK[1") || command.contains("BODYSTRUCTURE")),
        "{log:?}"
    );

    // A rebuild derives the same from the structure and the parts held.
    let before = fixture.snapshot();
    fixture
        .engine
        .with_store(|store| {
            store.rebuild(1, |_| {})?;
            Ok(())
        })
        .unwrap();
    assert_eq!(fixture.snapshot(), before);
    let again = fixture
        .engine
        .with_store(|store| {
            Ok((
                store.message_listed(message)?.unwrap(),
                store.message_parts(message)?,
            ))
        })
        .unwrap();
    assert_eq!(again, (listed, parts));
}

#[test]
fn a_damaged_text_part_is_fetched_again_and_derived_again() {
    let fixture = small_whole_limit();
    let text = b"the garden plan, enclosed".to_vec();
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        world.add(
            "INBOX",
            large_message(2, "Plans", "the garden plan, enclosed", 6_000),
            &[],
        );
    }
    fixture.pass().unwrap();
    let expected = fixture.snapshot();
    // Both text parts' files, as the server returned them, are damaged.
    for place in ["1.1", "1.2"] {
        let held = support::imap::part_bytes(
            &large_message(2, "Plans", "the garden plan, enclosed", 6_000),
            place,
        )
        .unwrap();
        assert!(held.windows(text.len()).any(|window| window == text));
        let hex = BlobId::of(&held).to_hex();
        let file = fixture
            .directory
            .path()
            .join("data")
            .join("blobs")
            .join(&hex[..2])
            .join(&hex);
        std::fs::write(&file, b"not what was stored").unwrap();
    }
    fixture
        .engine
        .with_store(|store| {
            store.rebuild(1, |_| {})?;
            Ok(())
        })
        .unwrap();
    let found = |fixture: &Fixture| {
        fixture
            .engine
            .with_store(|store| store.search("garden", 10))
            .unwrap()
            .len()
    };
    // The message is read as though its text were not held: its headers
    // and its file are still there.
    assert_eq!(found(&fixture), 0);
    assert_eq!(
        fixture
            .engine
            .with_store(|store| store.search("plans", 10))
            .unwrap()
            .len(),
        1
    );
    fixture.server.take_log();

    fixture.later(1);
    let report = fixture.pass().unwrap();
    assert_eq!(report.mailboxes[0].repaired, 2, "{report:?}");
    let log = fixture.server.take_log();
    assert_read_only(&log);
    for place in ["1.1", "1.2"] {
        assert!(
            fetches(&log)
                .iter()
                .any(|command| command.ends_with(&format!("(UID BODY.PEEK[{place}])")))
        );
    }
    assert_eq!(fixture.snapshot(), expected);
    assert_eq!(found(&fixture), 1);
}

#[test]
fn a_large_message_whose_parts_are_not_returned_counts_a_try() {
    let fixture = small_whole_limit();
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        let uid = world.add("INBOX", large_message(2, "Plans", "words", 6_000), &[]);
        world.find("INBOX").never_return_body.insert(uid);
    }
    let report = fixture.pass().unwrap();
    assert_eq!(report.mailboxes[0].bodies, 0);
    let row = fixture.mailbox("INBOX");
    let status = fixture
        .engine
        .with_store(|store| store.mailbox_status(row.id))
        .unwrap();
    assert_eq!((status.bodies_wanted, status.counts.bodies_held), (1, 0));
    // Within the hour it is not asked for again.
    fixture.server.take_log();
    fixture.later(1);
    fixture.pass().unwrap();
    assert!(
        !fetches(&fixture.server.take_log())
            .iter()
            .any(|command| command.contains("BODYSTRUCTURE"))
    );
}

#[test]
fn a_structure_nested_past_what_the_parser_can_read_is_passed_over() {
    // Read whole, its reply would exhaust the parser's stack and abort the
    // process: the reader refuses it as it arrives, and the message is held
    // as one whose parts nest deeper than the engine reads, never asked for
    // again.
    let fixture = small_whole_limit();
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        let uid = world.add("INBOX", large_message(2, "Deep", "words", 6_000), &[]);
        world.find("INBOX").nested.insert(uid);
        world.add("INBOX", message(3, "Fine", None, "a fine one"), &[]);
        world.add("INBOX", large_message(4, "Plans", "the garden", 6_000), &[]);
    }
    let report = fixture.pass().unwrap();
    let inbox = &report.mailboxes[0];
    assert_eq!(inbox.bodies, 3, "{inbox:?}");
    let row = fixture.mailbox("INBOX");
    let status = fixture
        .engine
        .with_store(|store| store.mailbox_status(row.id))
        .unwrap();
    assert_eq!((status.bodies_wanted, status.counts.bodies_held), (0, 3));
    let log = fixture.server.take_log();
    assert_read_only(&log);
    // Each large message's structure asked for once: the refused one is not
    // asked again on a new connection.
    assert_eq!(
        log.iter()
            .filter(|command| command.contains("BODYSTRUCTURE"))
            .count(),
        2
    );
    let found = fixture
        .engine
        .with_store(|store| store.search("deep", 10))
        .unwrap();
    let listed = fixture
        .engine
        .with_store(|store| store.message_listed(found[0].message))
        .unwrap()
        .unwrap();
    assert!(listed.held_in_parts);
    assert_eq!(
        listed.unparsed.as_deref(),
        Some("the message's parts nest deeper than the engine reads")
    );
    fixture.later(HOUR);
    fixture.pass().unwrap();
    assert!(
        !fixture
            .server
            .take_log()
            .iter()
            .any(|command| command.contains("BODYSTRUCTURE"))
    );
}

#[test]
fn a_message_held_in_parts_lists_its_parts_as_a_whole_one_does_and_opens_each_file() {
    let fixture = small_whole_limit();
    let bytes = forwarding_message(5, 6_000);
    {
        let mut world = fixture.server.world();
        world.mailbox("INBOX", &[]);
        world.add("INBOX", bytes.clone(), &[]);
    }
    fixture.pass().unwrap();
    let message = fixture
        .engine
        .with_store(|store| store.search("seed", 10))
        .unwrap()[0]
        .message;
    let whole = loam_mail::derive::body_fields(&bytes);
    let parts = |fixture: &Fixture| {
        fixture
            .engine
            .with_store(|store| store.message_parts(message))
            .unwrap()
    };
    // Its parts, their places, types and names are a whole message's.
    let listed = parts(&fixture);
    let seen: Vec<(String, String, String)> = listed
        .iter()
        .map(|part| {
            (
                part.place.clone(),
                part.content_type.clone(),
                part.name.clone(),
            )
        })
        .collect();
    let expected: Vec<(String, String, String)> = whole
        .parts
        .iter()
        .map(|part| {
            (
                part.place.clone(),
                part.content_type.clone(),
                part.name.clone(),
            )
        })
        .collect();
    assert_eq!(seen, expected);
    assert_eq!(listed[1].name, "été.pdf");
    assert_eq!(listed[4].name, "été list.pdf");
    // The forwarded message's own text is its own, not this message's.
    assert_eq!(
        fixture
            .engine
            .with_store(|store| store.search("tomatoes", 10))
            .unwrap()
            .len(),
        0
    );

    // Each file opened is fetched alone, then read as the whole message's.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    fixture.server.take_log();
    for place in ["2", "3.2"] {
        let fetched = runtime
            .block_on(loam_mail::fetch::fetch_part(
                &fixture.engine,
                message,
                place,
                7,
            ))
            .unwrap();
        assert!(fetched, "{place}");
        let content = fixture
            .engine
            .with_store(|store| store.part_content(message, place))
            .unwrap();
        assert_eq!(
            content,
            loam_mail::derive::part_content(&bytes, place),
            "{place}"
        );
    }
    let log = fixture.server.take_log();
    assert_read_only(&log);
    assert!(
        log.iter()
            .any(|command| command.ends_with("(UID BODY.PEEK[2])"))
    );
    assert!(
        log.iter()
            .any(|command| command.ends_with("(UID BODY.PEEK[3.2])"))
    );
    let opened = parts(&fixture);
    for place in ["2", "3.2"] {
        let row = opened.iter().find(|part| part.place == place).unwrap();
        let found = whole.parts.iter().find(|part| part.place == place).unwrap();
        assert_eq!(
            (&row.detected, row.type_differs, row.size),
            (&found.detected, found.type_differs, found.size),
            "{place}"
        );
    }
    // Opened again, nothing is fetched.
    assert!(
        !runtime
            .block_on(loam_mail::fetch::fetch_part(
                &fixture.engine,
                message,
                "2",
                8
            ))
            .unwrap()
    );

    // A rebuild after files were opened derives the same.
    let before = fixture.snapshot();
    fixture
        .engine
        .with_store(|store| {
            store.rebuild(9, |_| {})?;
            Ok(())
        })
        .unwrap();
    assert_eq!(fixture.snapshot(), before);
    assert_eq!(parts(&fixture), opened);
}
