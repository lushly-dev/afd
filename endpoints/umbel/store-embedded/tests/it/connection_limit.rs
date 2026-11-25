//! `store.max_connections` (Umbel decision D204): the stores of one host share a cap on the
//! threads at work on their SQLite connections, a new store's first open and the settings reads
//! included; past it a call waits up to the lock timeout, then answers `Busy`, and runs once a
//! turn is free.

use std::time::{Duration, Instant};

use umbel_store::StoreError;
use umbel_store_embedded::{ConnectionLimit, SqliteMemoryStore, SqliteStore, StoreOptions};

const OPTIONS: StoreOptions = StoreOptions {
    lock_timeout_ms: 150,
};

/// Wait until no turn of `limit` is held.
fn until_free(limit: &ConnectionLimit) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while limit.in_use() > 0 {
        assert!(Instant::now() < deadline, "every turn came back");
        std::thread::yield_now();
    }
}

#[test]
fn a_store_call_past_the_cap_waits_the_lock_timeout_then_answers_busy() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let limit = ConnectionLimit::new(1);
    let store =
        SqliteStore::open_with_limit(dir.path(), "main", OPTIONS, limit.clone()).expect("opening");
    store.info().expect("a free turn serves the call");

    let hold = limit.hold();
    let started = Instant::now();
    assert_eq!(store.info().map(drop), Err(StoreError::Busy));
    assert!(
        started.elapsed() >= Duration::from_millis(150),
        "the call waited the lock timeout first"
    );
    // The memory store of the same host shares the cap, its settings reads included.
    let memory = SqliteMemoryStore::open(dir.path(), "main", OPTIONS)
        .expect("opening")
        .with_connection_limit(limit.clone());
    assert_eq!(memory.info().map(drop), Err(StoreError::Busy));
    assert_eq!(memory.keys_info().map(drop), Err(StoreError::Busy));

    drop(hold);
    until_free(&limit);
    store.info().expect("the turn is free again");
    assert_eq!(
        memory.info().map(drop),
        Err(StoreError::NotProvisioned),
        "with a turn, the memory read answers as before"
    );
    assert_eq!(limit.in_use(), 0, "every call gave its turn back");
}

#[test]
fn a_new_stores_first_open_waits_for_a_turn_too() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let limit = ConnectionLimit::new(1);
    let hold = limit.hold();
    let refused = SqliteStore::open_with_limit(dir.path(), "main", OPTIONS, limit.clone());
    assert_eq!(refused.map(drop), Err(StoreError::Busy));
    assert!(
        !dir.path().join("store").join("store.sqlite3").exists(),
        "no database was made without a turn"
    );
    drop(hold);
    until_free(&limit);
    SqliteStore::open_with_limit(dir.path(), "main", OPTIONS, limit.clone())
        .expect("with a turn the store opens");
    assert_eq!(limit.in_use(), 0);
}

#[test]
fn a_store_without_a_limit_is_not_capped() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let limit = ConnectionLimit::new(1);
    let _hold = limit.hold();
    let store = SqliteStore::open(dir.path(), "main", OPTIONS).expect("opening");
    store.info().expect("no limit, no wait");
}
