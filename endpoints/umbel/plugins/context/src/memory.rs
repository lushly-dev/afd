//! The memory sections (section 9.3): the push rule compiled into every read (`PushFilter`),
//! candidates tier by tier with `per_authority_cap`, and the `left_out` counts.
//!
//! Every read is under the caller's reader filter, which the host applies inside the query;
//! the push rule only narrows what a readable record must be to be pushed. Flagged records never
//! fill a candidate slot (`include_flagged` is false) and are only counted.

use serde_json::json;
use umbel_sdk::{Cx, HostError, LeftOutQuery, Outcome};
use umbel_store::memory::{
    KeyFileState, MemoryList, MemoryOrder, ProjectMatch, RecallQuery, format_instant,
};
use umbel_store::{
    AsOf, Authority, MemoryClass, MemoryQuery, MemoryRecord, PushFilter, ReadFlags, ScopeQuery,
};

use crate::fail;
use crate::render::clean_header;
use crate::select::{Gap, Item, Lane, Request, Section};
use crate::settings::{Bundle, Settings};

/// The candidates one tier's query asks for.
const CANDIDATES: u32 = 64;
/// The tier order of section 9.3.
const TIERS: [Authority; 5] = [
    Authority::Person,
    Authority::Tool,
    Authority::Agent,
    Authority::Import,
    Authority::Transcript,
];

/// What the memory lanes found.
pub(crate) struct Found {
    pub(crate) lanes: Vec<Lane>,
    pub(crate) keys_failed: Option<&'static str>,
    pub(crate) head: Option<u64>,
}

/// Why the memory lane stopped.
enum Stop {
    /// The grant is absent, or nothing was ever written: `lane-unavailable`, no warning.
    Absent,
    /// The key file is missing or foreign: `lane-unavailable` with this warning.
    Keys(&'static str),
    /// Any other failure fails the call.
    Fail(Outcome),
}

fn stop(error: HostError) -> Stop {
    match error {
        HostError::NotGranted(_) | HostError::NotProvisioned => Stop::Absent,
        HostError::KeysMissing => Stop::Keys("MEMORY_KEYS_MISSING"),
        HostError::KeysMismatch => Stop::Keys("MEMORY_KEYS_MISMATCH"),
        other => Stop::Fail(fail::host(&other)),
    }
}

/// The push rule of one section: the configured lists, `transcript` added to the caller's own
/// for `episodic` only, and `person` alone for a record with no project when the bundle names
/// one.
fn push_filter(section: Section, settings: &Settings, caller: &str) -> PushFilter {
    let mut own = settings.push_authorities.clone();
    if section == Section::Episodic && !own.contains(&Authority::Transcript) {
        own.push(Authority::Transcript);
    }
    PushFilter {
        caller: caller.to_owned(),
        own,
        foreign: settings.push_foreign_authorities.clone(),
        unset_project: vec![Authority::Person],
    }
}

fn scope(request: &Request) -> ScopeQuery {
    ScopeQuery {
        project: request
            .project
            .clone()
            .map_or(ProjectMatch::Any, ProjectMatch::ExactOrUnset),
        principal: None,
        agent: None,
        session: None,
    }
}

/// A memory item: validated values in the header, the subject and text quoted below it.
pub(crate) fn item(space: &str, record: &MemoryRecord) -> Item {
    let id = format!("{space}:{}", record.id);
    let authority = record.authority().map(Authority::as_str);
    let envelope = &record.provenance;
    let json = json!({
        "kind": "memory",
        "id": id,
        "title": record.subject,
        "text": record.text,
        "class": record.class.as_str(),
        "verification": "unverified",
        "flags": [],
        "trust": "content",
        "provenance": {
            "origin": envelope.origin,
            "authority": authority,
            "confirmation": envelope.confirmation,
            "principal": record.scope.principal,
            "recordedAt": format_instant(record.recorded_at),
            "validFrom": format_instant(record.valid_from),
            "validUntil": record.valid_until.map(format_instant),
            "expiresAt": format_instant(record.expires_at),
            "confidence": envelope.confidence,
            "constraints": envelope.constraints,
        },
    });
    let source = json!({ "type": "memory", "id": id, "title": record.subject });
    let recorded = format_instant(record.recorded_at);
    let header = format!(
        "[memory · {} · {} · unverified · authority: {} · recorded {}]",
        clean_header(&id),
        record.class.as_str(),
        authority.unwrap_or("unknown"),
        recorded.get(..10).unwrap_or(&recorded),
    );
    Item {
        id,
        json,
        source,
        header,
        title: record.subject.clone(),
        text: record.text.clone(),
        capped: false,
    }
}

/// One tier's candidates in lane order, the ones past the cap kept by id only.
fn tier(
    cx: &Cx,
    request: &Request,
    class: MemoryClass,
    authority: Authority,
    push: &PushFilter,
    cap: usize,
    lane: &mut Lane,
) -> Result<(), Stop> {
    let space = request.space.as_str();
    let as_of = AsOf::at(request.as_of);
    let flags = ReadFlags::at(request.now);
    if request.terms.is_empty() {
        let page = cx
            .memory_list(
                space,
                &MemoryList {
                    scope: scope(request),
                    classes: vec![class],
                    tags: Vec::new(),
                    authorities: vec![authority],
                    push: Some(push.clone()),
                    as_of,
                    flags,
                    order: MemoryOrder::Recorded,
                    after: None,
                    limit: CANDIDATES,
                },
            )
            .map_err(stop)?;
        lane.unreadable += page.unreadable;
        let mut placed = 0;
        for meta in page.items {
            if placed == cap {
                lane.items
                    .push(Item::capped(format!("{space}:{}", meta.id)));
                continue;
            }
            // A listing holds no text: read the record at the same instants.
            match cx.memory_get(space, &meta.id, as_of, flags) {
                Ok(Some(record)) => {
                    lane.items.push(item(space, &record));
                    placed += 1;
                }
                Ok(None) => {}
                Err(HostError::KeyAbsent { .. } | HostError::SealInvalid { .. }) => {
                    lane.unreadable += 1;
                }
                Err(error) => return Err(stop(error)),
            }
        }
    } else {
        let query = MemoryQuery::any_of(request.terms.iter().cloned())
            .map_err(|error| Stop::Fail(fail::invalid(&error.to_string())))?;
        let page = cx
            .memory_recall(
                space,
                &RecallQuery {
                    query,
                    scope: scope(request),
                    classes: vec![class],
                    tags: Vec::new(),
                    authorities: vec![authority],
                    push: Some(push.clone()),
                    as_of,
                    flags,
                    limit: CANDIDATES,
                },
            )
            .map_err(stop)?;
        lane.unreadable += page.unreadable;
        for (n, hit) in page.hits.iter().enumerate() {
            lane.items.push(if n < cap {
                item(space, &hit.record)
            } else {
                Item::capped(format!("{space}:{}", hit.record.id))
            });
        }
    }
    Ok(())
}

/// One section: its tiers, then its counts.
fn section_lane(
    cx: &Cx,
    request: &Request,
    settings: &Settings,
    bundle: &Bundle,
    section: Section,
    class: MemoryClass,
) -> Result<Lane, Stop> {
    let caller = request.caller.as_deref().unwrap_or_default();
    let push = push_filter(section, settings, caller);
    let mut lane = Lane::new(section);
    for authority in TIERS {
        if push.own.contains(&authority) || push.foreign.contains(&authority) {
            tier(
                cx,
                request,
                class,
                authority,
                &push,
                bundle.per_authority_cap,
                &mut lane,
            )?;
        }
    }
    let left = cx
        .memory_left_out(
            &request.space,
            &LeftOutQuery {
                scope: scope(request),
                classes: vec![class],
                push,
                as_of: AsOf::at(request.as_of),
                now: request.now,
            },
        )
        .map_err(stop)?;
    if let Some(counts) = left.by_class.get(&class) {
        lane.authority = counts.authority;
        lane.flagged = counts.flagged;
    }
    Ok(lane)
}

/// Every asked-for memory section of `request`.
pub(crate) fn lanes(
    cx: &Cx,
    request: &Request,
    settings: &Settings,
    bundle: &Bundle,
) -> Result<Found, Outcome> {
    let sections: Vec<(Section, MemoryClass)> = request
        .sections
        .iter()
        .filter_map(|section| section.class().map(|class| (*section, class)))
        .collect();
    let gapped = |gap: Gap| {
        sections
            .iter()
            .map(|(section, _)| Lane::gap(*section, gap))
            .collect::<Vec<_>>()
    };
    let mut found = Found {
        lanes: Vec::new(),
        keys_failed: None,
        head: None,
    };
    if sections.is_empty() {
        return Ok(found);
    }
    if settings.verified_only {
        found.lanes = gapped(Gap::VerifiedOnly);
        return Ok(found);
    }
    let run = || -> Result<(Vec<Lane>, u64), Stop> {
        // The key file's state first, so a missing or foreign one is said once and no text read
        // is tried; a read that meets it later stops the same way.
        match cx.memory_key_file(&request.space).map_err(stop)? {
            KeyFileState::Present => {}
            KeyFileState::Missing => return Err(Stop::Keys("MEMORY_KEYS_MISSING")),
            KeyFileState::Mismatch => return Err(Stop::Keys("MEMORY_KEYS_MISMATCH")),
        }
        let head = cx.memory_head(&request.space).map_err(stop)?;
        let mut lanes = Vec::new();
        for (section, class) in &sections {
            lanes.push(section_lane(
                cx, request, settings, bundle, *section, *class,
            )?);
        }
        Ok((lanes, head))
    };
    match run() {
        Ok((lanes, head)) => {
            found.lanes = lanes;
            found.head = Some(head);
        }
        Err(Stop::Absent) => found.lanes = gapped(Gap::LaneUnavailable),
        Err(Stop::Keys(code)) => {
            found.lanes = gapped(Gap::LaneUnavailable);
            found.keys_failed = Some(code);
        }
        Err(Stop::Fail(outcome)) => return Err(outcome),
    }
    Ok(found)
}

/// The JSON spelling of an authority list, for the reasoning line's tests.
#[cfg(test)]
fn names(list: &[Authority]) -> serde_json::Value {
    json!(list.iter().map(|a| a.as_str()).collect::<Vec<_>>())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn settings(own: &[Authority]) -> Settings {
        Settings {
            verified_only: false,
            push_authorities: own.to_vec(),
            push_foreign_authorities: vec![Authority::Person],
        }
    }

    #[test]
    fn the_default_push_is_person_and_episodic_adds_own_transcripts() {
        let semantic = push_filter(
            Section::Semantic,
            &settings(&[Authority::Person]),
            "human:ada",
        );
        assert_eq!(names(&semantic.own), json!(["person"]));
        assert_eq!(names(&semantic.foreign), json!(["person"]));
        assert_eq!(names(&semantic.unset_project), json!(["person"]));
        let episodic = push_filter(
            Section::Episodic,
            &settings(&[Authority::Person]),
            "human:ada",
        );
        assert_eq!(names(&episodic.own), json!(["person", "transcript"]));
        // Only the caller's own: a foreign transcript is never admitted by the section.
        assert_eq!(names(&episodic.foreign), json!(["person"]));
    }
}
