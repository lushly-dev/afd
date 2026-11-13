//! The host's label passed through (specification, section 4.6): every read command returns a
//! wording's `dev.umbel/standing` object unchanged, as `label`, and its standing as `standing`,
//! `unverified` spelled `seed`. The same wording read through capture's candidates, match, ask,
//! find and open carries one label, byte for byte, for a seed and for an affirmed wording; and a
//! reader who is not the space's person sees when and at what level, and not who.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const SEED: &str = "Sharpen the hoe before the first weeding.";
const MINE: &str = "Oil wooden handles every winter.";

/// The labels of the idea `id`'s held wording, by command, as `reader` reads them.
async fn labels(fx: &Fx, id: &str, statement: &str, stranger: bool) -> Vec<(String, Value, Value)> {
    let call = |command: &'static str, input: Value| async move {
        if stranger {
            fx.stranger(command, input).await
        } else {
            fx.agent(command, input).await
        }
    };
    let mut out = Vec::new();
    let opened = call("ideas-open", json!({ "id": id })).await;
    let o = data(&opened);
    out.push(("open".to_owned(), o["standing"].clone(), o["label"].clone()));
    out.push((
        "open history".to_owned(),
        o["history"][0]["standing"].clone(),
        o["history"][0]["label"].clone(),
    ));
    let found = call("ideas-find", json!({ "order": "id" })).await;
    let item = data(&found)["ideas"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == id)
        .unwrap()
        .clone();
    out.push((
        "find".to_owned(),
        item["standing"].clone(),
        item["label"].clone(),
    ));
    let asked = call("ideas-ask", json!({ "question": statement })).await;
    let held = data(&asked)["ideas"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == id)
        .unwrap()
        .clone();
    out.push((
        "ask".to_owned(),
        held["standing"].clone(),
        held["label"].clone(),
    ));
    let matched = call("ideas-match", json!({ "statements": [statement] })).await;
    let hit = data(&matched)["results"][0]["candidates"][0].clone();
    assert_eq!(hit["id"], id);
    out.push((
        "match".to_owned(),
        hit["standing"].clone(),
        hit["label"].clone(),
    ));
    let captured = call(
        "ideas-capture",
        json!({ "ideas": [{ "statement": format!("{statement} Again, in other words."), "type": "principle" }] }),
    )
    .await;
    let candidate = data(&captured)["ideas"][0]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone();
    out.push((
        "capture".to_owned(),
        candidate["standing"].clone(),
        candidate["label"].clone(),
    ));
    out
}

#[tokio::test]
async fn every_read_returns_the_hosts_label_unchanged() {
    let (fx, ids) = affirmed_store(&[SEED, MINE], &[1]).await;

    let seed = labels(&fx, &ids[0], SEED, false).await;
    for (command, standing, label) in &seed {
        assert_eq!(standing, "seed", "{command}");
        assert_eq!(
            *label,
            json!({ "standing": "unverified", "affirmed": null, "source": null }),
            "{command}"
        );
    }

    // The space's person (the agent acts for her) sees who decided.
    let affirmed = labels(&fx, &ids[1], MINE, false).await;
    let expected = json!({
        "standing": "affirmed",
        "affirmed": {
            "by": "human:ada",
            "at": "2026-01-01T00:00:00.000Z",
            "assurance": affirmed[0].2["affirmed"]["assurance"],
        },
        "source": null,
    });
    assert_eq!(expected["affirmed"]["assurance"]["level"], "terminal");
    for (command, standing, label) in &affirmed {
        assert_eq!(standing, "affirmed", "{command}");
        assert_eq!(
            label.to_string(),
            expected.to_string(),
            "{command}: byte for byte"
        );
    }
}

#[tokio::test]
async fn a_reader_who_is_not_the_person_sees_when_and_how_and_not_who() {
    let (fx, ids) = affirmed_store(&[MINE], &[0]).await;
    for (command, standing, label) in labels(&fx, &ids[0], MINE, true).await {
        assert_eq!(standing, "affirmed", "{command}");
        assert_eq!(
            label,
            json!({
                "standing": "affirmed",
                "affirmed": { "by": null, "at": "2026-01-01T00:00:00.000Z", "assurance": { "level": "terminal" } },
                "source": null,
            }),
            "{command}"
        );
    }
}
