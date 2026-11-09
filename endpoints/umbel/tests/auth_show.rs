//! `auth-show` (phase 5 specification, section 10.3) and `workspace-show`'s hosted answer
//! (sections 6.1, 9.4 and 4.7; step 2c): each caller sees its own projection only, never a
//! token, a claim or a secret; and in a hosted mode a caller other than the operator learns no
//! workspace name or path and no space it does not read.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use support::oauth::{Running, Setup};
use support::{Scripted, cli_with};

/// The keys `auth-show` answers with, exactly section 10.3's list.
const KEYS: [&str; 8] = [
    "authentication",
    "delegationChain",
    "issuer",
    "namespace",
    "principal",
    "scopes",
    "spaces",
    "tokenExpiresAt",
];

/// Spaces `alpha` (ada's), `beta` (bo's) and `main` (the configuration's, read by anyone).
const SPACES: &str = "[spaces.alpha]\ntitle = \"Alpha\"\nreaders = [\"human:corp/ada\"]\n\n[spaces.beta]\ntitle = \"Beta hidden\"\nreaders = [\"human:corp/bo\"]\n";

fn keys(data: &Value) -> Vec<String> {
    let mut keys: Vec<String> = data.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    keys
}

/// `command`'s result for `token`, through `afd-call`.
async fn call(running: &Running, token: &str, command: &str) -> Value {
    let result = running
        .result(
            token,
            "afd-call",
            json!({ "command": command, "input": {} }),
        )
        .await;
    assert_eq!(result["success"], json!(true), "{result}");
    result
}

/// `args` at the operator's CLI of `running`'s workspace, which registers its fixtures.
async fn operator(running: &Running, args: &[&str]) -> support::Run {
    cli_with(
        running.dir.path(),
        args,
        Scripted::no_terminal(),
        |builder| {
            builder
                .register(support::oauth::whoami())
                .register(support::oauth::touch())
        },
    )
    .await
}

fn iso(seconds: i64) -> String {
    chrono::DateTime::from_timestamp(seconds, 0)
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[tokio::test]
async fn auth_show_is_the_verified_callers_own_projection_and_nothing_more() {
    let running = Running::start(Setup {
        rest: SPACES,
        ..Setup::default()
    })
    .await;
    let issued = running.now_s();
    let canary_jti = "jti-canary-5d2f9a71c4e8";
    let ada = running
        .token()
        .jti(canary_jti)
        .claim("groups", json!(["group-claim-canary"]))
        .claim("acr", json!("acr-canary"))
        .claim("auth_time", json!(issued - 7))
        .sign();
    let result = call(&running, &ada, "auth-show").await;
    let data = &result["data"];
    assert_eq!(keys(data), KEYS, "{data}");
    assert_eq!(
        data["principal"],
        json!({ "kind": "agent", "id": "corp/test-client", "onBehalfOf": "corp/ada" })
    );
    assert_eq!(data["namespace"], json!("corp"));
    assert_eq!(data["issuer"], json!("as"));
    assert_eq!(data["authentication"], json!("verified"));
    assert_eq!(data["scopes"], json!(["umbel:read", "umbel:write"]));
    // The spaces ada reads, with the verbs her scopes grant there; not bo's.
    assert_eq!(
        data["spaces"],
        json!({ "alpha": ["read", "write"], "main": ["read", "write"] })
    );
    assert_eq!(
        data["delegationChain"],
        json!([{ "kind": "agent", "id": "corp/test-client" }])
    );
    assert_eq!(data["tokenExpiresAt"], json!(iso(issued + 300)));

    // Never the token, its parts or any other claim.
    let text = result.to_string();
    for part in ada.split('.') {
        assert!(!text.contains(part), "a part of the token was shown");
    }
    for canary in [canary_jti, "group-claim-canary", "acr-canary"] {
        assert!(!text.contains(canary), "{canary} in {text}");
    }
    for hidden in [
        "beta",
        "policyVersion",
        "policyDecision",
        "credentials",
        "claimGroups",
    ] {
        assert!(!text.contains(hidden), "{hidden} in {text}");
    }

    // bo sees his own, and nothing of ada's.
    let bo = running.token().subject("bo").sign();
    let data = call(&running, &bo, "auth-show").await["data"].clone();
    assert_eq!(data["principal"]["onBehalfOf"], json!("corp/bo"));
    assert_eq!(
        data["spaces"],
        json!({ "beta": ["read", "write"], "main": ["read", "write"] })
    );
    assert!(!data.to_string().contains("alpha"), "{data}");
}

#[tokio::test]
async fn auth_show_on_the_cli_stdio_and_the_library_names_no_token() {
    let running = Running::start(Setup::default()).await;
    // The operator at the CLI.
    let run = operator(&running, &["call", "auth-show"]).await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let data = run.json()["data"].clone();
    assert_eq!(keys(&data), KEYS, "{data}");
    assert_eq!(
        data["principal"],
        json!({ "kind": "human", "id": "corp/ada" })
    );
    assert_eq!(data["authentication"], json!("process"));
    for absent in ["namespace", "issuer", "scopes", "spaces", "tokenExpiresAt"] {
        assert_eq!(data[absent], Value::Null, "{absent}: {data}");
    }
    assert_eq!(data["delegationChain"], json!([]));

    // The library: the embedder's actor.
    let host = &running.host;
    let context = host.context(Actor::new(ActorKind::Agent).with_id("corp/embedded"));
    let result = host
        .registry()
        .execute("auth-show", json!({}), Some(context))
        .await;
    let data = result.data.unwrap();
    assert_eq!(data["authentication"], json!("embedder"));
    assert_eq!(data["principal"]["id"], json!("corp/embedded"));

    // A call no surface prepared has no caller to show.
    let bare = host.registry().execute("auth-show", json!({}), None).await;
    assert_eq!(bare.error.unwrap().code, "UNAUTHORIZED");
}

#[tokio::test]
async fn workspace_show_names_only_what_a_hosted_caller_reads() {
    let running = Running::start(Setup {
        rest: SPACES,
        ..Setup::default()
    })
    .await;
    let path = running.dir.path().display().to_string();
    let ada = running.token().sign();
    let result = call(&running, &ada, "workspace-show").await;
    let data = &result["data"];
    assert_eq!(data["name"], Value::Null, "{data}");
    assert_eq!(data["workspace"], Value::Null, "{data}");
    assert_eq!(data["defaultSpace"], json!("main"));
    let ids: Vec<&str> = data["spaces"]
        .as_array()
        .unwrap()
        .iter()
        .map(|space| space["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["main", "alpha"]);
    assert_eq!(
        data["access"],
        json!({ "principals": "verified", "exact": ["library", "http"], "statistics": "per-filter" })
    );
    let text = result.to_string();
    for hidden in [path.as_str(), "beta", "Beta hidden"] {
        assert!(!text.contains(hidden), "{hidden} in {text}");
    }
    // The versions and the host stay: a client needs them to read what it is given.
    assert!(data["versions"]["principal"].is_array(), "{data}");

    // The operator, at the CLI, gets the whole answer.
    let run = operator(&running, &["call", "workspace-show"]).await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let data = run.json()["data"].clone();
    assert_eq!(data["workspace"], json!(path));
    assert!(data["name"].is_string(), "{data}");
    let ids: Vec<String> = data["spaces"]
        .as_array()
        .unwrap()
        .iter()
        .map(|space| space["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["main", "alpha", "beta"]);
    assert_eq!(data["access"]["principals"], json!("verified"));
}

#[tokio::test]
async fn workspace_show_hides_a_default_space_the_caller_cannot_read() {
    // The library is not the operator (section 4.7): an embedder's caller is treated by its
    // actor, so a person who reads only `alpha` learns neither `main` nor that it is the default.
    let running = Running::start(Setup {
        rest: SPACES,
        ..Setup::default()
    })
    .await;
    let text = std::fs::read_to_string(running.dir.path().join("umbel.toml"))
        .unwrap()
        .replace(
            "[spaces.main]\n",
            "[spaces.main]\nreaders = [\"human:corp/bo\"]\n",
        );
    std::fs::write(running.dir.path().join("umbel.toml"), text).unwrap();
    let host = umbel::HostBuilder::open(running.dir.path())
        .unwrap()
        .register(support::oauth::whoami())
        .register(support::oauth::touch())
        .seal()
        .unwrap();
    let context = host.context(
        Actor::new(ActorKind::Agent)
            .with_id("corp/app")
            .with_on_behalf_of("corp/ada"),
    );
    let result = host
        .registry()
        .execute("workspace-show", json!({}), Some(context))
        .await;
    let data = result.data.unwrap();
    assert_eq!(data["defaultSpace"], Value::Null, "{data}");
    assert_eq!(data["spaces"], json!([{ "id": "alpha", "title": "Alpha" }]));
    assert_eq!(data["name"], Value::Null);
    assert_eq!(data["workspace"], Value::Null);
}

#[tokio::test]
async fn in_mode_none_workspace_show_is_unchanged() {
    let dir = support::workspace(&format!(
        "config_version = 5\ndefault_space = \"main\"\n\n[spaces.main]\n\n{SPACES}"
    ));
    let path = dir.path().display().to_string();
    let run = cli_with(
        dir.path(),
        &["call", "workspace-show"],
        Scripted::no_terminal(),
        |b| b,
    )
    .await;
    let data = run.json()["data"].clone();
    assert_eq!(data["workspace"], json!(path));
    assert_eq!(data["spaces"].as_array().unwrap().len(), 3);
    assert_eq!(
        data["access"],
        json!({ "principals": "unverified", "exact": ["library"] })
    );
    // Every caller, the library included, gets the same in mode none.
    let host = support::host(dir.path());
    let context = host.context(Actor::new(ActorKind::Agent).with_id("anyone"));
    let result = host
        .registry()
        .execute("workspace-show", json!({}), Some(context))
        .await;
    assert_eq!(result.data.unwrap()["workspace"], json!(path));
}

#[tokio::test]
async fn workspace_show_over_stdio_in_a_hosted_mode_names_only_what_the_stdio_agent_reads() {
    // stdio is not the operator (section 4.7): its agent, `agent:corp/ada` acting for no one, reads
    // `main` (anyone) and neither `alpha` (ada the person's) nor `beta`.
    let running = Running::start(Setup {
        rest: SPACES,
        ..Setup::default()
    })
    .await;
    let mut stdio = umbel::testkit::mcp::Client::connect(
        &running.host,
        umbel::testkit::mcp::Transport::Stdio,
        umbel::testkit::mcp::Era::Modern,
    )
    .await;
    let result = stdio.afd_call("workspace-show", json!({})).await;
    let data = &result["data"];
    assert_eq!(
        data["spaces"],
        json!([{ "id": "main", "title": "main" }]),
        "{data}"
    );
    assert_eq!(data["name"], Value::Null);
    assert_eq!(data["workspace"], Value::Null);
    // And its auth-show names no token.
    let shown = stdio.afd_call("auth-show", json!({})).await;
    assert_eq!(shown["data"]["authentication"], json!("process"), "{shown}");
    assert_eq!(shown["data"]["tokenExpiresAt"], Value::Null);
}
