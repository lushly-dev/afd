//! `readable_collections` (phase 4 step 4, amendment 1): under the `documents` grant, the space's
//! collections whose default readers include the caller, as metadata only (id, kind, access set,
//! sensitivity). It returns no root, glob or file, and reads none; a collection the caller could
//! not read a document of is left out; without the grant it is refused; a space outside the call's
//! is refused.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::{agent, call};
use umbel::HostBuilder;
use umbel::plugins::sdk;
use umbel_sdk::{Cx, HostError, Outcome, Plugin, failure, success};

/// A command that answers `readable_collections` as JSON, for the call's space or `of`.
struct Probe {
    manifest: &'static str,
}

fn manifest(grants: &str) -> &'static str {
    Box::leak(
        format!(
            r#"manifest_version = 4
protocol = 1

[plugin]
id = "rc"
title = "Readable collections probe"
version = "0.1.0"
description = "Reports readable_collections."
kind = "compiled"
domains = ["rc"]
{grants}
[[commands]]
name = "rc-list"
description = "Report readable_collections."
effects = ["inspect"]
input_schema = {{ type = "object", properties = {{ space = {{ type = "string" }}, of = {{ type = "string" }} }} }}
"#
        )
        .into_boxed_str(),
    )
}

fn answer(result: Result<Vec<umbel_sdk::CollectionMeta>, HostError>) -> Outcome {
    match result {
        Ok(collections) => success(json!({ "collections": collections })),
        Err(HostError::NotGranted(text)) => failure("NOT_GRANTED", &text, "-"),
        Err(other) => failure("OTHER", &other.to_string(), "-"),
    }
}

impl Plugin for Probe {
    fn manifest(&self) -> &'static str {
        self.manifest
    }

    fn handle(&self, _name: &str, input: Value, cx: &mut Cx) -> Outcome {
        let space = cx.call().space.clone().unwrap_or_default();
        let of = input
            .get("of")
            .and_then(Value::as_str)
            .map_or(space, str::to_owned);
        answer(cx.readable_collections(&of))
    }
}

const SECRET: &str = "zebracanary file text";

/// Spaces `main` (collections `notes` for the space, `team` for the group `platform`, `adas` for
/// Ada alone, `code` a code collection, `open` public) and `beta`; files with a canary in each
/// root. The probe is enabled in both spaces with `extra` keys.
fn workspace(extra: &str) -> tempfile::TempDir {
    let dir = support::workspace(&format!(
        r#"config_version = 4
default_space = "main"

[spaces.main]
[spaces.main.collections.notes]
root = "spaces/main/notes"
include = ["**/*.md"]
[spaces.main.collections.team]
root = "spaces/main/team"
access = ["group:platform"]
[spaces.main.collections.adas]
root = "spaces/main/adas"
access = ["principal:human:ada"]
sensitivity = "confidential"
[spaces.main.collections.code]
root = "spaces/main/code"
kind = "code"
[spaces.main.collections.open]
root = "spaces/main/open"
access = ["space", "group:platform"]
sensitivity = "public"

[spaces.beta]
readers = ["human:bo"]

[access.groups.platform]
members = ["human:ada"]

[plugins]
enabled = ["rc"]

[plugins.rc]
source = "compiled:rc"
{extra}
"#
    ));
    for root in ["notes", "team", "adas", "code", "open"] {
        let path = dir.path().join("spaces/main").join(root);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("secret-name.md"), SECRET).unwrap();
    }
    dir
}

fn configure(grants: &'static str) -> impl FnOnce(HostBuilder) -> HostBuilder {
    move |builder| {
        builder.with_compiled(sdk(Probe {
            manifest: manifest(grants),
        }))
    }
}

const DOCUMENTS: &str =
    "\n[[grants]]\nname = \"documents\"\nreason = \"Reads collection metadata.\"\n";

fn human(id: &str) -> afd::Actor {
    afd::Actor::new(afd::ActorKind::Human).with_id(id)
}

fn ids(result: &afd::CommandResult<Value>) -> Vec<String> {
    let data = result.data.as_ref().unwrap_or_else(|| panic!("{result:?}"));
    data["collections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn it_returns_metadata_and_never_file_data() {
    let dir = workspace("");
    let host = support::plugins::seal(dir.path(), configure(DOCUMENTS)).unwrap();
    let result = call(&host, human("ada"), "rc-list", json!({})).await;
    let data = result.data.clone().unwrap();
    let collections = data["collections"].as_array().unwrap();
    assert_eq!(
        collections[0],
        json!({ "id": "notes", "kind": "markdown", "access": ["space"], "sensitivity": "internal" })
    );
    for collection in collections {
        let mut keys: Vec<&str> = collection
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            ["access", "id", "kind", "sensitivity"],
            "{collection}"
        );
    }
    let code = collections.iter().find(|c| c["id"] == "code").unwrap();
    assert_eq!(code["kind"], "code");
    let adas = collections.iter().find(|c| c["id"] == "adas").unwrap();
    assert_eq!(adas["sensitivity"], "confidential");
    // No root, glob, file name or file byte.
    let text = data.to_string();
    for absent in [
        SECRET,
        "secret-name",
        "spaces/main",
        "**/*.md",
        "include",
        "root",
    ] {
        assert!(!text.contains(absent), "{absent} in {text}");
    }
}

#[tokio::test]
async fn it_lists_only_collections_whose_readers_include_the_caller() {
    let dir = workspace("");
    let host = support::plugins::seal(dir.path(), configure(DOCUMENTS)).unwrap();
    // Ada is in `platform` and is `adas`'s reader.
    assert_eq!(
        ids(&call(&host, human("ada"), "rc-list", json!({})).await),
        ["notes", "team", "adas", "code", "open"]
    );
    // Bo is in neither: only what the space's readers read.
    assert_eq!(
        ids(&call(&host, human("bo"), "rc-list", json!({})).await),
        ["notes", "code", "open"]
    );
    // An agent acting for Ada is Ada; an agent of its own is its own principal.
    let for_ada = afd::Actor::new(afd::ActorKind::Agent)
        .with_id("helper")
        .with_on_behalf_of("ada");
    assert_eq!(
        ids(&call(&host, for_ada, "rc-list", json!({})).await),
        ["notes", "team", "adas", "code", "open"]
    );
    assert_eq!(
        ids(&call(&host, agent("bot"), "rc-list", json!({})).await),
        ["notes", "code", "open"]
    );
}

#[tokio::test]
async fn it_is_refused_without_the_documents_grant() {
    let dir = workspace("");
    let host = support::plugins::seal(dir.path(), configure("")).unwrap();
    let refused = call(&host, human("ada"), "rc-list", json!({})).await;
    let error = refused.error.unwrap();
    assert_eq!(error.code, "NOT_GRANTED");
    assert!(error.message.contains("documents"), "{}", error.message);
    // The `content` grant does not carry it either.
    let dir = workspace("");
    let content = "\n[[grants]]\nname = \"content\"\nreason = \"Reads files.\"\n";
    let host = support::plugins::seal(dir.path(), configure(content)).unwrap();
    let refused = call(&host, human("ada"), "rc-list", json!({})).await;
    assert_eq!(refused.error.unwrap().code, "NOT_GRANTED");
    // A deny of the declared grant withholds it.
    let dir = workspace("deny = [\"documents\"]");
    let optional = "\n[[grants]]\nname = \"documents\"\nrequired = false\nreason = \"Reads collection metadata.\"\n";
    let host = support::plugins::seal(dir.path(), configure(optional)).unwrap();
    let refused = call(&host, human("ada"), "rc-list", json!({})).await;
    assert_eq!(refused.error.unwrap().code, "NOT_GRANTED");
}

#[tokio::test]
async fn another_space_than_the_calls_is_refused() {
    let dir = workspace("");
    let host = support::plugins::seal(dir.path(), configure(DOCUMENTS)).unwrap();
    let refused = call(&host, human("ada"), "rc-list", json!({ "of": "beta" })).await;
    assert_eq!(refused.error.unwrap().code, "NOT_GRANTED");
}
