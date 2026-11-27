#![allow(clippy::unwrap_used)]
use super::*;

fn store(dir: &Path) -> SqlitePerson {
    SqlitePerson::new(&dir.join("shared").join("person.sqlite3"), 1_000)
}

fn decision(id: &str, now: i64) -> NewDecision {
    NewDecision {
        id: id.to_owned(),
        for_: DecisionFor {
            actor: ActorRef {
                kind: ActorKind::Agent,
                id: Some("corp/client".into()),
                on_behalf_of: Some("corp/ada".into()),
            },
            client_id: Some("client".into()),
            issuer: Some("as".into()),
            namespace: "corp".into(),
            subject: "ada".into(),
        },
        command: "gate-approve".into(),
        input_digest: "d".repeat(43),
        properties: serde_json::from_value(serde_json::json!({ "proposal": "p-1" })).unwrap(),
        spaces: vec!["main".into()],
        chain: Vec::new(),
        trace_id: Some("t".into()),
        created_ms: now,
        expires_ms: now + 600_000,
        binding: None,
    }
}

fn login(id: &str, decision: &str, now: i64) -> NewLogin {
    NewLogin {
        id: id.to_owned(),
        decision: decision.to_owned(),
        verifier: "v".into(),
        nonce: "n".into(),
        browser_hash: "ab".repeat(32),
        created_ms: now,
        expires_ms: now + 600_000,
    }
}

fn choice(action: Action) -> Choice {
    Choice {
        page: 1,
        action,
        checked: Vec::new(),
        hash: page_hash(1),
        max_age_ms: i64::MAX,
    }
}

fn page_hash(page: u32) -> String {
    format!("sha256:{}", format!("{page}").repeat(64))
}

const APPROVE: Action = Action::Approve;
const DECLINE: Action = Action::Decline;

fn rendered(store: &SqlitePerson, id: &str, login: &str, page: u32, items: &[&str], now: i64) {
    rendered_of(store, id, login, page, 2, items, now);
}

fn rendered_of(
    store: &SqlitePerson,
    id: &str,
    login: &str,
    page: u32,
    pages: u32,
    items: &[&str],
    now: i64,
) -> Rendered {
    store
        .render(
            &Render {
                decision: id.to_owned(),
                login: login.to_owned(),
                page,
                pages,
                hash: page_hash(page),
                items: items.iter().map(|&id| id.to_owned()).collect(),
                ttl_ms: 600_000,
            },
            now,
        )
        .unwrap()
}

fn verified(ok: bool) -> Verified {
    Verified {
        auth_time_ms: 1,
        acr: "phr".into(),
        preview_hash: format!("sha256:{}", "0".repeat(64)),
        preview_ok: ok,
    }
}

#[test]
fn a_login_is_taken_once_and_decides_once() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 1_000_000;
    store.create(&decision("d1", now), now).unwrap();
    assert_eq!(
        store.start_login(&login("l1", "d1", now), now).unwrap(),
        LoginStart::Started
    );
    // Deciding before the login returned records nothing.
    assert!(matches!(
        store
            .decide("d1", "l1", &"ab".repeat(32), &choice(APPROVE), now)
            .unwrap(),
        Decided::Refused
    ));
    // Without its browser's cookie the login is not taken, and stays to be taken.
    assert!(
        store
            .take_login("l1", &"cd".repeat(32), now)
            .unwrap()
            .is_none()
    );
    assert!(
        store
            .take_login("l1", &"ab".repeat(32), now)
            .unwrap()
            .is_some()
    );
    // A replayed return finds nothing.
    assert!(
        store
            .take_login("l1", &"ab".repeat(32), now)
            .unwrap()
            .is_none()
    );
    assert!(store.finish_login("l1", Some(&verified(true))).unwrap());
    // Another browser, another decision, or after the login's expiry: nothing.
    assert!(matches!(
        store
            .decide("d1", "l1", &"cd".repeat(32), &choice(APPROVE), now)
            .unwrap(),
        Decided::Refused
    ));
    assert!(matches!(
        store
            .decide("d2", "l1", &"ab".repeat(32), &choice(APPROVE), now)
            .unwrap(),
        Decided::Refused
    ));
    assert!(matches!(
        store
            .decide(
                "d1",
                "l1",
                &"ab".repeat(32),
                &choice(APPROVE),
                now + 600_000
            )
            .unwrap(),
        Decided::Refused
    ));
    // Approve needs every page rendered.
    assert!(matches!(
        store
            .decide("d1", "l1", &"ab".repeat(32), &choice(APPROVE), now)
            .unwrap(),
        Decided::Changed
    ));
    rendered_of(&store, "d1", "l1", 1, 1, &[], now);
    let Decided::Recorded(decided) = store
        .decide("d1", "l1", &"ab".repeat(32), &choice(APPROVE), now)
        .unwrap()
    else {
        panic!("not recorded");
    };
    assert_eq!(decided.status, Status::Approved);
    // Once: neither the login nor the decision decides again.
    assert!(matches!(
        store
            .decide("d1", "l1", &"ab".repeat(32), &choice(DECLINE), now)
            .unwrap(),
        Decided::Refused
    ));
    let stored = store.decision("d1").unwrap().unwrap();
    assert_eq!(stored.status, Status::Approved);
    // The stored decision reads back as `person-decision.v2`: its members and no more.
    let v2 = stored.to_v2();
    let mut members: Vec<&String> = v2.as_object().unwrap().keys().collect();
    members.sort();
    assert_eq!(
        members,
        [
            "acr",
            "authTime",
            "command",
            "createdAt",
            "decidedAt",
            "excluded",
            "expires",
            "for",
            "id",
            "inputDigest",
            "level",
            "pages",
            "previewHash",
            "properties",
            "status",
            "version"
        ]
    );
    assert_eq!(v2["level"], "verified");
    assert_eq!(v2["status"], "approved");
    assert_eq!(v2["for"]["clientId"], "client");
    assert_eq!(v2["properties"], serde_json::json!({ "proposal": "p-1" }));
    let pending = {
        store.create(&decision("d9", now), now).unwrap();
        store.decision("d9").unwrap().unwrap().to_v2()
    };
    for member in ["decidedAt", "level", "authTime", "acr", "previewHash"] {
        assert!(pending[member].is_null(), "{member}: {pending}");
    }
}

#[test]
fn an_approval_needs_a_shown_preview_and_a_live_decision() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 5_000_000;
    store.create(&decision("d1", now), now).unwrap();
    store.start_login(&login("l1", "d1", now), now).unwrap();
    store
        .take_login("l1", &"ab".repeat(32), now)
        .unwrap()
        .unwrap();
    store.finish_login("l1", Some(&verified(false))).unwrap();
    // No page was shown: nothing to approve.
    assert!(matches!(
        store
            .decide("d1", "l1", &"ab".repeat(32), &choice(APPROVE), now)
            .unwrap(),
        Decided::Changed
    ));
    // Declining needs no preview.
    let Decided::Recorded(decided) = store
        .decide("d1", "l1", &"ab".repeat(32), &choice(DECLINE), now)
        .unwrap()
    else {
        panic!("not recorded");
    };
    assert_eq!(decided.status, Status::Declined);
    // An expired decision starts no login.
    store.create(&decision("d2", now), now).unwrap();
    assert_eq!(
        store
            .start_login(&login("l2", "d2", now), now + 600_000)
            .unwrap(),
        LoginStart::NoDecision
    );
    assert_eq!(
        store.start_login(&login("l3", "nope", now), now).unwrap(),
        LoginStart::NoDecision
    );
}

#[test]
fn one_decision_starts_a_bounded_number_of_logins_and_rows_are_purged() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 9_000_000;
    store.create(&decision("d1", now), now).unwrap();
    for index in 0..MAX_LOGINS_PER_DECISION {
        assert_eq!(
            store
                .start_login(&login(&format!("l{index}"), "d1", now), now)
                .unwrap(),
            LoginStart::Started
        );
    }
    assert_eq!(
        store.start_login(&login("lx", "d1", now), now).unwrap(),
        LoginStart::TooMany
    );
    // An hour after expiry the next write purges the rows.
    let later = now + 600_000 + KEEP_AFTER_EXPIRY_MS + 1;
    store.create(&decision("d2", later), later).unwrap();
    assert!(store.decision("d1").unwrap().is_none());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join("shared").join("person.sqlite3"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

fn ready(store: &SqlitePerson, id: &str, login_id: &str, now: i64) {
    store.create(&decision(id, now), now).unwrap();
    store.start_login(&login(login_id, id, now), now).unwrap();
    store
        .take_login(login_id, &"ab".repeat(32), now)
        .unwrap()
        .unwrap();
    store.finish_login(login_id, Some(&verified(true))).unwrap();
}

fn post(store: &SqlitePerson, page: u32, action: Action, checked: &[usize], now: i64) -> Decided {
    store
        .decide(
            "d1",
            "l1",
            &"ab".repeat(32),
            &Choice {
                page,
                action,
                checked: checked.to_vec(),
                hash: page_hash(page),
                max_age_ms: i64::MAX,
            },
            now,
        )
        .unwrap()
}

#[test]
fn pages_are_kept_and_items_pulled_out_by_position() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 7_000_000;
    ready(&store, "d1", "l1", now);
    assert!(
        store
            .verified_login("d1", "l1", &"ab".repeat(32), now)
            .unwrap()
    );
    assert!(
        !store
            .verified_login("d1", "l1", &"cd".repeat(32), now)
            .unwrap()
    );
    rendered(&store, "d1", "l1", 1, &["a", "b", "c"], now);
    // Not every page seen: no approval, and nothing recorded.
    assert!(matches!(
        post(&store, 1, APPROVE, &[0, 1, 2], now),
        Decided::Changed
    ));
    // A position past the page, or repeated: refused, nothing kept.
    assert!(matches!(
        post(&store, 1, Action::Next, &[3], now),
        Decided::Changed
    ));
    assert!(matches!(
        post(&store, 1, Action::Next, &[0, 0], now),
        Decided::Changed
    ));
    // No page before the first.
    assert!(matches!(
        post(&store, 1, Action::Previous, &[], now),
        Decided::Changed
    ));
    // Next keeps the page's choices: `b` unchecked.
    assert!(matches!(
        post(&store, 1, Action::Next, &[0, 2], now),
        Decided::Moved(2)
    ));
    assert_eq!(store.decision("d1").unwrap().unwrap().excluded, ["b"]);
    // No page past the last; an id of another page cannot be shown.
    assert!(matches!(
        rendered_of(&store, "d1", "l1", 2, 2, &["a"], now),
        Rendered::Duplicate
    ));
    rendered(&store, "d1", "l1", 2, &["d"], now);
    assert!(matches!(
        post(&store, 2, Action::Next, &[0], now),
        Decided::Changed
    ));
    // Approve from page 2 with `d` unchecked: final, beside page 1's.
    let Decided::Recorded(decided) = post(&store, 2, APPROVE, &[], now) else {
        panic!("not recorded");
    };
    assert_eq!(decided.status, Status::Approved);
    assert_eq!(decided.excluded, ["b", "d"]);
    assert_eq!(
        decided.preview_hash.as_deref(),
        Some(&*format!("sha256:{}", "2".repeat(64)))
    );
    let v2 = decided.to_v2();
    assert_eq!(v2["excluded"], serde_json::json!(["b", "d"]));
    assert_eq!(v2["pages"][0]["items"], serde_json::json!(["a", "b", "c"]));
    assert_eq!(v2["pages"][1]["page"], 2);
}

#[test]
fn a_changed_review_clears_the_pages_and_the_choices() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 8_000_000;
    ready(&store, "d1", "l1", now);
    rendered(&store, "d1", "l1", 1, &["a", "b"], now);
    assert!(matches!(
        post(&store, 1, Action::Next, &[0], now),
        Decided::Moved(2)
    ));
    // Another number of pages: cleared.
    assert!(matches!(
        rendered_of(&store, "d1", "l1", 2, 3, &["c"], now),
        Rendered::Changed
    ));
    let cleared = store.decision("d1").unwrap().unwrap();
    assert!(cleared.pages.is_empty() && cleared.excluded.is_empty());
    assert_eq!(cleared.pages_total, None);
    // A page seen before with another hash: cleared too.
    rendered(&store, "d1", "l1", 1, &["a", "b"], now);
    let changed = store
        .render(
            &Render {
                decision: "d1".into(),
                login: "l1".into(),
                page: 1,
                pages: 2,
                hash: format!("sha256:{}", "f".repeat(64)),
                items: vec!["a".into(), "b".into()],
                ttl_ms: 600_000,
            },
            now,
        )
        .unwrap();
    assert!(matches!(changed, Rendered::Changed));
    assert!(store.decision("d1").unwrap().unwrap().pages.is_empty());
}

#[test]
fn each_render_moves_the_expiry_never_past_a_day() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 10_000_000;
    ready(&store, "d1", "l1", now);
    let later = now + 500_000;
    let Rendered::Recorded(moved) = rendered_of(&store, "d1", "l1", 1, 1, &[], later) else {
        panic!("not recorded");
    };
    assert_eq!(moved.expires_ms, later + 600_000);
    // The login moved with it.
    assert!(
        store
            .verified_login("d1", "l1", &"ab".repeat(32), later + 599_000)
            .unwrap()
    );
    // Rendered again and again, it never lives past a day from its beginning.
    let mut at = later;
    while at < now + MAX_DECISION_LIFE_MS {
        at += 590_000;
        if let Rendered::Recorded(decision) = rendered_of(&store, "d1", "l1", 1, 1, &[], at) {
            assert!(decision.expires_ms <= now + MAX_DECISION_LIFE_MS);
        }
    }
    assert_eq!(
        store.decision("d1").unwrap().unwrap().expires_ms,
        now + MAX_DECISION_LIFE_MS
    );
    assert!(matches!(
        rendered_of(&store, "d1", "l1", 1, 1, &[], now + MAX_DECISION_LIFE_MS),
        Rendered::Gone
    ));
}

#[test]
fn the_pending_list_is_the_persons_own_live_decisions() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 11_000_000;
    store.create(&decision("d1", now), now).unwrap();
    let mut other = decision("d2", now + 1);
    other.for_.subject = "bo".into();
    store.create(&other, now).unwrap();
    let mut late = decision("d3", now + 2);
    late.expires_ms = now + 10;
    store.create(&late, now).unwrap();
    let ids = |at: i64| -> Vec<String> {
        store
            .pending_for("corp", "ada", at)
            .unwrap()
            .into_iter()
            .map(|decision| decision.id)
            .collect()
    };
    assert_eq!(ids(now), ["d1", "d3"]);
    assert_eq!(ids(now + 10), ["d1"]);
    assert!(store.pending_for("else", "ada", now).unwrap().is_empty());
    // A list login has no decision: it decides nothing.
    store
        .start_list_login(
            &NewListLogin {
                id: "ll".into(),
                namespace: "corp".into(),
                verifier: "v".into(),
                nonce: "n".into(),
                browser_hash: "ab".repeat(32),
                created_ms: now,
                expires_ms: now + 600_000,
            },
            now,
        )
        .unwrap();
    let taken = store
        .take_login("ll", &"ab".repeat(32), now)
        .unwrap()
        .unwrap();
    assert_eq!(taken.decision, "");
    assert_eq!(taken.namespace.as_deref(), Some("corp"));
    store.finish_login("ll", Some(&verified(true))).unwrap();
    assert!(matches!(
        store
            .decide("", "ll", &"ab".repeat(32), &choice(DECLINE), now)
            .unwrap(),
        Decided::Refused
    ));
}

#[test]
fn a_version_1_store_is_migrated_in_place() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shared").join("person.sqlite3");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    {
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE decisions (id TEXT PRIMARY KEY NOT NULL, for_json TEXT NOT NULL,
                     command TEXT NOT NULL, input_digest TEXT NOT NULL, properties TEXT NOT NULL,
                     spaces TEXT NOT NULL, chain TEXT NOT NULL, trace_id TEXT,
                     created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, status TEXT NOT NULL,
                     decided_ms INTEGER, auth_time_ms INTEGER, acr TEXT, preview_hash TEXT) WITHOUT ROWID;
                 CREATE TABLE logins (id TEXT PRIMARY KEY NOT NULL, decision TEXT NOT NULL,
                     verifier TEXT NOT NULL, nonce TEXT NOT NULL, browser_hash TEXT NOT NULL,
                     created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, status TEXT NOT NULL,
                     auth_time_ms INTEGER, acr TEXT, preview_hash TEXT,
                     preview_ok INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        let for_json = serde_json::to_string(&decision("d1", 0).for_).unwrap();
        connection
            .execute(
                "INSERT INTO decisions VALUES ('d1', ?1, 'gate-approve', 'x', '{}', '[]', '[]',
                     NULL, 1, 2, 'pending', NULL, NULL, NULL, NULL)",
                params![for_json],
            )
            .unwrap();
    }
    let store = SqlitePerson::new(&path, 1_000);
    let read = store.decision("d1").unwrap().unwrap();
    assert!(read.pages.is_empty() && read.excluded.is_empty());
    assert_eq!(read.pages_total, None);
    let version: i64 = Connection::open(&path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);
    // The copy taken before the migration (D214) is the version 1 store with its row.
    let copy = Connection::open(
        dir.path()
            .join("shared")
            .join("person.sqlite3.v1.pre-migration"),
    )
    .unwrap();
    let (version, rows): (i64, i64) = copy
        .query_row(
            "SELECT (SELECT user_version FROM pragma_user_version), count(*) FROM decisions",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((version, rows), (1, 1));
}

#[test]
fn a_version_2_store_gains_the_binding_and_its_rows_have_none() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shared").join("person.sqlite3");
    let store = store(dir.path());
    let mut bound = decision("d2", 0);
    bound.binding = Some("mac".into());
    store.create(&decision("d1", 0), 0).unwrap();
    store.create(&bound, 0).unwrap();
    assert_eq!(
        store.decision("d2").unwrap().unwrap().binding.as_deref(),
        Some("mac")
    );
    drop(store);
    // Back to version 2: the column dropped, as a version 2 host wrote the file.
    {
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("ALTER TABLE decisions DROP COLUMN binding; PRAGMA user_version = 2;")
            .unwrap();
    }
    let store = SqlitePerson::new(&path, 1_000);
    for id in ["d1", "d2"] {
        assert_eq!(store.decision(id).unwrap().unwrap().binding, None, "{id}");
    }
    let version: i64 = Connection::open(&path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);
    // The copy taken before the migration (D214) is the version 2 store with both rows.
    let copy = Connection::open(
        dir.path()
            .join("shared")
            .join("person.sqlite3.v2.pre-migration"),
    )
    .unwrap();
    let (version, rows): (i64, i64) = copy
        .query_row(
            "SELECT (SELECT user_version FROM pragma_user_version), count(*) FROM decisions",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((version, rows), (2, 2));
}

#[test]
fn a_form_from_another_version_of_its_page_records_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 12_000_000;
    ready(&store, "d1", "l1", now);
    rendered_of(&store, "d1", "l1", 1, 1, &["a", "b"], now);
    let stale = |action: Action| Choice {
        page: 1,
        action,
        checked: vec![0],
        hash: format!("sha256:{}", "e".repeat(64)),
        max_age_ms: i64::MAX,
    };
    for action in [Action::Next, APPROVE] {
        assert!(matches!(
            store
                .decide("d1", "l1", &"ab".repeat(32), &stale(action), now)
                .unwrap(),
            Decided::Changed
        ));
    }
    assert!(store.decision("d1").unwrap().unwrap().excluded.is_empty());
    // An approval later than the lifetime after the login's `auth_time` (1 ms) is stale.
    let mut late = choice(APPROVE);
    late.max_age_ms = now - 2;
    assert!(matches!(
        store
            .decide("d1", "l1", &"ab".repeat(32), &late, now)
            .unwrap(),
        Decided::Stale
    ));
    // Decline needs neither.
    assert!(matches!(
        store
            .decide("d1", "l1", &"ab".repeat(32), &stale(DECLINE), now)
            .unwrap(),
        Decided::Recorded(_)
    ));
}

#[test]
fn cleared_pages_are_rendered_again_from_none() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 13_000_000;
    ready(&store, "d1", "l1", now);
    rendered(&store, "d1", "l1", 1, &["a"], now);
    rendered(&store, "d1", "l1", 2, &["b"], now);
    store.clear_pages("d1").unwrap();
    let cleared = store.decision("d1").unwrap().unwrap();
    assert!(cleared.pages.is_empty() && !cleared.every_page_seen());
}

#[test]
fn live_list_logins_are_capped() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 14_000_000;
    let list = |index: i64, at: i64| NewListLogin {
        id: format!("ll{index}"),
        namespace: "corp".into(),
        verifier: "v".into(),
        nonce: "n".into(),
        browser_hash: "ab".repeat(32),
        created_ms: at,
        expires_ms: at + 600_000,
    };
    for index in 0..MAX_LIVE_LIST_LOGINS {
        assert_eq!(
            store.start_list_login(&list(index, now), now).unwrap(),
            LoginStart::Started
        );
    }
    assert_eq!(
        store.start_list_login(&list(999, now), now).unwrap(),
        LoginStart::TooMany
    );
    // Once they expire, more may start.
    let later = now + 600_000;
    assert_eq!(
        store.start_list_login(&list(1000, later), later).unwrap(),
        LoginStart::Started
    );
}

#[test]
fn a_login_lives_ten_minutes_until_verified_then_as_long_as_its_decision() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(dir.path());
    let now = 15_000_000;
    let mut long = decision("d1", now);
    long.expires_ms = now + 3_600_000;
    store.create(&long, now).unwrap();
    let mut row = login("l1", "d1", now);
    row.expires_ms = now + LOGIN_START_TTL_MS;
    store.start_login(&row, now).unwrap();
    store
        .take_login("l1", &"ab".repeat(32), now)
        .unwrap()
        .unwrap();
    store.finish_login("l1", Some(&verified(true))).unwrap();
    assert!(
        store
            .verified_login("d1", "l1", &"ab".repeat(32), now + 3_000_000)
            .unwrap()
    );
    // Unreturned, a login dies at ten minutes.
    let mut row = login("l2", "d1", now);
    row.expires_ms = now + LOGIN_START_TTL_MS;
    store.start_login(&row, now).unwrap();
    assert!(
        store
            .take_login("l2", &"ab".repeat(32), now + LOGIN_START_TTL_MS)
            .unwrap()
            .is_none()
    );
}

#[test]
fn two_processes_migrating_a_version_1_store_at_once_both_open_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shared").join("person.sqlite3");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    {
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE decisions (id TEXT PRIMARY KEY NOT NULL, for_json TEXT NOT NULL,
                     command TEXT NOT NULL, input_digest TEXT NOT NULL, properties TEXT NOT NULL,
                     spaces TEXT NOT NULL, chain TEXT NOT NULL, trace_id TEXT,
                     created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, status TEXT NOT NULL,
                     decided_ms INTEGER, auth_time_ms INTEGER, acr TEXT, preview_hash TEXT) WITHOUT ROWID;
                 CREATE TABLE logins (id TEXT PRIMARY KEY NOT NULL, decision TEXT NOT NULL,
                     verifier TEXT NOT NULL, nonce TEXT NOT NULL, browser_hash TEXT NOT NULL,
                     created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, status TEXT NOT NULL,
                     auth_time_ms INTEGER, acr TEXT, preview_hash TEXT,
                     preview_ok INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
                 PRAGMA journal_mode = WAL;
                 PRAGMA user_version = 1;",
            )
            .unwrap();
    }
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                SqlitePerson::new(&path, 5_000)
                    .decision("none")
                    .map(|found| found.is_none())
            })
        })
        .collect();
    for handle in handles {
        assert!(handle.join().unwrap().unwrap());
    }
}
