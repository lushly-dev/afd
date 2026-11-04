//! `umbel_okf::draft` (phase 4 specification, sections 3.2, 4.4 and 4.5): the fixed rendering,
//! the rationale, `subject_key` and the id derivations, byte for byte, so the curator's rendering
//! and the knowledge plugin's re-rendering can never drift apart.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use umbel_okf::draft::{
    self, Draft, EXCERPT_CHARS, Rationale, candidate_id, conflict_set_id, document_id,
    idempotency_key, is_candidate_id, is_conflict_set_id, is_idempotency_key, subject_key,
    subject_key_digest,
};
use umbel_okf::{Ingest, Kind, analyze};
use umbel_store::memory::parse_instant;
use umbel_store::{Authority, MemoryClass};

/// 2026-11-02T10:00:00.000Z.
const AT: i64 = 1_793_613_600_000;

fn fact<'a>(subject: &'a str, text: &'a str) -> Draft<'a> {
    Draft {
        class: MemoryClass::Semantic,
        subject,
        text,
        tags: vec!["staging".into(), "deploy".into(), "staging".into()],
        constraints: vec!["staging only".into(), "before 2027".into()],
        plugin: "curator",
        instance: "curator",
        settled_at: AT,
    }
}

#[test]
fn a_fact_renders_byte_for_byte_with_sorted_tags_and_holds_only() {
    let rendered = draft::render(&fact(
        "Staging uses blue-green",
        "Deploys to staging switch colours.",
    ));
    assert_eq!(
        rendered,
        "---\n\
         title: \"Staging uses blue-green\"\n\
         type: \"fact\"\n\
         tags: [\"deploy\", \"staging\"]\n\
         generated:\n  by: \"umbel:curator/curator\"\n  at: \"2026-11-02T10:00:00.000Z\"\n\
         ---\n\
         Deploys to staging switch colours.\n\
         \n## Holds only\n\n\
         - \"before 2027\"\n\
         - \"staging only\"\n"
    );
    // The same inputs in another order render the same bytes.
    let mut reordered = fact(
        "Staging uses blue-green",
        "Deploys to staging switch colours.",
    );
    reordered.tags.reverse();
    reordered.constraints.reverse();
    assert_eq!(draft::render(&reordered), rendered);
}

#[test]
fn a_procedure_without_constraints_or_tags_has_no_holds_only_and_keeps_one_final_newline() {
    let mut procedure = fact("Roll back", "1. Pick the previous tag.\n2. Deploy it.\n");
    procedure.class = MemoryClass::Procedural;
    procedure.tags.clear();
    procedure.constraints.clear();
    procedure.instance = "curator-b";
    assert_eq!(
        draft::render(&procedure),
        "---\ntitle: \"Roll back\"\ntype: \"procedure\"\ntags: []\ngenerated:\n  by: \"umbel:curator/curator-b\"\n  at: \"2026-11-02T10:00:00.000Z\"\n---\n1. Pick the previous tag.\n2. Deploy it.\n"
    );
    assert_eq!(draft::doc_type(MemoryClass::Episodic), None);
}

#[test]
fn every_value_stays_on_its_line_and_reads_back_as_the_record_said_it() {
    let subject = "A \"quoted\" back\\slash\nnew line\u{2028}sep\u{85}nel\u{feff}";
    let constraint = "only \u{2029} here \"x\"";
    let mut tricky = fact(subject, "Body text.");
    tricky.tags = vec!["tag\u{2028}x".into()];
    tricky.constraints = vec![constraint.into()];
    let rendered = draft::render(&tricky);
    // Nothing a record said breaks a line of the frontmatter or of `Holds only`.
    let frontmatter: Vec<&str> = rendered.split("---\n").nth(1).unwrap().lines().collect();
    assert_eq!(frontmatter.len(), 6, "{rendered}");
    assert!(!rendered.contains('\u{2028}') && !rendered.contains('\u{2029}'));
    assert!(!rendered.contains('\u{85}') && !rendered.contains('\u{feff}'));
    // The OKF reader reads the title, type, tags and `generated` back exactly.
    let analysis = analyze(&Ingest::new(
        rendered.as_bytes(),
        "learned/c-0123456789abcdef0123.md",
        Kind::Markdown,
        "document",
    ))
    .unwrap();
    assert_eq!(analysis.title, subject);
    assert_eq!(analysis.doc_type, "fact");
    assert_eq!(analysis.tags, vec!["tag\u{2028}x".to_owned()]);
    let generated = analysis.generated.unwrap();
    assert_eq!(generated.by, "umbel:curator/curator");
    assert_eq!(generated.at, "2026-11-02T10:00:00.000Z");
    let line = rendered.lines().last().unwrap();
    let back: String = serde_json::from_str(line.strip_prefix("- ").unwrap()).unwrap();
    assert_eq!(back, constraint);
}

#[test]
fn the_settling_instant_is_read_back_only_in_its_canonical_form() {
    let rendered = draft::render(&fact("S", "T"));
    assert_eq!(draft::settled_at(&rendered), Some(AT));
    for other in [
        "2026-11-02T10:00:00Z",
        "2026-11-02T10:00:00.0000Z",
        "2026-11-02T10:00:00.000+00:00",
    ] {
        let changed = rendered.replace("2026-11-02T10:00:00.000Z", other);
        assert_eq!(draft::settled_at(&changed), None, "{other}");
    }
    assert_eq!(draft::settled_at("no frontmatter\n"), None);
}

#[test]
fn the_rationale_is_fixed_text_and_parse_is_its_exact_inverse() {
    let rationale = Rationale {
        class: MemoryClass::Semantic,
        authority: Authority::Person,
        sessions: 3,
        principals: 2,
        settled_at: AT,
    };
    let text = rationale.render();
    assert_eq!(
        text,
        "Drafted from semantic memory of authority person, observed in 3 sessions by 2 principals, settled at 2026-11-02T10:00:00.000Z."
    );
    assert_eq!(Rationale::parse(&text), Some(rationale));
    let one = Rationale {
        class: MemoryClass::Procedural,
        authority: Authority::Agent,
        sessions: 1,
        principals: 1,
        ..rationale
    };
    assert_eq!(
        one.render(),
        "Drafted from procedural memory of authority agent, observed in 1 session by 1 principal, settled at 2026-11-02T10:00:00.000Z."
    );
    assert_eq!(Rationale::parse(&one.render()), Some(one));
    for bad in [
        text.replace("3 sessions", "3 session"),
        text.replace("3 sessions", "03 sessions"),
        text.replace("person", "boss"),
        text.replace(".000Z", "Z"),
        format!("{text} And more."),
        format!(" {text}"),
        text.trim_end_matches('.').to_owned(),
    ] {
        assert_eq!(Rationale::parse(&bad), None, "{bad}");
    }
}

#[test]
fn subject_key_lowercases_and_folds_runs_of_space_and_punctuation() {
    assert_eq!(
        subject_key("  Staging -- uses   Blue/Green!  "),
        "staging uses blue green"
    );
    assert_eq!(subject_key("Ünïcode\tStays, ÖK"), "ünïcode stays ök");
    assert_eq!(subject_key("...---"), "");
    assert_eq!(
        subject_key("Staging uses blue-green"),
        subject_key("staging: uses BLUE green.")
    );
    assert_eq!(
        subject_key_digest("Staging -- uses Blue/Green"),
        "sha256:5e8ae5a13451d64bf2aedddd5c996bdb037ab5b719107c1a301a27df1ebd569d"
    );
}

#[test]
fn the_ids_are_content_free_derivations_pinned_byte_for_byte() {
    let candidate = candidate_id("alpha", "human:ada", "mem-000000000000000000000001");
    assert_eq!(candidate, "c-43315d53cc285fb704d6");
    assert!(is_candidate_id(&candidate));
    let set = conflict_set_id("alpha", "human:ada", "c-0123456789abcdef0123");
    assert_eq!(set, "k-4c1bc3f4cad010fa1cd6");
    assert!(is_conflict_set_id(&set));
    for bad in [
        "c-43315D53CC285FB704D6",
        "c-43315d53cc285fb704d",
        "k-43315d53cc285fb704d6",
        "c-43315d53cc285fb704g6",
    ] {
        assert!(!is_candidate_id(bad), "{bad}");
    }
    assert!(!is_conflict_set_id(&candidate));
    // Another principal or space is another candidate.
    assert_ne!(
        candidate_id("alpha", "human:bo", "mem-000000000000000000000001"),
        candidate
    );
    assert_ne!(
        candidate_id("beta", "human:ada", "mem-000000000000000000000001"),
        candidate
    );
    assert_eq!(
        document_id("notes", "learned/", &candidate),
        "notes/learned/c-43315d53cc285fb704d6"
    );
}

#[test]
fn the_idempotency_key_carries_the_instance_the_candidate_and_the_draft_count() {
    let candidate = "c-43315d53cc285fb704d6";
    assert_eq!(
        idempotency_key("curator", candidate, 0),
        "curator/c-43315d53cc285fb704d6/0"
    );
    assert!(is_idempotency_key(
        &idempotency_key("curator", candidate, 12),
        "curator",
        candidate
    ));
    for bad in [
        "curator/c-43315d53cc285fb704d6/",
        "curator/c-43315d53cc285fb704d6/01",
        "curator/c-43315d53cc285fb704d6/-1",
        "curator/c-43315d53cc285fb704d6/1/x",
        "curator/c-43315d53cc285fb704d6/staging",
        "other/c-43315d53cc285fb704d6/1",
        "curator/c-0123456789abcdef0123/1",
        "curatorx/c-43315d53cc285fb704d6/1",
    ] {
        assert!(!is_idempotency_key(bad, "curator", candidate), "{bad}");
    }
}

#[test]
fn an_excerpt_is_the_first_thousand_characters_not_bytes() {
    let text = "é".repeat(EXCERPT_CHARS + 5);
    let cut = draft::excerpt(&text);
    assert_eq!(cut.chars().count(), EXCERPT_CHARS);
    assert_eq!(cut.len(), EXCERPT_CHARS * 2);
    assert_eq!(draft::excerpt("short"), "short");
    // The instant helper the rendering writes reads back.
    assert_eq!(parse_instant("2026-11-02T10:00:00.000Z").unwrap(), AT);
}
