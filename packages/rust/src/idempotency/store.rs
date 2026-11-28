//! The idempotency step's store (`spec/idempotency.md`, S12): the interface a host may supply,
//! and the default, which keeps everything in memory for this process only.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::result::CommandResult;

/// The state of an [`IdempotencyRecord`] (S6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[non_exhaustive]
pub enum IdempotencyRecordState {
    /// The handler runs, or ran and was never heard from again (S7): live until
    /// [`IdempotencyRecord::lease_ends_at`], never settled after that.
    Reserved,
    /// The handler's result is kept in [`IdempotencyRecord::result`].
    Stored,
    /// Nobody can say whether the call was applied: its handler returned `TIMEOUT` or panicked.
    Unknown,
}

/// What the store holds for one scope (K5: the caller's principal binding, the command and the
/// key). Times are milliseconds on the step's clock, the server's, never the caller's (S8).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdempotencyRecord {
    /// The identity of the reservation this record was made for (S5, S12).
    pub reservation: String,
    /// The call's digest (S4).
    pub digest: String,
    /// When the key was reserved.
    pub reserved_at: i64,
    /// When the record stops answering repeats: `reserved_at + ttl_ms` (S8). Inclusive.
    pub expires_at: i64,
    /// When a reservation still unsettled stops being live and is treated as never settled: the
    /// call's deadline plus `lease_ms`, or `reserved_at + lease_ms` for a call without one (S7).
    /// Inclusive.
    pub lease_ends_at: i64,
    /// Where the call stands.
    pub state: IdempotencyRecordState,
    /// The handler's result, when [`Self::state`] is [`IdempotencyRecordState::Stored`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<CommandResult<Value>>,
}

/// A reservation to make: the record's digest and times, without its identity or state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotencyReservation {
    /// The call's digest (S4).
    pub digest: String,
    /// See [`IdempotencyRecord::reserved_at`].
    pub reserved_at: i64,
    /// See [`IdempotencyRecord::expires_at`].
    pub expires_at: i64,
    /// See [`IdempotencyRecord::lease_ends_at`].
    pub lease_ends_at: i64,
}

impl IdempotencyReservation {
    /// The record this reservation makes, under `reservation`.
    pub fn into_record(self, reservation: impl Into<String>) -> IdempotencyRecord {
        IdempotencyRecord {
            reservation: reservation.into(),
            digest: self.digest,
            reserved_at: self.reserved_at,
            expires_at: self.expires_at,
            lease_ends_at: self.lease_ends_at,
            state: IdempotencyRecordState::Reserved,
            result: None,
        }
    }
}

/// What [`IdempotencyStore::reserve`] did.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum IdempotencyReserveOutcome {
    /// The key was free and is now reserved under this identity, unique to the reservation.
    Reserved(String),
    /// A record that has not expired holds the key; nothing changed.
    Held(Box<IdempotencyRecord>),
}

/// How a reservation is settled (S6).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum IdempotencySettlement {
    /// The handler's result, to keep.
    Result(Box<CommandResult<Value>>),
    /// Never settled: nobody can say whether the call was applied.
    Unknown,
}

/// The store of the idempotency step (`spec/idempotency.md`, S12). Each method is atomic for its
/// scope: of two calls for one scope that find nothing, exactly one reserves, also on a
/// multi-threaded runtime. A store shared by several processes gives the step's promise across
/// them (S13); [`InMemoryIdempotencyStore`] does not.
///
/// An `Err` is the store's own failure. From [`Self::reserve`] it fails the call before its
/// handler runs; from the others it leaves the reservation to its lease (S7), and the
/// handler's result still stands.
#[async_trait]
pub trait IdempotencyStore: Send + Sync {
    /// Reserve the key of `scope` for `request`, unless a record that has not expired at `now`
    /// holds it: then report that record, changing nothing.
    async fn reserve(
        &self,
        scope: &str,
        request: IdempotencyReservation,
        now: i64,
    ) -> Result<IdempotencyReserveOutcome, String>;

    /// Settle `reservation` as `settlement` says. Does nothing when the scope no longer holds
    /// that reservation (it was released, or the key was reserved again).
    async fn complete(
        &self,
        scope: &str,
        reservation: &str,
        settlement: IdempotencySettlement,
    ) -> Result<(), String>;

    /// Remove `reservation`, so a repeat runs. Does nothing when the scope no longer holds it.
    async fn release(&self, scope: &str, reservation: &str) -> Result<(), String>;

    /// The record of `scope` that has not expired at `now`, if any.
    async fn get(&self, scope: &str, now: i64) -> Result<Option<IdempotencyRecord>, String>;
}

/// Reservation identities, unique in this process.
static RESERVATIONS: AtomicU64 = AtomicU64::new(0);

/// A new reservation identity: a process-wide count and, where the OS random source answers,
/// 64 random bits, so identities from two processes sharing a host's store do not collide.
pub(crate) fn next_reservation() -> String {
    let count = RESERVATIONS.fetch_add(1, Ordering::Relaxed) + 1;
    match crate::canonical::new_dispatch_id() {
        Ok(Some(random)) => format!("{count}-{random}"),
        _ => count.to_string(),
    }
}

/// The records of [`InMemoryIdempotencyStore`], with the size of its next sweep.
#[derive(Default)]
struct Records {
    by_scope: HashMap<String, IdempotencyRecord>,
    next_sweep_at: usize,
}

/// The default store: in memory, for this process only. A restart forgets every key, and a
/// repeat that reaches another process finds nothing there (S13). Each method holds one
/// `std::sync::Mutex` for its whole decision and never across an `.await`.
///
/// Expired records are swept on a reservation once the store holds `sweep_at` scopes (default
/// 10,000), and then when it holds twice as many as the last sweep left. It sets no cap on live
/// records.
pub struct InMemoryIdempotencyStore {
    records: Mutex<Records>,
    sweep_at: usize,
}

impl Default for InMemoryIdempotencyStore {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for InMemoryIdempotencyStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InMemoryIdempotencyStore")
            .field("size", &self.len())
            .finish()
    }
}

impl InMemoryIdempotencyStore {
    /// An empty store that sweeps at 10,000 scopes.
    pub fn new() -> Self {
        Self::with_sweep_at(10_000)
    }

    /// An empty store that sweeps expired records once it holds `sweep_at` scopes (at least 1).
    pub fn with_sweep_at(sweep_at: usize) -> Self {
        let sweep_at = sweep_at.max(1);
        Self {
            records: Mutex::new(Records {
                by_scope: HashMap::new(),
                next_sweep_at: sweep_at,
            }),
            sweep_at,
        }
    }

    /// How many scopes the store holds, expired ones included until a sweep.
    pub fn len(&self) -> usize {
        self.lock().by_scope.len()
    }

    /// Whether the store holds no scope.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Records> {
        self.records.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The live record of `scope` in `records`, removing it once expired.
    fn live<'a>(records: &'a mut Records, scope: &str, now: i64) -> Option<&'a IdempotencyRecord> {
        if records
            .by_scope
            .get(scope)
            .is_some_and(|record| now > record.expires_at)
        {
            records.by_scope.remove(scope);
        }
        records.by_scope.get(scope)
    }
}

#[async_trait]
impl IdempotencyStore for InMemoryIdempotencyStore {
    async fn reserve(
        &self,
        scope: &str,
        request: IdempotencyReservation,
        now: i64,
    ) -> Result<IdempotencyReserveOutcome, String> {
        let mut records = self.lock();
        if let Some(held) = Self::live(&mut records, scope, now) {
            return Ok(IdempotencyReserveOutcome::Held(Box::new(held.clone())));
        }
        if records.by_scope.len() >= records.next_sweep_at {
            records
                .by_scope
                .retain(|_, record| now <= record.expires_at);
            // Amortized: a store full of live keys does not scan them on every reservation.
            records.next_sweep_at = self.sweep_at.max(2 * records.by_scope.len());
        }
        let reservation = next_reservation();
        records
            .by_scope
            .insert(scope.to_owned(), request.into_record(reservation.clone()));
        Ok(IdempotencyReserveOutcome::Reserved(reservation))
    }

    async fn complete(
        &self,
        scope: &str,
        reservation: &str,
        settlement: IdempotencySettlement,
    ) -> Result<(), String> {
        let mut records = self.lock();
        if let Some(record) = records
            .by_scope
            .get_mut(scope)
            .filter(|record| record.reservation == reservation)
        {
            match settlement {
                IdempotencySettlement::Result(result) => {
                    record.state = IdempotencyRecordState::Stored;
                    record.result = Some(*result);
                }
                IdempotencySettlement::Unknown => record.state = IdempotencyRecordState::Unknown,
            }
        }
        Ok(())
    }

    async fn release(&self, scope: &str, reservation: &str) -> Result<(), String> {
        let mut records = self.lock();
        if records
            .by_scope
            .get(scope)
            .is_some_and(|record| record.reservation == reservation)
        {
            records.by_scope.remove(scope);
        }
        Ok(())
    }

    async fn get(&self, scope: &str, now: i64) -> Result<Option<IdempotencyRecord>, String> {
        let mut records = self.lock();
        Ok(Self::live(&mut records, scope, now).cloned())
    }
}
