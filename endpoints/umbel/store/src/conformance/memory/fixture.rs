//! The memory access fixture (`fixtures/memory/records.json`): 40 records of two owners across six
//! access shapes, written into a store and mirrored by an independent oracle.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::{T0, write};
use crate::conformance::samples;
use crate::memory::{MemoryFlag, MemoryStore, Millis, ProjectMatch, PushFilter};
use crate::{AccessSet, Actor, ActorKind, Authority, MemoryClass, Origin};

const FIXTURE: &str = include_str!("../../../fixtures/memory/records.json");

/// The instant every fixture read uses: after the last record was written.
pub(super) const NOW: Millis = T0 + 100_000;

#[derive(Deserialize)]
pub(super) struct FixtureRecord {
    pub(super) n: u64,
    pub(super) owner: String,
    pub(super) access: Vec<String>,
    pub(super) class: String,
    pub(super) project: Option<String>,
    pub(super) session: Option<String>,
    pub(super) authority: String,
    pub(super) agent: Option<String>,
    pub(super) flags: Vec<String>,
    pub(super) subject: String,
    pub(super) text: String,
    pub(super) tags: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct Fixture {
    pub(super) readers: BTreeMap<String, Vec<String>>,
    pub(super) records: Vec<FixtureRecord>,
}

pub(super) fn load() -> Result<Fixture, String> {
    serde_json::from_str(FIXTURE).map_err(|e| format!("the memory fixture does not parse: {e}"))
}

impl FixtureRecord {
    /// The record's id.
    pub(super) fn id(&self) -> String {
        samples::memory_id(self.n + 1)
    }

    pub(super) fn class(&self) -> MemoryClass {
        MemoryClass::parse(&self.class).unwrap_or(MemoryClass::Semantic)
    }

    pub(super) fn authority(&self) -> Authority {
        Authority::parse(&self.authority).unwrap_or(Authority::Agent)
    }

    pub(super) fn flagged(&self) -> bool {
        !self.flags.is_empty()
    }

    /// Whether a reader holding `tokens` may read it.
    pub(super) fn readable(&self, tokens: &[String]) -> bool {
        self.access.iter().any(|t| tokens.contains(t))
    }

    /// Whether `push` admits it under `project`.
    pub(super) fn pushed(&self, push: &PushFilter, project: &ProjectMatch) -> bool {
        push.admits(
            &self.owner,
            self.authority(),
            self.project.as_deref(),
            project,
            self.flagged(),
        )
    }
}

/// Write the fixture, record `n` in its own batch at `T0 + n` seconds, valid from `T0`.
pub(super) fn populate(memory: &dyn MemoryStore, fixture: &Fixture) -> Result<(), String> {
    for r in &fixture.records {
        let access: Vec<&str> = r.access.iter().map(String::as_str).collect();
        let mut e = samples::memory_entry(r.n + 1, &r.owner, &access, &r.subject, &r.text);
        e.class = r.class();
        e.scope.project = r.project.clone();
        e.scope.session = r.session.clone();
        e.scope.agent = r.agent.as_ref().map(|id| Actor {
            kind: ActorKind::Agent,
            id: Some(id.clone()),
            label: None,
            on_behalf_of: Some(r.owner.clone()),
        });
        e.tags = r.tags.clone();
        e.flags = r
            .flags
            .iter()
            .map(|f| {
                if f == "hidden-text" {
                    MemoryFlag::HiddenText
                } else {
                    MemoryFlag::InstructionLike
                }
            })
            .collect();
        e.access = AccessSet::new(r.access.iter().cloned()).map_err(|e| e.to_string())?;
        samples::set_authority(&mut e, r.authority());
        if r.authority() == Authority::Person {
            e.envelope.origin = Origin::UserStated;
        }
        samples::agree(&mut e);
        let at = T0 + i64::try_from(r.n).unwrap_or(0) * 1000;
        write(memory, at, vec![e])?;
    }
    Ok(())
}
