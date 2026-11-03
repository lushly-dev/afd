//! Section 7.4 through the full stack: the four first-party plugins in one host, records written
//! by every route (remember, capture, import, `afd-batch`, `afd-pipe`) with random canaries in
//! subject, text, tag, constraint and source, recalled, then forgotten.
//!
//! - **The raw bytes** of every file in the workspace (the store directory, the journal, every
//!   event stream and the log) hold no canary and no destroyed key afterwards. The control: before
//!   the forget the index's plaintext copy holds each subject, text and tag canary, so the probe
//!   sees what it looks for. (The control with FTS5's `secure-delete` off is the store's,
//!   `store-embedded/tests/memory_sqlite.rs`, since the store's compaction clears the index either
//!   way; step 3a's amendment 7.)
//! - **A reader held across the forget** leaves `wal: "pending"` with `MEMORY_ERASURE_PENDING` and
//!   unsettled markers; a later write, once it is closed, retries, and the canary is gone and the
//!   markers settled.
//! - **The backup test**: a `store-backup` holds no canary; after a forget, the copy restored by
//!   5.4's procedure beside the current `memory.keys` reads nothing forgotten, its rows' keys are
//!   destroyed, and the rebuilt index holds no canary; a record forgotten after the restore leaves
//!   none; a capture of the forgotten window is refused from the prefix the rebuild wrote, and a
//!   session-wide prefix is not recovered (5.4's stated limit); a trial restore, then the newer
//!   database put back, opens every record.
//!
//! The crash points and the pragmas of 7.4 are the store's (`memory_keyfile.rs`,
//! `memory_multiprocess.rs`): no full-stack path reaches them.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel::testkit::mcp::Stdio;

/// One route's canaries: subject, text, tag, constraint and source, each starting with its own
/// letter.
struct Canaries {
    subject: String,
    text: String,
    tag: String,
    constraint: String,
    source: String,
}

impl Canaries {
    fn new(letters: [char; 5]) -> Self {
        Self {
            subject: canary(letters[0]),
            text: canary(letters[1]),
            tag: canary(letters[2]),
            constraint: canary(letters[3]),
            source: canary(letters[4]),
        }
    }

    fn all(&self) -> [&str; 5] {
        [
            &self.subject,
            &self.text,
            &self.tag,
            &self.constraint,
            &self.source,
        ]
    }

    /// The fields the index keeps a plaintext copy of until a forget.
    fn indexed(&self) -> [&str; 3] {
        [&self.subject, &self.text, &self.tag]
    }

    fn remember(&self) -> Value {
        json!({
            "class": "semantic",
            "subject": format!("{} subject", self.subject),
            "text": format!("The text {} of the record.", self.text),
            "tags": [self.tag],
            "constraints": [format!("only {}", self.constraint)],
            "sources": [{ "resource": format!("notes/{}.md", self.source) }],
            "project": "afd",
        })
    }
}

/// The routes, with their letters: no two canaries of a route share a first letter.
const ROUTES: [(&str, [char; 5]); 5] = [
    ("remember", ['b', 'c', 'd', 'f', 'g']),
    ("capture", ['h', 'j', 'k', 'l', 'm']),
    ("import", ['n', 'p', 'q', 'r', 't']),
    ("batch", ['v', 'w', 'x', 'z', 'b']),
    ("pipe", ['c', 'd', 'f', 'g', 'h']),
];

/// Write one record by each route; ada's ids, and every canary.
async fn write_every_route(ws: &Ws) -> (Vec<String>, Vec<Canaries>) {
    let canaries: Vec<Canaries> = ROUTES.iter().map(|(_, l)| Canaries::new(*l)).collect();
    let [remember, capture, import, batch, pipe] = &canaries[..] else {
        unreachable!()
    };
    let mut ids = Vec::new();
    ids.push(ws.remember(human("ada"), remember.remember()).await);
    let captured = ws
        .call(
            human("ada"),
            "memory-capture",
            json!({
                "version": 1, "harness": { "name": "claude-code" }, "event": "stop",
                "session": "fb-1", "project": "afd", "idempotencyKey": "claude-code:fb-1:w1:p0",
                "captureKey": "claude-code:fb-1:w1", "window": 1,
                "episodes": [{ "subject": format!("{} window", capture.subject), "text": format!("[user]\n{}\n", capture.text), "part": 0, "turns": [0, 0] }],
                "decisions": [{ "subject": "A decision", "text": format!("Decided {}", capture.tag), "constraints": [capture.constraint] }],
                "artifacts": [{ "kind": "file", "resource": format!("src/{}.rs", capture.source), "title": "a file" }],
            }),
        )
        .await;
    for id in data(&captured)["records"].as_array().unwrap() {
        ids.push(id.as_str().unwrap().to_owned());
    }
    let imported = ws
        .cli(
            human("ada"),
            "memory-import",
            json!({ "harness": "claude-code", "project": "afd", "entries": [{
                "class": "semantic",
                "subject": format!("{} imported", import.subject),
                "text": format!("Imported {} with {}.", import.text, import.constraint),
                "tags": [import.tag],
                "path": format!("{}.md", import.source),
            }] }),
        )
        .await;
    for id in data(&imported)["records"].as_array().unwrap() {
        ids.push(id.as_str().unwrap().to_owned());
    }
    // `afd-batch` and `afd-pipe` over MCP, as ada's agent on stdio.
    let mut client = Stdio::connect(ws.host()).await;
    let reply = client
        .request(
            "tools/call",
            json!({ "name": "afd-batch", "arguments": { "commands": [
                { "command": "memory-remember", "input": batch.remember() },
            ] } }),
        )
        .await;
    let batched = &reply["result"]["structuredContent"];
    assert_eq!(batched["results"][0]["result"]["success"], true, "{reply}");
    ids.push(
        batched["results"][0]["result"]["data"]["id"]
            .as_str()
            .unwrap()
            .to_owned(),
    );
    let reply = client
        .request(
            "tools/call",
            json!({ "name": "afd-pipe", "arguments": { "steps": [
                { "command": "memory-remember", "input": pipe.remember() },
            ] } }),
        )
        .await;
    let piped = &reply["result"]["structuredContent"];
    assert_eq!(piped["steps"][0]["status"], "success", "{reply}");
    drop(client);
    let listed = ws
        .call(human("ada"), "memory-list", json!({ "limit": 50 }))
        .await;
    let mut all = support::ids(&listed);
    all.sort();
    let mut known = ids.clone();
    known.sort();
    assert_eq!(
        all.len(),
        known.len() + 1,
        "the pipe's record too: {listed}"
    );
    (all, canaries)
}

#[tokio::test]
async fn every_route_leaves_no_canary_and_no_key_after_a_forget() {
    let ws = Ws::new(&Options::default());
    let (ids, canaries) = write_every_route(&ws).await;
    // Recall them: every indexed canary is found.
    for c in &canaries {
        for term in c.indexed() {
            let recall = ws
                .call(human("ada"), "memory-recall", json!({ "query": term }))
                .await;
            assert!(!support::ids(&recall).is_empty(), "{term} is recalled");
        }
    }
    let words: Vec<&str> = canaries.iter().flat_map(Canaries::all).collect();
    let indexed: Vec<&str> = canaries.iter().flat_map(Canaries::indexed).collect();
    // The control: before the forget the probe sees each indexed canary on disk.
    let before = holding(&ws.dir, &needles(&indexed));
    for word in &indexed {
        assert!(
            before.iter().any(|(_, w)| w == word),
            "the probe sees {word} before the forget"
        );
    }
    // The journal, events and log never held any of them (digest journaling, 7.1).
    never_mentions(&ws.journaled_text(), &words);
    let keys = keys_of(&ws.store_dir("alpha"), &ids);
    assert!(
        !holding(&ws.dir, &keys).is_empty(),
        "the probe sees the keys"
    );

    let forgot = ws
        .call(human("ada"), "memory-forget", json!({ "ids": ids }))
        .await;
    assert_eq!(data(&forgot)["erased"], ids.len(), "{forgot}");
    assert_eq!(data(&forgot)["wal"], "clean");
    for c in &canaries {
        for term in c.indexed() {
            let recall = ws
                .call(human("ada"), "memory-recall", json!({ "query": term }))
                .await;
            assert!(
                support::ids(&recall).is_empty(),
                "{term} is not recalled after"
            );
        }
    }
    let left = holding(&ws.dir, &needles(&words));
    assert!(left.is_empty(), "canaries left on disk: {left:?}");
    let left = holding(&ws.dir, &keys);
    assert!(left.is_empty(), "destroyed keys left on disk: {left:?}");
    assert_eq!(
        markers(&ws.store_dir("alpha"), &ids),
        vec![Some((true, true)); ids.len()],
        "every key destroyed, every marker settled"
    );
}

#[tokio::test]
async fn a_reader_held_across_a_forget_leaves_it_pending_until_a_later_write() {
    let mut ws = Ws::new(&Options::default());
    let c = Canaries::new(['b', 'c', 'd', 'f', 'g']);
    let id = ws.remember(human("ada"), c.remember()).await;
    let db = ws.store_dir("alpha").join("memory.sqlite3");
    let mut reader = rusqlite::Connection::open(&db).unwrap();
    let snapshot = reader.transaction().unwrap();
    let rows: i64 = snapshot
        .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 1);
    let forgot = ws
        .call(human("ada"), "memory-forget", json!({ "ids": [id] }))
        .await;
    assert_eq!(data(&forgot)["erased"], 1);
    assert_eq!(data(&forgot)["wal"], "pending", "{forgot}");
    assert!(warning(&forgot, "MEMORY_ERASURE_PENDING").is_some());
    assert_eq!(
        markers(&ws.store_dir("alpha"), std::slice::from_ref(&id)),
        [Some((true, false))],
        "the key destroyed, the marker unsettled"
    );
    // The text cannot be opened already.
    let shown = ws
        .call(human("ada"), "memory-show", json!({ "id": id }))
        .await;
    assert_eq!(code(&shown), "MEMORY_NOT_FOUND");
    drop(snapshot);
    drop(reader);
    // A later write retries, now with no reader, and settles it.
    ws.at(ws.clock + MINUTE);
    ws.remember(
        human("ada"),
        fact("Later", "A later write retries the erasure.", json!({})),
    )
    .await;
    assert_eq!(
        markers(&ws.store_dir("alpha"), std::slice::from_ref(&id)),
        [Some((true, true))],
        "settled"
    );
    let left = holding(&ws.dir, &needles(&c.all()));
    assert!(left.is_empty(), "canaries left on disk: {left:?}");
}

fn capture_window(session: &str, window: u64, idempotency: &str, text: &str) -> Value {
    json!({
        "version": 1, "harness": { "name": "claude-code" }, "event": "stop",
        "session": session, "project": "afd", "idempotencyKey": idempotency,
        "captureKey": format!("claude-code:{session}:w{window}"), "window": window,
        "episodes": [{ "subject": format!("Session {session} window {window}"), "text": text, "part": 0, "turns": [0, 0] }],
    })
}

#[tokio::test]
async fn a_store_backup_cannot_read_a_record_forgotten_after_it() {
    let mut ws = Ws::new(&Options::default());
    let c = Canaries::new(['b', 'c', 'd', 'f', 'g']);
    let fact_id = ws.remember(human("ada"), c.remember()).await;
    let tail = canary('h');
    let session_text = canary('j');
    let kept_text = canary('k');
    let window = ws
        .call(
            human("ada"),
            "memory-capture",
            capture_window(
                "fb-w",
                1,
                "claude-code:fb-w:w1:t3:p0",
                &format!("[user]\n{tail}\n"),
            ),
        )
        .await;
    let window = data(&window)["records"][0].as_str().unwrap().to_owned();
    let session = ws
        .call(
            human("ada"),
            "memory-capture",
            capture_window(
                "fb-s",
                1,
                "claude-code:fb-s:w1:p0",
                &format!("[user]\n{session_text}\n"),
            ),
        )
        .await;
    let session = data(&session)["records"][0].as_str().unwrap().to_owned();
    let kept = ws
        .remember(
            human("ada"),
            fact("Kept", &format!("{kept_text} stays."), json!({})),
        )
        .await;
    let forgotten_words: Vec<&str> = c
        .all()
        .into_iter()
        .chain([tail.as_str(), session_text.as_str()])
        .collect();

    // The backup holds no canary.
    let backup = ws
        .cli(
            human("ada"),
            "store-backup",
            json!({ "path": "backups/one" }),
        )
        .await;
    assert_eq!(data(&backup)["memory"], true, "{backup}");
    assert!(warning(&backup, "MEMORY_KEYS_NOT_BACKED_UP").is_some());
    let one = ws.path("backups/one");
    assert!(one.join("memory.sqlite3").exists());
    let all_words: Vec<&str> = forgotten_words
        .iter()
        .copied()
        .chain([kept_text.as_str()])
        .collect();
    assert_eq!(holding(&one, &needles(&all_words)), []);

    // Forget the fact and the window by id, and the other session by selector.
    ws.at(ws.clock + MINUTE);
    let forgot = ws
        .call(
            human("ada"),
            "memory-forget",
            json!({ "ids": [fact_id, window] }),
        )
        .await;
    assert_eq!(data(&forgot)["erased"], 2, "{forgot}");
    let forgot = ws
        .call(human("ada"), "memory-forget", json!({ "session": "fb-s" }))
        .await;
    assert_eq!(data(&forgot)["erased"], 1, "{forgot}");
    let forgotten = [fact_id.clone(), window.clone(), session.clone()];
    // Before the restore, the session's prefix refuses its later windows.
    let refused = ws
        .call(
            human("ada"),
            "memory-capture",
            capture_window("fb-s", 2, "claude-code:fb-s:w2:p0", "[user]\nlater\n"),
        )
        .await;
    assert_eq!(data(&refused)["created"], 0, "{refused}");

    // Restore the copy by hand beside the current key file. Before any open, its rows are there
    // with their sealed blobs, and every one of their keys is destroyed.
    ws.closed(|dir| {
        let store = dir.join("state/spaces/alpha/store");
        restore_memory(&store, &dir.join("backups/one"));
        let raw = rusqlite::Connection::open(store.join("memory.sqlite3")).unwrap();
        for id in &forgotten {
            let sealed: Option<Vec<u8>> = raw
                .query_row("SELECT sealed FROM records WHERE id = ?1", [id], |r| {
                    r.get(0)
                })
                .unwrap();
            assert!(
                sealed.is_some_and(|b| !b.is_empty()),
                "{id}'s blob is in the copy"
            );
        }
        assert_eq!(markers(&store, &forgotten), vec![Some((true, true)); 3]);
    });
    // Every read answers as for an absent record, and the rebuilt index holds no canary.
    for id in &forgotten {
        let shown = ws
            .call(human("ada"), "memory-show", json!({ "id": id }))
            .await;
        assert_eq!(code(&shown), "MEMORY_NOT_FOUND", "{id}");
        let invalidated = ws
            .call(
                human("ada"),
                "memory-invalidate",
                json!({ "id": id, "reason": "wrong" }),
            )
            .await;
        assert_eq!(code(&invalidated), "MEMORY_NOT_FOUND");
    }
    for word in &forgotten_words {
        let recall = ws
            .call(human("ada"), "memory-recall", json!({ "query": word }))
            .await;
        assert_eq!(data(&recall)["hits"], json!([]), "{word}");
    }
    let listed = ws
        .call(human("ada"), "memory-list", json!({ "limit": 50 }))
        .await;
    assert_eq!(ids(&listed), [kept.as_str()]);
    let left = holding(&ws.store_dir("alpha"), &needles(&forgotten_words));
    assert!(left.is_empty(), "the rebuilt index holds {left:?}");

    // A record forgotten after the restore leaves no canary: the rebuilt table has FTS5's
    // `secure-delete` again.
    let after = canary('l');
    let later = ws
        .remember(
            human("ada"),
            fact("After", &format!("{after} after the restore."), json!({})),
        )
        .await;
    ws.call(human("ada"), "memory-forget", json!({ "ids": [later] }))
        .await;
    assert_eq!(holding(&ws.dir, &needles(&[after.as_str()])), []);

    // The forgotten window's prefix was written back by the rebuild: a later capture of that
    // window is refused. The session-wide prefix had no row and is lost (5.4's stated limit): a
    // later window of that session is captured again.
    let window_again = ws
        .call(
            human("ada"),
            "memory-capture",
            capture_window("fb-w", 1, "claude-code:fb-w:w1:t9:p0", "[user]\nagain\n"),
        )
        .await;
    assert_eq!(data(&window_again)["created"], 0, "{window_again}");
    assert_eq!(data(&window_again)["refused"], 1);
    let session_again = ws
        .call(
            human("ada"),
            "memory-capture",
            capture_window("fb-s", 2, "claude-code:fb-s:w2:p1", "[user]\nlater again\n"),
        )
        .await;
    assert_eq!(data(&session_again)["created"], 1, "{session_again}");
    let first_window_again = ws
        .call(
            human("ada"),
            "memory-capture",
            capture_window("fb-s", 1, "claude-code:fb-s:w1:p9", "[user]\nfirst again\n"),
        )
        .await;
    assert_eq!(
        data(&first_window_again)["created"],
        0,
        "the row's window prefix"
    );

    // A trial restore: back up this database, restore the older copy, open it, then put the
    // newer one back; every record opens.
    let newer = ws
        .cli(
            human("ada"),
            "store-backup",
            json!({ "path": "backups/two" }),
        )
        .await;
    assert_eq!(data(&newer)["memory"], true);
    let live = ids(&ws
        .call(human("ada"), "memory-list", json!({ "limit": 50 }))
        .await);
    assert!(live.len() >= 2, "{live:?}");
    ws.closed(|dir| {
        restore_memory(
            &dir.join("state/spaces/alpha/store"),
            &dir.join("backups/one"),
        );
    });
    let trial = ws
        .call(human("ada"), "memory-list", json!({ "limit": 50 }))
        .await;
    assert_eq!(
        ids(&trial),
        [kept.as_str()],
        "the older copy, without the forgotten"
    );
    ws.closed(|dir| {
        restore_memory(
            &dir.join("state/spaces/alpha/store"),
            &dir.join("backups/two"),
        );
    });
    let back = ids(&ws
        .call(human("ada"), "memory-list", json!({ "limit": 50 }))
        .await);
    assert_eq!(back, live);
    for id in &live {
        let shown = ws
            .call(human("ada"), "memory-show", json!({ "id": id }))
            .await;
        assert_eq!(shown["success"], true, "{id} opens: {shown}");
    }
}
