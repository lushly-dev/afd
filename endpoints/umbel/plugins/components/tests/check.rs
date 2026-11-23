//! `components-check` (specification, amendment A30; Component Briefs step D1, #1154): a page's
//! source read as text for undeclared tags and attributes, on the default pack and on FAST-AF's
//! real pack; the answer says it rendered nothing; the refusals and the limits; and the job's
//! scenario.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{Actor, ActorKind, CommandInterface};
use serde_json::{Value, json};
use support::*;
use umbel::testkit::TestHost;

async fn check_on(host: &TestHost, input: Value) -> Value {
    serde_json::to_value(host.call("components-check", input).await).unwrap()
}

/// `components-check` over MCP with an output budget of `ask` bytes.
async fn check_with_budget(host: &TestHost, input: Value, ask: u64) -> Value {
    let context = host
        .host()
        .context(Actor::new(ActorKind::Test).with_id("testkit"))
        .with_interface(CommandInterface::Mcp)
        .with_output_budget_ask(ask);
    serde_json::to_value(
        host.host()
            .registry()
            .execute("components-check", input, Some(context))
            .await,
    )
    .unwrap()
}

/// The findings as `(reason, tag, attribute, line)`.
fn findings(result: &Value) -> Vec<(String, String, Option<String>, u64)> {
    data(result)["findings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|finding| {
            (
                finding["reason"].as_str().unwrap().to_owned(),
                finding["tag"].as_str().unwrap().to_owned(),
                finding["attribute"].as_str().map(str::to_owned),
                finding["line"].as_u64().unwrap(),
            )
        })
        .collect()
}

fn finding(
    reason: &str,
    tag: &str,
    attribute: Option<&str>,
    line: u64,
) -> (String, String, Option<String>, u64) {
    (
        reason.to_owned(),
        tag.to_owned(),
        attribute.map(str::to_owned),
        line,
    )
}

/// Every answer says, in fixed fields and a fixed note, that it read text and rendered nothing,
/// and names Specimen as the real check.
fn says_it_rendered_nothing(result: &Value) {
    let data = data(result);
    assert_eq!(data["read"], "text", "{result}");
    assert_eq!(data["rendered"], false, "{result}");
    let note = data["note"].as_str().unwrap();
    assert!(note.contains("nothing was rendered"), "{note}");
    assert!(note.contains("pnpm test:stories"), "{note}");
    assert!(
        result["reasoning"]
            .as_str()
            .unwrap()
            .contains("rendered nothing"),
        "{result}"
    );
    // It serves no pack text, so it has no content part (section 5.1).
    assert!(data.get("content").is_none(), "{result}");
}

#[tokio::test]
async fn an_undeclared_attribute_and_an_unknown_tag_on_the_default_pack() {
    let host = default_host();
    let source = "<form>\n  <example-field label=\"Name\" error-text=\"Required\" lable=\"x\"></example-field>\n  <example-feild></example-feild>\n</form>";
    let result = check_on(&host, json!({ "source": source })).await;
    says_it_rendered_nothing(&result);
    assert_eq!(
        findings(&result),
        [
            finding("unknown-attribute", "example-field", Some("error-text"), 2),
            finding("unknown-attribute", "example-field", Some("lable"), 2),
            finding("unknown-tag", "example-feild", None, 3),
        ]
    );
    let data = data(&result);
    assert_eq!(data["findings"][0]["nearest"], json!([]));
    assert_eq!(data["findings"][1]["nearest"], json!(["label", "value"]));
    assert_eq!(data["findings"][2]["nearest"], json!(["example-field"]));
    assert_eq!(data["count"], 3);
    assert_eq!(data["truncated"], false);
    assert_eq!(
        data["checked"],
        json!({ "elements": 2, "attributes": 3, "skipped": 0, "unclosed": 0 })
    );
    assert_eq!(data["libraries"][0]["library"], "example");
    assert!(
        result["warnings"].as_array().is_none_or(Vec::is_empty),
        "{result}"
    );
}

#[tokio::test]
async fn a_clean_page_has_no_findings_and_still_says_it_rendered_nothing() {
    let host = default_host();
    let source = r#"html`<example-select label="Size" ?disabled=${x => x.off} :value=${x => x.size} @change=${(x, c) => x.pick(c.event)} id="size" class="wide" aria-describedby="hint" data-test="size">
  <example-option value="s" selected>Don't pick me</example-option>
</example-select>`"#;
    let result = check_on(&host, json!({ "source": source })).await;
    says_it_rendered_nothing(&result);
    assert_eq!(findings(&result), []);
    assert_eq!(data(&result)["count"], 0);
    assert_eq!(
        data(&result)["checked"],
        json!({ "elements": 2, "attributes": 8, "skipped": 2, "unclosed": 0 })
    );
}

#[tokio::test]
async fn nothing_from_the_pack_but_identifiers_is_in_the_answer() {
    let host = default_host();
    let summary = Pack::example().json("data/example/components/example-field.json")["summary"]
        .as_str()
        .unwrap()
        .to_owned();
    let result = check_on(
        &host,
        json!({ "source": "<example-field nope></example-field>" }),
    )
    .await;
    assert_eq!(findings(&result).len(), 1);
    assert!(!result.to_string().contains(&summary), "{result}");
}

/// The case that reopened D1: a consumer application bound an undeclared attribute on
/// `violet-text-field` (originally `error-text`, which #1586 later declared), along with the two
/// the owner's one-off scan found, on FAST-AF's real pack.
#[tokio::test]
async fn fast_af_flags_what_a_consumer_application_shipped() {
    let fx = Pack::fast_af().host();
    let source = r#"html`
<violet-text-field
  label="Email"
  type="email"
  required
  helper-text="${x => x.hint}"
  :value=${x => x.email}
  @input=${(x, c) => x.update(c.event)}
></violet-text-field>
<violet-button appearance="accent" size="small" type="submit">Save</violet-button>
<violet-checkbox label="Remember me" checked></violet-checkbox>
`"#;
    let result = fx
        .host
        .call(
            "components-check",
            json!({ "source": source, "library": "violet-elements" }),
        )
        .await;
    let result = serde_json::to_value(result).unwrap();
    says_it_rendered_nothing(&result);
    assert_eq!(
        findings(&result),
        [
            finding(
                "unknown-attribute",
                "violet-text-field",
                Some("helper-text"),
                6
            ),
            finding("unknown-attribute", "violet-button", Some("size"), 10),
            finding("unknown-attribute", "violet-checkbox", Some("label"), 11),
        ]
    );
    assert_eq!(data(&result)["libraries"][0]["library"], "violet-elements");
}

#[tokio::test]
async fn fast_af_a_clean_page_has_no_findings() {
    let fx = Pack::fast_af().host();
    let source = r#"<violet-text-field label="Email" type="email" required supporting-text="We never share it." placeholder="name@example.com" autocomplete="email"></violet-text-field>
<violet-button appearance="accent" type="submit" aria-describedby="hint">Save</violet-button>
<violet-checkbox name="remember" checked>Remember me</violet-checkbox>
<p id="hint">It's saved when you press Save.</p>"#;
    let result = serde_json::to_value(
        fx.host
            .call("components-check", json!({ "source": source }))
            .await,
    )
    .unwrap();
    says_it_rendered_nothing(&result);
    assert_eq!(findings(&result), []);
    assert_eq!(data(&result)["checked"]["elements"], 3);
}

#[tokio::test]
async fn refusals_carry_a_suggestion_and_no_content() {
    let host = default_host();
    let too_long = "x".repeat(262_145);
    for (input, expected) in [
        (json!({ "source": too_long }), "COMPONENTS_INVALID"),
        (
            json!({ "source": "", "library": "Not A Library" }),
            "COMPONENTS_INVALID",
        ),
        (
            json!({ "source": "", "library": "missing" }),
            "LIBRARY_NOT_FOUND",
        ),
        (
            json!({ "source": "", "versions": { "example-components": "not a version" } }),
            "COMPONENTS_INVALID",
        ),
    ] {
        let result = check_on(&host, input.clone()).await;
        assert_eq!(code(&result), expected, "{input}");
        assert!(
            !result["error"]["suggestion"]
                .as_str()
                .unwrap_or_default()
                .is_empty(),
            "{result}"
        );
        assert!(
            !result.to_string().contains("xxxxxxxxxx"),
            "the source echoed: {result}"
        );
    }
    // `source` is required by the schema; the host refuses its absence before the handler runs.
    let result = check_on(&host, json!({})).await;
    assert_eq!(result["success"], false, "{result}");

    // A pack the reader refuses refuses the check, as every command (section 9).
    let mut pack = Pack::example();
    pack.edit(&record_path("field"), |record| {
        record["usage"] =
            json!([{ "id": "field.x", "text": "x".repeat(300), "basis": "authored" }]);
    });
    pack.regenerate("example");
    let fx = pack.host();
    let result = check_on(&fx.host, json!({ "source": "<example-field>" })).await;
    assert_eq!(code(&result), "PACK_INVALID", "{result}");
    assert!(result.get("data").is_none_or(Value::is_null), "{result}");
}

#[tokio::test]
async fn findings_are_capped_at_256_and_counted() {
    let host = default_host();
    let source = "<example-field nope></example-field>\n".repeat(300);
    let result = check_with_budget(&host, json!({ "source": source }), 64_000).await;
    let data = data(&result);
    assert_eq!(data["findings"].as_array().unwrap().len(), 256);
    assert_eq!(data["count"], 300);
    assert_eq!(data["truncated"], true);
    assert_eq!(data["findings"][255]["line"], 256);
}

#[tokio::test]
async fn findings_shed_to_the_budget_and_never_pass_it() {
    let host = default_host();
    let source = "<example-field nope></example-field>\n".repeat(100);
    let roomy = check_with_budget(&host, json!({ "source": source }), 64_000).await;
    assert_eq!(data(&roomy)["findings"].as_array().unwrap().len(), 100);
    let tight = check_with_budget(&host, json!({ "source": source }), 4_000).await;
    let shown = data(&tight)["findings"].as_array().unwrap().len();
    assert!(shown > 0 && shown < 100, "{shown}");
    assert_eq!(data(&tight)["count"], 100);
    assert_eq!(data(&tight)["truncated"], true);
    let (used, limit) = measured(&tight);
    assert!(used <= limit, "{used} > {limit}");
    // The fewest bytes that hold the note and the counts still answer; below them, it is refused.
    let refused = check_with_budget(&host, json!({ "source": source }), 300).await;
    assert_eq!(refused["success"], false, "{refused}");
}

#[tokio::test]
async fn a_version_that_differs_is_warned_and_still_checked() {
    let host = default_host();
    let result = check_on(
        &host,
        json!({ "source": "<example-field nope>", "versions": { "example-components": "9.9.9" } }),
    )
    .await;
    assert_eq!(findings(&result).len(), 1);
    let warnings = result["warnings"].as_array().unwrap();
    assert_eq!(warnings[0]["code"], "LIBRARY_VERSION_MISMATCH", "{result}");
}

#[tokio::test]
async fn minimum_basis_narrows_nearest_but_not_what_is_declared() {
    let mut config = toml::Table::new();
    config.insert("minimum_basis".into(), "verified".into());
    let fx = Pack::example().host_with(config);
    // `label` is observed: still declared, so not flagged, and not offered as a nearest name.
    let result = check_on(
        &fx.host,
        json!({ "source": "<example-field label=\"A\" lable=\"B\">" }),
    )
    .await;
    assert_eq!(
        findings(&result),
        [finding(
            "unknown-attribute",
            "example-field",
            Some("lable"),
            1
        )]
    );
    assert_eq!(data(&result)["findings"][0]["nearest"], json!([]));
}

// JSON is a YAML subset: the scenario the AFD runner validates, read with the matchers it uses.
fn expect(actual: &Value, expected: &Value) {
    if let Some(object) = expected.as_object() {
        if let Some(length) = object.get("length") {
            assert_eq!(
                actual.as_array().map(Vec::len),
                length.as_u64().map(|n| n as usize),
                "{actual}"
            );
        } else if let Some(contains) = object.get("contains") {
            let (Some(actual), Some(contains)) = (actual.as_str(), contains.as_str()) else {
                panic!("`contains` needs two strings: {actual} and {contains}");
            };
            assert!(actual.contains(contains), "{actual}");
        } else {
            for (key, value) in object {
                expect(&actual[key], value);
            }
        }
    } else {
        assert_eq!(actual, expected);
    }
}

#[tokio::test]
async fn check_before_handoff_scenario() {
    let host = default_host();
    let scenario: Value = serde_json::from_str(include_str!(
        "../scenarios/check-before-handoff.scenario.yaml"
    ))
    .unwrap();
    for step in scenario["steps"].as_array().unwrap() {
        let command = step["command"].as_str().unwrap();
        let result = serde_json::to_value(host.call(command, step["input"].clone()).await).unwrap();
        expect(&result, &step["expect"]);
    }
}
