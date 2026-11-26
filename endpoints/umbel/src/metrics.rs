//! Metrics per command (D217): how many calls ran, how many failed and how long they took, in the
//! Prometheus text exposition format (version 0.0.4).
//!
//! The host always counts: the outermost middleware ([`middleware`]) adds to one fixed series per
//! registered command, so a count is a few atomic additions and the labels are bounded by the
//! registry. A command name is never read from a caller: the series are made once, when the
//! middleware is installed, from the sealed registry, and a name outside them is not counted.
//!
//! Nothing is exposed unless the operator asks: `umbel serve --metrics-bind <addr>` (or
//! `UMBEL_METRICS_BIND`) serves `GET /metrics` on a listener of its own, on a loopback address
//! only, without authentication but with a `Host` check against DNS rebinding (D217). The series
//! carry the command name and the outcome and nothing else: no principal, no space, no input, no
//! result, no error text.
//!
//! **Outcomes.** `ok`; `held` for `APPROVAL_REQUIRED`, a call held for an approval that a client
//! may run again once approved, so an approved call is one `held` and one `ok`, not an error; and
//! `error` for every other failure, including a call the registry dropped (a timeout, a panic, a
//! caller that went away), which the layer still counts and logs on its way out.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use afd::{BoxFuture, CommandContext, CommandMiddleware, CommandResult, MiddlewareNext};
use serde_json::Value;

/// The upper bounds of the duration histogram, in seconds (Prometheus' default buckets, which
/// span a cache read to a long plugin call).
const BUCKETS: [f64; 11] = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

/// The content type of the text exposition format.
#[cfg(feature = "cli")]
pub(crate) const CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";

/// One command's counters.
#[derive(Default)]
struct Series {
    ok: AtomicU64,
    held: AtomicU64,
    error: AtomicU64,
    /// Calls per bucket, not cumulative; the last is `+Inf`'s own.
    buckets: [AtomicU64; BUCKETS.len() + 1],
    /// The sum of durations, in microseconds.
    sum_micros: AtomicU64,
}

/// How a call ended, as the `outcome` label names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    Ok,
    Held,
    Error,
}

impl Outcome {
    /// The outcome of `result`.
    pub(crate) fn of(result: &CommandResult<Value>) -> Self {
        if result.success {
            Self::Ok
        } else if result
            .error
            .as_ref()
            .is_some_and(|error| error.code == afd::error_codes::APPROVAL_REQUIRED)
        {
            Self::Held
        } else {
            Self::Error
        }
    }
}

/// Every registered command's counters, fixed when the middleware is installed.
#[derive(Default)]
pub(crate) struct Metrics {
    series: BTreeMap<String, Series>,
}

impl Metrics {
    /// One series per name in `commands`, the sealed registry's.
    pub(crate) fn new<I: IntoIterator<Item = String>>(commands: I) -> Self {
        Self {
            series: commands
                .into_iter()
                .map(|name| (name, Series::default()))
                .collect(),
        }
    }

    /// Count one finished call of `command`. A name with no series is not counted.
    pub(crate) fn record(&self, command: &str, outcome: Outcome, elapsed: std::time::Duration) {
        let Some(series) = self.series.get(command) else {
            return;
        };
        match outcome {
            Outcome::Ok => &series.ok,
            Outcome::Held => &series.held,
            Outcome::Error => &series.error,
        }
        .fetch_add(1, Ordering::Relaxed);
        let seconds = elapsed.as_secs_f64();
        let bucket = BUCKETS
            .iter()
            .position(|bound| seconds <= *bound)
            .unwrap_or(BUCKETS.len());
        series.buckets[bucket].fetch_add(1, Ordering::Relaxed);
        let micros = u64::try_from(elapsed.as_micros()).unwrap_or(u64::MAX);
        series.sum_micros.fetch_add(micros, Ordering::Relaxed);
    }

    /// The text exposition: `umbel_command_calls_total` by command and outcome, and the
    /// `umbel_command_duration_seconds` histogram by command, in command order. A command that
    /// has not run is listed at zero, so a scrape sees every series from the start.
    pub(crate) fn render(&self) -> String {
        let mut text = String::new();
        text.push_str(
            "# HELP umbel_command_calls_total Command calls that finished, by command and outcome.\n",
        );
        text.push_str("# TYPE umbel_command_calls_total counter\n");
        for (name, series) in &self.series {
            let name = label(name);
            for (outcome, count) in [
                ("ok", &series.ok),
                ("held", &series.held),
                ("error", &series.error),
            ] {
                let _ = writeln!(
                    text,
                    "umbel_command_calls_total{{command=\"{name}\",outcome=\"{outcome}\"}} {}",
                    count.load(Ordering::Relaxed)
                );
            }
        }
        text.push_str(
            "# HELP umbel_command_duration_seconds How long command calls took, by command.\n",
        );
        text.push_str("# TYPE umbel_command_duration_seconds histogram\n");
        for (name, series) in &self.series {
            let name = label(name);
            let mut cumulative = 0u64;
            for (index, count) in series.buckets.iter().enumerate() {
                cumulative += count.load(Ordering::Relaxed);
                let bound = BUCKETS
                    .get(index)
                    .map_or_else(|| "+Inf".to_owned(), ToString::to_string);
                let _ = writeln!(
                    text,
                    "umbel_command_duration_seconds_bucket{{command=\"{name}\",le=\"{bound}\"}} {cumulative}"
                );
            }
            #[allow(clippy::cast_precision_loss)]
            let sum = series.sum_micros.load(Ordering::Relaxed) as f64 / 1_000_000.0;
            let _ = writeln!(
                text,
                "umbel_command_duration_seconds_sum{{command=\"{name}\"}} {sum}"
            );
            let _ = writeln!(
                text,
                "umbel_command_duration_seconds_count{{command=\"{name}\"}} {cumulative}"
            );
        }
        text
    }
}

/// A label value escaped as the text format requires: backslash, double quote and line feed.
fn label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

/// One call in flight. Finished, it records the result; dropped unfinished (the registry's
/// timeout or a caller that went away dropped the call, or a panic unwound through it), it
/// records an error with `COMMAND_EXECUTION_ERROR` for a panic and `COMMAND_CANCELLED` otherwise.
struct InFlight {
    metrics: Arc<Metrics>,
    command: String,
    request_id: String,
    trace_id: Option<String>,
    started: Instant,
    done: bool,
}

impl InFlight {
    fn finish(&mut self, outcome: Outcome, code: &str, abandoned: bool) {
        self.done = true;
        let elapsed = self.started.elapsed();
        self.metrics.record(&self.command, outcome, elapsed);
        crate::logging::log_call(&crate::logging::Call {
            command: &self.command,
            request_id: &self.request_id,
            trace_id: self.trace_id.as_deref(),
            elapsed,
            success: outcome == Outcome::Ok,
            code,
            abandoned,
        });
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        if !self.done {
            let code = if std::thread::panicking() {
                afd::error_codes::COMMAND_EXECUTION_ERROR
            } else {
                afd::error_codes::COMMAND_CANCELLED
            };
            self.finish(Outcome::Error, code, true);
        }
    }
}

/// The outermost middleware: times every call of a registered command, counts it in `metrics`
/// and writes its line (`crate::logging::log_call`). Outermost, so the duration and the outcome
/// are what the caller got, refusals by the inner layers included. A call without a request id
/// gets one here, so the calls it makes (a pipeline's steps, a batch's items) share it.
pub(crate) fn middleware(metrics: Arc<Metrics>) -> CommandMiddleware {
    Arc::new(
        move |name: String,
              _input: Arc<Value>,
              mut context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let request_id = crate::logging::request_id(&context);
            context
                .extra
                .entry(crate::logging::REQUEST_ID_KEY.to_owned())
                .or_insert_with(|| Value::String(request_id.clone()));
            let mut call = InFlight {
                metrics: Arc::clone(&metrics),
                command: name,
                request_id,
                trace_id: context.trace_id.clone(),
                started: Instant::now(),
                done: false,
            };
            Box::pin(async move {
                let result = next(context).await;
                let code = result
                    .error
                    .as_ref()
                    .map_or_else(String::new, |error| error.code.clone());
                call.finish(Outcome::of(&result), &code, false);
                result
            })
        },
    )
}

/// Parse `--metrics-bind` or `UMBEL_METRICS_BIND` (`source` names which): a socket address on a
/// loopback interface.
///
/// # Errors
/// The sentence to show: the value is not an address, or not a loopback one.
#[cfg(feature = "cli")]
pub(crate) fn parse_bind(value: &str, source: &str) -> Result<std::net::SocketAddr, String> {
    let address: std::net::SocketAddr = value.parse().map_err(|_| {
        format!("{source} is \"{value}\", which is not an address such as 127.0.0.1:9464")
    })?;
    if !address.ip().to_canonical().is_loopback() {
        return Err(format!(
            "{source} is \"{value}\": the metrics listener binds a loopback address only, since it has no authentication"
        ));
    }
    Ok(address)
}

/// Whether a request's `Host` names a loopback host (`localhost`, `127.0.0.1`, `[::1]`, with any
/// port), so a page on a name a rebinding DNS answer points at loopback cannot read it.
#[cfg(feature = "cli")]
fn loopback_host(headers: &axum::http::HeaderMap) -> bool {
    let Some(host) = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or_default()
    } else {
        host.split(':').next().unwrap_or_default()
    };
    name.eq_ignore_ascii_case("localhost")
        || name
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.to_canonical().is_loopback())
}

/// Serve `GET /metrics` from `metrics` on `listener` until `until` resolves; every other path
/// is 404, every other method 405, and a `Host` that is not a loopback host 421.
///
/// # Errors
/// The listener's I/O error.
#[cfg(feature = "cli")]
pub(crate) async fn serve(
    listener: tokio::net::TcpListener,
    metrics: Arc<Metrics>,
    until: impl std::future::Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let router = axum::Router::new().route(
        "/metrics",
        axum::routing::get(move |headers: axum::http::HeaderMap| {
            let metrics = Arc::clone(&metrics);
            async move {
                use axum::response::IntoResponse;
                if !loopback_host(&headers) {
                    return axum::http::StatusCode::MISDIRECTED_REQUEST.into_response();
                }
                (
                    [(axum::http::header::CONTENT_TYPE, CONTENT_TYPE)],
                    metrics.render(),
                )
                    .into_response()
            }
        }),
    );
    axum::serve(listener, router)
        .with_graceful_shutdown(until)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_call_lands_in_its_buckets_and_its_outcome() {
        let metrics = Metrics::new(["a-one".to_owned(), "b-two".to_owned()]);
        metrics.record("a-one", Outcome::Ok, Duration::from_millis(30));
        metrics.record("a-one", Outcome::Error, Duration::from_secs(20));
        metrics.record("a-one", Outcome::Held, Duration::from_millis(1));
        metrics.record("not-registered", Outcome::Ok, Duration::from_millis(1));
        let text = metrics.render();
        for (outcome, count) in [("ok", 1), ("held", 1), ("error", 1)] {
            let line = format!(
                "umbel_command_calls_total{{command=\"a-one\",outcome=\"{outcome}\"}} {count}\n"
            );
            assert!(text.contains(&line), "{line} in {text}");
        }
        assert!(text.contains("umbel_command_calls_total{command=\"b-two\",outcome=\"ok\"} 0\n"));
        for (bound, count) in [
            ("0.005", 1),
            ("0.025", 1),
            ("0.05", 2),
            ("10", 2),
            ("+Inf", 3),
        ] {
            let line = format!(
                "umbel_command_duration_seconds_bucket{{command=\"a-one\",le=\"{bound}\"}} {count}\n"
            );
            assert!(text.contains(&line), "{line} in {text}");
        }
        assert!(text.contains("umbel_command_duration_seconds_sum{command=\"a-one\"} 20.031\n"));
        assert!(text.contains("umbel_command_duration_seconds_count{command=\"a-one\"} 3\n"));
        // A name the registry never had makes no series.
        assert!(!text.contains("not-registered"));
    }

    #[test]
    fn an_approval_hold_is_its_own_outcome() {
        let held = afd::failure::<Value>(afd::CommandError::new(
            afd::error_codes::APPROVAL_REQUIRED,
            "held",
        ));
        assert_eq!(Outcome::of(&held), Outcome::Held);
        let refused =
            afd::failure::<Value>(afd::CommandError::new(afd::error_codes::TIMEOUT, "late"));
        assert_eq!(Outcome::of(&refused), Outcome::Error);
        assert_eq!(Outcome::of(&afd::success(Value::Null)), Outcome::Ok);
    }

    #[test]
    fn a_call_dropped_before_it_answers_counts_as_an_error() {
        let metrics = Arc::new(Metrics::new(["a-one".to_owned()]));
        drop(InFlight {
            metrics: Arc::clone(&metrics),
            command: "a-one".to_owned(),
            request_id: "r".to_owned(),
            trace_id: None,
            started: Instant::now(),
            done: false,
        });
        let text = metrics.render();
        assert!(
            text.contains("umbel_command_calls_total{command=\"a-one\",outcome=\"error\"} 1\n"),
            "{text}"
        );
        assert!(text.contains("umbel_command_duration_seconds_count{command=\"a-one\"} 1\n"));
    }

    #[test]
    fn label_values_are_escaped() {
        assert_eq!(label("a\"b\\c\nd"), "a\\\"b\\\\c\\nd");
    }

    #[cfg(feature = "cli")]
    #[test]
    fn only_a_loopback_address_is_accepted() {
        for loopback in ["127.0.0.1:9464", "[::1]:9464", "[::ffff:127.0.0.1]:9464"] {
            assert!(parse_bind(loopback, "--metrics-bind").is_ok(), "{loopback}");
        }
        for open in [
            "0.0.0.0:9464",
            "[::]:9464",
            "[::ffff:0.0.0.0]:9464",
            "192.168.1.2:9464",
        ] {
            let message = parse_bind(open, "--metrics-bind").unwrap_err();
            assert!(message.contains("loopback"), "{open}: {message}");
        }
        let named = parse_bind("localhost:9464", "UMBEL_METRICS_BIND").unwrap_err();
        assert!(named.starts_with("UMBEL_METRICS_BIND"), "{named}");
    }

    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn the_listener_serves_the_exposition_and_nothing_else() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let metrics = Arc::new(Metrics::new(["a-one".to_owned()]));
        metrics.record("a-one", Outcome::Ok, Duration::from_millis(2));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let server = tokio::spawn(serve(listener, Arc::clone(&metrics), async {
            let _ = stopped.await;
        }));
        let get = |path: &'static str, host: &'static str| async move {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream
                .write_all(
                    format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n")
                        .as_bytes(),
                )
                .await
                .unwrap();
            let mut reply = String::new();
            stream.read_to_string(&mut reply).await.unwrap();
            reply
        };
        let reply = get("/metrics", "localhost:9464").await;
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        assert!(reply.contains(CONTENT_TYPE), "{reply}");
        assert!(
            reply.contains("umbel_command_calls_total{command=\"a-one\",outcome=\"ok\"} 1"),
            "{reply}"
        );
        for host in ["127.0.0.1:9464", "[::1]:9464", "LOCALHOST"] {
            let reply = get("/metrics", host).await;
            assert!(reply.starts_with("HTTP/1.1 200"), "{host}: {reply}");
        }
        assert!(get("/", "localhost").await.starts_with("HTTP/1.1 404"));
        // A name a rebinding DNS answer points at loopback is refused, and nothing leaks.
        let rebound = get("/metrics", "attacker.example:9464").await;
        assert!(rebound.starts_with("HTTP/1.1 421"), "{rebound}");
        assert!(!rebound.contains("umbel_command"), "{rebound}");
        let _ = stop.send(());
        server.await.unwrap().unwrap();
    }
}
