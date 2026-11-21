//! The four change commands against a real iCloud account (the
//! specification's step D2), and their undo. Ignored: it runs only when
//! asked, with the sign-in in two files whose paths it is given, so that the
//! sign-in never appears in a command line, an environment variable or its
//! output.
//!
//! It changes mail, but only in the account's largest mailbox, which the
//! owner keeps for tests (a mailbox of notifications, of at least 100 000
//! messages, or the one `LOAM_MAIL_LIVE_MAILBOX` names by the engine's id),
//! and puts each change back. Mail the archive step moves is mail that test
//! mailbox alone shows, so no other mailbox's copy moves with it: marks and their undo, an agent's copy into junk within the policy
//! and its undo, a move into the inbox and an archive from there, the
//! archive undone and the mail moved back, and an agent's proposal to trash a chunk of the mailbox, which
//! changes nothing until the person's approval, then runs, and whose undo is
//! cancelled part-way and resumed. Never the whole mailbox: the owner keeps
//! it whole as the large-mailbox test. It syncs the account's headers into
//! the directory it is given first, fetching no bodies.
//!
//! It prints and writes counts, ids the engine made and times only: no
//! address, subject, mailbox name or text.
//!
//! ```text
//! LOAM_MAIL_LIVE_ADDRESS_FILE=... LOAM_MAIL_LIVE_PASSWORD_FILE=... \
//! LOAM_MAIL_LIVE_DIR=/Volumes/<encrypted image>/d2 LOAM_MAIL_LIVE_OUT=results.json \
//!   cargo test --release --test live_large_changes -- --ignored --nocapture
//! ```
//!
//! A run that fails part-way names the operation that stopped. Run it again
//! with `LOAM_MAIL_LIVE_RECOVER=1` and the same directory: after a pass of
//! sync it carries on every stopped operation, dismisses any proposal, and
//! undoes, newest first, every change not yet undone, except the moves into
//! and out of the inbox: undoing the archive gives its mail new ids in the
//! inbox, where the undo of the move into it would find it missing, so the
//! archive's mail, which the run notes in the directory as `live-plan.json`
//! (engine ids only), is moved back to the test mailbox instead. Mail an
//! undo found missing on its way back to the test mailbox, and that is not
//! there now, is moved back too.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use afd::{Actor, ActorKind, CommandContext, CommandInterface, CommandRegistry, SystemClock};
use async_trait::async_trait;
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::parts::Structure;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, Imap};
use loam_mail::provider::{
    Connector, Copied, Fetched, FlagsSeen, Listing, NextId, Opened, OpenedToChange, PartFetched,
    Provider, ProviderError, RemoteMailbox, Since,
};
use loam_mail::store::{AccountRow, HeaderSeen};
use loam_mail::sync::{Options, sync_account};
use serde_json::{Value, json};

/// Calls to the provider and the time they took, by method.
type Timings = Arc<std::sync::Mutex<std::collections::BTreeMap<&'static str, (u64, f64)>>>;

/// Requests that change mail, counted.
const CHANGING: &[&str] = &["copy", "moveTo", "setFlags", "remove"];

/// A provider that times each call and fetches no bodies: this run needs
/// headers alone.
struct Counted {
    inner: Box<dyn Provider>,
    timings: Timings,
}

/// Times `call` under `method` in `timings`.
async fn timed<T>(
    timings: &Timings,
    method: &'static str,
    call: impl std::future::Future<Output = T>,
) -> T {
    let started = Instant::now();
    let result = call.await;
    let mut timings = timings.lock().unwrap();
    let entry = timings.entry(method).or_insert((0, 0.0));
    entry.0 += 1;
    entry.1 += started.elapsed().as_secs_f64() * 1000.0;
    result
}

#[async_trait]
impl Provider for Counted {
    async fn mailboxes(&mut self) -> Result<Vec<RemoteMailbox>, ProviderError> {
        timed(&self.timings, "mailboxes", self.inner.mailboxes()).await
    }
    async fn open(&mut self, mailbox: &str) -> Result<Opened, ProviderError> {
        timed(&self.timings, "open", self.inner.open(mailbox)).await
    }
    async fn list(&mut self) -> Result<Listing, ProviderError> {
        timed(&self.timings, "list", self.inner.list()).await
    }
    async fn returned(&mut self) -> Result<Vec<String>, ProviderError> {
        timed(&self.timings, "returned", self.inner.returned()).await
    }
    async fn changes(&mut self, cursor: &str) -> Result<Since, ProviderError> {
        timed(&self.timings, "changes", self.inner.changes(cursor)).await
    }
    async fn open_since(
        &mut self,
        mailbox: &str,
        validity: &str,
        cursor: &str,
    ) -> Result<(Opened, Option<Since>), ProviderError> {
        timed(
            &self.timings,
            "openSince",
            self.inner.open_since(mailbox, validity, cursor),
        )
        .await
    }
    async fn flags(&mut self) -> Result<Vec<FlagsSeen>, ProviderError> {
        timed(&self.timings, "flags", self.inner.flags()).await
    }
    async fn headers(&mut self, ids: &[String]) -> Result<Vec<HeaderSeen>, ProviderError> {
        timed(&self.timings, "headers", self.inner.headers(ids)).await
    }
    async fn messages(&mut self, _ids: &[String]) -> Result<Vec<Fetched>, ProviderError> {
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
        timed(
            &self.timings,
            "openToChange",
            self.inner.open_to_change(mailbox),
        )
        .await
    }
    async fn next_id(&mut self, mailbox: &str) -> Result<NextId, ProviderError> {
        timed(&self.timings, "nextId", self.inner.next_id(mailbox)).await
    }
    async fn present(&mut self, ids: &[String]) -> Result<Vec<String>, ProviderError> {
        timed(&self.timings, "present", self.inner.present(ids)).await
    }
    async fn ids_from(&mut self, from: &str) -> Result<Vec<String>, ProviderError> {
        timed(&self.timings, "idsFrom", self.inner.ids_from(from)).await
    }
    async fn flags_of(&mut self, ids: &[String]) -> Result<Vec<FlagsSeen>, ProviderError> {
        timed(&self.timings, "flagsOf", self.inner.flags_of(ids)).await
    }
    async fn copy(&mut self, ids: &[String], to: &str) -> Result<Copied, ProviderError> {
        timed(&self.timings, "copy", self.inner.copy(ids, to)).await
    }
    fn moves(&self) -> bool {
        self.inner.moves()
    }
    async fn move_to(&mut self, ids: &[String], to: &str) -> Result<Copied, ProviderError> {
        timed(&self.timings, "moveTo", self.inner.move_to(ids, to)).await
    }
    async fn set_flags(
        &mut self,
        ids: &[String],
        flags: &[&str],
        on: bool,
    ) -> Result<(), ProviderError> {
        timed(
            &self.timings,
            "setFlags",
            self.inner.set_flags(ids, flags, on),
        )
        .await
    }
    async fn remove(&mut self, ids: &[String]) -> Result<(), ProviderError> {
        timed(&self.timings, "remove", self.inner.remove(ids)).await
    }
    async fn close(&mut self) {
        self.inner.close().await;
    }
}

struct Live {
    credentials: Credentials,
    timings: Timings,
    connections: Arc<AtomicUsize>,
}

#[async_trait]
impl Connector for Live {
    async fn connect(&self, _account: &AccountRow) -> Result<Box<dyn Provider>, ProviderError> {
        let imap = timed(
            &self.timings,
            "connect",
            Imap::connect(&Endpoint::icloud(), &self.credentials, ICLOUD_NAMES),
        )
        .await?;
        self.connections.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(Counted {
            inner: Box::new(imap),
            timings: Arc::clone(&self.timings),
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

fn number(variable: &str, default: usize) -> usize {
    std::env::var(variable)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn person() -> CommandContext {
    CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human)
}

fn agent() -> CommandContext {
    CommandContext::new()
        .with_interface(CommandInterface::Mcp)
        .with_actor(Actor::new(ActorKind::Agent).with_id("tok_live"))
}

async fn call(
    registry: &CommandRegistry,
    context: CommandContext,
    name: &str,
    input: Value,
) -> Value {
    let result = registry.execute(name, input, Some(context)).await;
    serde_json::to_value(&result).unwrap()
}

/// The data of a result that must have succeeded. A failure is reported by
/// its code and the engine's words, which hold no text from mail.
fn data(result: &Value, what: &str) -> Value {
    assert!(
        result["success"] == true,
        "{what} failed: {} ({}); operation {}",
        result["error"]["code"],
        result["error"]["message"],
        result["error"]["details"]["operation"],
    );
    result["data"].clone()
}

/// An operation's counts, and the time it took.
fn step(name: &str, operation: &Value, seconds: f64) -> Value {
    let changed = operation["changed"].as_u64().unwrap_or(0);
    json!({
        "step": name,
        "command": operation["command"],
        "operation": operation["operation"],
        "state": operation["state"],
        "messages": operation["messages"],
        "places": operation["places"],
        "changed": changed,
        "unchanged": operation["unchanged"],
        "missing": operation["missing"],
        "ignored": operation["ignored"],
        "seconds": (seconds * 10.0).round() / 10.0,
        "msPerChanged": if changed > 0 {
            json!((seconds * 1000.0 / changed as f64).round())
        } else {
            Value::Null
        },
    })
}

/// The store's own database, read beside the engine.
fn database(directory: &str) -> rusqlite::Connection {
    rusqlite::Connection::open_with_flags(
        std::path::Path::new(directory).join("mail.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap()
}

/// The flags of each message the mailbox `mailbox` shows, by message.
fn flags_shown(directory: &str, mailbox: i64) -> std::collections::HashMap<i64, String> {
    let connection = database(directory);
    let mut statement = connection
        .prepare(
            "SELECT message_id, flags FROM observation
             WHERE mailbox_id = ?1 AND ended_at IS NULL",
        )
        .unwrap();
    statement
        .query_map([mailbox], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// The dates the mailbox's messages are listed under, oldest first, with
/// each message's id.
fn dated(directory: &str, mailbox: i64) -> Vec<(i64, i64)> {
    let connection = database(directory);
    let mut statement = connection
        .prepare(
            "SELECT envelope.date, observation.message_id FROM observation
             JOIN envelope ON envelope.message_id = observation.message_id
             WHERE observation.mailbox_id = ?1 AND observation.ended_at IS NULL
             ORDER BY envelope.date, observation.message_id",
        )
        .unwrap();
    statement
        .query_map([mailbox], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// Where each of `ids` is shown now: how many places in the test mailbox
/// `test`, and every place elsewhere, by mailbox.
fn where_shown(
    directory: &str,
    test: i64,
    ids: &[i64],
) -> std::collections::BTreeMap<(i64, i64), i64> {
    let connection = database(directory);
    let mut statement = connection
        .prepare(
            "SELECT mailbox_id, count(*) FROM observation
             WHERE message_id = ?1 AND ended_at IS NULL GROUP BY mailbox_id",
        )
        .unwrap();
    let mut found = std::collections::BTreeMap::new();
    for id in ids {
        let rows = statement
            .query_map([id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap();
        for row in rows {
            let (mailbox, places) = row.unwrap();
            // The test mailbox's places are keyed as 0, the others by id.
            found.insert((*id, if mailbox == test { 0 } else { mailbox }), places);
        }
    }
    found
}

/// Of `ids`, those shown in the test mailbox `test` once and nowhere else.
fn only_in(directory: &str, test: i64, ids: &[i64]) -> Vec<i64> {
    let shown = where_shown(directory, test, ids);
    ids.iter()
        .copied()
        .filter(|id| {
            shown.get(&(*id, 0)) == Some(&1)
                && !shown.keys().any(|(other, at)| other == id && *at != 0)
        })
        .collect()
}

/// An undo that put back every place `original` changed, and lost none.
fn assert_undone(original: &Value, undo: &Value, what: &str) {
    assert_eq!(undo["state"], "done", "{what}: the undo ran to its end");
    assert_eq!(
        undo["changed"], original["changed"],
        "{what}: the undo put back every place the change made"
    );
    assert_eq!(undo["missing"], 0, "{what}: no place was missing");
    assert_eq!(undo["ignored"], 0, "{what}: the provider acted on each");
}

/// The messages an undo, on its way back to the test mailbox, found
/// missing, and that the test mailbox does not show now but another
/// mailbox does: mail shown nowhere left the account, and is counted by
/// [`lost`].
fn left_behind(directory: &str, plan: &Value) -> Vec<i64> {
    let Some(test) = plan["test"].as_i64() else {
        return Vec::new();
    };
    let connection = database(directory);
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT item.message_id FROM operation_item item
             JOIN operation ON operation.id = item.operation_id
             WHERE operation.undo_of IS NOT NULL AND item.step = 'missing'
               AND item.to_mailbox_id = ?1 AND item.message_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM observation
                   JOIN mailbox ON mailbox.id = observation.mailbox_id
                   WHERE observation.message_id = item.message_id
                     AND observation.mailbox_id = ?1
                     AND observation.ended_at IS NULL
                     AND observation.validity = mailbox.validity
                     AND mailbox.gone_at IS NULL)
               AND EXISTS (SELECT 1 FROM observation
                   JOIN mailbox ON mailbox.id = observation.mailbox_id
                   WHERE observation.message_id = item.message_id
                     AND observation.ended_at IS NULL
                     AND observation.validity = mailbox.validity
                     AND mailbox.gone_at IS NULL)
             ORDER BY 1",
        )
        .unwrap();
    statement
        .query_map([test], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// How many messages an undo found missing on its way back to the test
/// mailbox that no mailbox shows now: gone from the account, as mail the
/// provider let go from its trash.
fn lost(directory: &str, plan: &Value) -> i64 {
    let Some(test) = plan["test"].as_i64() else {
        return 0;
    };
    database(directory)
        .query_row(
            "SELECT count(DISTINCT item.message_id) FROM operation_item item
             JOIN operation ON operation.id = item.operation_id
             WHERE operation.undo_of IS NOT NULL AND item.step = 'missing'
               AND item.to_mailbox_id = ?1 AND item.message_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM observation
                   JOIN mailbox ON mailbox.id = observation.mailbox_id
                   WHERE observation.message_id = item.message_id
                     AND observation.ended_at IS NULL
                     AND observation.validity = mailbox.validity
                     AND mailbox.gone_at IS NULL)",
            [test],
            |row| row.get(0),
        )
        .unwrap()
}

/// Each mailbox that holds mail [`left_behind`], with the dates that mail
/// spans (a selection's `after` and `before`) and how much of it there is.
fn left_windows(directory: &str, plan: &Value) -> Vec<(i64, i64, i64, i64)> {
    let left = left_behind(directory, plan);
    if left.is_empty() {
        return Vec::new();
    }
    let connection = database(directory);
    let ids = left
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let mut statement = connection
        .prepare(&format!(
            "SELECT observation.mailbox_id, min(envelope.date), max(envelope.date) + 1,
                    count(DISTINCT observation.message_id)
             FROM observation JOIN envelope ON envelope.message_id = observation.message_id
             JOIN mailbox ON mailbox.id = observation.mailbox_id
             WHERE observation.ended_at IS NULL AND observation.message_id IN ({ids})
               AND observation.validity = mailbox.validity AND mailbox.gone_at IS NULL
             GROUP BY 1 ORDER BY 1"
        ))
        .unwrap();
    statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// Where the run notes what a recovery needs: engine ids only.
fn plan_path(directory: &str) -> std::path::PathBuf {
    std::path::Path::new(directory).join("live-plan.json")
}

fn note(directory: &str, plan: &Value) {
    std::fs::write(plan_path(directory), plan.to_string()).unwrap();
}

/// The mailboxes the run uses, by role, from `mail-status`: the largest
/// mailbox with no special use is the one the owner keeps for tests.
struct Places {
    test: i64,
    inbox: i64,
    junk: i64,
}

fn places_of(status: &Value, named: Option<i64>) -> (Places, Value) {
    let mailboxes = status["accounts"][0]["mailboxes"].as_array().unwrap();
    let of_role = |role: &str| {
        mailboxes
            .iter()
            .find(|mailbox| mailbox["role"] == role)
            .unwrap_or_else(|| panic!("the account has no {role} mailbox"))["mailbox"]
            .as_i64()
            .unwrap()
    };
    let test = match named {
        Some(id) => mailboxes
            .iter()
            .find(|mailbox| mailbox["mailbox"] == id)
            .expect("the mailbox named is the account's"),
        None => mailboxes
            .iter()
            .filter(|mailbox| mailbox["role"] == "none")
            .max_by_key(|mailbox| mailbox["headers"].as_u64().unwrap_or(0))
            .expect("a mailbox with no special use"),
    };
    assert_eq!(test["role"], "none", "the test mailbox has no special use");
    let counts: Value = mailboxes
        .iter()
        .filter(|mailbox| mailbox["role"] != "none" || mailbox["mailbox"] == test["mailbox"])
        .map(|mailbox| {
            let role = if mailbox["mailbox"] == test["mailbox"] {
                "test".to_string()
            } else {
                mailbox["role"].as_str().unwrap().to_string()
            };
            (
                role,
                json!({
                    "mailbox": mailbox["mailbox"],
                    "headers": mailbox["headers"],
                    "unreturned": mailbox["unreturned"],
                }),
            )
        })
        .collect::<serde_json::Map<_, _>>()
        .into();
    (
        Places {
            test: test["mailbox"].as_i64().unwrap(),
            inbox: of_role("inbox"),
            junk: of_role("junk"),
        },
        counts,
    )
}

/// Makes a selection of the test mailbox's mail listed from `from` up to
/// `to` in `dates`, as the person; its id and count.
async fn select(
    registry: &CommandRegistry,
    mailbox: i64,
    dates: &[(i64, i64)],
    from: usize,
    to: usize,
) -> (Value, Value) {
    let mut query = json!({ "mailbox": mailbox, "before": dates[to].0 });
    if from > 0 {
        query["after"] = json!(dates[from].0);
    }
    let made = data(
        &call(registry, person(), "mail-selection-create", query).await,
        "a selection",
    );
    (made["selection"].clone(), made["count"].clone())
}

/// Carries on operation `id` until it is done.
async fn finish(registry: &CommandRegistry, id: &Value) -> Value {
    for _ in 0..20 {
        let shown = data(
            &call(
                registry,
                person(),
                "mail-operation-show",
                json!({ "operation": id, "limit": 1 }),
            )
            .await,
            "show",
        );
        if shown["state"] == "done" {
            return shown;
        }
        let _ = call(
            registry,
            person(),
            "mail-operation-resume",
            json!({ "operation": id }),
        )
        .await;
    }
    panic!("operation {id} did not finish");
}

/// Puts back what an earlier run left: every stopped operation carried on,
/// every proposal dismissed, every change not undone undone, newest first,
/// but for the moves into and out of the inbox, whose mail is moved back to
/// the test mailbox instead, as is mail an undo left behind.
async fn recover(registry: &CommandRegistry, directory: &str, plan: &Value) -> Value {
    let list = || async {
        data(
            &call(
                registry,
                person(),
                "mail-operation-list",
                json!({ "limit": 100 }),
            )
            .await,
            "the list",
        )["operations"]
            .as_array()
            .unwrap()
            .clone()
    };
    let mut done = Vec::new();
    for operation in list().await {
        let id = &operation["operation"];
        match operation["state"].as_str() {
            Some("proposed") => {
                data(
                    &call(
                        registry,
                        person(),
                        "mail-operation-dismiss",
                        json!({ "operation": id }),
                    )
                    .await,
                    "a dismissal",
                );
                done.push(json!({ "dismissed": id }));
            }
            Some("stopped" | "running") => {
                finish(registry, id).await;
                done.push(json!({ "finished": id }));
            }
            _ => {}
        }
    }
    let skipped = [&plan["moveIn"], &plan["moveBack"]];
    let operations = list().await;
    for operation in &operations {
        let id = &operation["operation"];
        let wanted = operation["undoOf"].is_null()
            && operation["undoneBy"].is_null()
            && operation["state"] == "done"
            && operation["changed"].as_u64().unwrap_or(0) > 0
            && !skipped.contains(&id)
            // A move back to the test mailbox is the run's own putting back,
            // made again below; undone, it would send the mail away again.
            && !(operation["command"] == "mail-label"
                && operation["asked"]["mailbox"] == plan["test"]);
        let undone_already = operations.iter().any(|other| other["undoOf"] == *id);
        if wanted && !undone_already {
            let made = call(
                registry,
                person(),
                "mail-operation-undo",
                json!({ "operation": id }),
            )
            .await;
            let made = data(&made, "an undo");
            finish(registry, &made["operation"]).await;
            done.push(json!({ "undid": id }));
        }
    }
    // Mail an undo found missing on its way back to the test mailbox that
    // another mailbox still shows (mail the provider let go from its trash
    // shows nowhere, and is counted as lost). Only a
    // selection reaches mail in the trash, so each mailbox it is in now is
    // selected by the dates it spans, and moved back only when that holds
    // it alone.
    for (mailbox, after, before, held) in left_windows(directory, plan) {
        let made = data(
            &call(
                registry,
                person(),
                "mail-selection-create",
                json!({ "mailbox": mailbox, "after": after, "before": before }),
            )
            .await,
            "a selection of what an undo left",
        );
        assert_eq!(
            made["count"], held,
            "the dates of what an undo left in mailbox {mailbox} hold other mail: nothing was moved"
        );
        let back = call(
            registry,
            person(),
            "mail-label",
            json!({ "selection": made["selection"], "expectedCount": made["count"], "mailbox": plan["test"] }),
        )
        .await;
        let back = data(&back, "a move back of what an undo left");
        done.push(json!({ "leftBehind": held, "movedBack": back["changed"] }));
    }
    if let Some(ids) = plan["archive"].as_array().filter(|ids| !ids.is_empty()) {
        let back = call(
            registry,
            person(),
            "mail-label",
            json!({ "messages": ids, "mailbox": plan["test"] }),
        )
        .await;
        let back = data(&back, "the move back");
        done.push(json!({ "movedBack": back["changed"], "alreadyThere": back["unchanged"] }));
    }
    json!(done)
}

#[test]
#[ignore = "changes mail at a real iCloud account; run with the sign-in files named"]
fn the_change_commands_against_icloud() {
    let credentials = Credentials {
        user: read_secret("LOAM_MAIL_LIVE_ADDRESS_FILE"),
        password: read_secret("LOAM_MAIL_LIVE_PASSWORD_FILE"),
    };
    let directory = std::env::var("LOAM_MAIL_LIVE_DIR").expect("LOAM_MAIL_LIVE_DIR is set");
    let recovering = std::env::var("LOAM_MAIL_LIVE_RECOVER").is_ok_and(|value| value == "1");
    let trash_chunk = number("LOAM_MAIL_LIVE_TRASH", 10_000);
    let mark_chunk = number("LOAM_MAIL_LIVE_MARK", 1_000);
    let copy_chunk = number("LOAM_MAIL_LIVE_COPY", 50);
    let archive_chunk = number("LOAM_MAIL_LIVE_ARCHIVE", 10).min(40);
    let named_mailbox = std::env::var("LOAM_MAIL_LIVE_MAILBOX")
        .ok()
        .and_then(|value| value.parse::<i64>().ok());
    let smallest = number("LOAM_MAIL_LIVE_SMALLEST", 100_000);
    let timings: Timings = Arc::default();
    let connector = Arc::new(Live {
        credentials,
        timings: Arc::clone(&timings),
        connections: Arc::new(AtomicUsize::new(0)),
    });
    let home = Home::at(&directory);
    let engine = Arc::new(
        Engine::new(Some(home.clone()))
            .with_connector(Arc::clone(&connector) as Arc<dyn Connector>),
    );
    let account = engine
        .with_store(|store| {
            if store.accounts()?.is_empty() {
                // The connector holds the sign-in; the row names the provider.
                store.add_account("icloud", "live", 0)?;
            }
            Ok(store.accounts()?.remove(0))
        })
        .unwrap();
    let registry = loam_mail::registry(&engine).unwrap();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let options = Options::default();
    let sync = || {
        let started = Instant::now();
        let at = std::sync::Mutex::new(Instant::now());
        runtime
            .block_on(sync_account(
                &engine,
                connector.as_ref(),
                &account,
                &options,
                &SystemClock,
                &|line| {
                    let mut at = at.lock().unwrap();
                    if at.elapsed().as_secs() >= 30 {
                        *at = Instant::now();
                        eprintln!("{line}");
                    }
                },
            ))
            .expect("a pass of sync completes");
        started.elapsed().as_secs_f64()
    };

    if recovering {
        // The account as it is now, before anything is put back.
        sync();
        let plan = std::fs::read_to_string(plan_path(&directory))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or(Value::Null);
        let recovered = runtime.block_on(recover(&registry, &directory, &plan));
        eprintln!("recovered: {recovered}");
        sync();
        assert!(
            left_behind(&directory, &plan).is_empty(),
            "the mail an undo left behind is back in the test mailbox"
        );
        eprintln!("gone from the account: {}", lost(&directory, &plan));
        if let (Some(test), Some(ids)) = (plan["test"].as_i64(), plan["archive"].as_array()) {
            let ids: Vec<i64> = ids.iter().filter_map(Value::as_i64).collect();
            assert_eq!(
                only_in(&directory, test, &ids).len(),
                ids.len(),
                "the archive's mail is back in the test mailbox alone"
            );
        }
        return;
    }
    let held = runtime.block_on(call(&registry, person(), "mail-operation-list", json!({})));
    assert_eq!(
        data(&held, "the list")["operations"],
        json!([]),
        "this directory holds operations from a run before: recover it first"
    );

    let first_seconds = sync();
    eprintln!("first pass: {first_seconds:.0} s");
    // The classes and stories a selection waits for.
    let mut tries = 0;
    let status: Value = loop {
        let status = data(
            &runtime.block_on(call(&registry, person(), "mail-status", json!({}))),
            "the status",
        );
        if status["screening"]["ready"] == true || tries >= 5 {
            break status;
        }
        tries += 1;
        sync();
    };
    assert_eq!(
        status["screening"]["ready"], true,
        "screening is not ready: nothing was changed"
    );
    let (places, before) = places_of(&status, named_mailbox);
    let dates = dated(&directory, places.test);
    let total = dates.len();
    let flags_before = flags_shown(&directory, places.test);
    assert!(
        named_mailbox.is_some() || total >= smallest,
        "the largest mailbox holds {total} messages, fewer than the {smallest} of the test mailbox: nothing was changed"
    );
    assert!(
        trash_chunk <= total / 2,
        "a trash of {trash_chunk} is more than half the test mailbox's {total}: nothing was changed"
    );
    assert!(
        total > trash_chunk + mark_chunk + copy_chunk + archive_chunk * 5 + 10,
        "the test mailbox is smaller than the run: {total}"
    );
    eprintln!("before: {before}, test mailbox {total} messages with dates");
    let mut steps = Vec::new();
    // Chunks of the mailbox, oldest first, one after the other; never the
    // whole of it.
    let mut start = 0;
    let mut chunk = |size: usize| {
        let range = (start, start + size);
        start += size;
        range
    };
    let trash_range = chunk(trash_chunk);
    let mark_range = chunk(mark_chunk);
    let copy_range = chunk(copy_chunk);
    // Mail the test mailbox alone shows, so that moving it by its ids moves
    // no other mailbox's copy.
    let archive_window = chunk(archive_chunk * 5);
    let window: Vec<i64> = dates[archive_window.0..archive_window.1]
        .iter()
        .map(|(_, message)| *message)
        .collect();
    let ids: Vec<i64> = only_in(&directory, places.test, &window)
        .into_iter()
        .take(archive_chunk)
        .collect();
    assert_eq!(
        ids.len(),
        archive_chunk,
        "too few messages shown in the test mailbox alone: nothing was changed"
    );
    let mut plan = json!({ "test": places.test, "archive": ids });
    note(&directory, &plan);
    // Every message a step changes, and where each is shown before.
    let touched: Vec<i64> = dates[trash_range.0..copy_range.1]
        .iter()
        .map(|(_, message)| *message)
        .chain(ids.iter().copied())
        .collect();
    let shown_before = where_shown(&directory, places.test, &touched);

    runtime.block_on(async {
        // 1. The person marks mail flagged, then unread, and undoes each.
        for (name, input) in [
            ("flag", json!({ "flagged": true })),
            ("mark unread", json!({ "read": false })),
        ] {
            let (selection, count) =
                select(&registry, places.test, &dates, mark_range.0, mark_range.1).await;
            let mut input = input;
            input["selection"] = selection;
            input["expectedCount"] = count;
            let started = Instant::now();
            let made = data(&call(&registry, person(), "mail-mark", input).await, name);
            steps.push(step(name, &made, started.elapsed().as_secs_f64()));
            let started = Instant::now();
            let undone = call(
                &registry,
                person(),
                "mail-operation-undo",
                json!({ "operation": made["operation"] }),
            )
            .await;
            let undone = data(&undone, "an undo");
            assert_undone(&made, &undone, name);
            steps.push(step(
                &format!("undo {name}"),
                &undone,
                started.elapsed().as_secs_f64(),
            ));
            eprintln!("{name}: done and undone");
        }

        // 2. An agent copies mail into junk within the policy, and undoes
        // it: the copies go, the originals stay.
        let (selection, count) =
            select(&registry, places.test, &dates, copy_range.0, copy_range.1).await;
        let started = Instant::now();
        let copied = call(
            &registry,
            agent(),
            "mail-label",
            json!({ "selection": selection, "expectedCount": count, "mailbox": places.junk, "copy": true }),
        )
        .await;
        let copied = data(&copied, "the agent's copy");
        assert_eq!(copied["state"], "done", "within the policy, it runs");
        steps.push(step("agent copies to junk", &copied, started.elapsed().as_secs_f64()));
        let started = Instant::now();
        let undone = call(
            &registry,
            agent(),
            "mail-operation-undo",
            json!({ "operation": copied["operation"] }),
        )
        .await;
        let undone = data(&undone, "the agent's undo");
        assert_undone(&copied, &undone, "the agent's copy");
        steps.push(step("agent undoes the copy", &undone, started.elapsed().as_secs_f64()));
        eprintln!("copy: done and undone");

        // 3. The person moves mail into the inbox and archives it from
        // there; the archive is undone, and the mail moved back.
        let started = Instant::now();
        let moved = call(
            &registry,
            person(),
            "mail-label",
            json!({ "messages": ids, "mailbox": places.inbox }),
        )
        .await;
        let moved = data(&moved, "the move into the inbox");
        plan["moveIn"] = moved["operation"].clone();
        note(&directory, &plan);
        assert_eq!(moved["changed"], archive_chunk, "each moved, alone");
        steps.push(step("move to the inbox", &moved, started.elapsed().as_secs_f64()));
        let started = Instant::now();
        let archived = data(
            &call(&registry, person(), "mail-archive", json!({ "messages": ids })).await,
            "the archive",
        );
        steps.push(step("archive", &archived, started.elapsed().as_secs_f64()));
        let started = Instant::now();
        let undone = call(
            &registry,
            person(),
            "mail-operation-undo",
            json!({ "operation": archived["operation"] }),
        )
        .await;
        let undone = data(&undone, "undo archive");
        assert_undone(&archived, &undone, "the archive");
        steps.push(step("undo archive", &undone, started.elapsed().as_secs_f64()));
        // The undo gave each message a new id in the inbox, so the move into
        // it is not undone but made the other way.
        let started = Instant::now();
        plan["moveBack"] = json!("pending");
        note(&directory, &plan);
        let back = call(
            &registry,
            person(),
            "mail-label",
            json!({ "messages": ids, "mailbox": places.test }),
        )
        .await;
        let back = data(&back, "the move back");
        plan["moveBack"] = back["operation"].clone();
        note(&directory, &plan);
        assert_eq!(back["changed"], archive_chunk, "each moved back");
        steps.push(step("move back from the inbox", &back, started.elapsed().as_secs_f64()));
        eprintln!("archive: done and undone");

        // 4. An agent proposes trashing a chunk, over its limit: nothing
        // changes until the person approves.
        let (selection, count) =
            select(&registry, places.test, &dates, trash_range.0, trash_range.1).await;
        let changing_before = changing(&timings);
        let proposal = data(
            &call(
                &registry,
                agent(),
                "mail-trash",
                json!({ "selection": selection, "expectedCount": count }),
            )
            .await,
            "the agent's proposal",
        );
        assert_eq!(proposal["state"], "proposed");
        let id = proposal["operation"].clone();
        let shown = data(
            &call(&registry, person(), "mail-operation-show", json!({ "operation": id, "limit": 1 }))
                .await,
            "the preview",
        );
        // The last look before a large move: exactly the chunk, from the
        // test mailbox, into the trash.
        assert!(count.as_u64().unwrap() <= trash_chunk as u64);
        assert_eq!(shown["preview"]["approvable"], true, "{}", shown["preview"]["refused"]);
        let from = shown["preview"]["byMailbox"].as_array().unwrap();
        assert_eq!(from.len(), 1, "from one mailbox");
        assert_eq!(from[0]["mailbox"], places.test, "the test mailbox");
        assert_eq!(from[0]["places"], count, "every place counted");
        let to = shown["preview"]["destinations"].as_array().unwrap();
        assert_eq!(to.len(), 1, "into one mailbox");
        assert_eq!(to[0]["role"], "trash", "the trash");
        let preview = json!({
            "approvable": shown["preview"]["approvable"],
            "byClass": shown["preview"]["byClass"],
            "knownSenders": shown["preview"]["knownSenders"],
            "unreturned": shown["preview"]["unreturned"],
        });
        assert_eq!(
            changing(&timings),
            changing_before,
            "nothing was asked of the provider while it waited"
        );
        let held = call(&registry, person(), "mail-operation-approve", json!({ "operation": id })).await;
        let token = held["error"]["details"]["approvalToken"]
            .as_str()
            .expect("held for the person's approval")
            .to_string();
        let started = Instant::now();
        let approved = call(
            &registry,
            person().with_approval(token),
            "mail-operation-approve",
            json!({ "operation": id }),
        )
        .await;
        let approved = data(&approved, "the approval");
        assert_eq!(approved["state"], "done", "the approved trash ran to its end");
        steps.push(step("approved trash", &approved, started.elapsed().as_secs_f64()));
        eprintln!("trash: approved and done");

        // Its undo, cancelled part-way and carried on.
        let started = Instant::now();
        let trashed = approved["changed"].as_u64().unwrap_or(0);
        let returned = std::sync::atomic::AtomicBool::new(false);
        let undo = async {
            let undone =
                call(&registry, person(), "mail-operation-undo", json!({ "operation": id })).await;
            returned.store(true, Ordering::SeqCst);
            undone
        };
        let cancel = async {
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                if returned.load(Ordering::SeqCst) {
                    return (0, false);
                }
                let listed = call(&registry, person(), "mail-operation-list", json!({ "limit": 1 }))
                    .await;
                let newest = &listed["data"]["operations"][0];
                if newest["undoOf"] == id {
                    let changed = newest["changed"].as_u64().unwrap_or(0);
                    if changed * 2 >= trashed {
                        let cancelled = call(
                            &registry,
                            person(),
                            "mail-operation-cancel",
                            json!({ "operation": newest["operation"] }),
                        )
                        .await;
                        return (changed, cancelled["data"]["stopping"] == true);
                    }
                    if newest["state"] != "running" {
                        return (changed, false);
                    }
                }
            }
        };
        let (undone, (changed_at_cancel, cancelled)) = tokio::join!(undo, cancel);
        let stopped = data(&undone, "the undo of the trash");
        let stopped_at = started.elapsed().as_secs_f64();
        steps.push(json!({
            "step": if cancelled { "undo trash, cancelled" } else { "undo trash, not cancelled" },
            "operation": stopped["operation"],
            "state": stopped["state"],
            "changed": stopped["changed"],
            "changedWhenCancelled": changed_at_cancel,
            "seconds": (stopped_at * 10.0).round() / 10.0,
        }));
        let started = Instant::now();
        let finished = finish(&registry, &stopped["operation"]).await;
        assert_undone(&approved, &finished, "the trash");
        steps.push(step("undo trash, resumed", &finished, started.elapsed().as_secs_f64()));
        eprintln!("trash: undone");
        steps.push(json!({ "step": "proposal preview", "preview": preview }));
    });

    // What a pass of sync finds after: each mailbox as it was.
    let last_seconds = sync();
    let status = data(
        &runtime.block_on(call(&registry, person(), "mail-status", json!({}))),
        "the status",
    );
    let (_, after) = places_of(&status, Some(places.test));
    // Each message the run changed is shown where it was, as many times,
    // and in the test mailbox with the flags it had: mail that arrived
    // meanwhile is not counted.
    let shown_after = where_shown(&directory, places.test, &touched);
    let moved_places = shown_before
        .iter()
        .filter(|(place, count)| shown_after.get(*place) != Some(*count))
        .count()
        + shown_after
            .keys()
            .filter(|place| !shown_before.contains_key(*place))
            .count();
    let now_shown = flags_shown(&directory, places.test);
    let back = touched
        .iter()
        .filter(|id| now_shown.contains_key(id))
        .count();
    let same_flags = touched
        .iter()
        .filter(|id| {
            now_shown
                .get(id)
                .is_some_and(|flags| flags_before.get(id) == Some(flags))
        })
        .count();
    let requests = timings
        .lock()
        .unwrap()
        .iter()
        .map(|(method, (calls, ms))| {
            (
                method.to_string(),
                json!({ "calls": calls, "ms": ms.round() }),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    let results = json!({
        "firstPassSeconds": first_seconds.round(),
        "lastPassSeconds": last_seconds.round(),
        "testMailbox": {
            "listedWithDates": total,
            "touched": touched.len(),
            "backInIt": back,
            "withTheirFlags": same_flags,
            "placesNotAsBefore": moved_places,
        },
        "mailboxes": { "before": before, "after": after },
        "steps": steps,
        "requests": requests,
        "connections": connector.connections.load(Ordering::SeqCst),
    });
    eprintln!("{}", serde_json::to_string_pretty(&results).unwrap());
    if let Ok(out) = std::env::var("LOAM_MAIL_LIVE_OUT") {
        std::fs::write(out, serde_json::to_string_pretty(&results).unwrap()).unwrap();
    }
    assert_eq!(
        moved_places, 0,
        "every message is shown where it was, as often"
    );
    assert_eq!(back, touched.len(), "every message the run changed is back");
    assert_eq!(same_flags, touched.len(), "each with the flags it had");
}

/// How many requests that change mail were made so far.
fn changing(timings: &Timings) -> u64 {
    let timings = timings.lock().unwrap();
    CHANGING
        .iter()
        .filter_map(|method| timings.get(method).map(|(calls, _)| *calls))
        .sum()
}
