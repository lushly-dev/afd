//! The resource authorization server: the authorization code grant with PKCE and RFC 8707
//! resource indicators, client credentials, certificate-bound tokens over mTLS (RFC 8705), and
//! RFC 7662 introspection checked by AFD's `check_introspection`, answer by answer.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::server::auth::{TokenRules, check_introspection};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};
use support::{Auth, Flow, RESOURCE, client, client_with, post_form, rule, verifier};
use umbel_testkit_idp::{
    Break, Client, Endpoint, Fault, IntrospectionAnswer, ScriptedLogin, TestIdp,
};

const REDIRECT: &str = "https://agent.test/callback";

async fn kit() -> TestIdp {
    let kit = TestIdp::start().await.unwrap();
    let server = kit.authorization_server();
    server.register_client(Client::confidential("agent", "agent-secret").redirect_uri(REDIRECT));
    server.register_client(Client::confidential("umbel", "umbel-secret").introspection());
    kit
}

fn payload(token: &str) -> Value {
    let part = token.split('.').nth(1).unwrap();
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(part).unwrap()).unwrap()
}

fn header(token: &str) -> Value {
    let part = token.split('.').next().unwrap();
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(part).unwrap()).unwrap()
}

#[tokio::test]
async fn the_authorization_code_grant_issues_an_rfc_9068_token_for_one_resource() {
    let kit = kit().await;
    let server = kit.authorization_server();
    let http = client(&kit);
    let flow = Flow::new("agent", "agent-secret", REDIRECT);
    server.script_login(ScriptedLogin::user("ada"));
    let params = flow.params("umbel:read umbel:write:alpha", &[("resource", RESOURCE)]);
    let reply = flow.authorize(&http, server, &params).await;
    assert_eq!(reply.status, 302);
    let query = reply.location_query();
    assert_eq!(query["iss"], server.issuer());
    let token = flow.redeem(&http, server, &query["code"], &[]).await;
    assert_eq!(token.status, 200, "{}", token.text);
    assert_eq!(token.json["token_type"], "Bearer");
    assert_eq!(token.json["scope"], "umbel:read umbel:write:alpha");
    let access = token.json["access_token"].as_str().unwrap();
    assert_eq!(header(access)["typ"], "at+jwt");
    let credentials = verifier(&kit).verify_token(access, None).await.unwrap();
    assert_eq!(credentials.issuer, server.issuer());
    assert_eq!(credentials.subject, "ada");
    assert_eq!(credentials.client_id, "agent");
    assert_eq!(credentials.scopes, ["umbel:read", "umbel:write:alpha"]);
    assert_eq!(credentials.acr.as_deref(), Some("phr"));
    assert!(credentials.auth_time.is_some());
    let claims = payload(access);
    assert_eq!(claims["aud"], RESOURCE);
    assert_eq!(claims["groups"], json!(["eng"]));
    assert_eq!(claims["amr"], json!(["hwk", "pin"]));
    assert_eq!(
        claims["exp"].as_i64().unwrap() - claims["iat"].as_i64().unwrap(),
        300
    );
}

#[tokio::test]
async fn an_audience_needs_exactly_one_resource() {
    let kit = kit().await;
    let server = kit.authorization_server();
    let http = client(&kit);
    let flow = Flow::new("agent", "agent-secret", REDIRECT);
    let code = |resources: &'static [&'static str]| {
        let flow = &flow;
        let http = &http;
        async move {
            server.script_login(ScriptedLogin::user("bo"));
            let mut extra: Vec<(&str, &str)> = Vec::new();
            for resource in resources {
                extra.push(("resource", resource));
            }
            let params = flow.params("umbel:read", &extra);
            flow.authorize(http, server, &params).await.location_query()["code"].clone()
        }
    };
    // None at all.
    let reply = flow.redeem(&http, server, &code(&[]).await, &[]).await;
    assert_eq!(reply.json["error"], "invalid_target");
    // Named only at the token endpoint.
    let reply = flow
        .redeem(&http, server, &code(&[]).await, &[("resource", RESOURCE)])
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    // Two at the authorization endpoint, one chosen at the token endpoint.
    let two: &'static [&'static str] = &[RESOURCE, "https://other.test/mcp"];
    let reply = flow.redeem(&http, server, &code(two).await, &[]).await;
    assert_eq!(reply.json["error"], "invalid_target");
    let reply = flow
        .redeem(
            &http,
            server,
            &code(two).await,
            &[("resource", "https://other.test/mcp")],
        )
        .await;
    assert_eq!(
        payload(reply.json["access_token"].as_str().unwrap())["aud"],
        "https://other.test/mcp"
    );
    // One not in the authorization request.
    let reply = flow
        .redeem(
            &http,
            server,
            &code(&[RESOURCE]).await,
            &[("resource", "https://other.test/mcp")],
        )
        .await;
    assert_eq!(reply.json["error"], "invalid_target");
    // Not https.
    let params = flow.params("umbel:read", &[("resource", "http://umbel.test/mcp")]);
    let reply = flow.authorize(&http, server, &params).await;
    assert_eq!(reply.location_query()["error"], "invalid_target");
}

#[tokio::test]
async fn client_credentials_name_the_client_as_subject() {
    let kit = kit().await;
    let server = kit.authorization_server();
    let reply = post_form(
        &client(&kit),
        &server.url(Endpoint::Token),
        Auth::Post("agent", "agent-secret"),
        &[
            ("grant_type", "client_credentials"),
            ("resource", RESOURCE),
            ("scope", "umbel:read"),
        ],
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let credentials = verifier(&kit)
        .verify_token(reply.json["access_token"].as_str().unwrap(), None)
        .await
        .unwrap();
    assert_eq!(credentials.subject, "agent");
    assert_eq!(credentials.client_id, "agent");
    assert_eq!(credentials.scopes, ["umbel:read"]);
}

#[tokio::test]
async fn a_certificate_bound_client_gets_tokens_bound_to_the_certificate_it_presented() {
    let kit = kit().await;
    let server = kit.authorization_server();
    server.register_client(Client::confidential("bound", "bound-secret").certificate_bound());
    let certificate = kit.ca().client_certificate("bound").unwrap();
    let pairs = [("grant_type", "client_credentials"), ("resource", RESOURCE)];
    let reply = post_form(
        &client_with(&kit, &certificate),
        &server.url(Endpoint::Token),
        Auth::Basic("bound", "bound-secret"),
        &pairs,
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let token = reply.json["access_token"].as_str().unwrap();
    assert_eq!(
        payload(token)["cnf"],
        json!({ "x5t#S256": certificate.x5t_s256() })
    );
    let verifier = verifier(&kit);
    assert!(
        verifier
            .verify_token(token, Some(&certificate.x5t_s256()))
            .await
            .is_ok()
    );
    assert_eq!(rule(verifier.verify_token(token, None).await), "binding");
    // Without a certificate, no token.
    let reply = post_form(
        &client(&kit),
        &server.url(Endpoint::Token),
        Auth::Basic("bound", "bound-secret"),
        &pairs,
    )
    .await;
    assert_eq!(reply.status, 400);
    assert_eq!(reply.json["error"], "invalid_request");
    // An unbound client's token stays unbound even over mTLS.
    let reply = post_form(
        &client_with(&kit, &certificate),
        &server.url(Endpoint::Token),
        Auth::Basic("agent", "agent-secret"),
        &pairs,
    )
    .await;
    assert!(
        payload(reply.json["access_token"].as_str().unwrap())
            .get("cnf")
            .is_none()
    );
}

async fn introspect(kit: &TestIdp, token: &str) -> Value {
    let reply = post_form(
        &client(kit),
        &kit.authorization_server().url(Endpoint::Introspection),
        Auth::Basic("umbel", "umbel-secret"),
        &[("token", token), ("token_type_hint", "access_token")],
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    reply.json
}

fn checked(kit: &TestIdp, answer: &Value) -> Result<afd::server::auth::Credentials, &'static str> {
    let rules = TokenRules::new(RESOURCE).unwrap();
    let now = jsonwebtoken::get_current_timestamp() as i64;
    check_introspection(
        answer,
        kit.authorization_server().issuer(),
        &rules,
        now,
        None,
    )
    .map_err(|code| code.as_str())
}

#[tokio::test]
async fn introspection_answers_for_opaque_and_jwt_tokens() {
    let kit = kit().await;
    let server = kit.authorization_server();
    let opaque = server
        .opaque_token(RESOURCE)
        .subject("cy")
        .client_id("agent")
        .scopes(["umbel:read"])
        .sign();
    assert!(!opaque.contains('.'), "an opaque token is not a JWS");
    let answer = introspect(&kit, &opaque).await;
    assert_eq!(answer["active"], true);
    assert_eq!(answer["token_type"], "Bearer");
    let credentials = checked(&kit, &answer).unwrap();
    assert_eq!(credentials.subject, "cy");
    assert_eq!(credentials.scopes, ["umbel:read"]);
    // The server's JWTs are introspectable too.
    let jwt = server.access_token(RESOURCE).sign();
    assert!(checked(&kit, &introspect(&kit, &jwt).await).is_ok());
    // Unknown, revoked and expired tokens are inactive.
    assert_eq!(
        introspect(&kit, "never-issued").await,
        json!({ "active": false })
    );
    assert!(server.revoke(&opaque));
    assert_eq!(
        checked(&kit, &introspect(&kit, &opaque).await),
        Err("inactive")
    );
    let expired = server
        .opaque_token(RESOURCE)
        .break_rule(Break::Expired)
        .sign();
    assert_eq!(
        checked(&kit, &introspect(&kit, &expired).await),
        Err("inactive")
    );
}

#[tokio::test]
async fn each_scripted_introspection_answer_breaks_one_rule() {
    let kit = kit().await;
    let server = kit.authorization_server();
    let cases: Vec<(IntrospectionAnswer, &str)> = vec![
        (IntrospectionAnswer::Inactive, "inactive"),
        (IntrospectionAnswer::Raw(json!([])), "inactive"),
        (
            IntrospectionAnswer::Raw(json!({ "active": "true" })),
            "inactive",
        ),
        (IntrospectionAnswer::Without("active".into()), "inactive"),
        (
            IntrospectionAnswer::Patch(json!({ "aud": "https://other.test/mcp" })),
            "audience",
        ),
        (
            IntrospectionAnswer::Patch(json!({ "iss": "https://other.test" })),
            "issuer",
        ),
    ];
    let mut cases = cases;
    for field in ["exp", "iat", "iss", "aud", "sub", "client_id", "jti"] {
        cases.push((IntrospectionAnswer::Without(field.into()), "claims"));
    }
    for (answer, expected) in cases {
        let token = server
            .opaque_token(RESOURCE)
            .introspection(answer.clone())
            .sign();
        assert_eq!(
            checked(&kit, &introspect(&kit, &token).await),
            Err(expected),
            "{answer:?}"
        );
    }
    // Claim breaks reach the answer as they would a JWT.
    for broken in [
        Break::TooManyScopes,
        Break::DpopBound,
        Break::MultipleAudiences,
        Break::LifetimeTooLong,
    ] {
        let token = server.opaque_token(RESOURCE).break_rule(broken).sign();
        assert_eq!(
            checked(&kit, &introspect(&kit, &token).await),
            Err(broken.rule()),
            "{broken:?}"
        );
    }
    // The answer can change after issue.
    let token = server.opaque_token(RESOURCE).sign();
    assert!(checked(&kit, &introspect(&kit, &token).await).is_ok());
    assert!(server.set_introspection_answer(&token, IntrospectionAnswer::Inactive));
    assert_eq!(
        checked(&kit, &introspect(&kit, &token).await),
        Err("inactive")
    );
}

#[tokio::test]
async fn introspection_needs_an_authenticated_resource_server() {
    let kit = kit().await;
    let server = kit.authorization_server();
    let url = server.url(Endpoint::Introspection);
    let http = client(&kit);
    let token = server.opaque_token(RESOURCE).sign();
    let none = post_form(&http, &url, Auth::None, &[("token", &token)]).await;
    assert_eq!(none.status, 401);
    let wrong = post_form(
        &http,
        &url,
        Auth::Basic("umbel", "wrong"),
        &[("token", &token)],
    )
    .await;
    assert_eq!(wrong.status, 401);
    // An authenticated client that is not a resource server.
    let agent = post_form(
        &http,
        &url,
        Auth::Basic("agent", "agent-secret"),
        &[("token", &token)],
    )
    .await;
    assert_eq!(agent.status, 401);
    assert_eq!(agent.json["error"], "invalid_client");
    let missing = post_form(&http, &url, Auth::Basic("umbel", "umbel-secret"), &[]).await;
    assert_eq!(missing.status, 400);
    // The identity provider has no introspection endpoint.
    let idp = format!("{}/introspect", kit.identity_provider().issuer());
    assert_eq!(post_form(&http, &idp, Auth::None, &[]).await.status, 404);
    // An endpoint that cannot answer.
    server.set_fault(Endpoint::Introspection, Fault::Status(503));
    let down = post_form(
        &http,
        &url,
        Auth::Basic("umbel", "umbel-secret"),
        &[("token", &token)],
    )
    .await;
    assert_eq!(down.status, 503);
    assert_eq!(server.hits(Endpoint::Introspection), 5);
}
