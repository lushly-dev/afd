//! The record lane methods of [`Cx`] (records host specification, section 11.2; D159 to D165):
//! writing a declared record with its evidence, a person's decision on a standing record, and a
//! person's mark on a document. The three reads, `record_read`, `record_find` and `record_match`,
//! are with the other read methods in `store.rs`, so a [`Reader`](crate::Reader) has them too.
//!
//! A plugin reaches these through the `records` and `records_write` grants it already declares,
//! for the kinds its manifest lists under `[[records]]`. They are for compiled plugins: WIT world
//! 1.0.0 has no such function, so a component and a mounted server answer `NotGranted`.
//!
//! Every method takes the space explicitly and the host refuses a space outside the call's;
//! [`SpaceCx`] binds one, as for the other stores. The types are `umbel_store::lane`'s.

use serde_json::Value;
use umbel_store::lane::{
    Decision, Evidence, FindPage, LaneRecord, MatchPage, OwnInfo, RecordFind, RecordMatch,
    Standing, StandingLabel,
};
use umbel_store::{ContentHash, Envelope, Expect, RecordMeta, Rev};

use crate::cx::{Cx, HostError};
use crate::store::SpaceCx;

impl Cx {
    /// Grant `records_write`: write a record of a standing kind and replace its evidence.
    ///
    /// # Errors
    /// See [`HostServices::record_put_cited`](crate::HostServices::record_put_cited).
    #[allow(clippy::too_many_arguments)]
    pub fn record_put_cited(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
        evidence: Evidence,
    ) -> Result<RecordMeta, HostError> {
        self.check_space(space)?;
        self.host()?
            .record_put_cited(space, kind, id, body, envelope, expect, evidence)
    }

    /// Grant `records_write`: affirm a standing record's wording, or withdraw that, inside a
    /// call the space's person decided.
    ///
    /// # Errors
    /// See [`HostServices::record_decide`](crate::HostServices::record_decide).
    pub fn record_decide(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        decision: Decision,
    ) -> Result<StandingLabel, HostError> {
        self.check_space(space)?;
        self.host()?.record_decide(space, kind, id, decision)
    }

    /// Grants `records_write` and `documents`: mark a document, at the content hash the person
    /// was shown, as the person's own.
    ///
    /// # Errors
    /// See [`HostServices::doc_own_mark`](crate::HostServices::doc_own_mark).
    pub fn doc_own_mark(
        &self,
        space: &str,
        doc: &str,
        content_hash: &ContentHash,
        speaker: Option<&str>,
    ) -> Result<Rev, HostError> {
        self.check_space(space)?;
        self.host()?.doc_own_mark(space, doc, content_hash, speaker)
    }

    /// Grants `records_write` and `documents`: take a mark back.
    ///
    /// # Errors
    /// See [`HostServices::doc_own_unmark`](crate::HostServices::doc_own_unmark).
    pub fn doc_own_unmark(&self, space: &str, doc: &str) -> Result<Rev, HostError> {
        self.check_space(space)?;
        self.host()?.doc_own_unmark(space, doc)
    }

    /// Grant `documents`: how a readable document is the person's own now, or `None`.
    ///
    /// # Errors
    /// See [`HostServices::doc_own`](crate::HostServices::doc_own).
    pub fn doc_own(&self, space: &str, doc: &str) -> Result<Option<OwnInfo>, HostError> {
        self.check_space(space)?;
        self.host()?.doc_own(space, doc)
    }
}

impl SpaceCx<'_> {
    /// Grant `records_write`: write a record of a standing kind and replace its evidence.
    ///
    /// # Errors
    /// See [`Cx::record_put_cited`].
    pub fn record_put_cited(
        &self,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
        evidence: Evidence,
    ) -> Result<RecordMeta, HostError> {
        self.cx
            .record_put_cited(&self.space, kind, id, body, envelope, expect, evidence)
    }

    /// Grant `records`: one record of a declared kind, with its label.
    ///
    /// # Errors
    /// See [`Cx::record_read`].
    pub fn record_read(
        &self,
        kind: &str,
        id: &str,
        standings: &[Standing],
        verified_only: bool,
    ) -> Result<Option<LaneRecord>, HostError> {
        self.cx
            .record_read(&self.space, kind, id, standings, verified_only)
    }

    /// Grant `records`: the readable records of a declared kind by key and by text.
    ///
    /// # Errors
    /// See [`Cx::record_find`].
    pub fn record_find(&self, query: &RecordFind) -> Result<FindPage, HostError> {
        self.cx.record_find(&self.space, query)
    }

    /// Grant `records`: the identical and the nearest readable records of each text.
    ///
    /// # Errors
    /// See [`Cx::record_match`].
    pub fn record_match(&self, query: &RecordMatch) -> Result<MatchPage, HostError> {
        self.cx.record_match(&self.space, query)
    }

    /// Grant `records_write`: affirm a standing record's wording, or withdraw that.
    ///
    /// # Errors
    /// See [`Cx::record_decide`].
    pub fn record_decide(
        &self,
        kind: &str,
        id: &str,
        decision: Decision,
    ) -> Result<StandingLabel, HostError> {
        self.cx.record_decide(&self.space, kind, id, decision)
    }

    /// Grants `records_write` and `documents`: mark a document as the person's own.
    ///
    /// # Errors
    /// See [`Cx::doc_own_mark`].
    pub fn doc_own_mark(
        &self,
        doc: &str,
        content_hash: &ContentHash,
        speaker: Option<&str>,
    ) -> Result<Rev, HostError> {
        self.cx
            .doc_own_mark(&self.space, doc, content_hash, speaker)
    }

    /// Grants `records_write` and `documents`: take a mark back.
    ///
    /// # Errors
    /// See [`Cx::doc_own_unmark`].
    pub fn doc_own_unmark(&self, doc: &str) -> Result<Rev, HostError> {
        self.cx.doc_own_unmark(&self.space, doc)
    }

    /// Grant `documents`: how a readable document is the person's own now, or `None`.
    ///
    /// # Errors
    /// See [`Cx::doc_own`].
    pub fn doc_own(&self, doc: &str) -> Result<Option<OwnInfo>, HostError> {
        self.cx.doc_own(&self.space, doc)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use serde_json::json;
    use umbel_store::lane::{FindOrder, Pointer};

    use super::*;
    use crate::cx::{CallContext, HostServices, NoServices};
    use crate::store::Reader;

    fn cx(spaces: &[&str]) -> Cx {
        Cx::without_grants(CallContext {
            spaces: spaces.iter().map(|s| (*s).to_owned()).collect(),
            ..CallContext::default()
        })
    }

    fn envelope() -> Envelope {
        Envelope::from_value(json!({
            "version": 1, "origin": "user-stated", "space": "garden", "plugin": "notes",
            "agent": null, "principal": "human:local", "session": null, "traceId": "t",
            "observedAt": "2026-11-02T09:20:11.004Z", "validFrom": null, "validUntil": null,
            "confidence": null, "authority": null, "sources": null, "generated": null,
            "contentHash": null, "derivedFrom": null, "access": ["space"],
            "sensitivity": "internal"
        }))
        .unwrap()
    }

    fn evidence() -> Evidence {
        Evidence {
            doc: "journal/roses".to_owned(),
            doc_hash: ContentHash::of(b"Prune roses in late winter."),
            units: vec![4],
            rule: "sentences/1".to_owned(),
            speaker: None,
            verbatim: true,
        }
    }

    fn find() -> RecordFind {
        RecordFind {
            kind: "note".to_owned(),
            keys: Vec::new(),
            standings: Vec::new(),
            verified_only: false,
            text: None,
            order: FindOrder::Id,
            after: None,
            limit: 10,
            total: false,
        }
    }

    fn matching() -> RecordMatch {
        RecordMatch {
            kind: "note".to_owned(),
            texts: vec!["Prune roses in late winter.".to_owned()],
            k: 5,
            keys: Vec::new(),
            standings: Vec::new(),
            verified_only: false,
            exclude: Vec::new(),
        }
    }

    #[track_caller]
    fn not_granted(result: Result<(), HostError>, grant: &str) {
        match result {
            Err(HostError::NotGranted(message)) => {
                assert!(message.contains(&format!("`{grant}`")), "{message}");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_handle_without_grants_answers_not_granted_for_every_record_lane_method() {
        let cx = cx(&["garden"]);
        let hash = ContentHash::of(b"x");
        not_granted(
            cx.record_put_cited(
                "garden",
                "note",
                "n1",
                json!({}),
                envelope(),
                Expect::Any,
                evidence(),
            )
            .map(drop),
            "records_write",
        );
        not_granted(
            cx.record_read("garden", "note", "n1", &[Standing::Affirmed], true)
                .map(drop),
            "records",
        );
        not_granted(cx.record_find("garden", &find()).map(drop), "records");
        not_granted(cx.record_match("garden", &matching()).map(drop), "records");
        not_granted(
            cx.record_decide("garden", "note", "n1", Decision::Affirm)
                .map(drop),
            "records_write",
        );
        not_granted(
            cx.doc_own_mark("garden", "journal/roses", &hash, Some("Gardener"))
                .map(drop),
            "records_write",
        );
        not_granted(
            cx.doc_own_unmark("garden", "journal/roses").map(drop),
            "records_write",
        );
        not_granted(cx.doc_own("garden", "journal/roses").map(drop), "documents");
    }

    #[test]
    fn a_bound_space_has_the_same_eight() {
        let cx = cx(&["garden"]);
        let space = cx.in_space("garden").unwrap();
        let hash = ContentHash::of(b"x");
        not_granted(
            space
                .record_put_cited("note", "n1", json!({}), envelope(), Expect::Any, evidence())
                .map(drop),
            "records_write",
        );
        not_granted(
            space.record_read("note", "n1", &[], false).map(drop),
            "records",
        );
        not_granted(space.record_find(&find()).map(drop), "records");
        not_granted(space.record_match(&matching()).map(drop), "records");
        not_granted(
            space
                .record_decide("note", "n1", Decision::Withdraw)
                .map(drop),
            "records_write",
        );
        not_granted(
            space.doc_own_mark("journal/roses", &hash, None).map(drop),
            "records_write",
        );
        not_granted(
            space.doc_own_unmark("journal/roses").map(drop),
            "records_write",
        );
        not_granted(space.doc_own("journal/roses").map(drop), "documents");
    }

    #[test]
    fn a_space_outside_the_call_is_refused_before_any_grant() {
        let cx = cx(&["garden"]);
        let hash = ContentHash::of(b"x");
        for refused in [
            cx.record_put_cited(
                "orchard",
                "note",
                "n1",
                json!({}),
                envelope(),
                Expect::Any,
                evidence(),
            )
            .map(drop),
            cx.record_read("orchard", "note", "n1", &[], false)
                .map(drop),
            cx.record_find("orchard", &find()).map(drop),
            cx.record_match("orchard", &matching()).map(drop),
            cx.record_decide("orchard", "note", "n1", Decision::Affirm)
                .map(drop),
            cx.doc_own_mark("orchard", "journal/roses", &hash, None)
                .map(drop),
            cx.doc_own_unmark("orchard", "journal/roses").map(drop),
            cx.doc_own("orchard", "journal/roses").map(drop),
        ] {
            match refused {
                Err(HostError::NotGranted(message)) => {
                    assert!(message.contains("orchard"), "{message}");
                }
                other => panic!("{other:?}"),
            }
        }
    }

    #[test]
    fn a_reader_has_the_three_reads() {
        let reader = Reader::new(Box::new(NoServices));
        not_granted(
            reader
                .record_read("garden", "note", "n1", &[], false)
                .map(drop),
            "records",
        );
        let mut query = find();
        query.keys.push(umbel_store::lane::KeyFilter {
            key: Pointer::parse("/bed").unwrap(),
            any: vec!["north".to_owned()],
        });
        not_granted(reader.record_find("garden", &query).map(drop), "records");
        not_granted(
            reader.record_match("garden", &matching()).map(drop),
            "records",
        );
    }

    #[test]
    fn host_services_default_every_record_lane_method_to_not_granted() {
        // `NoServices` overrides none of the eight, as a component's and a mounted server's
        // services override none: each answers the trait's default.
        let host = NoServices;
        let hash = ContentHash::of(b"x");
        not_granted(
            host.record_put_cited(
                "garden",
                "note",
                "n1",
                json!({}),
                envelope(),
                Expect::Any,
                evidence(),
            )
            .map(drop),
            "records_write",
        );
        not_granted(
            host.record_read("garden", "note", "n1", &[], false)
                .map(drop),
            "records",
        );
        not_granted(host.record_find("garden", &find()).map(drop), "records");
        not_granted(
            host.record_match("garden", &matching()).map(drop),
            "records",
        );
        not_granted(
            host.record_decide("garden", "note", "n1", Decision::Affirm)
                .map(drop),
            "records_write",
        );
        not_granted(
            host.doc_own_mark("garden", "journal/roses", &hash, None)
                .map(drop),
            "records_write",
        );
        not_granted(
            host.doc_own_unmark("garden", "journal/roses").map(drop),
            "records_write",
        );
        not_granted(
            host.doc_own("garden", "journal/roses").map(drop),
            "documents",
        );
    }
}
