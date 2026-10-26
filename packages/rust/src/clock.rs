//! Injectable time and randomness for command handlers.
//!
//! Handlers that read the system time or a global random generator directly cannot be tested
//! deterministically or replayed. [`CommandRegistry::execute`](crate::CommandRegistry::execute)
//! puts a clock and a random source on every [`CommandContext`](crate::CommandContext) (the real
//! ones by default), and tests, replays and simulations swap in [`fixed_clock`] and
//! [`seeded_random`].
//!
//! [`seeded_random`] produces the same sequence as TypeScript's `seededRandom` for the same
//! seed: mulberry32, seeded with the FNV-1a (32-bit) hash of the seed's UTF-8 bytes.

use std::collections::hash_map::RandomState;
use std::fmt;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use crate::time::SystemTime;

// ═══════════════════════════════════════════════════════════════════════════════
// TRAITS
// ═══════════════════════════════════════════════════════════════════════════════

/// A source of the current time.
pub trait Clock: Send + Sync {
    /// Milliseconds since the Unix epoch, like TypeScript's `Date.now()`.
    fn now(&self) -> i64;
}

/// A source of random numbers.
pub trait RandomSource: Send + Sync {
    /// A number in `[0, 1)`, like TypeScript's `Math.random()`.
    fn next(&self) -> f64;

    /// The seed this source was created from, when it is seeded (for journals and replay).
    fn seed(&self) -> Option<&str> {
        None
    }
}

impl<C: Clock + ?Sized> Clock for Arc<C> {
    fn now(&self) -> i64 {
        (**self).now()
    }
}

impl<R: RandomSource + ?Sized> RandomSource for Arc<R> {
    fn next(&self) -> f64 {
        (**self).next()
    }

    fn seed(&self) -> Option<&str> {
        (**self).seed()
    }
}

impl fmt::Debug for dyn Clock {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Clock").finish_non_exhaustive()
    }
}

impl fmt::Debug for dyn RandomSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RandomSource")
            .field("seed", &self.seed())
            .finish_non_exhaustive()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM SOURCES
// ═══════════════════════════════════════════════════════════════════════════════

/// The real clock: the system time.
///
/// With the `wasm` feature it reads `Date.now()` through `web-time`, because
/// `std::time::SystemTime::now()` traps on `wasm32-unknown-unknown`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> i64 {
        match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
            Ok(elapsed) => i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX),
            Err(before) => i64::try_from(before.duration().as_millis()).map_or(i64::MIN, |ms| -ms),
        }
    }
}

/// The real random source. Not seeded, so not reproducible.
///
/// A process-wide splitmix64 generator, seeded from the standard library's per-process hash
/// keys and the system time. It is not suitable for secrets: use a cryptographic generator for
/// tokens and keys.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SystemRandom;

impl RandomSource for SystemRandom {
    fn next(&self) -> f64 {
        static STATE: OnceLock<AtomicU64> = OnceLock::new();
        const GOLDEN_GAMMA: u64 = 0x9e37_79b9_7f4a_7c15;
        let state = STATE.get_or_init(|| {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_i64(SystemClock.now());
            AtomicU64::new(hasher.finish())
        });
        let mut z = state
            .fetch_add(GOLDEN_GAMMA, Ordering::Relaxed)
            .wrapping_add(GOLDEN_GAMMA);
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^= z >> 31;
        // The top 53 bits, as an f64 in [0, 1).
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// The real clock (TypeScript `systemClock`).
pub const SYSTEM_CLOCK: SystemClock = SystemClock;

/// The real random source (TypeScript `systemRandom`). Not seeded, so not reproducible.
pub const SYSTEM_RANDOM: SystemRandom = SystemRandom;

// ═══════════════════════════════════════════════════════════════════════════════
// FIXED CLOCK
// ═══════════════════════════════════════════════════════════════════════════════

/// An instant accepted by [`fixed_clock`] and [`ManualClock::set`]: epoch milliseconds or a
/// `chrono` date-time. Parse an ISO 8601 (RFC 3339) string with [`ClockInstant::parse`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct ClockInstant(i64);

impl ClockInstant {
    /// The instant `ms` milliseconds after the Unix epoch.
    pub const fn from_millis(ms: i64) -> Self {
        Self(ms)
    }

    /// Milliseconds since the Unix epoch.
    pub const fn as_millis(self) -> i64 {
        self.0
    }

    /// Parse an RFC 3339 date-time such as `2026-01-01T00:00:00Z`.
    ///
    /// # Errors
    /// Returns a message naming the input when it is not a valid RFC 3339 date-time.
    pub fn parse(text: &str) -> Result<Self, String> {
        chrono::DateTime::parse_from_rfc3339(text)
            .map(|at| Self(at.timestamp_millis()))
            .map_err(|_| format!("Invalid clock instant: {text}"))
    }
}

impl From<i64> for ClockInstant {
    fn from(ms: i64) -> Self {
        Self(ms)
    }
}

impl<Tz: chrono::TimeZone> From<chrono::DateTime<Tz>> for ClockInstant {
    fn from(at: chrono::DateTime<Tz>) -> Self {
        Self(at.timestamp_millis())
    }
}

impl TryFrom<&str> for ClockInstant {
    type Error = String;

    fn try_from(text: &str) -> Result<Self, String> {
        Self::parse(text)
    }
}

/// A clock that only moves when told to, from [`fixed_clock`].
///
/// Clones share the same time, so a test can keep one handle and put another on a context:
///
/// ```rust
/// use afd::{fixed_clock, Clock, CommandContext};
///
/// let clock = fixed_clock(1_000);
/// let context = CommandContext::new().with_clock(clock.clone());
/// clock.advance(500);
/// assert_eq!(context.clock().now(), 1_500);
/// ```
#[derive(Debug, Clone, Default)]
pub struct ManualClock {
    current: Arc<AtomicI64>,
}

impl ManualClock {
    /// Move the clock to `at`.
    pub fn set(&self, at: impl Into<ClockInstant>) {
        self.current.store(at.into().0, Ordering::SeqCst);
    }

    /// Move the clock forward by `ms` milliseconds (backward when negative).
    pub fn advance(&self, ms: i64) {
        // `fetch_update` with a saturating add: an overflow would otherwise wrap the clock.
        let _ = self
            .current
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                Some(current.saturating_add(ms))
            });
    }
}

impl Clock for ManualClock {
    fn now(&self) -> i64 {
        self.current.load(Ordering::SeqCst)
    }
}

/// A clock stopped at `at`. It moves only through [`ManualClock::set`] and
/// [`ManualClock::advance`].
///
/// ```rust
/// use afd::{fixed_clock, Clock, ClockInstant};
///
/// let clock = fixed_clock(ClockInstant::parse("2026-01-01T00:00:00Z").unwrap());
/// assert_eq!(clock.now(), 1_767_225_600_000);
/// ```
pub fn fixed_clock(at: impl Into<ClockInstant>) -> ManualClock {
    ManualClock {
        current: Arc::new(AtomicI64::new(at.into().0)),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEEDED RANDOM
// ═══════════════════════════════════════════════════════════════════════════════

/// A reproducible random source, from [`seeded_random`].
#[derive(Debug)]
pub struct SeededRandom {
    seed: String,
    state: AtomicU32,
}

impl RandomSource for SeededRandom {
    fn next(&self) -> f64 {
        const INCREMENT: u32 = 0x6d2b_79f5;
        // mulberry32, as in TypeScript's `seededRandom`.
        let mut t = self
            .state
            .fetch_add(INCREMENT, Ordering::Relaxed)
            .wrapping_add(INCREMENT);
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }

    fn seed(&self) -> Option<&str> {
        Some(&self.seed)
    }
}

/// FNV-1a (32-bit) over the UTF-8 bytes of `text`.
fn fnv1a(text: &str) -> u32 {
    text.bytes().fold(0x811c_9dc5, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
    })
}

/// A reproducible random source: the same seed always gives the same sequence, the same one
/// TypeScript's `seededRandom` gives.
///
/// The generator is mulberry32, seeded with the FNV-1a (32-bit) hash of the seed's UTF-8 bytes.
/// It is fast and well distributed, and not suitable for secrets.
///
/// ```rust
/// use afd::{seeded_random, RandomSource};
///
/// let random = seeded_random("abc");
/// assert_eq!(random.next(), 0.5166419988963753);
/// assert_eq!(random.seed(), Some("abc"));
/// ```
pub fn seeded_random(seed: impl Into<String>) -> SeededRandom {
    let seed = seed.into();
    SeededRandom {
        state: AtomicU32::new(fnv1a(&seed)),
        seed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_random_matches_the_typescript_golden_values() {
        let random = seeded_random("abc");
        assert_eq!(random.seed(), Some("abc"));
        assert_eq!(
            [random.next(), random.next(), random.next()],
            [
                0.5166419988963753,
                0.6596221292857081,
                0.0018796597141772509
            ]
        );
        assert_eq!(seeded_random("").next(), 0.6112444521859288);
    }

    #[test]
    fn seeded_random_repeats_per_seed_and_differs_between_seeds() {
        let sequence = |seed: &str| {
            let random = seeded_random(seed);
            (0..20).map(|_| random.next()).collect::<Vec<_>>()
        };
        assert_eq!(sequence("replay-1"), sequence("replay-1"));
        assert_ne!(sequence("replay-1"), sequence("replay-2"));
        assert_ne!(sequence("é"), sequence("e"));
    }

    #[test]
    fn random_sources_stay_in_the_unit_interval() {
        let seeded = seeded_random("range");
        for _ in 0..10_000 {
            for value in [seeded.next(), SYSTEM_RANDOM.next()] {
                assert!((0.0..1.0).contains(&value), "{value}");
            }
        }
        assert_eq!(SYSTEM_RANDOM.seed(), None);
    }

    #[test]
    fn system_random_does_not_repeat() {
        let values: Vec<f64> = (0..100).map(|_| SYSTEM_RANDOM.next()).collect();
        let mut unique = values.clone();
        unique.sort_by(f64::total_cmp);
        unique.dedup();
        assert_eq!(unique.len(), values.len());
    }

    #[test]
    fn system_clock_reads_the_system_time() {
        let before = chrono::Utc::now().timestamp_millis();
        let now = SYSTEM_CLOCK.now();
        let after = chrono::Utc::now().timestamp_millis();
        assert!(before <= now && now <= after);
    }

    #[test]
    fn fixed_clock_stays_put_until_moved() {
        let clock = fixed_clock(ClockInstant::parse("2026-01-01T00:00:00Z").unwrap());
        assert_eq!(clock.now(), 1_767_225_600_000);
        assert_eq!(clock.now(), 1_767_225_600_000);

        let clock = fixed_clock(1000);
        clock.advance(500);
        assert_eq!(clock.now(), 1500);
        clock.advance(-1500);
        assert_eq!(clock.now(), 0);
        clock.set(ClockInstant::try_from("1970-01-01T00:00:01.000Z").unwrap());
        assert_eq!(clock.now(), 1000);
        clock.set(chrono::DateTime::from_timestamp_millis(5678).unwrap());
        assert_eq!(clock.now(), 5678);
        clock.set(i64::MAX);
        clock.advance(1);
        assert_eq!(clock.now(), i64::MAX);
    }

    #[test]
    fn fixed_clock_defaults_to_the_epoch_and_clones_share_time() {
        assert_eq!(ManualClock::default().now(), 0);
        let clock = fixed_clock(ClockInstant::default());
        let shared = clock.clone();
        clock.advance(42);
        assert_eq!(shared.now(), 42);
        let as_trait: Arc<dyn Clock> = Arc::new(shared);
        assert_eq!(as_trait.now(), 42);
    }

    #[test]
    fn invalid_instants_are_rejected() {
        assert_eq!(
            ClockInstant::parse("not a date"),
            Err("Invalid clock instant: not a date".to_string())
        );
    }
}
