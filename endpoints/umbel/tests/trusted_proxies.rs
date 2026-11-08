//! `http.trusted_proxies` (amendment from phase 5 step 3, settling step 2a's follow-up): a listed
//! peer's connection must open with a PROXY protocol version 2 header, whose client address the
//! per-IP limit keys on; a listed peer's connection without one is refused; no other peer's header
//! is read, and no forwarded header ever is. Configuration version 5 holds the key's rules.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::net::SocketAddr;

use bytes::Bytes;
use support::hosted::{proxy_v2, send_after};
use support::oauth::{Running, Setup};
use umbel_testkit_idp::TestIdp;

const LIMITS: &str = "[limits]\nip_requests_per_minute = 2\n";

fn health(running: &Running) -> http::Request<http_body_util::Full<Bytes>> {
    running.client.request("GET", "/health", &[], Bytes::new())
}

fn client(address: &str) -> SocketAddr {
    address.parse().unwrap()
}

#[tokio::test]
async fn a_trusted_proxys_header_names_the_client_the_ip_limit_keys_on() {
    let running = Running::start(Setup {
        http: "trusted_proxies = [\"127.0.0.1\"]",
        rest: LIMITS,
        ..Setup::default()
    })
    .await;
    let server = running.served.address;
    let first = proxy_v2(client("192.0.2.1:40000"), server);
    for _ in 0..2 {
        let reply = send_after(server, &first, health(&running)).await.unwrap();
        assert_eq!(reply.status, 200, "{}", reply.text);
    }
    // The third from 192.0.2.1 in the minute is refused, from any port of it.
    let again = proxy_v2(client("192.0.2.1:40001"), server);
    let reply = send_after(server, &again, health(&running)).await.unwrap();
    assert_eq!(reply.status, 429, "{}", reply.text);
    // Another client behind the same proxy has its own budget, IPv6 included.
    for other in ["192.0.2.2:40000", "[2001:db8::1]:40000"] {
        let header = proxy_v2(client(other), server);
        let reply = send_after(server, &header, health(&running)).await.unwrap();
        assert_eq!(reply.status, 200, "{other}: {}", reply.text);
    }
    // A forwarded header names no one: the limit still keys on the header's client.
    let mut forged = health(&running);
    forged
        .headers_mut()
        .insert("x-forwarded-for", "192.0.2.9".parse().unwrap());
    forged
        .headers_mut()
        .insert("forwarded", "for=192.0.2.9".parse().unwrap());
    let reply = send_after(server, &again, forged).await.unwrap();
    assert_eq!(reply.status, 429, "{}", reply.text);
}

#[tokio::test]
async fn a_trusted_peers_connection_without_the_header_is_refused() {
    let running = Running::start(Setup {
        http: "trusted_proxies = [\"127.0.0.1\"]",
        rest: LIMITS,
        ..Setup::default()
    })
    .await;
    let server = running.served.address;
    // Plain HTTP from the listed peer: closed, never answered.
    assert!(
        send_after(server, b"", health(&running)).await.is_err(),
        "a listed peer's connection without a header was served"
    );
    // A LOCAL command names no client: refused too.
    let mut local = proxy_v2(client("192.0.2.1:40000"), server);
    local[12] = 0x20;
    assert!(send_after(server, &local, health(&running)).await.is_err());
    // Version 1, the text form, is not read either.
    let text = b"PROXY TCP4 192.0.2.1 127.0.0.1 40000 443\r\n";
    assert!(send_after(server, text, health(&running)).await.is_err());
}

#[tokio::test]
async fn an_unlisted_peers_header_is_never_read() {
    let running = Running::start(Setup {
        rest: LIMITS,
        ..Setup::default()
    })
    .await;
    let server = running.served.address;
    // To a listener that trusts no proxy, a PROXY header is bytes HTTP refuses.
    let header = proxy_v2(client("192.0.2.1:40000"), server);
    let refused = send_after(server, &header, health(&running)).await;
    if let Ok(reply) = &refused {
        assert_eq!(reply.status, 400, "{}", reply.text);
    }
    // The limit keys on the connection's own address: two requests, then 429, whatever any
    // header would have named.
    // (HTTP refused the probe above before any layer counted it.)
    for _ in 0..2 {
        let reply = send_after(server, b"", health(&running)).await.unwrap();
        assert_eq!(reply.status, 200, "{}", reply.text);
    }
    let reply = send_after(server, b"", health(&running)).await.unwrap();
    assert_eq!(reply.status, 429, "{}", reply.text);
}

#[tokio::test]
async fn the_key_is_version_5_hosted_and_exact() {
    let kit = TestIdp::start().await.unwrap();
    let open = |http: &str| {
        let setup = Setup {
            http,
            ..Setup::default()
        };
        let dir = support::workspace(&support::oauth::config(&kit, &setup));
        let opened = umbel::Workspace::open(dir.path());
        (dir, opened)
    };
    for bad in [
        "trusted_proxies = [\"127.0.0.1:443\"]",
        "trusted_proxies = [\"10.0.0.0/8\"]",
        "trusted_proxies = [\"proxy.example.com\"]",
        "trusted_proxies = [\"0.0.0.0\"]",
        "trusted_proxies = [\"::\"]",
        "trusted_proxies = [\"224.0.0.1\"]",
        "trusted_proxies = [\"255.255.255.255\"]",
        "trusted_proxies = [\"10.0.0.1\", \"10.0.0.1\"]",
        "trusted_proxies = [\"10.0.0.1\", \"::ffff:10.0.0.1\"]",
        "trusted_proxies = [\"fe80::1%en0\"]",
    ] {
        let (_dir, opened) = open(bad);
        let error = opened.err().unwrap_or_else(|| panic!("{bad} was accepted"));
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{bad}");
        assert!(error.message().contains("http.trusted_proxies"), "{bad}");
    }
    let (_dir, opened) =
        open("trusted_proxies = [\"10.0.0.1\", \"::ffff:10.0.0.2\", \"2001:db8::1\"]");
    let workspace = opened.unwrap();
    assert_eq!(
        workspace.config().http.trusted_proxies,
        vec![
            "10.0.0.1".parse::<std::net::IpAddr>().unwrap(),
            "10.0.0.2".parse().unwrap(),
            "2001:db8::1".parse().unwrap(),
        ]
    );
    // Mode none has no per-IP limit to key, and version 4 has no such key.
    for text in [
        "config_version = 5\n[http]\ntrusted_proxies = [\"10.0.0.1\"]\n",
        "config_version = 4\n[http]\ntrusted_proxies = [\"10.0.0.1\"]\n",
    ] {
        let dir = support::workspace(text);
        let error = umbel::Workspace::open(dir.path()).err().unwrap();
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}");
        assert!(
            error.message().contains("trusted_proxies"),
            "{text}: {error}"
        );
    }
}
