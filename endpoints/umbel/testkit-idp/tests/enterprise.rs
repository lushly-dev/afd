//! Enterprise-managed authorization (phase 5 specification, section 3.4): an ID token at the
//! identity provider, the RFC 8693 token exchange for an ID-JAG, and the RFC 7523 JWT bearer grant
//! that redeems it at the resource authorization server for an access token AFD accepts; then each
//! refusal of both steps.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};
use support::{Auth, Flow, RESOURCE, Reply, client, post_form, verifier};
use umbel_testkit_idp::{
    Break, Client, Endpoint, ID_JAG_TOKEN_TYPE, ID_TOKEN_TOKEN_TYPE, JWT_BEARER_GRANT,
    RequiredClaim, ScriptedLogin, TOKEN_EXCHANGE_GRANT, TestIdp,
};

const CLIENT: &str = "mcp-client";
const IDP_SECRET: &str = "idp-secret";
const AS_SECRET: &str = "as-secret";
const REDIRECT: &str = "https://client.test/callback";

async fn kit() -> TestIdp {
    let kit = TestIdp::start().await.unwrap();
    kit.identity_provider()
        .register_client(Client::confidential(CLIENT, IDP_SECRET).redirect_uri(REDIRECT));
    kit.authorization_server()
        .register_client(Client::confidential(CLIENT, AS_SECRET));
    kit
}

fn decode(token: &str, part: usize) -> Value {
    let part = token.split('.').nth(part).unwrap();
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(part).unwrap()).unwrap()
}

/// cy logs in at the identity provider: an ID token for the client.
async fn id_token(kit: &TestIdp) -> String {
    let idp = kit.identity_provider();
    let http = client(kit);
    let flow = Flow::new(CLIENT, IDP_SECRET, REDIRECT);
    idp.script_login(ScriptedLogin::user("cy"));
    let code = flow
        .authorize(&http, idp, &flow.params("openid", &[]))
        .await
        .location_query()["code"]
        .clone();
    let reply = flow.redeem(&http, idp, &code, &[]).await;
    reply.json["id_token"].as_str().unwrap().to_owned()
}

async fn exchange(kit: &TestIdp, pairs: &[(&str, &str)]) -> Reply {
    post_form(
        &client(kit),
        &kit.identity_provider().url(Endpoint::Token),
        Auth::Basic(CLIENT, IDP_SECRET),
        pairs,
    )
    .await
}

fn exchange_pairs<'a>(kit: &'a TestIdp, subject_token: &'a str) -> Vec<(&'a str, &'a str)> {
    vec![
        ("grant_type", TOKEN_EXCHANGE_GRANT),
        ("requested_token_type", ID_JAG_TOKEN_TYPE),
        ("audience", kit.authorization_server().issuer()),
        ("resource", RESOURCE),
        ("scope", "umbel:read umbel:write:alpha"),
        ("subject_token", subject_token),
        ("subject_token_type", ID_TOKEN_TOKEN_TYPE),
    ]
}

async fn redeem(kit: &TestIdp, assertion: &str, extra: &[(&str, &str)]) -> Reply {
    let mut pairs = vec![("grant_type", JWT_BEARER_GRANT), ("assertion", assertion)];
    pairs.extend_from_slice(extra);
    post_form(
        &client(kit),
        &kit.authorization_server().url(Endpoint::Token),
        Auth::Basic(CLIENT, AS_SECRET),
        &pairs,
    )
    .await
}

#[tokio::test]
async fn id_token_to_id_jag_to_an_access_token_afd_accepts() {
    let kit = kit().await;
    let id_token = id_token(&kit).await;
    let reply = exchange(&kit, &exchange_pairs(&kit, &id_token)).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    assert_eq!(reply.json["issued_token_type"], ID_JAG_TOKEN_TYPE);
    assert_eq!(reply.json["token_type"], "N_A");
    assert_eq!(reply.json["scope"], "umbel:read umbel:write:alpha");
    assert!(reply.json["expires_in"].as_i64().unwrap() > 0);
    let jag = reply.json["access_token"].as_str().unwrap();
    assert_eq!(decode(jag, 0)["typ"], "oauth-id-jag+jwt");
    assert_eq!(decode(jag, 0)["alg"], "RS256");
    let claims = decode(jag, 1);
    assert_eq!(claims["iss"], kit.identity_provider().issuer());
    assert_eq!(claims["aud"], kit.authorization_server().issuer());
    assert_eq!(claims["sub"], "cy");
    assert_eq!(claims["client_id"], CLIENT);
    assert_eq!(claims["resource"], RESOURCE);
    assert_eq!(claims["acr"], "phr");
    assert_eq!(claims["amr"], json!(["hwk", "pin"]));
    assert!(claims["jti"].is_string() && claims["auth_time"].is_number());

    let token = redeem(&kit, jag, &[]).await;
    assert_eq!(token.status, 200, "{}", token.text);
    assert_eq!(token.json["scope"], "umbel:read umbel:write:alpha");
    let access = token.json["access_token"].as_str().unwrap();
    let credentials = verifier(&kit).verify_token(access, None).await.unwrap();
    assert_eq!(credentials.issuer, kit.authorization_server().issuer());
    assert_eq!(credentials.subject, "cy");
    assert_eq!(credentials.client_id, CLIENT);
    assert_eq!(credentials.scopes, ["umbel:read", "umbel:write:alpha"]);
    assert_eq!(credentials.acr.as_deref(), Some("phr"));
    assert_eq!(decode(access, 1)["groups"], json!(["eng"]));
    // An ID-JAG is redeemed once.
    let again = redeem(&kit, jag, &[]).await;
    assert_eq!(again.json["error"], "invalid_grant");
}

#[tokio::test]
async fn the_id_jag_names_the_clients_id_at_the_authorization_server() {
    let kit = kit().await;
    kit.identity_provider().register_client(
        Client::confidential(CLIENT, IDP_SECRET)
            .redirect_uri(REDIRECT)
            .resource_client_id("as-client"),
    );
    let id_token = id_token(&kit).await;
    let reply = exchange(&kit, &exchange_pairs(&kit, &id_token)).await;
    let jag = reply.json["access_token"].as_str().unwrap();
    assert_eq!(decode(jag, 1)["client_id"], "as-client");
    // So `mcp-client` cannot redeem it at the authorization server.
    assert_eq!(redeem(&kit, jag, &[]).await.json["error"], "invalid_grant");
}

#[tokio::test]
async fn the_token_exchange_refuses_what_it_must() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    let id_token = id_token(&kit).await;
    let with = |name: &str, value: Option<&str>| {
        let mut pairs: Vec<(String, String)> = exchange_pairs(&kit, &id_token)
            .into_iter()
            .filter(|(key, _)| *key != name)
            .map(|(key, value)| (key.to_owned(), value.to_owned()))
            .collect();
        if let Some(value) = value {
            pairs.push((name.to_owned(), value.to_owned()));
        }
        pairs
    };
    let other_client = idp.id_token("cy", "someone-else").sign();
    let expired = idp.id_token("cy", CLIENT).break_rule(Break::Expired).sign();
    let unknown_key = idp
        .id_token("cy", CLIENT)
        .break_rule(Break::UnknownKid)
        .sign();
    let forged = idp
        .id_token("cy", CLIENT)
        .break_rule(Break::Signature)
        .sign();
    let foreign = kit.authorization_server().access_token(CLIENT).sign();
    let cases: Vec<(Vec<(String, String)>, &str)> = vec![
        (
            with("audience", Some("https://elsewhere.invalid")),
            "invalid_target",
        ),
        (with("audience", None), "invalid_request"),
        (
            with(
                "requested_token_type",
                Some("urn:ietf:params:oauth:token-type:access_token"),
            ),
            "invalid_request",
        ),
        (
            with(
                "subject_token_type",
                Some("urn:ietf:params:oauth:token-type:saml2"),
            ),
            "invalid_request",
        ),
        (
            with("subject_token", Some(&other_client)),
            "invalid_request",
        ),
        (with("subject_token", Some(&expired)), "invalid_request"),
        (with("subject_token", Some(&unknown_key)), "invalid_request"),
        (with("subject_token", Some(&forged)), "invalid_request"),
        (with("subject_token", Some(&foreign)), "invalid_request"),
        (with("subject_token", Some("not-a-jws")), "invalid_request"),
        (
            with("resource", Some("http://umbel.test/mcp")),
            "invalid_target",
        ),
        (with("actor_token", Some(&id_token)), "invalid_request"),
    ];
    for (pairs, error) in cases {
        let pairs: Vec<(&str, &str)> = pairs
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let reply = exchange(&kit, &pairs).await;
        assert_eq!(reply.status, 400, "{pairs:?}");
        assert_eq!(reply.json["error"], error, "{pairs:?}");
    }
    // Two audiences.
    let mut pairs = exchange_pairs(&kit, &id_token);
    pairs.push(("audience", "https://elsewhere.invalid"));
    assert_eq!(
        exchange(&kit, &pairs).await.json["error"],
        "invalid_request"
    );
    // No client authentication.
    let reply = post_form(
        &client(&kit),
        &idp.url(Endpoint::Token),
        Auth::None,
        &exchange_pairs(&kit, &id_token),
    )
    .await;
    assert_eq!(reply.status, 401);
    // The authorization server does not exchange tokens.
    let reply = post_form(
        &client(&kit),
        &kit.authorization_server().url(Endpoint::Token),
        Auth::Basic(CLIENT, AS_SECRET),
        &exchange_pairs(&kit, &id_token),
    )
    .await;
    assert_eq!(reply.json["error"], "unsupported_grant_type");
}

#[tokio::test]
async fn the_jwt_bearer_grant_refuses_what_it_must() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    let jag = || {
        idp.id_jag("cy", CLIENT)
            .claim("resource", json!(RESOURCE))
            .scopes(["umbel:read"])
    };
    // A valid one, built directly, is accepted.
    let reply = redeem(&kit, &jag().sign(), &[]).await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    for broken in [
        Break::Typ,
        Break::Signature,
        Break::UnknownKid,
        Break::KeyMismatch,
        Break::AlgNone,
        Break::Hs256,
        Break::Crit,
        Break::Jwk,
        Break::DuplicateClaim,
        Break::UnknownIssuer,
        Break::Audience,
        Break::MultipleAudiences,
        Break::Expired,
        Break::NotYetValid,
        Break::Missing(RequiredClaim::Jti),
        Break::Missing(RequiredClaim::Sub),
        Break::Missing(RequiredClaim::Exp),
        Break::Missing(RequiredClaim::Iat),
        Break::Missing(RequiredClaim::ClientId),
    ] {
        let reply = redeem(&kit, &jag().break_rule(broken).sign(), &[]).await;
        assert_eq!(reply.json["error"], "invalid_grant", "{broken:?}");
    }
    // Another client's ID-JAG.
    let theirs = idp
        .id_jag("cy", "someone-else")
        .claim("resource", json!(RESOURCE))
        .sign();
    assert_eq!(
        redeem(&kit, &theirs, &[]).await.json["error"],
        "invalid_grant"
    );
    // An ID-JAG signed by the authorization server's own key is not the trusted issuer's.
    let self_signed = kit
        .authorization_server()
        .access_token(RESOURCE)
        .header_member("typ", json!("oauth-id-jag+jwt"))
        .claim("iss", json!(idp.issuer()))
        .claim("aud", json!(kit.authorization_server().issuer()))
        .client_id(CLIENT)
        .sign();
    assert_eq!(
        redeem(&kit, &self_signed, &[]).await.json["error"],
        "invalid_grant"
    );
    // Scopes may narrow, never widen.
    let narrow = redeem(
        &kit,
        &jag().scopes(["umbel:read", "umbel:write"]).sign(),
        &[("scope", "umbel:read")],
    )
    .await;
    assert_eq!(narrow.json["scope"], "umbel:read");
    let wide = redeem(&kit, &jag().sign(), &[("scope", "umbel:write")]).await;
    assert_eq!(wide.json["error"], "invalid_scope");
    // Resources: chosen among the ID-JAG's, required somewhere, never added.
    let two = jag().claim("resource", json!([RESOURCE, "https://other.test/mcp"]));
    assert_eq!(
        redeem(&kit, &two.clone().sign(), &[]).await.json["error"],
        "invalid_target"
    );
    let chosen = redeem(&kit, &two.sign(), &[("resource", "https://other.test/mcp")]).await;
    assert_eq!(
        decode(chosen.json["access_token"].as_str().unwrap(), 1)["aud"],
        "https://other.test/mcp"
    );
    let none = idp.id_jag("cy", CLIENT).sign();
    assert_eq!(
        redeem(&kit, &none, &[]).await.json["error"],
        "invalid_target"
    );
    let added = redeem(
        &kit,
        &jag().sign(),
        &[("resource", "https://other.test/mcp")],
    )
    .await;
    assert_eq!(added.json["error"], "invalid_target");
    let from_request = redeem(
        &kit,
        &idp.id_jag("cy", CLIENT).sign(),
        &[("resource", RESOURCE)],
    )
    .await;
    assert_eq!(from_request.status, 200);
    // No assertion.
    let reply = post_form(
        &client(&kit),
        &kit.authorization_server().url(Endpoint::Token),
        Auth::Basic(CLIENT, AS_SECRET),
        &[("grant_type", JWT_BEARER_GRANT)],
    )
    .await;
    assert_eq!(reply.json["error"], "invalid_request");
}
