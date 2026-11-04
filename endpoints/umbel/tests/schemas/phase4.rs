//! Phase 4's shapes (phase 4 specification, section 2): the plugin manifest version 4, the
//! proposal record version 2, the curator's records and its run report, version 1. Every example
//! validates in `every_example_validates_against_its_schema`; these tests hold what each schema
//! refuses, and that version 1 proposals keep their own schema.

use serde_json::{Value, json};
use umbel::plugins::Manifest;

use super::{as_toml, assert_refuses, edited, example, examples, schemas_dir, validator};

fn hash(digit: char) -> Value {
    json!(format!("sha256:{}", digit.to_string().repeat(64)))
}

fn remove(value: &mut Value, key: &str) {
    value.as_object_mut().unwrap().remove(key);
}

/// Every top-level key of `base` is required.
fn assert_each_key_required(validator: &jsonschema::Validator, label: &str, base: &Value) {
    for field in base.as_object().unwrap().keys() {
        assert!(
            !validator.is_valid(&edited(base, |v| remove(v, field))),
            "{label} accepted a missing {field}"
        );
    }
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_version_constants_name_schema_files() {
    assert_eq!(umbel::PROPOSAL_VERSIONS, [1, 2]);
    assert_eq!(umbel::PROPOSAL_VERSION, 2);
    assert_eq!(umbel::CURATOR_VERSION, 1);
    let exists = |stem: String| {
        assert!(
            schemas_dir().join(format!("{stem}.json")).is_file(),
            "{stem}"
        );
    };
    for version in umbel::MANIFEST_VERSIONS {
        exists(format!("plugin-manifest.v{version}"));
    }
    for version in umbel::PROPOSAL_VERSIONS {
        exists(format!("proposal.v{version}"));
    }
    exists(format!("curator-record.v{}", umbel::CURATOR_VERSION));
    exists(format!("curator-report.v{}", umbel::CURATOR_VERSION));
}

// ── Plugin manifest, version 4 (section 2.2) ───────────────────────────────────────────────────

#[test]
fn the_version_4_manifest_schema_refuses_what_the_host_refuses() {
    let validator = validator("plugin-manifest.v4");
    let base = example("plugin-manifest.v4", "");
    assert!(validator.is_valid(&base));
    let with = |edit: &dyn Fn(&mut Value)| edited(&base, |m| edit(m));
    let cases = [
        with(&|m| m["manifest_version"] = json!(3)),
        // confirm_preview needs confirm_prompt, and a command name.
        with(&|m| {
            remove(&mut m["commands"][0], "confirm_prompt");
            remove(&mut m["commands"][0], "confirm");
        }),
        with(&|m| m["commands"][0]["confirm_preview"] = json!("Review_Preview")),
        with(&|m| m["commands"][0]["confirm_preview"] = json!(true)),
        // A pipeline's expose has no palette, and its result is steps or last.
        with(&|m| m["pipelines"][0]["expose"]["palette"] = json!(true)),
        with(&|m| m["pipelines"][0]["expose"]["cli"] = json!("yes")),
        with(&|m| m["pipelines"][0]["result"] = json!("first")),
        with(&|m| m["pipelines"][0]["confirm_preview"] = json!("review-preview")),
    ];
    assert_refuses(&validator, "plugin-manifest.v4", &cases);
    for (index, case) in cases.iter().enumerate() {
        assert!(
            Manifest::parse(&as_toml(case), "m").is_err(),
            "case {index}: the host accepted {case}"
        );
    }
    // A component command and a mounted tool take no confirm_preview.
    let mut component = example("plugin-manifest.v1", "component");
    component["manifest_version"] = json!(4);
    assert!(validator.is_valid(&component));
    let refused = edited(&component, |m| {
        m["commands"][0]["confirm_prompt"] = json!("Run it?");
        m["commands"][0]["confirm_preview"] = json!("greet-hello");
    });
    assert!(!validator.is_valid(&refused));
    assert!(Manifest::parse(&as_toml(&refused), "c").is_err());
    let mut mounted = example("plugin-manifest.v1", "mounted");
    mounted["manifest_version"] = json!(4);
    assert!(validator.is_valid(&mounted));
    mounted["mount"]["tools"] = json!([{ "tool": "a", "confirm_preview": "x-preview" }]);
    assert!(!validator.is_valid(&mounted));
    assert!(Manifest::parse(&as_toml(&mounted), "m").is_err());
    // What confirm_preview names is the reader's to check: the schema admits these.
    for edit in [
        &(|m: &mut Value| m["commands"][0]["confirm_preview"] = json!("review-missing"))
            as &dyn Fn(&mut Value),
        &|m| m["commands"][2]["effects"] = json!(["store-write"]),
        &|m| remove(&mut m["commands"][2], "journal"),
        &|m| m["commands"][2]["returns"] = json!({ "type": "object" }),
        &|m| {
            m["commands"][2]["input_schema"]["properties"]["verdict"] = json!({ "type": "string" })
        },
    ] {
        let case = with(edit);
        assert!(validator.is_valid(&case), "{case}");
        assert!(Manifest::parse(&as_toml(&case), "m").is_err(), "{case}");
    }
    // Version 3 files stay version 3: the version 3 schema refuses what version 4 adds.
    let v3 = super::validator("plugin-manifest.v3");
    assert!(!v3.is_valid(&base));
    let mut lifted = example("plugin-manifest.v3", "");
    assert!(v3.is_valid(&lifted));
    lifted["pipelines"][0]["result"] = json!("last");
    assert!(!v3.is_valid(&lifted));
}

#[test]
fn the_version_4_manifest_examples_are_manifests_to_the_host_too() {
    let validator = validator("plugin-manifest.v4");
    let found = examples("plugin-manifest.v4");
    assert_eq!(found.len(), 2, "every key, and none of them");
    for (name, example) in found {
        assert!(validator.is_valid(&example), "{name}");
        let manifest =
            Manifest::parse(&as_toml(&example), &name).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(manifest.manifest_version, 4, "{name}");
    }
    let manifest = Manifest::parse(&as_toml(&example("plugin-manifest.v4", "")), "x").unwrap();
    assert_eq!(
        manifest.commands[0].confirm_preview.as_deref(),
        Some("review-preview")
    );
    assert_eq!(manifest.pipelines[0].result.as_str(), "last");
    assert!(!manifest.pipelines[0].expose.mcp);
    let defaults =
        Manifest::parse(&as_toml(&example("plugin-manifest.v4", "defaults")), "x").unwrap();
    assert!(defaults.pipelines[0].expose.mcp && defaults.pipelines[0].expose.cli);
    assert_eq!(defaults.pipelines[0].result.as_str(), "steps");
}

// ── Proposal record, version 2 (section 2.1) ───────────────────────────────────────────────────

#[test]
fn version_1_proposals_keep_their_schema_and_version_2_refuses_them() {
    let v1 = validator("proposal.v1");
    let v2 = validator("proposal.v2");
    for case in ["", "applied"] {
        let record = example("proposal.v1", case);
        assert!(v1.is_valid(&record), "{case}");
        assert!(!v2.is_valid(&record), "{case}");
    }
    for (name, record) in examples("proposal.v2") {
        assert!(!v1.is_valid(&record), "{name}");
    }
}

#[test]
fn the_version_2_proposal_refuses_what_the_specification_refuses() {
    let validator = validator("proposal.v2");
    let base = example("proposal.v2", "");
    assert!(validator.is_valid(&base));
    assert_each_key_required(&validator, "proposal.v2", &base);
    let with = |edit: &dyn Fn(&mut Value)| edited(&base, |p| edit(p));
    assert!(validator.is_valid(&with(
        &|p| p["conflictSet"] = json!("k-0a1b2c3d4e5f60718293")
    )));
    assert_refuses(
        &validator,
        "proposal.v2",
        &[
            with(&|p| p["version"] = json!(1)),
            with(&|p| p["conflictSet"] = json!("set-1")),
            // The envelope is version 2 with authority null, and derivedFrom names memory only.
            with(&|p| p["provenance"]["authority"] = json!("person")),
            with(&|p| p["provenance"]["version"] = json!(1)),
            with(&|p| p["provenance"]["derivedFrom"][0]["kind"] = json!("document")),
            with(&|p| p["provenance"]["derivedFrom"][0]["id"] = json!("mem-1@2")),
            with(&|p| p["provenance"]["derivedFrom"] = json!([])),
            with(&|p| {
                let one = p["provenance"]["derivedFrom"][0].clone();
                p["provenance"]["derivedFrom"] = Value::Array(vec![one; 33]);
            }),
            with(&|p| p["policy"]["rule"] = json!("curator")),
            with(&|p| p["policy"]["rule"] = json!("auto:")),
            with(&|p| {
                remove(&mut p["change"], "content");
            }),
            // The drafter: attested and verified fields, and the mode's rule.
            with(&|p| p["drafter"]["plugin"] = json!("Curator")),
            with(&|p| p["drafter"]["candidate"] = json!("c-123")),
            with(&|p| p["drafter"]["model"] = json!("none")),
            with(&|p| p["drafter"]["mode"] = json!("manual")),
            with(&|p| p["drafter"]["promotedBy"] = json!("human:ada")),
            with(&|p| p["drafter"]["mode"] = json!("promoted")),
            with(&|p| {
                p["drafter"]["mode"] = json!("promoted");
                p["drafter"]["promotedBy"] = json!("human:ada");
                remove(&mut p["drafter"], "candidate");
            }),
            with(&|p| remove(&mut p["drafter"], "run")),
        ],
    );
    // Memory evidence copies every field of its source, and only settled kinds of source.
    let entry = base["evidence"][0].clone();
    for field in entry.as_object().unwrap().keys() {
        let missing = with(&|p| remove(&mut p["evidence"][0], field));
        assert_eq!(
            validator.is_valid(&missing),
            field == "excerpt",
            "memory evidence without {field}"
        );
    }
    assert_refuses(
        &validator,
        "memory evidence",
        &[
            with(&|p| p["evidence"][0]["class"] = json!("episodic")),
            with(&|p| p["evidence"][0]["authority"] = json!("transcript")),
            with(&|p| p["evidence"][0]["authority"] = json!("document")),
            with(&|p| p["evidence"][0]["origin"] = json!("unspecified")),
            with(&|p| p["evidence"][0]["ref"] = json!("mem-3f9a1c0d7b2e4a6f8c1d5e90")),
            with(&|p| p["evidence"][0]["ref"] = json!("mem-3f9a1c0d7b2e4a6f8c1d5e90@0")),
            with(&|p| p["evidence"][0]["observations"]["principals"] = json!(0)),
            with(&|p| p["evidence"][0]["observations"]["writes"] = json!(3)),
            with(&|p| p["evidence"][0]["excerpt"] = json!("x".repeat(1001))),
            with(&|p| p["evidence"][0]["text"] = json!("the whole record")),
            with(&|p| p["evidence"][0]["access"] = json!([])),
            with(&|p| p["evidence"][0]["constraints"] = json!(vec!["x"; 17])),
            // An erased entry belongs only to a redacted proposal.
            with(
                &|p| p["evidence"][0] = json!({ "kind": "memory", "ref": "mem-3f9a1c0d7b2e4a6f8c1d5e90@2", "erased": true }),
            ),
        ],
    );
}

#[test]
fn what_a_drafter_attests_needs_a_drafter() {
    let validator = validator("proposal.v2");
    let plain = example("proposal.v2", "withdrawn");
    assert!(validator.is_valid(&plain));
    // A pending proposal nobody drafted: no withdrawal is not a drafter's withdrawal.
    let pending = edited(&plain, |p| {
        p["state"] = json!("pending");
        p["withdrawal"] = Value::Null;
    });
    assert!(validator.is_valid(&pending), "{pending}");
    let drafted = example("proposal.v2", "");
    let with = |edit: &dyn Fn(&mut Value)| edited(&plain, |p| edit(p));
    assert_refuses(
        &validator,
        "proposal.v2 without a drafter",
        &[
            with(&|p| p["evidence"] = drafted["evidence"].clone()),
            with(&|p| p["conflictSet"] = json!("k-0a1b2c3d4e5f60718293")),
            with(&|p| {
                p["provenance"]["derivedFrom"] = drafted["provenance"]["derivedFrom"].clone()
            }),
            with(&|p| p["withdrawal"]["by"] = json!("drafter")),
            // A proposer's withdrawal is a retraction.
            with(&|p| p["withdrawal"]["reason"] = json!("source-changed")),
        ],
    );
}

#[test]
fn a_withdrawal_and_a_decision_follow_the_state_and_the_rule() {
    let validator = validator("proposal.v2");
    let pending = example("proposal.v2", "");
    let applied = example("proposal.v2", "applied");
    let policy = example("proposal.v2", "policy");
    let withdrawn = example("proposal.v2", "withdrawn");
    assert_refuses(
        &validator,
        "proposal.v2 states",
        &[
            edited(&pending, |p| {
                p["withdrawal"] = withdrawn["withdrawal"].clone()
            }),
            edited(&withdrawn, |p| p["withdrawal"] = Value::Null),
            edited(&withdrawn, |p| p["withdrawal"]["at"] = json!("yesterday")),
            edited(
                &pending,
                |p| {
                    p["redacted"] =
                        json!({ "at": "2026-11-09T09:00:00.000Z", "reason": "source-erased" })
                },
            ),
            // A decision names its channel: terminal for a person, policy for an area's rule.
            edited(&applied, |p| remove(&mut p["decision"], "channel")),
            edited(&applied, |p| {
                p["decision"]["channel"] = json!("mcp-elicitation")
            }),
            edited(&applied, |p| p["decision"]["channel"] = json!("policy")),
            edited(&applied, |p| p["decision"]["by"]["kind"] = json!("agent")),
            edited(&applied, |p| {
                p["policy"]["rule"] = json!("auto:deprecate-declared")
            }),
            edited(&policy, |p| p["decision"]["channel"] = json!("terminal")),
            edited(&policy, |p| {
                p["decision"]["by"] = json!({ "kind": "human", "id": "local" })
            }),
            edited(&policy, |p| p["decision"]["by"]["id"] = json!("handbook")),
            edited(&policy, |p| p["policy"]["rule"] = json!("person")),
        ],
    );
}

#[test]
fn a_redacted_proposal_keeps_no_memory_text_or_hash() {
    let validator = validator("proposal.v2");
    let redacted = example("proposal.v2", "redacted");
    assert!(validator.is_valid(&redacted));
    let drafted = example("proposal.v2", "");
    let text = redacted.to_string();
    let source_hash = drafted["evidence"][0]["contentHash"].as_str().unwrap();
    assert!(!text.contains(source_hash), "{text}");
    assert!(!text.contains("canary flag"), "{text}");
    assert_eq!(
        redacted["changeHash"],
        redacted["provenance"]["contentHash"]
    );
    let with = |edit: &dyn Fn(&mut Value)| edited(&redacted, |p| edit(p));
    assert_refuses(
        &validator,
        "proposal.v2 redacted",
        &[
            with(&|p| p["change"]["content"] = json!("---\ntitle: kept\n---\n")),
            with(&|p| p["diff"] = json!("+kept")),
            with(&|p| p["evidence"] = drafted["evidence"].clone()),
            with(&|p| {
                p["provenance"]["derivedFrom"] = drafted["provenance"]["derivedFrom"].clone()
            }),
            with(&|p| p["state"] = json!("applied")),
            with(&|p| p["state"] = json!("pending")),
            with(&|p| p["redacted"]["reason"] = json!("tidy")),
            with(&|p| p["evidence"][0]["excerpt"] = json!("kept")),
            // No excerpt of any kind, no verify note and no decision reason survive (step 3b).
            with(&|p| {
                p["evidence"] = json!([{ "kind": "text", "ref": "notes", "excerpt": "kept" }])
            }),
            with(
                &|p| p["change"] = json!({ "op": "verify", "doc": "notes/a", "baseHash": format!("sha256:{}", "1".repeat(64)), "verification": { "note": "kept" } }),
            ),
            with(&|p| {
                p["state"] = json!("rejected");
                p["withdrawal"] = Value::Null;
                p["decision"] = decision(Some("kept"));
            }),
        ],
    );
    // Every draft that was not applied may be redacted, keeping its decision or withdrawal
    // (phase 4 step 3b, amendment 12): a drafter's withdrawal for another reason, a proposer's,
    // a rejection and an approval whose apply never landed.
    for (state, withdrawal, decided) in [
        (
            "withdrawn",
            json!({ "by": "drafter", "reason": "source-changed", "at": "2026-11-09T09:00:00.000Z" }),
            false,
        ),
        (
            "withdrawn",
            json!({ "by": "proposer", "reason": "retracted", "at": "2026-11-09T09:00:00.000Z" }),
            false,
        ),
        ("rejected", Value::Null, true),
        ("approved", Value::Null, true),
    ] {
        let kept = with(&|p| {
            p["state"] = json!(state);
            p["withdrawal"] = withdrawal.clone();
            if decided {
                p["decision"] = decision(None);
            }
        });
        let errors: Vec<String> = validator
            .iter_errors(&kept)
            .map(|e| e.to_string())
            .collect();
        assert!(errors.is_empty(), "a redacted {state} draft: {errors:?}");
    }
}

/// A person's decision at a terminal, with or without a reason.
fn decision(reason: Option<&str>) -> Value {
    let mut decision = json!({
        "by": { "kind": "human", "id": "bo" }, "principal": "human:bo",
        "at": "2026-11-09T09:00:00.000Z", "traceId": "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
        "proposerKind": "human", "channel": "terminal",
    });
    if let Some(reason) = reason {
        decision["reason"] = json!(reason);
    }
    decision
}

// ── Curator records and the run report (sections 2.3 and 7.2) ──────────────────────────────────

#[test]
fn every_curator_record_kind_needs_its_fields_and_only_them() {
    let validator = validator("curator-record.v1");
    for (name, record) in examples("curator-record.v1") {
        assert!(validator.is_valid(&record), "{name}");
        assert_each_key_required(&validator, &name, &record);
        assert_refuses(
            &validator,
            &name,
            &[
                edited(&record, |r| r["version"] = json!(2)),
                edited(&record, |r| r["kind"] = json!("draft")),
                edited(&record, |r| r["text"] = json!("memory text")),
                edited(&record, |r| r["subject"] = json!("memory subject")),
                edited(&record, |r| r["access"] = json!([])),
                edited(&record, |r| r["principal"] = json!("ada")),
            ],
        );
    }
    let candidate = example("curator-record.v1", "");
    let run = example("curator-record.v1", "run");
    let consent = example("curator-record.v1", "consent");
    let state = example("curator-record.v1", "state");
    assert_refuses(
        &validator,
        "curator-record.v1 kinds",
        &[
            // Each kind's id prefix, and no key of another kind.
            edited(&candidate, |r| r["id"] = run["id"].clone()),
            edited(&run, |r| r["id"] = candidate["id"].clone()),
            edited(&consent, |r| r["id"] = state["id"].clone()),
            edited(&state, |r| r["id"] = consent["id"].clone()),
            edited(&candidate, |r| r["lock"] = Value::Null),
            edited(&state, |r| r["contentHash"] = hash('9')),
            edited(&run, |r| r["sources"] = candidate["sources"].clone()),
            edited(&consent, |r| r["status"] = json!("ready")),
            // Every kind but a candidate is readable by its principal alone.
            edited(&run, |r| r["access"] = json!(["space"])),
            edited(&state, |r| {
                r["access"] = json!(["principal:human:local", "principal:human:ada"])
            }),
            edited(&consent, |r| remove(&mut r["sources"][0], "contentHash")),
            edited(&state, |r| r["lock"] = json!({ "trace": "t" })),
            edited(&state, |r| r["scanAfter"]["id"] = json!("doc-1")),
            edited(&state, |r| r["feedAfter"] = json!(-1)),
            edited(&run, |r| r["report"]["counts"]["read"] = json!(-1)),
        ],
    );
    // Phase 4 step 5: a review per document, the state's document cursor, a candidate's open
    // proposal, and a consent that keeps no sources once one of them was erased.
    let review = example("curator-record.v1", "review");
    let forgotten = example("curator-record.v1", "consent-erased");
    assert_refuses(
        &validator,
        "curator-record.v1 step 5",
        &[
            edited(&review, |r| r["id"] = candidate["id"].clone()),
            edited(&review, |r| r["status"] = json!("settling")),
            edited(&review, |r| r["op"] = json!("create")),
            edited(&review, |r| r["baseHash"] = json!("abc")),
            edited(&review, |r| r["contentHash"] = hash('9')),
            edited(&review, |r| r["access"] = json!(["space"])),
            edited(&candidate, |r| r["status"] = json!("refused")),
            edited(&candidate, |r| r["proposal"] = json!("p-1")),
            edited(&state, |r| r["reviewAfter"] = json!("")),
            edited(&forgotten, |r| r["sources"] = consent["sources"].clone()),
            edited(&forgotten, |r| r["erased"] = json!(false)),
            edited(&consent, |r| r["erased"] = json!(true)),
        ],
    );
}

#[test]
fn a_candidate_keeps_no_text_and_drops_its_content_keys_when_erased() {
    let validator = validator("curator-record.v1");
    let candidate = example("curator-record.v1", "");
    let erased = example("curator-record.v1", "erased");
    let with = |edit: &dyn Fn(&mut Value)| edited(&candidate, |r| edit(r));
    assert!(validator.is_valid(&with(&|r| {
        r["status"] = json!("skipped");
        r["reason"] = json!("too-many-sources");
    })));
    assert!(validator.is_valid(&with(&|r| {
        r["status"] = json!("settling");
        r["snapshot"] = Value::Null;
    })));
    let mut refused = vec![
        // The subject key is a digest, never the subject.
        with(&|r| r["subjectKey"] = json!("staging rollbacks use the canary flag")),
        with(&|r| r["class"] = json!("episodic")),
        with(&|r| r["status"] = json!("promoted")),
        with(&|r| r["sources"] = json!([])),
        with(&|r| {
            let one = r["sources"][0].clone();
            r["sources"] = Value::Array(vec![one; 33]);
        }),
        with(&|r| r["sources"][0]["contentHash"] = hash('9')),
        with(&|r| r["snapshot"]["authority"] = json!("transcript")),
        with(&|r| r["snapshot"] = Value::Null),
        with(&|r| r["conflictSet"] = json!("set-1")),
        // A reason goes with its status: a code when skipped, text when rejected, else none.
        with(&|r| r["reason"] = json!("why not")),
        with(&|r| {
            r["status"] = json!("skipped");
            r["reason"] = json!("why not");
        }),
        with(&|r| {
            r["status"] = json!("rejected");
            r["reason"] = Value::Null;
            r["quietUntil"] = json!("2027-02-06T09:00:00.000Z");
        }),
        with(&|r| {
            r["status"] = json!("rejected");
            r["reason"] = json!("Not true.");
        }),
        with(&|r| r["status"] = json!("applied")),
        with(&|r| r["drafts"] = json!(-1)),
    ];
    for key in ["contentHash", "subjectKey", "sources", "reason"] {
        refused.push(edited(&erased, |r| r[key] = candidate[key].clone()));
    }
    assert_refuses(&validator, "curator-record.v1 candidate", &refused);
    assert!(validator.is_valid(&with(&|r| {
        r["status"] = json!("applied");
        r["promotedTo"] = json!("notes/learned/c-4a1b2c3d4e5f60718293");
    })));
}

#[test]
fn the_run_report_holds_ids_and_counts_only() {
    let validator = validator("curator-report.v1");
    let base = example("curator-report.v1", "");
    assert!(validator.is_valid(&base));
    assert_each_key_required(&validator, "curator-report.v1", &base);
    for count in base["counts"].as_object().unwrap().keys() {
        assert!(
            !validator.is_valid(&edited(&base, |r| remove(&mut r["counts"], count))),
            "a report without the count {count}"
        );
    }
    let with = |edit: &dyn Fn(&mut Value)| edited(&base, |r| edit(r));
    assert_refuses(
        &validator,
        "curator-report.v1",
        &[
            with(&|r| r["version"] = json!(2)),
            with(&|r| r["counts"]["drafted"] = json!(-1)),
            with(&|r| r["counts"]["texts"] = json!(1)),
            with(&|r| r["skipped"][0]["reason"] = json!("boring")),
            with(&|r| r["skipped"][0]["subject"] = json!("memory subject")),
            with(&|r| remove(&mut r["inconsistencies"][1], "check")),
            with(&|r| r["inconsistencies"][0]["check"] = json!("links-resolve")),
            with(&|r| r["inconsistencies"][1]["check"] = json!("spelling")),
            with(&|r| r["inconsistencies"] = json!([{ "kind": "conflict-after-draft" }])),
            with(&|r| r["inconsistencies"] = json!([{ "kind": "successor-missing" }])),
            with(&|r| r["inconsistencies"][0]["kind"] = json!("odd")),
            with(&|r| r["proposals"] = json!(["p-1"])),
            with(&|r| {
                r["proposals"] =
                    Value::Array((0..51).map(|n| json!(format!("p-{n:020x}"))).collect())
            }),
            with(&|r| r["next"] = json!({})),
            with(&|r| r["text"] = json!("memory text")),
            // Phase 4 step 5: the checkpoint's state, and refusals by code only.
            with(&|r| r["checkpoint"] = json!("done")),
            with(&|r| r["refused"] = json!([{ "candidate": "c-6f708192a3b4c5d6e7f8" }])),
            with(&|r| r["refused"] = json!([{ "code": "PROPOSAL_ALREADY_OPEN", "reason": "x" }])),
            with(&|r| r["refused"] = json!([{ "code": "not a code" }])),
        ],
    );
    assert!(validator.is_valid(&with(&|r| {
        r["checkpoint"] = json!("pending");
        r["refused"] = json!([{
            "code": "PROPOSAL_DRAFT_MISMATCH", "candidate": "c-6f708192a3b4c5d6e7f8",
            "check": "copied-authority",
        }]);
    })));
}
