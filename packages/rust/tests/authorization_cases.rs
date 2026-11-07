//! `spec/authorization.json`: every language-neutral case of `spec/authorization.md`, loaded and
//! checked section by section against the public functions the server itself uses.
#![cfg(feature = "server-auth")]

use afd::server::auth::{
    audience_accepts, check_claims, check_jws_header, check_key_fit, extract_bearer,
    parse_scope_claim, request_decision, static_decision, ProtectedResource, RequestDecision,
    RuleCode, ScopeDecision, TokenRules,
};
use afd::{credentials_binding, principal_binding, Actor, Credentials};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

fn cases() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/authorization.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn section<'a>(cases: &'a Value, name: &str) -> &'a Vec<Value> {
    cases[name]
        .as_array()
        .unwrap_or_else(|| panic!("no {name}"))
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_owned())
        .collect()
}

fn rule(expected: &Value) -> Option<RuleCode> {
    expected
        .get("refused")
        .and_then(Value::as_str)
        .map(|name| RuleCode::from_name(name).unwrap_or_else(|| panic!("unknown rule {name}")))
}

const SECTIONS: [&str; 13] = [
    "bearer",
    "challenges",
    "metadataUrls",
    "metadataDocuments",
    "audience",
    "scopeClaims",
    "jwtHeaders",
    "keys",
    "claims",
    "staticScopes",
    "batches",
    "principalBindings",
    "inputDigests",
];

#[test]
fn every_section_is_loaded() {
    let cases = cases();
    let total: usize = SECTIONS
        .iter()
        .map(|name| section(&cases, name).len())
        .sum();
    assert_eq!(total, 184);
    let listed: Vec<&str> = cases
        .as_object()
        .unwrap()
        .iter()
        .filter(|(_, value)| value.is_array())
        .map(|(name, _)| name.as_str())
        .collect();
    let mut known = SECTIONS.to_vec();
    known.sort_unstable();
    let mut listed = listed;
    listed.sort_unstable();
    assert_eq!(listed, known, "a section this loader does not check");
}

#[test]
fn bearer() {
    for case in section(&cases(), "bearer") {
        let values: Vec<&[u8]> = case["authorization"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().as_bytes())
            .collect();
        let query = case.get("query").and_then(Value::as_str);
        let form = case
            .get("formBody")
            .and_then(Value::as_str)
            .map(str::as_bytes);
        let got = extract_bearer(&values, query, form);
        let expected = &case["expected"];
        match rule(expected) {
            Some(code) => assert_eq!(got, Err(code), "{}", case["description"]),
            None => assert_eq!(
                got,
                Ok(expected["token"].as_str().unwrap()),
                "{}",
                case["description"]
            ),
        }
    }
}

#[test]
fn challenges() {
    for case in section(&cases(), "challenges") {
        let metadata = ProtectedResource::new(
            case["resource"].as_str().unwrap(),
            ["https://auth.example.com"],
        )
        .unwrap()
        .with_scopes_supported(strings(&case["scopesSupported"].clone().or_empty()))
        .unwrap();
        assert_eq!(metadata.metadata_url(), case["resourceMetadata"]);
        let (header, body) = match case["status"].as_u64().unwrap() {
            401 => {
                let sent = case["tokenSent"].as_bool().unwrap();
                (
                    metadata.unauthorized_challenge(sent),
                    metadata.unauthorized_body(),
                )
            }
            403 => {
                let missing = strings(&case["missing"]);
                (
                    metadata.forbidden_challenge(&missing),
                    metadata.forbidden_body(&missing),
                )
            }
            status => panic!("status {status}"),
        };
        assert_eq!(header, case["header"], "{}", case["description"]);
        assert_eq!(body, case["body"], "{}", case["description"]);
    }
}

trait OrEmpty {
    fn or_empty(self) -> Value;
}

impl OrEmpty for Value {
    fn or_empty(self) -> Value {
        if self.is_null() {
            json!([])
        } else {
            self
        }
    }
}

#[test]
fn metadata_urls() {
    for case in section(&cases(), "metadataUrls") {
        let metadata = ProtectedResource::new(
            case["resource"].as_str().unwrap(),
            ["https://auth.example.com"],
        )
        .unwrap();
        assert_eq!(metadata.metadata_urls(), strings(&case["urls"]));
        assert_eq!(metadata.metadata_url(), case["urls"][0]);
    }
}

#[test]
fn metadata_documents() {
    for case in section(&cases(), "metadataDocuments") {
        let options = &case["options"];
        let mut metadata = ProtectedResource::new(
            options["resource"].as_str().unwrap(),
            strings(&options["authorizationServers"]),
        )
        .unwrap()
        .with_scopes_supported(strings(&options["scopesSupported"]))
        .unwrap()
        .with_bound_tokens_required(options["requireBoundTokens"].as_bool().unwrap());
        if let Some(name) = options.get("resourceName").and_then(Value::as_str) {
            metadata = metadata.with_resource_name(name);
        }
        assert_eq!(
            metadata.document(),
            case["expected"],
            "{}",
            case["description"]
        );
    }
}

#[test]
fn audience() {
    for case in section(&cases(), "audience") {
        assert_eq!(
            audience_accepts(case.get("aud"), case["resource"].as_str().unwrap()),
            case["accepted"].as_bool().unwrap(),
            "{}",
            case["description"]
        );
    }
}

#[test]
fn scope_claims() {
    for case in section(&cases(), "scopeClaims") {
        let got = parse_scope_claim(
            case.get("scope"),
            case["prefix"].as_str(),
            case["limit"].as_u64().unwrap() as usize,
        );
        match rule(case) {
            Some(code) => assert_eq!(got, Err(code), "{}", case["description"]),
            None => assert_eq!(got, Ok(strings(&case["scopes"])), "{}", case["description"]),
        }
    }
}

#[test]
fn jwt_headers() {
    for case in section(&cases(), "jwtHeaders") {
        let algorithms = strings(&case["algorithms"]);
        let algorithms: Vec<&str> = algorithms.iter().map(String::as_str).collect();
        let got = check_jws_header(&case["header"], &algorithms);
        match rule(&case["expected"]) {
            Some(code) => assert_eq!(got, Err(code), "{}", case["description"]),
            None => {
                assert_eq!(case["expected"], "accepted");
                assert_eq!(got, Ok(()), "{}", case["description"]);
            }
        }
    }
}

#[test]
fn keys() {
    for case in section(&cases(), "keys") {
        let key = Some(&case["key"]).filter(|key| !key.is_null());
        let got = check_key_fit(&case["header"], key);
        match rule(&case["expected"]) {
            Some(code) => assert_eq!(got, Err(code), "{}", case["description"]),
            None => assert_eq!(got, Ok(()), "{}", case["description"]),
        }
    }
}

/// The verifier's rules from the top-level `config` with the case's `config` over it.
fn rules_for(cases: &Value, case: &Value) -> (String, TokenRules) {
    let mut config: Map<String, Value> = cases["config"].as_object().unwrap().clone();
    if let Some(over) = case.get("config").and_then(Value::as_object) {
        config.extend(over.clone());
    }
    let mut rules = TokenRules::new(config["resource"].as_str().unwrap())
        .unwrap()
        .with_clock_skew_s(config["clockSkewS"].as_u64().unwrap())
        .unwrap()
        .with_max_token_lifetime_s(config["maxTokenLifetimeS"].as_u64().unwrap())
        .unwrap()
        .with_scope_limit(config["scopeLimit"].as_u64().unwrap() as usize)
        .unwrap()
        .with_require_bound_tokens(config["requireBoundTokens"].as_bool().unwrap());
    if let Some(prefix) = config["scopePrefix"].as_str() {
        rules = rules.with_scope_prefix(prefix).unwrap();
    }
    (config["issuer"].as_str().unwrap().to_owned(), rules)
}

#[test]
fn claims() {
    let cases = cases();
    let now = cases["now"].as_i64().unwrap();
    for case in section(&cases, "claims") {
        let (issuer, rules) = rules_for(&cases, case);
        let got = check_claims(
            case["claims"].as_object().unwrap(),
            &issuer,
            &rules,
            now,
            case["certificate"].as_str(),
        );
        match rule(&case["expected"]) {
            Some(code) => assert_eq!(
                got.map(|_| "credentials"),
                Err(code),
                "{}",
                case["description"]
            ),
            None => assert_eq!(
                serde_json::to_value(got.unwrap()).unwrap(),
                case["expected"]["credentials"],
                "{}",
                case["description"]
            ),
        }
    }
}

#[test]
fn static_scopes() {
    for case in section(&cases(), "staticScopes") {
        let got = static_decision(
            &strings(&case["requiredScopes"]),
            &strings(&case["scopes"]),
            &strings(&case["held"]),
        );
        let expected = match &case["expected"] {
            Value::String(allowed) if allowed == "allowed" => ScopeDecision::Allowed,
            expected => ScopeDecision::Missing(strings(&expected["missing"])),
        };
        assert_eq!(got, expected, "{}", case["description"]);
    }
}

#[test]
fn batches() {
    for case in section(&cases(), "batches") {
        let decisions: Vec<ScopeDecision> = case["steps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|step| match step {
                Value::String(name) if name == "allowed" => ScopeDecision::Allowed,
                Value::String(name) if name == "defer" => ScopeDecision::Defer,
                step => ScopeDecision::Missing(strings(&step["missing"])),
            })
            .collect();
        let decision = request_decision(&decisions);
        match &case["expected"] {
            Value::String(proceed) if proceed == "proceed" => {
                assert_eq!(
                    decision,
                    RequestDecision::Proceed,
                    "{}",
                    case["description"]
                );
            }
            expected => {
                let RequestDecision::Forbidden(missing) = decision else {
                    panic!("{} proceeded", case["description"]);
                };
                assert_eq!(
                    missing.join(" "),
                    expected["forbidden"].as_str().unwrap(),
                    "{}",
                    case["description"]
                );
            }
        }
    }
}

fn credentials_from(value: &Value) -> Option<Credentials> {
    let object = value.as_object()?;
    let text = |name: &str| object[name].as_str().unwrap().to_owned();
    let mut credentials = Credentials::new(
        text("issuer"),
        text("subject"),
        text("clientId"),
        text("resource"),
        object["issuedAt"].as_i64().unwrap(),
        object["expiresAt"].as_i64().unwrap(),
    )
    .with_scopes(strings(&object["scopes"]));
    if let Some(acr) = object.get("acr").and_then(Value::as_str) {
        credentials = credentials.with_acr(acr);
    }
    Some(credentials)
}

#[test]
fn principal_bindings() {
    for case in section(&cases(), "principalBindings") {
        let actor: Option<Actor> = serde_json::from_value(case["actor"].clone()).unwrap();
        let credentials = credentials_from(&case["credentials"]);
        assert_eq!(
            principal_binding(actor.as_ref(), credentials.as_ref()),
            case["binding"],
            "{}",
            case["description"]
        );
        assert_eq!(
            credentials_binding(credentials.as_ref()),
            case["credentialsBinding"],
            "{}",
            case["description"]
        );
    }
}

/// The relay's input digest is step 0d's API; here the crate's canonical JSON is checked against
/// the cases, and the digest is computed from it as the specification states.
#[cfg(feature = "approval")]
#[test]
fn input_digests() {
    for case in section(&cases(), "inputDigests") {
        let canonical = afd::canonical_json(&case["input"]).unwrap();
        assert_eq!(canonical, case["canonical"], "{}", case["description"]);
        let digest = URL_SAFE_NO_PAD.encode(Sha256::digest(canonical.as_bytes()));
        assert_eq!(digest, case["inputDigest"], "{}", case["description"]);
    }
}
