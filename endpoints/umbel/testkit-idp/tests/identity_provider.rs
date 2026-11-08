//! The identity provider: the authorization endpoint (RFC 6749 4.1, OpenID Connect Core 3.1 with
//! `prompt`, `max_age`, `acr_values` and `claims`), the scripted login and the password form,
//! PKCE `S256` (RFC 7636), client authentication, RFC 9207 `iss`, and ID tokens verified
//! independently against the published JWKS with `jsonwebtoken`'s own validation.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use jsonwebtoken::jwk::Jwk;
use jsonwebtoken::{DecodingKey, Validation};
use serde_json::{Value, json};
use support::{Auth, Flow, client, form, post_form};
use umbel_testkit_idp::{Client, Endpoint, LoginScript, ResponseIss, ScriptedLogin, TestIdp, User};

const CLIENT: &str = "umbel-person-page";
const SECRET: &str = "person-page-secret";
const REDIRECT: &str = "https://umbel.test/mcp/callback";

async fn kit() -> TestIdp {
    let kit = TestIdp::start().await.unwrap();
    kit.identity_provider()
        .register_client(Client::confidential(CLIENT, SECRET).redirect_uri(REDIRECT));
    kit
}

fn flow() -> Flow {
    Flow::new(CLIENT, SECRET, REDIRECT)
}

/// The OpenID Connect person login of section 7.2.
fn person_login(flow: &Flow) -> Vec<(&str, &str)> {
    flow.params(
        "openid",
        &[
            ("prompt", "login"),
            ("max_age", "300"),
            ("acr_values", "phr"),
            ("response_mode", "query"),
            (
                "claims",
                r#"{"id_token":{"acr":{"essential":true,"values":["phr"]}}}"#,
            ),
        ],
    )
}

/// Verify an ID token with `jsonwebtoken`'s validation and the JWKS as served.
async fn verify_id_token(kit: &TestIdp, token: &str) -> (jsonwebtoken::Header, Value) {
    let idp = kit.identity_provider();
    let header = jsonwebtoken::decode_header(token).unwrap();
    let jwks = support::get(&client(kit), &idp.url(Endpoint::Jwks))
        .await
        .json;
    let key = jwks["keys"]
        .as_array()
        .unwrap()
        .iter()
        .find(|key| key["kid"].as_str() == header.kid.as_deref())
        .unwrap();
    let jwk: Jwk = serde_json::from_value(key.clone()).unwrap();
    let mut validation = Validation::new(header.alg);
    validation.set_audience(&[CLIENT]);
    validation.set_issuer(&[idp.issuer()]);
    let data =
        jsonwebtoken::decode::<Value>(token, &DecodingKey::from_jwk(&jwk).unwrap(), &validation)
            .unwrap();
    (header, data.claims)
}

#[tokio::test]
async fn a_scripted_login_redeems_for_an_id_token_with_nonce_and_user_verification() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    let http = client(&kit);
    let flow = flow();
    idp.script_login(ScriptedLogin::user("ada"));
    let reply = flow.authorize(&http, idp, &person_login(&flow)).await;
    assert_eq!(reply.status, 302);
    assert!(reply.header("location").unwrap().starts_with(REDIRECT));
    let query = reply.location_query();
    assert_eq!(query["state"], flow.state);
    assert_eq!(query["iss"], idp.issuer());
    let code = &query["code"];
    // The provider records what the relying party asked for.
    let requests = idp.authorization_requests();
    let asked = requests.last().unwrap();
    for (name, value) in [
        ("prompt", "login"),
        ("max_age", "300"),
        ("acr_values", "phr"),
        ("response_mode", "query"),
        ("code_challenge_method", "S256"),
        ("nonce", flow.nonce.as_str()),
    ] {
        assert!(
            asked.contains(&(name.to_owned(), value.to_owned())),
            "{name}={value} in {asked:?}"
        );
    }
    assert!(
        asked
            .iter()
            .any(|(name, value)| name == "claims" && value.contains("\"essential\":true"))
    );
    let token = flow.redeem(&http, idp, code, &[]).await;
    assert_eq!(token.status, 200, "{}", token.text);
    assert_eq!(token.header("cache-control"), Some("no-store"));
    assert_eq!(token.json["token_type"], "Bearer");
    assert!(token.json["expires_in"].as_i64().unwrap() > 0);
    let (header, claims) = verify_id_token(&kit, token.json["id_token"].as_str().unwrap()).await;
    assert_eq!(header.typ.as_deref(), Some("JWT"));
    assert_eq!(header.alg, jsonwebtoken::Algorithm::RS256);
    assert_eq!(claims["sub"], "ada");
    assert_eq!(claims["azp"], CLIENT);
    assert_eq!(claims["nonce"], flow.nonce);
    assert_eq!(claims["acr"], "phr");
    assert_eq!(claims["amr"], json!(["hwk", "pin"]));
    assert_eq!(claims["groups"], json!(["eng"]));
    let now = jsonwebtoken::get_current_timestamp() as i64;
    let auth_time = claims["auth_time"].as_i64().unwrap();
    assert!((now - auth_time).abs() <= 5);
    // The code is spent.
    let again = flow.redeem(&http, idp, code, &[]).await;
    assert_eq!(again.status, 400);
    assert_eq!(again.json["error"], "invalid_grant");
}

#[tokio::test]
async fn the_password_form_logs_a_synthetic_user_in() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    let http = client(&kit);
    let flow = flow();
    let form_reply = flow.authorize(&http, idp, &person_login(&flow)).await;
    assert_eq!(form_reply.status, 200);
    assert!(form_reply.text.contains("<form method=\"post\""));
    let request = form_reply
        .header("testkit-login-request")
        .unwrap()
        .to_owned();
    assert!(form_reply.text.contains(&request));
    let login = |password: &'static str| {
        let request = request.clone();
        let http = http.clone();
        let url = idp.url(Endpoint::Login);
        async move {
            post_form(
                &http,
                &url,
                Auth::None,
                &[
                    ("request", &request),
                    ("username", "bo"),
                    ("password", password),
                ],
            )
            .await
        }
    };
    let wrong = login("not-the-password").await;
    assert_eq!(wrong.status, 401);
    let password = User::synthetic("bo").password().to_owned();
    assert_eq!(password, "bo-test-password");
    let right = login("bo-test-password").await;
    assert_eq!(right.status, 302);
    let code = right.location_query()["code"].clone();
    // The login request is used once.
    assert_eq!(login("bo-test-password").await.status, 400);
    let token = flow.redeem(&http, idp, &code, &[]).await;
    let (_, claims) = verify_id_token(&kit, token.json["id_token"].as_str().unwrap()).await;
    assert_eq!(claims["sub"], "bo");
    assert!(claims.get("groups").is_none());
}

#[tokio::test]
async fn a_scripted_login_sets_what_the_provider_reports() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    let http = client(&kit);
    let flow = flow();
    // No user verification: `pwd` only, and no `acr`.
    idp.script_login(ScriptedLogin::user("ada").amr(["pwd"]).acr(None));
    let code = flow
        .authorize(&http, idp, &person_login(&flow))
        .await
        .location_query()["code"]
        .clone();
    let token = flow.redeem(&http, idp, &code, &[]).await;
    let (_, claims) = verify_id_token(&kit, token.json["id_token"].as_str().unwrap()).await;
    assert_eq!(claims["amr"], json!(["pwd"]));
    assert!(claims.get("acr").is_none());
    // A reused session: an old `auth_time` despite `prompt=login`.
    idp.script_login(ScriptedLogin::user("cy").auth_time(1_700_000_000));
    let code = flow
        .authorize(&http, idp, &person_login(&flow))
        .await
        .location_query()["code"]
        .clone();
    let token = flow.redeem(&http, idp, &code, &[]).await;
    let (_, claims) = verify_id_token(&kit, token.json["id_token"].as_str().unwrap()).await;
    assert_eq!(claims["auth_time"], 1_700_000_000);
    assert_eq!(claims["sub"], "cy");
    // An adjusted ID token: another nonce, a user's own `amr` changed.
    idp.add_user(User::synthetic("bo").amr(["otp"]));
    idp.script_login(ScriptedLogin::user("bo").adjust_token(|token| token.nonce("someone-else")));
    let code = flow
        .authorize(&http, idp, &person_login(&flow))
        .await
        .location_query()["code"]
        .clone();
    let token = flow.redeem(&http, idp, &code, &[]).await;
    let (_, claims) = verify_id_token(&kit, token.json["id_token"].as_str().unwrap()).await;
    assert_eq!(claims["nonce"], "someone-else");
    assert_eq!(claims["amr"], json!(["otp"]));
}

#[tokio::test]
async fn refusals_redirect_with_the_error_state_and_issuer() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    let http = client(&kit);
    let flow = flow();
    idp.script_login(LoginScript::Refuse("access_denied".to_owned()));
    let query = flow
        .authorize(&http, idp, &person_login(&flow))
        .await
        .location_query();
    assert_eq!(query["error"], "access_denied");
    assert_eq!(query["state"], flow.state);
    assert_eq!(query["iss"], idp.issuer());
    assert!(!query.contains_key("code"));
    // prompt=none with no session.
    let params = flow.params("openid", &[("prompt", "none")]);
    let query = flow.authorize(&http, idp, &params).await.location_query();
    assert_eq!(query["error"], "login_required");
    // RFC 9207 `iss` left out, or wrong.
    idp.set_response_iss(ResponseIss::Omitted);
    idp.script_login(ScriptedLogin::user("ada"));
    let query = flow
        .authorize(&http, idp, &person_login(&flow))
        .await
        .location_query();
    assert!(query.contains_key("code") && !query.contains_key("iss"));
    idp.set_response_iss(ResponseIss::Value("https://elsewhere.invalid".to_owned()));
    idp.script_login(ScriptedLogin::user("ada"));
    let query = flow
        .authorize(&http, idp, &person_login(&flow))
        .await
        .location_query();
    assert_eq!(query["iss"], "https://elsewhere.invalid");
}

#[tokio::test]
async fn malformed_authorization_requests_are_refused() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    let http = client(&kit);
    let flow = flow();
    let base = flow.params("openid", &[]);
    let with = |name: &'static str, value: Option<&'static str>| {
        let mut params: Vec<(&str, &str)> = base
            .iter()
            .copied()
            .filter(|(key, _)| *key != name)
            .collect();
        if let Some(value) = value {
            params.push((name, value));
        }
        params
    };
    // Never redirected: an unknown client, an unregistered redirect URI, either one repeated.
    for params in [
        with("client_id", Some("stranger")),
        with("redirect_uri", Some("https://attacker.invalid/cb")),
        with("redirect_uri", None),
        [base.clone(), vec![("client_id", CLIENT)]].concat(),
        [base.clone(), vec![("redirect_uri", REDIRECT)]].concat(),
    ] {
        let reply = flow.authorize(&http, idp, &params).await;
        assert_eq!(reply.status, 400);
        assert!(reply.header("location").is_none());
    }
    // Redirected with an error.
    for (params, error) in [
        (with("code_challenge", None), "invalid_request"),
        (
            with("code_challenge_method", Some("plain")),
            "invalid_request",
        ),
        (with("code_challenge_method", None), "invalid_request"),
        (with("code_challenge", Some("short")), "invalid_request"),
        (
            with("response_type", Some("token")),
            "unsupported_response_type",
        ),
        (with("response_mode", Some("fragment")), "invalid_request"),
        (with("scope", Some("profile")), "invalid_scope"),
        (with("prompt", Some("none login")), "invalid_request"),
        (with("prompt", Some("sometimes")), "invalid_request"),
        (with("max_age", Some("-1")), "invalid_request"),
        (with("claims", Some("[1]")), "invalid_request"),
        (
            [base.clone(), vec![("nonce", "again")]].concat(),
            "invalid_request",
        ),
    ] {
        let reply = flow.authorize(&http, idp, &params).await;
        assert_eq!(reply.status, 302, "{params:?}");
        assert_eq!(reply.location_query()["error"], error, "{params:?}");
    }
    assert!(idp.hits(Endpoint::Authorization) >= 15);
}

#[tokio::test]
async fn the_token_endpoint_checks_the_code_pkce_and_the_client() {
    let kit = kit().await;
    let idp = kit.identity_provider();
    idp.register_client(Client::confidential("other", "other-secret").redirect_uri(REDIRECT));
    let http = client(&kit);
    let flow = flow();
    let token_url = idp.url(Endpoint::Token);
    let code = || async {
        idp.script_login(ScriptedLogin::user("ada"));
        flow.authorize(&http, idp, &person_login(&flow))
            .await
            .location_query()["code"]
            .clone()
    };
    // A wrong verifier spends the code.
    let spent = code().await;
    let wrong = umbel_testkit_idp::Pkce::new();
    let reply = post_form(
        &http,
        &token_url,
        Auth::Basic(CLIENT, SECRET),
        &[
            ("grant_type", "authorization_code"),
            ("code", &spent),
            ("redirect_uri", REDIRECT),
            ("code_verifier", &wrong.verifier),
        ],
    )
    .await;
    assert_eq!(reply.json["error"], "invalid_grant");
    assert_eq!(
        flow.redeem(&http, idp, &spent, &[]).await.json["error"],
        "invalid_grant"
    );
    // Another redirect URI.
    let reply = post_form(
        &http,
        &token_url,
        Auth::Basic(CLIENT, SECRET),
        &[
            ("grant_type", "authorization_code"),
            ("code", &code().await),
            ("redirect_uri", "https://umbel.test/other"),
            ("code_verifier", &flow.pkce.verifier),
        ],
    )
    .await;
    assert_eq!(reply.json["error"], "invalid_grant");
    // Another client's code.
    let theirs = code().await;
    let reply = post_form(
        &http,
        &token_url,
        Auth::Basic("other", "other-secret"),
        &[
            ("grant_type", "authorization_code"),
            ("code", &theirs),
            ("redirect_uri", REDIRECT),
            ("code_verifier", &flow.pkce.verifier),
        ],
    )
    .await;
    assert_eq!(reply.json["error"], "invalid_grant");
    // Client authentication: post works; none, a wrong secret, or two methods do not.
    let mine = code().await;
    let reply = post_form(
        &http,
        &token_url,
        Auth::Post(CLIENT, SECRET),
        &[
            ("grant_type", "authorization_code"),
            ("code", &mine),
            ("redirect_uri", REDIRECT),
            ("code_verifier", &flow.pkce.verifier),
        ],
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    let pairs = [("grant_type", "authorization_code"), ("code", "x")];
    let none = post_form(&http, &token_url, Auth::None, &pairs).await;
    assert_eq!(none.status, 401);
    assert_eq!(none.json["error"], "invalid_client");
    assert!(
        none.header("www-authenticate")
            .unwrap()
            .starts_with("Basic")
    );
    let wrong = post_form(&http, &token_url, Auth::Basic(CLIENT, "wrong"), &pairs).await;
    assert_eq!(wrong.status, 401);
    assert_eq!(wrong.json["error"], "invalid_client");
    let both = http
        .post(&token_url)
        .basic_auth(CLIENT, Some(SECRET))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form(&[
            ("grant_type", "authorization_code"),
            ("client_secret", SECRET),
        ]))
        .send()
        .await
        .unwrap();
    assert_eq!(both.status().as_u16(), 400);
    // A grant the provider does not offer, no grant, and a JSON body.
    let reply = post_form(
        &http,
        &token_url,
        Auth::Basic(CLIENT, SECRET),
        &[("grant_type", "client_credentials")],
    )
    .await;
    assert_eq!(reply.json["error"], "unsupported_grant_type");
    let reply = post_form(&http, &token_url, Auth::Basic(CLIENT, SECRET), &[]).await;
    assert_eq!(reply.json["error"], "invalid_request");
    let json_body = http
        .post(&token_url)
        .basic_auth(CLIENT, Some(SECRET))
        .header("content-type", "application/json")
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(json_body.status().as_u16(), 400);
}
