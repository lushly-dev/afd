//! One answer for an absent or unreadable space (phase 5 specification, sections 4.3, 5.3, 5.4 and
//! 9.4; step 3): an undeclared space and one the caller may not read, or that its token grants no
//! verb in, answer byte for byte alike on every surface a hosted caller who is not the operator
//! reaches (the registry over HTTP, every route to it, the library, a plugin's host services),
//! the token narrows host built-ins as it narrows plugins and never widens, and the listings
//! (`space-list`, `workspace-show`, `plugin-list`, `plugin-show`, `skill-list` and
//! `PLUGIN_NOT_ENABLED`) name only the spaces the caller reads. The operator keeps
//! `SPACE_NOT_FOUND` and the whole listings.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use support::hosted::Reply;
use support::oauth::{Running, Setup};
use support::plugins::Probe;
use umbel::plugins::sdk;

/// `alpha` and `beta` are ada's, `private` is bo's; `main`, the default, is anyone's. The probe
/// instance serves `alpha` and `private`, so ada reads one of its spaces and cy (who reads only
/// `main`) none.
const REST: &str = r#"[spaces.alpha]
readers = ["human:corp/ada"]

[spaces.beta]
readers = ["human:corp/ada"]

[spaces.private]
readers = ["human:corp/bo"]

[plugins]
enabled = ["probe"]

[plugins.probe]
spaces = ["alpha", "private"]
"#;

/// The probe plugin with only space commands (so it may leave the default space out), its pack
/// and its skill, and the `events` grant.
fn probe() -> Probe {
    Probe::with_manifest(
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "probe"
title = "Probe"
version = "0.3.0"
description = "A plugin whose commands report what its grants allow."
kind = "compiled"
domains = ["probe"]

[[grants]]
name = "events"
required = true
reason = "the probe reads events"

[[commands]]
name = "probe-note"
description = "Record a note, in a space."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { space = { type = "string" }, text = { type = "string" } }, additionalProperties = false }

[[commands]]
name = "probe-events"
description = "Read events through the events grant."
effects = ["inspect"]
input_schema = { type = "object", properties = { space = { type = "string" }, events_space = { type = "string" }, after = { type = "string" } }, additionalProperties = false }

[[packs]]
id = "p"
path = "packs/p"

[[skills]]
name = "probe-guide"
path = "skills/probe-guide"
"#
        .to_owned(),
    )
}

/// The commands and plugin every host of these tests has, the CLI's included.
fn configure(builder: umbel::HostBuilder) -> umbel::HostBuilder {
    builder
        .register_with_schema(
            support::fixture("fixture-spaced", |_, _| afd::success(json!(true))),
            json!({
                "type": "object",
                "properties": { "space": { "type": "string" } },
                "additionalProperties": false,
            }),
        )
        .register_with_schema(
            support::fixture("fixture-many", |_, _| afd::success(json!(true))),
            json!({
                "type": "object",
                "properties": { "spaces": { "type": "array", "items": { "type": "string" } } },
                "additionalProperties": false,
            }),
        )
        .with_compiled(sdk(probe()))
}

/// [`configure`] with the oauth fixtures `Running` registers, for the operator's CLI.
fn configure_cli(builder: umbel::HostBuilder) -> umbel::HostBuilder {
    configure(
        builder
            .register(support::oauth::whoami())
            .register(support::oauth::touch()),
    )
}

async fn running() -> Running {
    Running::start_configured(
        Setup {
            rest: REST,
            ..Setup::default()
        },
        configure,
    )
    .await
}

/// A token of `subject` with `scopes`.
fn token(running: &Running, subject: &str, scopes: &[&str]) -> String {
    running
        .token()
        .subject(subject)
        .scopes(scopes.iter().copied())
        .sign()
}

/// `command` with `input` through `afd-call`.
async fn call(running: &Running, token: &str, command: &str, input: Value) -> Reply {
    running
        .call(
            Some(token),
            "afd-call",
            json!({ "command": command, "input": input }),
        )
        .await
}

fn result(reply: &Reply) -> Value {
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.json()["result"]["structuredContent"].clone()
}

/// The reply with what differs between any two calls removed: the trace id and the times a call
/// took (a batch's `timing`), wherever they appear. Everything else must be equal byte for byte.
fn stable(reply: &Reply) -> String {
    fn strip(value: &mut Value) {
        match value {
            Value::Object(members) => {
                members.remove("traceId");
                members.remove("executionTimeMs");
                members.remove("durationMs");
                members.remove("timing");
                for member in members.values_mut() {
                    strip(member);
                }
            }
            Value::Array(items) => items.iter_mut().for_each(strip),
            Value::String(text) => {
                // A tool result's text content carries the structured content again, as JSON.
                if let Ok(mut inner) = serde_json::from_str::<Value>(text)
                    && inner.is_object()
                {
                    strip(&mut inner);
                    *text = inner.to_string();
                }
            }
            _ => {}
        }
    }
    let mut value = reply.json();
    assert!(!value.is_null(), "{}", reply.text);
    strip(&mut value);
    format!("{} {}", reply.status, value)
}

/// Assert that `unreadable` and `absent` are section 5.4's one answer, alike byte for byte, and
/// name neither space.
fn one_answer(unreadable: &Reply, absent: &Reply, names: &[&str], what: &str) {
    assert_eq!(stable(unreadable), stable(absent), "{what}");
    assert_eq!(unreadable.status, 200, "{what}: {}", unreadable.text);
    assert!(
        unreadable.text.contains("SPACE_NOT_READABLE"),
        "{what}: {}",
        unreadable.text
    );
    assert!(
        unreadable
            .text
            .contains("The space does not exist or you may not read it"),
        "{what}: {}",
        unreadable.text
    );
    for name in names {
        assert!(
            !unreadable.text.contains(name),
            "{what}: {}",
            unreadable.text
        );
        assert!(!absent.text.contains(name), "{what}: {}", absent.text);
    }
}

#[tokio::test]
async fn an_absent_and_an_unreadable_space_answer_alike_on_every_route() {
    let running = running().await;
    // Unqualified scopes: readability alone decides.
    let ada = token(&running, "ada", &["umbel:read", "umbel:write"]);
    type Input = Box<dyn Fn(&str) -> Value>;
    let probes: Vec<(&str, Input)> = vec![
        ("event-list", Box::new(|space| json!({ "space": space }))),
        (
            "event-ack",
            Box::new(|space| json!({ "space": space, "cursor": format!("v0:{space}:0") })),
        ),
        (
            "fixture-spaced",
            Box::new(|space| json!({ "space": space })),
        ),
        (
            "probe-note",
            Box::new(|space| json!({ "space": space, "text": "x" })),
        ),
        (
            "event-list",
            Box::new(|space| json!({ "space": space, "consumer": "other", "limit": 5 })),
        ),
    ];
    for (command, input) in &probes {
        let unreadable = call(&running, &ada, command, input("private")).await;
        let absent = call(&running, &ada, command, input("ghost")).await;
        one_answer(&unreadable, &absent, &["private", "ghost"], command);
    }
    // The first-class tool, afd-batch and afd-pipe give the same answer.
    let unreadable = running
        .call(Some(&ada), "event-list", json!({ "space": "private" }))
        .await;
    let absent = running
        .call(Some(&ada), "event-list", json!({ "space": "ghost" }))
        .await;
    one_answer(&unreadable, &absent, &["private", "ghost"], "first-class");
    for meta in ["afd-batch", "afd-pipe"] {
        let key = if meta == "afd-batch" {
            "commands"
        } else {
            "steps"
        };
        let steps = |space: &str| json!({ key: [ { "command": "event-list", "input": { "space": space } } ] });
        let unreadable = running.call(Some(&ada), meta, steps("private")).await;
        let absent = running.call(Some(&ada), meta, steps("ghost")).await;
        one_answer(&unreadable, &absent, &["private", "ghost"], meta);
    }
    // A malformed list says nothing about which spaces exist.
    for (one, two) in [
        (json!(["private", "private"]), json!(["ghost", "ghost"])),
        (json!(["main", "private"]), json!(["main", "ghost"])),
    ] {
        let first = call(&running, &ada, "fixture-many", json!({ "spaces": one })).await;
        let second = call(&running, &ada, "fixture-many", json!({ "spaces": two })).await;
        assert_eq!(stable(&first), stable(&second));
        assert!(first.text.contains("\"success\":false"), "{}", first.text);
    }
}

#[tokio::test]
async fn a_token_granting_a_verb_in_an_unreadable_space_is_deferred_never_403() {
    let running = running().await;
    // The token names both spaces; ada may read neither (one is bo's, one does not exist).
    // Readability comes before scope: no 403 names either, both get the one answer.
    let ada = token(
        &running,
        "ada",
        &["umbel:read:private", "umbel:read:ghost", "umbel:read:alpha"],
    );
    let ack = |space: &str| json!({ "space": space, "cursor": format!("v0:{space}:0") });
    let unreadable = call(&running, &ada, "event-ack", ack("private")).await;
    let absent = call(&running, &ada, "event-ack", ack("ghost")).await;
    one_answer(&unreadable, &absent, &["private", "ghost"], "qualified");
    // A space the token grants nothing in answers alike too, readable or not.
    let narrow = token(&running, "ada", &["umbel:read:alpha"]);
    for space in ["beta", "private", "ghost"] {
        let other = call(&running, &narrow, "event-list", json!({ "space": space })).await;
        one_answer(&other, &absent, &[space], space);
    }
    // While a readable space the token grants a verb in names its scope.
    let readable = call(&running, &ada, "event-ack", ack("alpha")).await;
    assert_eq!(readable.status, 403, "{}", readable.text);
}

#[tokio::test]
async fn the_token_narrows_host_built_ins_and_a_scope_never_widens() {
    let running = running().await;
    // ada reads main, alpha and beta; her token grants only main.
    let ada = token(&running, "ada", &["umbel:read:main"]);
    let listed = result(&call(&running, &ada, "event-list", json!({ "space": "main" })).await);
    assert_eq!(listed["success"], json!(true), "{listed}");
    let narrowed = call(&running, &ada, "event-list", json!({ "space": "alpha" })).await;
    let absent = call(&running, &ada, "event-list", json!({ "space": "ghost" })).await;
    one_answer(&narrowed, &absent, &["alpha"], "narrowed");
    let spaces = result(&call(&running, &ada, "space-list", json!({})).await);
    let ids: Vec<&str> = spaces["data"]["spaces"]
        .as_array()
        .unwrap()
        .iter()
        .map(|space| space["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["main"]);
    // bo holds a scope for ada's space: it never makes it readable.
    let bo = token(&running, "bo", &["umbel:read:alpha", "umbel:read:private"]);
    let widened = call(&running, &bo, "event-list", json!({ "space": "alpha" })).await;
    one_answer(&widened, &absent, &["alpha"], "never widened");
    let own = result(&call(&running, &bo, "event-list", json!({ "space": "private" })).await);
    assert_eq!(own["success"], json!(true), "{own}");
}

#[tokio::test]
async fn a_plugins_host_services_give_the_one_answer() {
    let running = running().await;
    let ada = token(&running, "ada", &["umbel:read", "umbel:write"]);
    // The probe reads events of another space through its `events` grant: bo's space and a
    // space nobody declared refuse alike.
    let read = |events_space: &str| json!({ "space": "alpha", "events_space": events_space });
    let unreadable = result(&call(&running, &ada, "probe-events", read("private")).await);
    let absent = result(&call(&running, &ada, "probe-events", read("ghost")).await);
    assert_eq!(unreadable["error"], absent["error"]);
    let message = unreadable["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("The space does not exist or you may not read it"),
        "{message}"
    );
}

#[tokio::test]
async fn the_library_gets_the_one_answer_and_the_operator_keeps_names() {
    let running = running().await;
    let host = &running.host;
    // A library call is treated by its actor (section 4.7): the one answer.
    let ada = Actor::new(ActorKind::Agent)
        .with_id("corp/app")
        .with_on_behalf_of("corp/ada");
    let unreadable = support::call(
        host,
        ada.clone(),
        "event-list",
        json!({ "space": "private" }),
    )
    .await
    .error
    .unwrap();
    let absent = support::call(host, ada, "event-list", json!({ "space": "ghost" }))
        .await
        .error
        .unwrap();
    assert_eq!(
        serde_json::to_value(&unreadable).unwrap(),
        serde_json::to_value(&absent).unwrap()
    );
    assert_eq!(unreadable.code, "SPACE_NOT_READABLE");
    // A built-in that reads no store (event-ack writes the caller's cursor) is refused alike,
    // before its handler could compare the cursor with the space's head.
    let ack = |space: &str| json!({ "space": space, "cursor": format!("v0:{space}:0") });
    let bo_agent = || {
        Actor::new(ActorKind::Agent)
            .with_id("corp/app")
            .with_on_behalf_of("corp/cy")
    };
    let unreadable = support::call(host, bo_agent(), "event-ack", ack("private"))
        .await
        .error
        .unwrap();
    let absent = support::call(host, bo_agent(), "event-ack", ack("ghost"))
        .await
        .error
        .unwrap();
    assert_eq!(
        serde_json::to_value(&unreadable).unwrap(),
        serde_json::to_value(&absent).unwrap()
    );
    // The operator, at the CLI, keeps SPACE_NOT_FOUND and the named SPACE_NOT_READABLE.
    let run = support::cli_with(
        running.dir.path(),
        &["call", "event-list", "space=ghost"],
        support::Scripted::no_terminal(),
        configure_cli,
    )
    .await;
    assert_eq!(run.error_code(), "SPACE_NOT_FOUND", "{}", run.stdout);
    assert!(run.stdout.contains("ghost"), "{}", run.stdout);
    let run = support::cli_with(
        running.dir.path(),
        &["call", "event-list", "space=private"],
        support::Scripted::no_terminal(),
        configure_cli,
    )
    .await;
    assert_eq!(run.error_code(), "SPACE_NOT_READABLE", "{}", run.stdout);
    assert!(run.stdout.contains("private"), "{}", run.stdout);
}

#[tokio::test]
async fn the_listings_name_only_the_spaces_the_caller_reads() {
    let running = running().await;
    let ada = token(&running, "ada", &["umbel:read", "umbel:write"]);
    let cy = token(&running, "cy", &["umbel:read", "umbel:write"]);
    let data = |reply: Reply| {
        let result = result(&reply);
        assert_eq!(result["success"], json!(true), "{result}");
        result["data"].clone()
    };

    // space-list: ada's three, never bo's.
    let spaces = data(call(&running, &ada, "space-list", json!({})).await);
    let ids: Vec<&str> = spaces["spaces"]
        .as_array()
        .unwrap()
        .iter()
        .map(|space| space["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["main", "alpha", "beta"]);

    // plugin-show: the instance serves alpha (ada's) and private (bo's); ada sees alpha alone.
    let shown = data(call(&running, &ada, "plugin-show", json!({ "plugin": "probe" })).await);
    assert_eq!(shown["instance"]["spaces"], json!(["alpha"]));
    for pack in shown["packs"].as_array().unwrap() {
        let spaces: Vec<&str> = pack["spaces"]
            .as_array()
            .unwrap()
            .iter()
            .map(|state| state["space"].as_str().unwrap())
            .collect();
        assert_eq!(spaces, ["alpha"], "{pack}");
    }
    assert!(!shown.to_string().contains("private"), "{shown}");
    // PLUGIN_NOT_ENABLED in a space ada reads names only the instance's spaces she reads.
    let refused = result(&call(&running, &ada, "probe-note", json!({ "space": "beta" })).await);
    assert_eq!(refused["error"]["code"], json!("PLUGIN_NOT_ENABLED"));
    let text = refused["error"].to_string();
    assert!(
        text.contains("alpha") && !text.contains("private"),
        "{text}"
    );

    // cy reads none of the instance's spaces: it is not listed, its skill is not listed, and
    // plugin-show answers as for an instance that does not exist.
    let plugins = data(call(&running, &cy, "plugin-list", json!({})).await);
    assert_eq!(plugins["plugins"], json!([]), "{plugins}");
    let skills = data(call(&running, &cy, "skill-list", json!({})).await);
    assert_eq!(skills["skills"], json!([]), "{skills}");
    let hidden = call(&running, &cy, "plugin-show", json!({ "plugin": "probe" })).await;
    let missing = call(&running, &cy, "plugin-show", json!({ "plugin": "probf" })).await;
    let normalize = |reply: &Reply| stable(reply).replace("probf", "probe");
    assert_eq!(normalize(&hidden), normalize(&missing));
    assert!(hidden.text.contains("PLUGIN_NOT_FOUND"), "{}", hidden.text);
    // ada does see them.
    let plugins = data(call(&running, &ada, "plugin-list", json!({})).await);
    assert_eq!(plugins["plugins"][0]["id"], json!("probe"));
    let skills = data(call(&running, &ada, "skill-list", json!({})).await);
    assert_eq!(skills["skills"][0]["name"], json!("probe-guide"));

    // The operator sees everything.
    let run = support::cli_with(
        running.dir.path(),
        &["call", "plugin-show", "plugin=probe"],
        support::Scripted::no_terminal(),
        configure_cli,
    )
    .await;
    assert_eq!(
        run.json()["data"]["instance"]["spaces"],
        json!(["alpha", "private"]),
        "{}",
        run.stdout
    );
    let run = support::cli_with(
        running.dir.path(),
        &["call", "space-list"],
        support::Scripted::no_terminal(),
        configure_cli,
    )
    .await;
    assert_eq!(run.json()["data"]["spaces"].as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn an_instance_hidden_from_a_caller_answers_as_an_unknown_command() {
    let running = running().await;
    // cy reads only main; the probe serves alpha and private, so to cy it does not exist. Calling
    // its command answers exactly as a name nobody registered, whatever the space or the scopes.
    for scopes in [&["umbel:read", "umbel:write"][..], &["umbel:read:main"][..]] {
        let cy = token(&running, "cy", scopes);
        for input in [
            json!({ "space": "main", "text": "x" }),
            json!({ "space": "ghost" }),
            json!({ "space": "private" }),
            json!({}),
        ] {
            let hidden = call(&running, &cy, "probe-note", input.clone()).await;
            let unknown = call(&running, &cy, "probe-gone", input.clone()).await;
            let normalize = |reply: &Reply| stable(reply).replace("probe-gone", "probe-note");
            assert_eq!(
                normalize(&hidden),
                normalize(&unknown),
                "{scopes:?} {input}"
            );
            assert!(hidden.text.contains("COMMAND_NOT_FOUND"), "{}", hidden.text);
        }
    }
    // ada reads alpha: the command exists for her.
    let ada = token(&running, "ada", &["umbel:read", "umbel:write"]);
    let noted = result(
        &call(
            &running,
            &ada,
            "probe-note",
            json!({ "space": "alpha", "text": "x" }),
        )
        .await,
    );
    assert_eq!(noted["success"], json!(true), "{noted}");
}
