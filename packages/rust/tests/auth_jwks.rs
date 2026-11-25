//! `JwksKeySource`: the host loads the JWKS, AFD caches it (`spec/authorization.md`, M3 rule 3),
//! as TypeScript's `jwksKeySource(load, options)` does: the maximum age, the last good keys kept
//! while loads fail, the maximum staleness, an unknown `kid` refetched at most once per interval
//! per issuer, and concurrent callers sharing one load. Time is a manual clock.
#![cfg(feature = "server-auth")]

mod common;

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Context;

use afd::server::auth::{
    JwksKeySource, JwksKeySourceOptions, JwksLoader, JwtIssuer, JwtVerifier, KeyError, KeySource,
    RuleCode,
};
use afd::{fixed_clock, ManualClock};
use async_trait::async_trait;
use common::auth::*;
use futures_util::future::join_all;
use futures_util::task::noop_waker;
use futures_util::FutureExt;
use serde_json::{json, Value};
use tokio::sync::Semaphore;

const A: &str = "https://a.example.com";
const B: &str = "https://b.example.com";

/// A host loader: serves `document` (an error while it is `None`), counts its calls per issuer,
/// and, when gated, waits for a permit before answering.
#[derive(Clone, Default)]
struct Loader {
    document: Arc<Mutex<Option<Value>>>,
    calls: Arc<Mutex<Vec<String>>>,
    gate: Option<Arc<Semaphore>>,
    panics: Arc<AtomicUsize>,
}

impl Loader {
    fn serving(document: Value) -> Self {
        let loader = Self::default();
        loader.publish(Some(document));
        loader
    }

    fn gated(document: Value) -> (Self, Arc<Semaphore>) {
        let gate = Arc::new(Semaphore::new(0));
        let loader = Self {
            gate: Some(gate.clone()),
            ..Self::serving(document)
        };
        (loader, gate)
    }

    fn publish(&self, document: Option<Value>) {
        *self.document.lock().unwrap() = document;
    }

    fn calls(&self) -> usize {
        self.calls.lock().unwrap().len()
    }

    fn calls_for(&self, issuer: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|i| *i == issuer)
            .count()
    }
}

#[async_trait]
impl JwksLoader for Loader {
    async fn load(&self, issuer: &str) -> Result<Value, String> {
        self.calls.lock().unwrap().push(issuer.to_owned());
        if let Some(gate) = &self.gate {
            let _permit = gate.acquire().await.unwrap();
        }
        if self.panics.load(Ordering::SeqCst) > 0 {
            self.panics.fetch_sub(1, Ordering::SeqCst);
            panic!("the host's loader panicked");
        }
        self.document
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "the JWKS endpoint is down".to_owned())
    }
}

fn key(kid: &str) -> Value {
    json!({ "kid": kid, "kty": "EC", "crv": "P-256", "x": "AA", "y": "AA" })
}

fn document(kids: &[&str]) -> Value {
    json!({ "keys": kids.iter().map(|kid| key(kid)).collect::<Vec<_>>() })
}

fn options(clock: &ManualClock) -> JwksKeySourceOptions {
    JwksKeySourceOptions::default().with_clock(clock.clone())
}

fn source(loader: &Loader, options: JwksKeySourceOptions) -> JwksKeySource {
    JwksKeySource::new(loader.clone(), options).unwrap()
}

async fn kid_of(keys: &JwksKeySource, issuer: &str, kid: &str) -> Result<String, KeyError> {
    keys.key(issuer, kid)
        .await
        .map(|jwk| jwk.kid().unwrap().to_owned())
}

// ─── Loading and the maximum age ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn loads_once_then_again_for_an_unknown_kid_at_most_once_per_interval() {
    let clock = fixed_clock(1_000_000);
    let loader = Loader::serving(document(&["k1"]));
    let keys = source(
        &loader,
        options(&clock).with_min_refetch_interval_ms(30_000),
    );
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    assert_eq!(kid_of(&keys, A, "made-up-1").await, Err(KeyError::Unknown));
    assert_eq!(kid_of(&keys, A, "made-up-2").await, Err(KeyError::Unknown));
    assert_eq!(loader.calls(), 1);
    clock.advance(29_999);
    assert_eq!(kid_of(&keys, A, "made-up-3").await, Err(KeyError::Unknown));
    assert_eq!(loader.calls(), 1);
    clock.advance(1);
    assert_eq!(kid_of(&keys, A, "made-up-4").await, Err(KeyError::Unknown));
    assert_eq!(loader.calls(), 2);
    // A key rotated in is found by the refetch its unknown `kid` causes.
    clock.advance(30_000);
    loader.publish(Some(document(&["k1", "k2"])));
    assert_eq!(kid_of(&keys, A, "k2").await.unwrap(), "k2");
    assert_eq!(loader.calls(), 3);
}

#[tokio::test]
async fn loaded_keys_are_used_for_the_maximum_age_then_loaded_again() {
    let clock = fixed_clock(0);
    let loader = Loader::serving(document(&["old"]));
    let keys = source(
        &loader,
        options(&clock)
            .with_max_age_ms(1_000)
            .with_min_refetch_interval_ms(500),
    );
    assert_eq!(kid_of(&keys, A, "old").await.unwrap(), "old");
    loader.publish(Some(document(&["new"])));
    clock.advance(999);
    assert_eq!(kid_of(&keys, A, "old").await.unwrap(), "old");
    assert_eq!(loader.calls(), 1);
    clock.advance(1);
    // Past the maximum age the keys are loaded again, and the withdrawn key is gone. Its unknown
    // `kid` does not load a third time inside the refetch interval.
    assert_eq!(kid_of(&keys, A, "old").await, Err(KeyError::Unknown));
    assert_eq!(kid_of(&keys, A, "new").await.unwrap(), "new");
    assert_eq!(loader.calls(), 2);
    // A maximum age shorter than the refetch interval waits for the interval, as in TypeScript.
    let slow = Loader::serving(document(&["k1"]));
    let keys = source(&slow, options(&clock).with_max_age_ms(1_000));
    kid_of(&keys, A, "k1").await.unwrap();
    clock.advance(29_999);
    kid_of(&keys, A, "k1").await.unwrap();
    assert_eq!(slow.calls(), 1);
    clock.advance(1);
    kid_of(&keys, A, "k1").await.unwrap();
    assert_eq!(slow.calls(), 2);
}

// ─── Failures: the last good keys, the maximum staleness ─────────────────────────────────────

#[tokio::test]
async fn keeps_the_last_good_keys_when_a_later_load_fails() {
    let clock = fixed_clock(0);
    let loader = Loader::serving(document(&["k1"]));
    let keys = source(
        &loader,
        options(&clock)
            .with_max_age_ms(1_000)
            .with_min_refetch_interval_ms(0),
    );
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    loader.publish(None);
    clock.advance(5_000);
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    // An unknown `kid` whose refetch fails is `unavailable`, never `unknown`.
    assert_eq!(
        kid_of(&keys, A, "rotated-in").await,
        Err(KeyError::Unavailable)
    );
    // A document that is not a key set, and a panic, fail the load the same way.
    for bad in [
        json!({}),
        json!({ "keys": {} }),
        json!({ "keys": [{ "kty": "EC" }] }),
        json!({ "keys": [{ "kid": "" }] }),
        json!({ "keys": ["k1"] }),
        json!({ "keys": [key("k1"), key("k1")] }),
    ] {
        loader.publish(Some(bad.clone()));
        clock.advance(5_000);
        assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1", "{bad}");
        assert_eq!(
            kid_of(&keys, A, "rotated-in").await,
            Err(KeyError::Unavailable),
            "{bad}"
        );
    }
    loader.publish(Some(document(&["k1", "rotated-in"])));
    loader.panics.store(1, Ordering::SeqCst);
    clock.advance(5_000);
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    // The panicked load is over: the next one runs and finds the rotated key.
    assert_eq!(kid_of(&keys, A, "rotated-in").await.unwrap(), "rotated-in");
}

#[tokio::test]
async fn unavailable_once_the_last_good_keys_are_older_than_the_maximum_staleness() {
    let clock = fixed_clock(0);
    let loader = Loader::serving(document(&["k1"]));
    let keys = source(
        &loader,
        options(&clock)
            .with_max_age_ms(1_000)
            .with_max_stale_ms(10_000)
            .with_min_refetch_interval_ms(0),
    );
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    loader.publish(None);
    clock.advance(9_999);
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    clock.advance(1);
    assert_eq!(kid_of(&keys, A, "k1").await, Err(KeyError::Unavailable));
    // A load that succeeds again restores it.
    loader.publish(Some(document(&["k1"])));
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
}

#[tokio::test]
async fn unavailable_without_good_keys_and_no_load_before_the_interval() {
    let clock = fixed_clock(0);
    let loader = Loader::default();
    let keys = source(&loader, options(&clock));
    assert_eq!(kid_of(&keys, A, "k1").await, Err(KeyError::Unavailable));
    assert_eq!(kid_of(&keys, A, "k2").await, Err(KeyError::Unavailable));
    assert_eq!(loader.calls(), 1);
    loader.publish(Some(document(&["k1"])));
    clock.advance(30_000);
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    assert_eq!(loader.calls(), 2);
}

#[tokio::test]
async fn unknown_after_a_failed_age_refresh_unavailable_after_a_failed_miss_refetch() {
    let clock = fixed_clock(0);
    let loader = Loader::serving(document(&["k1"]));
    let keys = source(
        &loader,
        options(&clock)
            .with_max_age_ms(1_000)
            .with_min_refetch_interval_ms(5_000),
    );
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    loader.publish(None);
    // Past the maximum age and the interval: the age-triggered refresh fails, the last good keys
    // stay, and a missing `kid` is `unknown`, since that refresh was the interval's load.
    clock.advance(5_000);
    assert_eq!(kid_of(&keys, A, "rotated-in").await, Err(KeyError::Unknown));
    assert_eq!(loader.calls(), 2);
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    assert_eq!(loader.calls(), 2);
    // Within the maximum age, the miss itself refetches (the interval has passed), and that
    // failure is `unavailable`.
    let fresh = Loader::serving(document(&["k1"]));
    let keys = source(&fresh, options(&clock).with_min_refetch_interval_ms(5_000));
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    fresh.publish(None);
    clock.advance(5_000);
    assert_eq!(
        kid_of(&keys, A, "rotated-in").await,
        Err(KeyError::Unavailable)
    );
    assert_eq!(fresh.calls(), 2);
}

#[test]
fn refuses_a_maximum_staleness_shorter_than_the_maximum_age() {
    let options = JwksKeySourceOptions::default()
        .with_max_age_ms(10)
        .with_max_stale_ms(5);
    let error = JwksKeySource::new(Loader::default(), options).unwrap_err();
    assert!(error.contains("max_stale_ms"), "{error}");
    let equal = JwksKeySourceOptions::default()
        .with_max_age_ms(10)
        .with_max_stale_ms(10);
    assert!(JwksKeySource::new(Loader::default(), equal).is_ok());
}

// ─── Concurrency: one load, and an unknown-`kid` storm ───────────────────────────────────────

/// Waits until the loader has been entered `calls` times, then opens the gate once.
async fn release_after(loader: &Loader, gate: &Semaphore, calls: usize) {
    while loader.calls() < calls {
        tokio::task::yield_now().await;
    }
    gate.add_permits(1);
}

#[tokio::test]
async fn concurrent_callers_share_one_load() {
    let clock = fixed_clock(0);
    let (loader, gate) = Loader::gated(document(&["k1"]));
    let keys = source(&loader, options(&clock));
    let calls = join_all((0..64).map(|_| kid_of(&keys, A, "k1")));
    let (answers, ()) = tokio::join!(calls, release_after(&loader, &gate, 1));
    assert!(answers.iter().all(|answer| answer.as_deref() == Ok("k1")));
    assert_eq!(loader.calls(), 1);
}

#[tokio::test]
async fn concurrent_callers_share_one_failed_load() {
    let clock = fixed_clock(0);
    let (loader, gate) = Loader::gated(document(&["k1"]));
    loader.publish(None);
    let keys = source(&loader, options(&clock));
    let calls = join_all((0..64).map(|_| kid_of(&keys, A, "k1")));
    let (answers, ()) = tokio::join!(calls, release_after(&loader, &gate, 1));
    assert!(answers
        .iter()
        .all(|answer| *answer == Err(KeyError::Unavailable)));
    assert_eq!(loader.calls(), 1);
}

#[tokio::test]
async fn an_unknown_kid_storm_costs_one_load_per_interval() {
    let clock = fixed_clock(0);
    let (loader, gate) = Loader::gated(document(&["k1"]));
    gate.add_permits(1);
    let keys = source(&loader, options(&clock));
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    // Inside the interval of the first load, made-up `kid`s load nothing.
    for n in 0..1_000 {
        let kid = format!("made-up-{n}");
        assert_eq!(kid_of(&keys, A, &kid).await, Err(KeyError::Unknown));
    }
    assert_eq!(loader.calls(), 1);
    // Past it, a concurrent storm shares one refetch, and every caller is `unknown`. The gate is
    // closed again, so the refetch is still running while the storm arrives.
    gate.acquire().await.unwrap().forget();
    clock.advance(30_000);
    let kids: Vec<String> = (0..500).map(|n| format!("storm-{n}")).collect();
    let calls = join_all(kids.iter().map(|kid| kid_of(&keys, A, kid)));
    let (answers, ()) = tokio::join!(calls, release_after(&loader, &gate, 2));
    assert!(answers
        .iter()
        .all(|answer| *answer == Err(KeyError::Unknown)));
    assert_eq!(loader.calls(), 2);
    // The known key is still served, without a load.
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    assert_eq!(loader.calls(), 2);
}

#[tokio::test]
async fn a_load_whose_caller_was_dropped_resumes_with_the_next_caller() {
    let clock = fixed_clock(0);
    let (loader, gate) = Loader::gated(document(&["k1"]));
    let keys = source(&loader, options(&clock));
    // Polled once and dropped: the load has started and waits at the gate.
    assert!(kid_of(&keys, A, "k1").now_or_never().is_none());
    assert_eq!(loader.calls(), 1);
    gate.add_permits(1);
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    assert_eq!(loader.calls(), 1);
}

#[tokio::test]
async fn a_waiter_resuming_after_the_maximum_staleness_gets_unavailable() {
    let clock = fixed_clock(0);
    let (loader, gate) = Loader::gated(document(&["k1"]));
    gate.add_permits(1);
    let keys = source(&loader, options(&clock));
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
    gate.acquire().await.unwrap().forget();
    loader.publish(Some(document(&["k1", "k2"])));
    clock.advance(30_000);
    // Two callers miss `k2`: the first starts the refetch, the second joins it.
    let waker = noop_waker();
    let mut cx = Context::from_waker(&waker);
    let mut first = Box::pin(kid_of(&keys, A, "k2"));
    let mut late = Box::pin(kid_of(&keys, A, "k2"));
    assert!(first.as_mut().poll(&mut cx).is_pending());
    assert!(late.as_mut().poll(&mut cx).is_pending());
    gate.add_permits(1);
    assert_eq!(first.await.unwrap(), "k2");
    assert_eq!(loader.calls(), 2);
    // The second resumes only once the keys that load fetched are past the maximum staleness.
    clock.advance(3_600_000);
    assert_eq!(late.await, Err(KeyError::Unavailable));
}

/// A hand-written loader whose first `load` panics before it returns a future.
struct EagerPanic(AtomicUsize);

impl JwksLoader for EagerPanic {
    fn load<'a, 'b, 'c>(
        &'a self,
        _issuer: &'b str,
    ) -> Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'c>>
    where
        'a: 'c,
        'b: 'c,
        Self: 'c,
    {
        if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
            panic!("the host's loader panicked before returning a future");
        }
        Box::pin(async { Ok(document(&["k1"])) })
    }
}

#[tokio::test]
async fn a_loader_that_panics_before_returning_a_future_fails_only_that_load() {
    let clock = fixed_clock(0);
    let keys = JwksKeySource::new(
        EagerPanic(AtomicUsize::new(0)),
        options(&clock).with_min_refetch_interval_ms(0),
    )
    .unwrap();
    assert_eq!(kid_of(&keys, A, "k1").await, Err(KeyError::Unavailable));
    assert_eq!(kid_of(&keys, A, "k1").await.unwrap(), "k1");
}

// ─── Issuers ─────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn each_issuer_has_its_own_keys_and_intervals() {
    let clock = fixed_clock(0);
    let documents: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(vec![
        (A.to_owned(), document(&["a1"])),
        (B.to_owned(), document(&["b1"])),
    ]));
    let calls = Arc::new(AtomicUsize::new(0));
    let (served, counted) = (documents.clone(), calls.clone());
    // A closure is a loader.
    let loader = move |issuer: &str| {
        counted.fetch_add(1, Ordering::SeqCst);
        let document = served
            .lock()
            .unwrap()
            .iter()
            .find(|(name, _)| name == issuer)
            .map(|(_, document)| document.clone());
        async move { document.ok_or("no such issuer") }
    };
    let keys = JwksKeySource::new(loader, options(&clock)).unwrap();
    let shared = keys.clone();
    assert_eq!(kid_of(&keys, A, "a1").await.unwrap(), "a1");
    // A `kid` of one issuer names no key of another.
    assert_eq!(kid_of(&shared, B, "a1").await, Err(KeyError::Unknown));
    assert_eq!(kid_of(&shared, B, "b1").await.unwrap(), "b1");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    // An unknown-`kid` refetch is limited per issuer: B's interval has not passed when A's has.
    clock.advance(30_000);
    assert_eq!(kid_of(&keys, A, "made-up").await, Err(KeyError::Unknown));
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    let unknown =
        JwksKeySource::new(|_: &str| async { Err::<Value, _>("down") }, options(&clock)).unwrap();
    assert_eq!(kid_of(&unknown, A, "a1").await, Err(KeyError::Unavailable));
}

#[tokio::test]
async fn the_loader_is_asked_for_the_issuer_it_serves() {
    let clock = fixed_clock(0);
    let loader = Loader::serving(document(&["k1"]));
    let keys = source(&loader, options(&clock));
    kid_of(&keys, A, "k1").await.unwrap();
    kid_of(&keys, B, "k1").await.unwrap();
    assert_eq!((loader.calls_for(A), loader.calls_for(B)), (1, 1));
}

// ─── Through the verifier ────────────────────────────────────────────────────────────────────

fn verifier_over(loader: &Loader) -> JwtVerifier {
    let keys = JwksKeySource::new(loader.clone(), JwksKeySourceOptions::default()).unwrap();
    let issuer = JwtIssuer::new("auth", ISSUER, every_algorithm(), keys).unwrap();
    JwtVerifier::new(rules(), vec![issuer])
        .unwrap()
        .with_clock(fixed_clock(NOW * 1000))
}

#[tokio::test]
async fn the_verifier_reads_keys_through_it() {
    let loader = Loader::serving(jwks());
    let verifier = verifier_over(&loader);
    for (alg, kid, key) in [("RS256", "rsa", rsa()), ("ES256", "ec256", ec256())] {
        let token = valid_token(key, alg, kid);
        let credentials = verifier.verify_token(&token, None).await.unwrap();
        assert_eq!(credentials.subject, "user-1");
    }
    let unknown = valid_token(rsa(), "RS256", "made-up");
    let refusal = verifier.verify_token(&unknown, None).await.unwrap_err();
    assert_eq!(refusal.rule, RuleCode::Key);
    assert_eq!(loader.calls_for(ISSUER), 1);
    let down = Loader::default();
    let refusal = verifier_over(&down)
        .verify_token(&valid_token(rsa(), "RS256", "rsa"), None)
        .await
        .unwrap_err();
    assert_eq!(refusal.rule, RuleCode::Unavailable);
}
