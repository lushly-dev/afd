//! Discovery and transport: RFC 8414 and OpenID Connect metadata at the path-inserted and appended
//! well-known URLs, the JWKS, HTTPS with the test CA on loopback only, client certificates, and
//! every fault (status, a redirect that must not be followed, delay, oversize, malformed body,
//! patched metadata).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use serde_json::json;
use support::{client, client_with, following_client, get};
use umbel_testkit_idp::{Endpoint, Fault, TestCa, TestIdp};

#[tokio::test]
async fn binds_loopback_only_and_serves_https_with_the_test_ca() {
    let kit = TestIdp::start().await.unwrap();
    assert!(kit.address().ip().is_loopback());
    assert_eq!(kit.base_url(), format!("https://{}", kit.address()));
    // Plain HTTP gets no HTTP answer.
    let plain = reqwest::Client::builder().build().unwrap();
    let http = format!("http://{}/as/jwks", kit.address());
    let answer = plain
        .get(&http)
        .timeout(Duration::from_secs(5))
        .send()
        .await;
    assert!(answer.is_err() || answer.unwrap().status().as_u16() >= 400);
    // A client that does not trust the kit's CA fails the handshake.
    let other = TestCa::new().unwrap();
    let stranger = reqwest::Client::builder()
        .tls_certs_only([
            reqwest::Certificate::from_pem(other.certificate_pem().as_bytes()).unwrap(),
        ])
        .build()
        .unwrap();
    let url = kit.authorization_server().url(Endpoint::Jwks);
    assert!(stranger.get(&url).send().await.is_err());
    // The listener's certificate names 127.0.0.1 and localhost.
    let localhost = format!("https://localhost:{}/as/jwks", kit.address().port());
    assert_eq!(get(&client(&kit), &localhost).await.status, 200);
    assert_eq!(get(&client(&kit), &url).await.status, 200);
}

#[tokio::test]
async fn a_client_certificate_must_chain_to_the_test_ca() {
    let kit = TestIdp::start().await.unwrap();
    let url = kit.authorization_server().url(Endpoint::Jwks);
    let ours = kit.ca().client_certificate("agent").unwrap();
    assert_eq!(get(&client_with(&kit, &ours), &url).await.status, 200);
    let other = TestCa::new().unwrap().client_certificate("agent").unwrap();
    let identity = reqwest::Identity::from_pem(other.identity_pem().as_bytes()).unwrap();
    let foreign = reqwest::Client::builder()
        .tls_certs_only([
            reqwest::Certificate::from_pem(kit.ca().certificate_pem().as_bytes()).unwrap(),
        ])
        .identity(identity)
        .build()
        .unwrap();
    assert!(foreign.get(&url).send().await.is_err());
    // A certificate issued for a server is not a client certificate.
    let server = kit.ca().server_certificate(&["127.0.0.1"]).unwrap();
    assert!(client_with(&kit, &server).get(&url).send().await.is_err());
    // Thumbprints: x5t#S256 and the hex pin of the same DER.
    assert_eq!(ours.x5t_s256().len(), 43);
    assert_eq!(ours.sha256_hex().len(), 64);
}

#[tokio::test]
async fn metadata_is_served_at_every_well_known_location() {
    let kit = TestIdp::start().await.unwrap();
    let http = client(&kit);
    for (role, oidc) in [
        (&**kit.identity_provider(), true),
        (&**kit.authorization_server(), false),
    ] {
        let urls = role.metadata_urls();
        let issuer = role.issuer();
        let path = issuer.strip_prefix(kit.base_url()).unwrap();
        assert_eq!(
            urls.oauth,
            format!(
                "{}/.well-known/oauth-authorization-server{path}",
                kit.base_url()
            )
        );
        assert_eq!(
            urls.openid,
            format!("{}/.well-known/openid-configuration{path}", kit.base_url())
        );
        assert_eq!(
            urls.openid_appended,
            format!("{issuer}/.well-known/openid-configuration")
        );
        let oauth = get(&http, &urls.oauth).await;
        let openid = get(&http, &urls.openid).await;
        let appended = get(&http, &urls.openid_appended).await;
        for reply in [&oauth, &openid, &appended] {
            assert_eq!(reply.status, 200);
            assert_eq!(reply.header("content-type"), Some("application/json"));
            assert_eq!(reply.json, role.metadata());
        }
        let document = &oauth.json;
        // RFC 8414 section 3.3: the issuer is exactly the one the URL was built from.
        assert_eq!(document["issuer"], issuer);
        assert_eq!(document["jwks_uri"], role.url(Endpoint::Jwks));
        assert_eq!(document["token_endpoint"], role.url(Endpoint::Token));
        assert_eq!(
            document["authorization_endpoint"],
            role.url(Endpoint::Authorization)
        );
        assert_eq!(document["response_types_supported"], json!(["code"]));
        assert_eq!(
            document["code_challenge_methods_supported"],
            json!(["S256"])
        );
        assert_eq!(
            document["authorization_response_iss_parameter_supported"],
            true
        );
        if oidc {
            assert_eq!(document["subject_types_supported"], json!(["public"]));
            let claims = document["claims_supported"].as_array().unwrap();
            assert!(claims.contains(&json!("acr")) && claims.contains(&json!("amr")));
            assert!(
                document["id_token_signing_alg_values_supported"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("RS256"))
            );
            assert!(
                document["grant_types_supported"]
                    .as_array()
                    .unwrap()
                    .contains(&json!(umbel_testkit_idp::TOKEN_EXCHANGE_GRANT))
            );
            assert_eq!(
                document["identity_chaining_requested_token_types_supported"],
                json!([umbel_testkit_idp::ID_JAG_TOKEN_TYPE])
            );
        } else {
            assert_eq!(
                document["introspection_endpoint"],
                role.url(Endpoint::Introspection)
            );
            assert_eq!(document["tls_client_certificate_bound_access_tokens"], true);
            assert!(
                document["grant_types_supported"]
                    .as_array()
                    .unwrap()
                    .contains(&json!(umbel_testkit_idp::JWT_BEARER_GRANT))
            );
        }
        let jwks = get(&http, &role.url(Endpoint::Jwks)).await;
        assert_eq!(jwks.json, role.keys().jwks());
        let keys = jwks.json["keys"].as_array().unwrap();
        let types: Vec<(&str, Option<&str>)> = keys
            .iter()
            .map(|key| (key["kty"].as_str().unwrap(), key["crv"].as_str()))
            .collect();
        assert_eq!(
            types,
            [
                ("RSA", None),
                ("EC", Some("P-256")),
                ("EC", Some("P-384")),
                ("OKP", Some("Ed25519")),
            ]
        );
        for key in keys {
            assert_eq!(key["use"], "sig");
            assert!(key.get("d").is_none(), "no private member is published");
        }
        assert_eq!(role.hits(Endpoint::OauthMetadata), 1);
        assert_eq!(role.hits(Endpoint::OpenidMetadata), 1);
        assert_eq!(role.hits(Endpoint::OpenidMetadataAppended), 1);
        assert_eq!(role.hits(Endpoint::Jwks), 1);
    }
}

#[tokio::test]
async fn a_metadata_patch_can_name_another_issuer_or_drop_members() {
    let kit = TestIdp::start().await.unwrap();
    let idp = kit.identity_provider();
    idp.set_metadata_patch(Some(json!({
        "issuer": "https://elsewhere.invalid",
        "claims_supported": null,
        "jwks_uri": "http://127.0.0.1/jwks",
    })));
    let reply = get(&client(&kit), &idp.metadata_urls().openid_appended).await;
    assert_eq!(reply.json["issuer"], "https://elsewhere.invalid");
    assert!(reply.json.get("claims_supported").is_none());
    assert_eq!(reply.json["jwks_uri"], "http://127.0.0.1/jwks");
    idp.set_metadata_patch(None);
    let reply = get(&client(&kit), &idp.metadata_urls().openid_appended).await;
    assert_eq!(reply.json["issuer"], idp.issuer());
}

#[tokio::test]
async fn faults_answer_as_scripted() {
    let kit = TestIdp::start().await.unwrap();
    let server = kit.authorization_server();
    let http = client(&kit);
    let urls = server.metadata_urls();

    server.set_fault(Endpoint::OauthMetadata, Fault::Status(404));
    let reply = get(&http, &urls.oauth).await;
    assert_eq!(reply.status, 404);
    // Each location faults alone.
    assert_eq!(get(&http, &urls.openid).await.status, 200);
    server.clear_fault(Endpoint::OauthMetadata);
    assert_eq!(get(&http, &urls.oauth).await.status, 200);

    // A redirect is answered 302; the target serves the real document and counts its hits.
    for endpoint in Endpoint::DOCUMENTS {
        server.set_fault(endpoint, Fault::Redirect);
        let url = server.url(endpoint);
        let reply = get(&http, &url).await;
        assert_eq!(reply.status, 302, "{endpoint:?}");
        assert!(
            reply
                .header("location")
                .unwrap()
                .starts_with(kit.base_url())
        );
        assert_eq!(server.moved_hits(endpoint), 0);
        let followed = get(&following_client(&kit), &url).await;
        assert_eq!(followed.status, 200);
        assert_eq!(server.moved_hits(endpoint), 1);
        server.clear_fault(endpoint);
    }

    server.set_fault(Endpoint::Jwks, Fault::Delay(Duration::from_secs(3)));
    let slow = http
        .get(server.url(Endpoint::Jwks))
        .timeout(Duration::from_millis(300))
        .send()
        .await;
    assert!(slow.unwrap_err().is_timeout());
    server.clear_fault(Endpoint::Jwks);

    server.set_fault(Endpoint::Jwks, Fault::Oversize);
    let big = get(&http, &server.url(Endpoint::Jwks)).await;
    assert!(big.text.len() > 1024 * 1024);
    assert!(big.json["keys"].is_array(), "still valid JSON");
    server.clear_fault(Endpoint::Jwks);

    server.set_fault(
        Endpoint::OauthMetadata,
        Fault::Body("{\"issuer\":".to_owned()),
    );
    let broken = get(&http, &urls.oauth).await;
    assert_eq!(broken.status, 200);
    assert!(broken.json.is_null());
    server.clear_fault(Endpoint::OauthMetadata);
}

#[tokio::test]
async fn the_plain_listener_counts_an_http_fetch() {
    let kit = TestIdp::start().await.unwrap();
    let server = kit.authorization_server();
    let plain = server.plain_url(Endpoint::Jwks);
    assert!(plain.starts_with("http://127.0.0.1:"));
    assert!(plain.starts_with(kit.plain_base_url()));
    assert_eq!(plain.strip_prefix(kit.plain_base_url()), Some("/as/jwks"));
    // A client restricted to HTTPS never reaches it.
    let https_only = reqwest::Client::builder().https_only(true).build().unwrap();
    assert!(https_only.get(&plain).send().await.is_err());
    assert_eq!(server.plain_hits(Endpoint::Jwks), 0);
    // A client that fetches it is counted, and gets the real document.
    let reply = get(&reqwest::Client::new(), &plain).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.json, server.keys().jwks());
    assert_eq!(server.plain_hits(Endpoint::Jwks), 1);
    let metadata = get(
        &reqwest::Client::new(),
        &server.plain_url(Endpoint::OauthMetadata),
    )
    .await;
    assert_eq!(metadata.json["issuer"], server.issuer());
    // Only documents are served there.
    let token = get(&reqwest::Client::new(), &server.plain_url(Endpoint::Token)).await;
    assert_eq!(token.status, 404);
}

#[test]
fn the_kit_serves_a_caller_whose_runtime_blocks() {
    // A current-thread runtime that then blocks its only thread on a synchronous request.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let kit = runtime.block_on(TestIdp::start()).unwrap();
    let url = kit.authorization_server().plain_url(Endpoint::Jwks);
    let address = url
        .strip_prefix("http://")
        .unwrap()
        .split('/')
        .next()
        .unwrap();
    use std::io::{Read, Write};
    let mut stream = std::net::TcpStream::connect(address).unwrap();
    // A kit that ran on the caller's (blocked) runtime would never answer: fail, do not hang.
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    stream
        .write_all(b"GET /as/jwks HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n")
        .unwrap();
    let mut answer = String::new();
    stream.read_to_string(&mut answer).unwrap();
    assert!(answer.starts_with("HTTP/1.1 200"), "{answer}");
    drop(kit);
}
