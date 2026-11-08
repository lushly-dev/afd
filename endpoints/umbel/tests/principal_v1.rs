//! Who a verified caller is (phase 5 specification, sections 2.1, 4.1 to 4.3, 4.5 and 4.6; step
//! 2b), end to end over HTTP with `umbel-testkit-idp`'s tokens: the version 1 projection,
//! namespaces and subject claims, services three ways, the `~` form of long and unusual ids,
//! `act` kept only from an `act` issuer, groups from claims, equivalents one way, the operator's
//! join, and the interim scope rule until step 3.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use jsonschema::Validator;
use serde_json::{Value, json};
use support::oauth::{Running, Setup, modern};

fn principal_schema() -> Validator {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("schemas/principal.v1.json");
    let schema: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

fn expect_valid(principal: &Value) {
    let validator = principal_schema();
    let errors: Vec<String> = validator
        .iter_errors(principal)
        .map(|error| error.to_string())
        .collect();
    assert!(errors.is_empty(), "{errors:?}: {principal}");
}

#[tokio::test]
async fn a_persons_client_is_projected_as_version_1() {
    let running = Running::start(Setup {
        rest: "[spaces.alpha]\n[spaces.hidden]\nreaders = [\"human:corp/bo\"]",
        ..Setup::default()
    })
    .await;
    let token = running
        .token()
        .client_id("cli-app")
        .scopes(["umbel:read", "umbel:write:alpha", "other:admin"])
        .sign();
    let data = running.whoami(&token).await;
    let principal = &data["principal"];
    assert_eq!(
        *principal,
        json!({
            "version": 1,
            "actor": { "kind": "agent", "id": "corp/cli-app", "onBehalfOf": "corp/ada" },
            "transport": "http",
            "authentication": "verified",
            "namespace": "corp",
            "issuer": "as",
            "delegationChain": [{ "kind": "agent", "id": "corp/cli-app" }],
            "tokenBinding": { "kind": "bearer" },
            "humanPresent": null,
            "scopes": ["umbel:read", "umbel:write:alpha"],
            "spaces": { "alpha": ["read", "write"], "main": ["read"] },
            "policyDecision": { "decision": "allow", "policy": "auth", "reason": null },
            "policyVersion": running.host.workspace().config().policy_version,
        })
    );
    expect_valid(principal);
    assert_eq!(data["actor"], principal["actor"]);
    assert_eq!(data["claimGroups"], json!([]));
    // The token is a person's: no field holds it or AFD's credentials.
    assert!(!data.to_string().contains(&token));
}

#[tokio::test]
async fn services_are_recognised_by_sub_by_client_list_and_by_claim() {
    let running = Running::start(Setup {
        issuer: "algorithms = [\"ES256\"]\nservices = { clients = [\"build-bot\"], claim = { name = \"idtyp\", value = \"app\" } }",
        ..Setup::default()
    })
    .await;
    let service = json!({ "kind": "service", "id": "corp/build-bot" });
    for token in [
        running
            .token()
            .subject("build-bot")
            .client_id("build-bot")
            .sign(),
        running.token().subject("ada").client_id("build-bot").sign(),
    ] {
        let principal = running.whoami(&token).await["principal"].clone();
        assert_eq!(principal["actor"], service);
        assert_eq!(principal["delegationChain"], json!([service]));
        expect_valid(&principal);
    }
    let by_claim = running
        .token()
        .client_id("cron")
        .claim("idtyp", json!("app"))
        .sign();
    assert_eq!(
        running.whoami(&by_claim).await["principal"]["actor"],
        json!({ "kind": "service", "id": "corp/cron" })
    );
    // Exactly the configured value, as a string.
    for other in [json!("App"), json!(["app"]), json!("user")] {
        let token = running
            .token()
            .client_id("cron")
            .claim("idtyp", other.clone())
            .sign();
        assert_eq!(
            running.whoami(&token).await["principal"]["actor"],
            json!({ "kind": "agent", "id": "corp/cron", "onBehalfOf": "corp/ada" }),
            "{other}"
        );
    }
}

#[tokio::test]
async fn the_subject_comes_from_the_issuers_subject_claim() {
    let running = Running::start(Setup {
        issuer: "algorithms = [\"ES256\"]\nsubject_claim = \"oid\"",
        ..Setup::default()
    })
    .await;
    let token = running.token().claim("oid", json!("0a1b-2c3d")).sign();
    assert_eq!(
        running.whoami(&token).await["principal"]["actor"]["onBehalfOf"],
        "corp/0a1b-2c3d"
    );
    // A person token without its subject claim names no one: 401, and nothing runs.
    for bad in [None, Some(json!("")), Some(json!(7))] {
        let mut builder = running.token();
        if let Some(value) = bad.clone() {
            builder = builder.claim("oid", value);
        }
        let reply = running
            .call(Some(&builder.sign()), "fixture-touch", json!({}))
            .await;
        assert_eq!(reply.status, 401, "{bad:?}: {}", reply.text);
    }
}

#[tokio::test]
async fn long_and_tilde_ids_take_the_hashed_form() {
    let running = Running::start(Setup::default()).await;
    let long_client = "c".repeat(130);
    let tilde_subject = "~ada";
    let token = running
        .token()
        .client_id(&long_client)
        .subject(tilde_subject)
        .sign();
    let principal = running.whoami(&token).await["principal"].clone();
    let client = format!("corp/{}", umbel::auth::mapped_id("corp", &long_client));
    let person = format!("corp/{}", umbel::auth::mapped_id("corp", tilde_subject));
    assert_eq!(principal["actor"]["id"], json!(client));
    assert_eq!(principal["actor"]["onBehalfOf"], json!(person));
    for id in [&client, &person] {
        let (_, hashed) = id.split_once('/').unwrap();
        assert!(hashed.starts_with('~') && hashed.len() == 53, "{id}");
        assert!(umbel::auth::is_mapped_id("corp", hashed), "{id}");
    }
    assert!(!principal.to_string().contains(&long_client));
    expect_valid(&principal);
}

#[tokio::test]
async fn act_is_recorded_from_an_act_issuer_and_ignored_from_another() {
    let act = json!({ "sub": "planner", "act": { "sub": "orchestrator" } });
    let running = Running::start(Setup {
        issuer: "algorithms = [\"ES256\"]\ndelegation = \"act\"",
        ..Setup::default()
    })
    .await;
    let token = running
        .token()
        .client_id("planner")
        .claim("act", act.clone())
        .sign();
    let principal = running.whoami(&token).await["principal"].clone();
    assert_eq!(
        principal["delegationChain"],
        json!([
            { "kind": "agent", "id": "corp/planner" },
            { "kind": "agent", "id": "corp/orchestrator" },
        ])
    );
    expect_valid(&principal);
    // An act the host cannot map from an act issuer is refused.
    let token = running
        .token()
        .claim(
            "act",
            json!({ "sub": "planner", "iss": "https://other.example.com" }),
        )
        .sign();
    assert_eq!(
        running
            .call(Some(&token), "fixture-whoami", json!({}))
            .await
            .status,
        401
    );

    let running = Running::start(Setup::default()).await;
    let token = running
        .token()
        .client_id("planner")
        .claim("act", act)
        .sign();
    assert_eq!(
        running.whoami(&token).await["principal"]["delegationChain"],
        json!([{ "kind": "agent", "id": "corp/planner" }])
    );
}

/// `event-list` in `space` as `token`: its `CommandResult`.
async fn list_events(running: &Running, token: &str, space: &str) -> Value {
    running
        .result(token, "event-list", json!({ "space": space }))
        .await
}

#[tokio::test]
async fn groups_from_claims_join_static_members_for_the_token_only() {
    let running = Running::start(Setup {
        rest: r#"[spaces.eng-only]
readers = ["group:eng"]

[spaces.ops-only]
readers = ["group:ops"]

[access.groups.eng]
members = ["human:corp/cy"]
claim = { issuer = "as", name = "groups", value = "eng" }

[access.groups.ops]
members = []
claim = { issuer = "as", name = "role", value = "ops" }
"#,
        ..Setup::default()
    })
    .await;
    let member = running
        .token()
        .claim("groups", json!(["eng", "other"]))
        .sign();
    let data = running.whoami(&member).await;
    assert_eq!(data["claimGroups"], json!(["eng"]));
    assert!(data["principal"]["spaces"]["eng-only"].is_array(), "{data}");
    assert!(
        data["principal"]["spaces"].get("ops-only").is_none(),
        "{data}"
    );
    assert_eq!(
        list_events(&running, &member, "eng-only").await["success"],
        json!(true)
    );
    // A string claim holds its value too; a near miss does not.
    let ops = running.token().claim("role", json!("ops")).sign();
    assert_eq!(running.whoami(&ops).await["claimGroups"], json!(["ops"]));
    for claim in [json!("Eng"), json!(["engineering"]), json!({ "eng": true })] {
        let token = running.token().claim("groups", claim.clone()).sign();
        assert_eq!(
            running.whoami(&token).await["claimGroups"],
            json!([]),
            "{claim}"
        );
    }
    // Without the claim, the same person reads nothing of the group's: membership lasted only
    // as long as the token that carried it.
    let plain = running.token().sign();
    let refused = list_events(&running, &plain, "eng-only").await;
    assert_eq!(
        refused["error"]["code"],
        json!("SPACE_NOT_READABLE"),
        "{refused}"
    );
    // Static members are unioned: cy reads without the claim.
    let cy = running.token().subject("cy").sign();
    assert_eq!(
        list_events(&running, &cy, "eng-only").await["success"],
        json!(true)
    );
}

#[tokio::test]
async fn equivalents_give_the_namespaced_person_their_legacy_records_one_way() {
    let running = Running::start(Setup {
        principal: "local_id = \"corp/ada\"\n[principal.equivalents]\n\"human:ada\" = \"human:corp/ada\"",
        rest: "[spaces.legacy]\nreaders = [\"human:ada\"]",
        ..Setup::default()
    })
    .await;
    let ada = running.token().sign();
    assert_eq!(
        list_events(&running, &ada, "legacy").await["success"],
        json!(true)
    );
    assert!(running.whoami(&ada).await["principal"]["spaces"]["legacy"].is_array());
    let bo = running.token().subject("bo").sign();
    assert_eq!(
        list_events(&running, &bo, "legacy").await["error"]["code"],
        json!("SPACE_NOT_READABLE")
    );
    // The join (4.6): the operator at the CLI is the same principal as their hosted identity.
    let operator = format!(
        "human:{}",
        running.host.workspace().config().principal.local_id
    );
    let hosted = format!(
        "human:{}",
        running.whoami(&ada).await["principal"]["actor"]["onBehalfOf"]
            .as_str()
            .unwrap()
    );
    assert_eq!(operator, hosted);
}

#[tokio::test]
async fn until_step_3_only_unqualified_scopes_authorise_a_call() {
    let running = Running::start(Setup {
        rest: "[spaces.alpha]",
        ..Setup::default()
    })
    .await;
    let forbidden = |reply: &support::hosted::Reply| -> String {
        assert_eq!(reply.status, 403, "{}", reply.text);
        reply
            .headers
            .get("www-authenticate")
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned()
    };
    // Space-qualified scopes alone: 403 naming the unqualified scope, never a space.
    let qualified = running
        .token()
        .scopes(["umbel:read:main", "umbel:write:alpha"])
        .sign();
    let challenge = forbidden(
        &running
            .call(Some(&qualified), "fixture-whoami", json!({}))
            .await,
    );
    assert!(
        challenge.contains("error=\"insufficient_scope\""),
        "{challenge}"
    );
    assert!(challenge.contains("scope=\"umbel:read\""), "{challenge}");
    assert!(
        !challenge.contains("alpha") && !challenge.contains("main"),
        "{challenge}"
    );
    // Read alone: reads run, a mutation is 403 naming `umbel:write`.
    let read = running.token().scopes(["umbel:read"]).sign();
    running.whoami(&read).await;
    let challenge = forbidden(&running.call(Some(&read), "fixture-touch", json!({})).await);
    assert!(challenge.contains("scope=\"umbel:write\""), "{challenge}");
    // Read and write: both run.
    let write = running.token().scopes(["umbel:read", "umbel:write"]).sign();
    running.whoami(&write).await;
    assert_eq!(
        running.result(&write, "fixture-touch", json!({})).await["data"],
        json!(true)
    );
    // Until step 3 every request needs `umbel:read` itself, so write alone is refused, stricter
    // than 5.1's implication.
    let write_only = running.token().scopes(["umbel:write"]).sign();
    let challenge = forbidden(
        &running
            .call(Some(&write_only), "fixture-touch", json!({}))
            .await,
    );
    assert!(challenge.contains("scope=\"umbel:read\""), "{challenge}");
    // No Umbel scope: every request is refused, the listings, resources and skills included.
    let none = running.token().scopes(["openid"]).sign();
    forbidden(&running.call(Some(&none), "fixture-whoami", json!({})).await);
    for method in ["tools/list", "resources/list", "server/discover"] {
        forbidden(&modern(&running.client, method, json!({}), Some(&none)).await);
    }
    // The listing shows only what the token could call.
    let listed = |token: String| {
        let running = &running;
        async move {
            let reply = modern(&running.client, "tools/list", json!({}), Some(&token)).await;
            assert_eq!(reply.status, 200, "{}", reply.text);
            reply.text
        }
    };
    let text = listed(read).await;
    assert!(
        text.contains("fixture-whoami") && !text.contains("fixture-touch"),
        "{text}"
    );
    let text = listed(write).await;
    assert!(text.contains("fixture-touch"), "{text}");
}

/// A compiled plugin whose command reports `CallContext.equivalents`.
struct EquivalentsProbe;

impl umbel_sdk::Plugin for EquivalentsProbe {
    fn manifest(&self) -> &'static str {
        r#"manifest_version = 4
protocol = 1

[plugin]
id = "eq"
title = "Equivalents probe"
version = "0.1.0"
description = "Reports the caller's equivalents."
kind = "compiled"
domains = ["eq"]

[[commands]]
name = "eq-who"
description = "Report CallContext.equivalents."
effects = ["inspect"]
input_schema = { type = "object" }
"#
    }

    fn handle(&self, _name: &str, _input: Value, cx: &mut umbel_sdk::Cx) -> umbel_sdk::Outcome {
        umbel_sdk::success(json!({ "equivalents": cx.call().equivalents }))
    }
}

#[tokio::test]
async fn a_compiled_plugin_sees_the_legacy_principals_its_caller_stands_for() {
    let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
    let setup = Setup {
        principal: "local_id = \"corp/ada\"\n[principal.equivalents]\n\"human:ada\" = \"human:corp/ada\"",
        rest: "[plugins]\nenabled = [\"eq\"]\n\n[plugins.eq]\nsource = \"compiled:eq\"\n",
        ..Setup::default()
    };
    let dir = support::workspace(&support::oauth::config(&kit, &setup));
    let configure = |builder: umbel::HostBuilder| {
        builder
            .with_compiled(umbel::plugins::sdk(EquivalentsProbe))
            .register(support::oauth::whoami())
            .register(support::oauth::touch())
    };
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = configure(
        umbel::HostBuilder::open(dir.path())
            .unwrap()
            .with_auth_root_certificate(kit.ca().certificate_pem().as_bytes().to_vec())
            .with_unfinished_oauth()
            .with_auth_clock(clock.clone()),
    )
    .seal()
    .unwrap();
    let served = support::hosted::Served::start(&host).await;
    let running = Running {
        client: support::hosted::Client::plain(served.address),
        kit,
        dir,
        host,
        served,
        clock,
    };
    let ask = |subject: &'static str| {
        let running = &running;
        async move {
            let token = running.token().subject(subject).sign();
            let result = running
                .result(
                    &token,
                    "afd-call",
                    json!({ "command": "eq-who", "input": {} }),
                )
                .await;
            assert_eq!(result["success"], json!(true), "{result}");
            result["data"]["equivalents"].clone()
        }
    };
    assert_eq!(ask("ada").await, json!(["human:ada"]));
    assert_eq!(ask("bo").await, json!([]));
    // The operator at the CLI is the same person, with the same legacy principal.
    let run = support::cli_with(
        running.dir.path(),
        &["call", "eq-who", "{}"],
        support::Scripted::new(true, true),
        configure,
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert_eq!(run.json()["data"]["equivalents"], json!(["human:ada"]));
}
