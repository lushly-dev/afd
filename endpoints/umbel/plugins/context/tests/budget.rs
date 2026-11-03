//! The budget (section 9.4): the reserve and shares, items set aside and the second pass, the
//! item limit, omissions with `omittedMore`, `maxChars` in UTF-16 code units, and the whole
//! result fitting to the byte by AFD's own check.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_store::{Authority, MemoryClass, MemoryWrite};

fn person(n: u64, text: &str) -> MemoryWrite {
    entry(
        n,
        "main",
        "human:ada",
        MemoryClass::Semantic,
        Authority::Person,
        &format!("Fact {n}"),
        text,
    )
}

/// The bytes AFD measures, computed from the result as returned: everything but `metadata`.
fn afd_size(result: &Value) -> u64 {
    let mut value = result.clone();
    value.as_object_mut().unwrap().remove("metadata");
    serde_json::to_string(&value).unwrap().len() as u64
}

#[tokio::test]
async fn a_large_item_is_set_aside_and_smaller_ones_after_it_still_placed() {
    let mut fx = Fx::new();
    // The term on every line, so the long passage still ranks first.
    let big = "budgetq line of words\n".repeat(300);
    fx.index(
        "main",
        vec![
            // Ranked first: the term twice in its best chunk.
            doc("main", "handbook/big", "Big", &big),
            doc("main", "handbook/s1", "S1", "budgetq small one"),
            doc("main", "handbook/s2", "S2", "budgetq small two"),
        ],
    );
    let input = json!({ "task": "budgetq", "sections": ["knowledge"], "maxBytes": 4000 });
    let result = fx.ada(input).await;
    let placed = ids(&result, "knowledge");
    assert!(
        !placed.contains(&"main:handbook/big".to_owned()),
        "{result}"
    );
    assert_eq!(placed.len(), 2, "{result}");
    let budget = omitted(&result, "knowledge", "budget");
    assert_eq!(budget.len(), 1);
    assert_eq!(budget[0]["id"], "main:handbook/big");
    assert!(warning(&result, "BUNDLE_LIMITED").is_some());
    let (used, limit) = measured(&result);
    assert!(used <= 4000 && limit >= 4000, "{used} {limit}");
    // With room the big item is placed, cut at a line boundary to max_item_bytes.
    let roomy = fx
        .ada(json!({ "task": "budgetq", "sections": ["knowledge"], "maxBytes": 64000 }))
        .await;
    let section = &data(&roomy)["sections"][0]["items"];
    assert_eq!(section[0]["id"], "main:handbook/big");
    assert_eq!(section[0]["cut"], true);
    let text = section[0]["text"].as_str().unwrap();
    assert!(
        text.len() <= 4000 && !text.ends_with('\n'),
        "{}",
        text.len()
    );
    assert!(warning(&roomy, "BUNDLE_LIMITED").is_none());
    valid(&result);
    valid(&roomy);
}

#[tokio::test]
async fn shares_of_sections_not_running_pass_to_the_others_and_the_second_pass_fills_them() {
    let mut fx = Fx::with(&config(
        "[plugins.context.config]\npush_authorities = [\"person\", \"agent\", \"tool\"]\n",
    ));
    let mut entries = Vec::new();
    for n in 1..=8 {
        entries.push(person(n, &format!("fact {} {n}", "words ".repeat(30))));
    }
    fx.remember("main", entries);
    let alone = fx
        .ada(json!({ "sections": ["semantic"], "maxBytes": 5000 }))
        .await;
    let kept = ids(&alone, "semantic");
    assert!(!kept.is_empty() && kept.len() < 8, "{alone}");
    // Knowledge with no task is not running, and procedural holds nothing: their shares reach
    // semantic, through the carry and the second pass, so it places the same items.
    let shared = fx
        .ada(json!({ "sections": ["knowledge", "semantic", "procedural"], "maxBytes": 5000 }))
        .await;
    assert_eq!(ids(&shared, "semantic"), kept, "{shared}");
    assert_eq!(omitted(&shared, "semantic", "budget").len(), 8 - kept.len());
}

#[tokio::test]
async fn a_section_holds_at_most_max_items() {
    let mut fx = Fx::new();
    let docs = (0..30)
        .map(|n| doc("main", &format!("handbook/d{n:02}"), "D", "budgetq"))
        .collect();
    fx.index("main", docs);
    let result = fx
        .ada(json!({ "task": "budgetq", "sections": ["knowledge"], "maxBytes": 64000 }))
        .await;
    assert_eq!(ids(&result, "knowledge").len(), 24);
    assert_eq!(omitted(&result, "knowledge", "budget").len(), 6);
    assert!(warning(&result, "BUNDLE_LIMITED").is_some());
    valid(&result);
}

#[tokio::test]
async fn item_omissions_past_the_list_or_the_reserve_are_counted_in_omitted_more() {
    let mut fx = Fx::with(&config(
        "[plugins.context.config]\npush_authorities = [\"person\", \"agent\"]\n",
    ));
    let mut entries = Vec::new();
    for n in 1..=60 {
        entries.push(person(n, "many"));
    }
    for n in 61..=120 {
        entries.push(entry(
            n,
            "main",
            "human:ada",
            MemoryClass::Semantic,
            Authority::Agent,
            &format!("Agent {n}"),
            "many",
        ));
    }
    fx.remember("main", entries);
    fx.remember(
        "main",
        vec![entry(
            200,
            "main",
            "human:ada",
            MemoryClass::Semantic,
            Authority::Tool,
            "Tool",
            "many",
        )],
    );
    let result = fx
        .ada(json!({ "task": "many", "sections": ["semantic"] }))
        .await;
    let placed = ids(&result, "semantic").len();
    assert_eq!(placed, 16, "{result}");
    let omissions = data(&result)["omissions"].as_array().unwrap();
    let listed = omitted(&result, "semantic", "budget").len() as u64;
    let more = data(&result)["omittedMore"].as_u64().unwrap();
    // 52 past each tier's cap, of which only those that fit the reserve are named.
    assert_eq!(listed + more, 104, "{listed} {more}");
    assert!(more > 0 && omissions.len() <= 64);
    assert!(serde_json::to_string(omissions).unwrap().len() <= 2048);
    // The count entry is always kept: the tool record is readable and not admitted.
    assert_eq!(count(&result, "semantic", "authority"), 1);
    let limited = warning(&result, "BUNDLE_LIMITED").unwrap();
    assert_eq!(limited["details"]["omitted"], 104);
    valid(&result);
}

#[tokio::test]
async fn max_chars_counts_utf16_code_units() {
    let mut fx = Fx::new();
    // 600 characters but 1200 UTF-16 code units: the block's characters fit 1000, its code
    // units do not.
    fx.remember("main", vec![person(1, &"😀".repeat(600))]);
    let input = json!({ "sections": ["semantic"], "render": "text", "maxChars": 1000 });
    let result = fx.ada(input).await;
    let text = data(&result)["text"].as_str().unwrap();
    assert!(text.encode_utf16().count() <= 1000);
    assert!(ids(&result, "semantic").is_empty(), "{result}");
    assert_eq!(omitted(&result, "semantic", "budget").len(), 1);
    assert!(text.ends_with("Left out: 1 for budget. memory-recall and memory-list can read them."));
    // With room for it, it is placed.
    let roomy = fx
        .ada(json!({ "sections": ["semantic"], "render": "text", "maxChars": 2000 }))
        .await;
    assert_eq!(ids(&roomy, "semantic").len(), 1);
    let text = data(&roomy)["text"].as_str().unwrap();
    assert!(text.encode_utf16().count() <= 2000 && text.chars().count() < 1000);
}

#[tokio::test]
async fn the_whole_result_fits_to_the_byte_by_afds_check() {
    let mut fx = Fx::with(&config(
        "[plugins.context.config]\npush_authorities = [\"person\", \"agent\"]\n",
    ));
    let docs = (0..12)
        .map(|n| {
            doc(
                "main",
                &format!("handbook/f{n:02}"),
                "Fit",
                &format!("fitq {} {n}", "text ".repeat(20 + n * 7)),
            )
        })
        .collect();
    fx.index("main", docs);
    let entries = (1..=12)
        .map(|n| {
            person(
                n,
                &format!("fitq {} é {n}", "note ".repeat(10 + n as usize * 5)),
            )
        })
        .collect();
    fx.remember("main", entries);
    for render in ["none", "text"] {
        for ask in (2000..=12_000).step_by(1250) {
            let input = json!({ "task": "fitq", "render": render });
            let result = fx
                .bundle_with_budget(human("ada"), input.clone(), ask)
                .await;
            let (used, limit) = measured(&result);
            assert_eq!(limit, ask);
            assert!(used <= limit, "{render} {ask}: {used}");
            assert_eq!(used, afd_size(&result), "{render} {ask}");
            // The same budget through maxBytes.
            let through = fx
                .ada(json!({ "task": "fitq", "render": render, "maxBytes": ask }))
                .await;
            assert_eq!(data(&through), data(&result), "{render} {ask}");
            if render == "text" {
                let items = data(&result)["sections"].as_array().unwrap();
                assert!(
                    items
                        .iter()
                        .flat_map(|s| s["items"].as_array().unwrap())
                        .all(|item| item.get("text").is_none())
                );
            }
            valid(&result);
        }
    }
    // The smaller of maxBytes and the call's budget applies.
    let small = fx
        .bundle_with_budget(
            human("ada"),
            json!({ "task": "fitq", "maxBytes": 3000 }),
            16_000,
        )
        .await;
    assert!(afd_size(&small) <= 3000);
}
