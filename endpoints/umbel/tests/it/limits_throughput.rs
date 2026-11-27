//! A load test of `/mcp` in mode `oauth` with the per-IP limit (layer 3) and the per-token limit
//! (layer 6) on, over real sockets (#1776, D216).
//!
//! Ignored by default; run in release mode:
//! `cargo test --release --locked -p umbel --test it limits_throughput -- --ignored --nocapture`
//!
//! Each of `workers` clients keeps one HTTP/1.1 connection open from its own loopback address
//! (`127.0.0.<n>`, so each is its own layer-3 key, or `127.0.0.1` where the system binds no
//! other) with its own token subject (its own layer-6 key), and sends `tools/call fixture-whoami`
//! back to back. Both limits are set far above what the run sends, so every request is counted
//! and none is refused. A second pass sends `GET /health`, which meets layers 1 to 3 only, so it
//! times the per-IP limit on the socket path without the MCP service. Prints requests per second
//! and latency percentiles, with no thresholds.
use crate::support::oauth::{Running, Setup};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper_util::rt::TokioIo;
use serde_json::json;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

/// Requests each worker sends after its warm-up.
const PER_WORKER: usize = 300;
/// Requests each worker sends before timing starts.
const WARM_UP: usize = 20;

fn percentile(sorted: &[Duration], p: usize) -> Duration {
    sorted[(sorted.len() * p / 100).min(sorted.len() - 1)]
}

/// One worker: a connection from `local`, `PER_WORKER + WARM_UP` requests (`tools/call` with
/// `token`, or `GET /health` without one), the timed latencies.
async fn worker(server: SocketAddr, local: Ipv4Addr, token: Option<String>) -> Vec<Duration> {
    let mut socket = tokio::net::TcpSocket::new_v4().unwrap();
    if socket.bind(SocketAddr::new(local.into(), 0)).is_err() {
        // macOS answers only 127.0.0.1 unless the others are aliased (`ifconfig lo0 alias`):
        // every worker then shares one layer-3 key, which the high limit still admits.
        socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket
            .bind(SocketAddr::new(Ipv4Addr::LOCALHOST.into(), 0))
            .unwrap();
    }
    let stream = socket.connect(server).await.unwrap();
    stream.set_nodelay(true).unwrap();
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .unwrap();
    tokio::spawn(connection);
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "fixture-whoami",
            "arguments": {},
            "_meta": umbel::testkit::mcp::modern_meta(),
        },
    })
    .to_string();
    let mut timed = Vec::with_capacity(PER_WORKER);
    for at in 0..PER_WORKER + WARM_UP {
        let request = match &token {
            Some(token) => http::Request::post("/mcp")
                .header("host", "127.0.0.1")
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .header("mcp-protocol-version", "2026-07-28")
                .header("mcp-method", "tools/call")
                .header("mcp-name", "fixture-whoami")
                .header("authorization", format!("Bearer {token}"))
                .body(Full::new(Bytes::from(body.clone()))),
            None => http::Request::get("/health")
                .header("host", "127.0.0.1")
                .body(Full::new(Bytes::new())),
        }
        .unwrap();
        sender.ready().await.unwrap();
        let started = Instant::now();
        let response = sender.send_request(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let elapsed = started.elapsed();
        assert_eq!(status, 200, "{}", String::from_utf8_lossy(&bytes));
        if at >= WARM_UP {
            timed.push(elapsed);
        }
    }
    timed
}

async fn run(running: &Running, workers: u8, mcp: bool) {
    let tasks: Vec<_> = (0..workers)
        .map(|n| {
            let token = mcp.then(|| {
                running
                    .token()
                    .lifetime(3600)
                    .subject(&format!("load-{n}"))
                    .sign()
            });
            tokio::spawn(worker(
                running.served.address,
                Ipv4Addr::new(127, 0, 0, 10 + n),
                token,
            ))
        })
        .collect();
    let started = Instant::now();
    let mut latencies = Vec::new();
    for task in tasks {
        latencies.extend(task.await.unwrap());
    }
    // The warm-up overlaps the start of the clock: a lower bound on throughput.
    let elapsed = started.elapsed();
    latencies.sort();
    #[allow(clippy::cast_precision_loss)]
    let per_second = (usize::from(workers) * (PER_WORKER + WARM_UP)) as f64 / elapsed.as_secs_f64();
    println!(
        "limits_throughput {:<7} workers={workers:>3} requests={:>6} {per_second:>8.0} req/s  p50={:>7.2?} p90={:>7.2?} p99={:>7.2?}",
        if mcp { "/mcp" } else { "/health" },
        usize::from(workers) * PER_WORKER,
        percentile(&latencies, 50),
        percentile(&latencies, 90),
        percentile(&latencies, 99),
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore = "load test of /mcp with the limits on; run in release with --ignored --nocapture"]
async fn mcp_requests_per_second_with_the_limits_on() {
    let running = Running::start(Setup {
        rest: "[limits]\nip_requests_per_minute = 100000000\ncalls_per_minute = 100000000\n",
        ..Setup::default()
    })
    .await;
    for mcp in [true, false] {
        for workers in [1, 8, 32, 64] {
            run(&running, workers, mcp).await;
        }
    }
}
