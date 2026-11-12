//! The record lane's services (records host specification, sections 4.2, 6, 7, 8, 11.2 and 13;
//! D159 to D165, D169): writing a record of a kind the instance's manifest declares, with or
//! without evidence; reading, finding and matching such records, each with its label; a person's
//! decision on a standing record; and a person's mark on a document. Each read is filtered by the
//! caller's reader filter; a write is given the access set the host owns and its text is
//! scanned, flagged and never blocked.
//!
//! **Nothing a call claims or passes gives a record standing.** A decision and a mark are
//! written only inside a call that carries the proof the plugin gate's person gate accepted
//! ([`CallServices::person_gate`]), made by the space's one configured person
//! ([`CallServices::person_decides`]). What is the person's own, what a command can write files
//! into, and what "verified" means in a space come from the configuration, through the
//! [`StandingView`] the host builds for each call ([`CallServices::standing_view`]); a call's
//! `standings` and `verified_only` only ever narrow it.
//!
//! No message here holds a record's text or a key's value.
//!
//! **Seam.** Meaning is that specification's step B5: the vector after a put's write joins in
//! [`CallServices::put_declared`], and a match's texts are embedded in
//! [`CallServices::svc_record_match`], after its query passed its checks. Until then a match is
//! scored by words alone and says `meaning` is off.

use std::sync::Arc;

use serde_json::Value;
use umbel_sdk::HostError as ServiceError;
use umbel_store::lane::{
    Decision, Evidence, FindPage, LaneRecord, LaneWrite, MatchPage, OwnCollection, OwnInfo,
    OwnMark, RecordDecision, RecordDecl, RecordFind, RecordMatch, Standing, StandingLabel,
    StandingView, extract, is_speaker,
};
use umbel_store::{
    Assurance, ContentHash, Envelope, Expect, MemoryFlag, RecordMeta, Rev, StoreError,
};

use super::grants::CallServices;
use crate::access::effective_principal_of;
use crate::store::{SpaceStores, host_error, records};
use crate::workspace::{DefaultAccess, SpaceConfig, VerifiedAdmits};

type Result<T> = std::result::Result<T, ServiceError>;

fn invalid(code: &str, message: impl std::fmt::Display) -> ServiceError {
    ServiceError::Invalid(format!("{code}: {message}"))
}

fn not_granted(code: &str, message: impl std::fmt::Display) -> ServiceError {
    ServiceError::NotGranted(format!("{code}: {message}"))
}

/// The principal strings the space's person decides as (section 6.1, check 3): the configured
/// `person`, and the principal `[principal.equivalents]` maps it to. A caller is the person
/// when its effective principal is one of them, and a stored decision or mark counts only when
/// its `by` is one of them.
fn person_identities(config: &crate::workspace::Config, person: Option<&str>) -> Vec<String> {
    let Some(person) = person else {
        return Vec::new();
    };
    let mut identities = vec![person.to_owned()];
    if let Some(target) = config.principal.equivalents.get(person) {
        identities.push(target.clone());
    }
    identities
}

/// Withhold who affirmed a record, and how they were proven beyond the level, from a reader
/// who is neither the operator nor the space's person (section 6.5): such a reader keeps when
/// and at what level.
fn withhold_decider(label: &mut Option<StandingLabel>) {
    if let Some(affirmed) = label.as_mut().and_then(|label| label.affirmed.as_mut()) {
        affirmed.seen = None;
    }
}

/// The three standings, in the order a page's `admitted` holds them.
const STANDINGS: [Standing; 3] = [Standing::Unverified, Standing::Attested, Standing::Affirmed];

/// Section 6.6's `admitted`: what "verified" means in the space when the call asks for verified
/// content only, else every standing; narrowed to the call's `standings` when it names any. A
/// call narrows and never widens: a standing outside the base is not an error and returns less.
fn admitted(
    verified: VerifiedAdmits,
    standings: &[Standing],
    verified_only: bool,
) -> Vec<Standing> {
    let base: &[Standing] = match (verified_only, verified) {
        (false, _) => &STANDINGS,
        (true, VerifiedAdmits::Affirmed) => &[Standing::Affirmed],
        (true, VerifiedAdmits::AffirmedAttested) => &[Standing::Attested, Standing::Affirmed],
    };
    base.iter()
        .copied()
        .filter(|standing| standings.is_empty() || standings.contains(standing))
        .collect()
}

/// A store failure of a lane service on `kind` as section 13 words it: a stale lane names the
/// kind, and every other failure maps as [`host_error`] maps it.
fn lane_error(kind: &str, error: StoreError) -> ServiceError {
    match error {
        StoreError::LaneStale => invalid(records::RECORD_LANE_STALE, records::stale_message(kind)),
        other => host_error(other),
    }
}

/// The scan's findings over a record's text values (section 4.2, step 5), sorted and each once.
pub(crate) fn scan_text(text: &str) -> Vec<MemoryFlag> {
    let scan = umbel_scan::scan_content(text);
    let mut flags = Vec::new();
    if scan.has_hidden_text() {
        flags.push(MemoryFlag::HiddenText);
    }
    if scan.is_instruction_like() {
        flags.push(MemoryFlag::InstructionLike);
    }
    flags
}

impl CallServices {
    /// The declaration of `kind` in the calling instance's manifest, if it declares one.
    pub(super) fn declared_kind(&self, kind: &str) -> Option<&RecordDecl> {
        self.shared.records.get(kind)
    }

    /// The declaration a lane service on `kind` runs under, else `RECORD_KIND_NOT_DECLARED`.
    fn lane_kind(&self, kind: &str) -> Result<&RecordDecl> {
        self.declared_kind(kind).ok_or_else(|| {
            invalid(
                records::RECORD_KIND_NOT_DECLARED,
                format!(
                    "the kind {kind} is not a declared record kind of {}",
                    self.shared.instance
                ),
            )
        })
    }

    /// The configuration of `space`.
    fn space_config(&self, space: &str) -> Result<&SpaceConfig> {
        self.shared
            .workspace
            .config()
            .spaces
            .iter()
            .find(|declared| declared.id.as_str() == space)
            .ok_or_else(|| ServiceError::NotFound(format!("the space `{space}` is not declared")))
    }

    /// What the configuration says of `space` for one call (section 11.2), admitting `admit`:
    /// its own collections with their speakers, and its collections a command can write files
    /// into, as this host judged them when it read the configuration at its start (section 3).
    /// Nothing here comes from the call.
    fn space_view(&self, space: &str, admit: Vec<Standing>) -> Result<StandingView> {
        let config = self.shared.workspace.config();
        let declared = self.space_config(space)?;
        Ok(StandingView {
            own: declared
                .collections
                .iter()
                .filter(|collection| collection.own)
                .map(|collection| OwnCollection {
                    id: collection.id.clone(),
                    speaker: collection.speaker.clone(),
                })
                .collect(),
            command_writable: declared
                .collections
                .iter()
                .filter(|collection| config.command_writable(space, &collection.id))
                .map(|collection| collection.id.clone())
                .collect(),
            person: person_identities(config, declared.person.as_deref()),
            admit,
        })
    }

    /// Whether this call's reader may see who affirmed a record and how they were proven
    /// (section 6.5, as section 12.4 says of who a space's person is): the operator and the
    /// space's person. A read made as another principal (`as_reader`) is that principal's.
    fn sees_decider(&self, space: &str) -> bool {
        let config = self.shared.workspace.config();
        let person = self
            .space_config(space)
            .ok()
            .and_then(|declared| declared.person.as_deref());
        let persons = person_identities(config, person);
        match &self.as_principal {
            Some(principal) => persons.contains(principal),
            None => {
                crate::access::is_operator(&self.context)
                    || effective_principal_of(&self.context)
                        .is_some_and(|principal| persons.contains(&principal))
            }
        }
    }

    /// The view of one read of `decl`'s kind in `space` (sections 6.6 and 11.2): the space's
    /// own and command-writable collections, and the standings the call admits. The call's
    /// `verified_only` asks for what the space's `verified_admits` names, and its `standings`
    /// narrow further; neither can widen it. A kind without standing has no standing to ask
    /// for: section 7's rule refuses a call that does.
    fn standing_view(
        &self,
        space: &str,
        decl: &RecordDecl,
        standings: &[Standing],
        verified_only: bool,
    ) -> Result<StandingView> {
        if !decl.standing {
            if !standings.is_empty() || verified_only {
                return Err(invalid(
                    records::RECORD_QUERY_INVALID,
                    "standings must be empty and verified_only false for a kind without standing",
                ));
            }
            return self.space_view(space, STANDINGS.to_vec());
        }
        let verified = self.space_config(space)?.verified_admits;
        self.space_view(space, admitted(verified, standings, verified_only))
    }

    /// Section 6.1's checks 2 and 3, which a decision and a mark both make, in that order: the
    /// call passed the person gate, and the caller is the space's person. It answers how the
    /// person was proven and the person's effective principal, which a standing fact records.
    ///
    /// Neither is read from the plugin or from the call's input. The proof was derived when
    /// this call's services were built, from the host's own context fields, for this command
    /// and this validated input. The person is the configuration's `[spaces.<id>] person`, and
    /// the caller is it when the caller's effective principal, or a legacy principal that maps
    /// to it, is that string.
    fn person_decides(&self, space: &str) -> Result<(Assurance, String)> {
        let assurance = self.person_gate.clone().ok_or_else(|| {
            not_granted(
                records::RECORD_DECISION_NOT_GATED,
                "a decision on standing is made only inside a call a person decided",
            )
        })?;
        let not_the_person = || {
            not_granted(
                records::RECORD_DECISION_NOT_THE_PERSON,
                "only the space's person decides standing here",
            )
        };
        let config = self.shared.workspace.config();
        let person = self.space_config(space)?.person.as_deref();
        let principal = effective_principal_of(&self.context).ok_or_else(not_the_person)?;
        // The principal a decision is recorded under is one a read counts: the same list.
        if !person_identities(config, person).contains(&principal) {
            return Err(not_the_person());
        }
        Ok((assurance, principal))
    }

    /// The call's time, as a standing fact records it.
    fn decided_at(&self) -> String {
        crate::person::iso(self.context.clock().now())
    }

    /// `record_put` and `record_put_cited` on a declared kind (section 4.2), after step 1, the
    /// grant and the space, which the caller made. `evidence` is `record_put_cited`'s; `None`
    /// leaves the record's stored evidence as it is. Step 8, the vector after the write, is
    /// step B5's.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn put_declared(
        &self,
        space: &str,
        stores: &Arc<SpaceStores>,
        decl: &RecordDecl,
        id: &str,
        body: Value,
        mut envelope: Envelope,
        expect: Expect,
        evidence: Option<Evidence>,
    ) -> Result<RecordMeta> {
        // 2. A principal.
        let principal = effective_principal_of(&self.context).ok_or_else(|| {
            invalid(
                records::RECORD_PRINCIPAL_REQUIRED,
                "a declared record needs a caller with an effective principal",
            )
        })?;
        // 3. The envelope: the access set is the host's, whatever the plugin sent. Private by
        // default; the store keeps the stored set of a record that exists.
        envelope.access = vec![match self.shared.records_default_access {
            DefaultAccess::Private => format!("principal:{principal}"),
            DefaultAccess::Space => "space".to_owned(),
        }];
        if decl.standing {
            // Version 3, whose delegation chain `seal` fills, and the authority, whatever the
            // plugin sent (D71): `person` for a call that carries the person gate's proof.
            envelope.version = umbel_store::MEMORY_ENVELOPE_VERSION;
            envelope.authority = Some(
                crate::authority::record_authority(&self.context, self.person_gate.is_some())
                    .as_str()
                    .to_owned(),
            );
        }
        let envelope = self.seal(space, envelope)?;
        // 4. Extract: a refusal names the pointer and never the value.
        let found = extract(decl, &body).map_err(|error| match error {
            StoreError::Invalid(why) => invalid(records::RECORD_FIELD_INVALID, why),
            other => host_error(other),
        })?;
        // 5. Scan each text value: flagged, never blocked.
        let mut flags: Vec<MemoryFlag> = found
            .texts
            .iter()
            .flatten()
            .flat_map(|text| scan_text(text))
            .collect();
        flags.sort();
        flags.dedup();
        // 6. The evidence's shape. Its document is checked inside the store's transaction.
        if let Some(evidence) = &evidence {
            evidence.check().map_err(host_error)?;
        }
        // 7. One transaction, as the writer: an existing record it may not read is taken, and
        // evidence must cite a document it may read.
        let writer = self.filter(space)?;
        let lane = LaneWrite {
            evidence,
            flags,
            model: None,
        };
        let done = stores
            .documents
            .put_declared_record(
                &self.shared.instance,
                decl,
                id,
                body,
                envelope,
                expect,
                lane,
                &writer,
            )
            .map_err(|error| lane_error(&decl.kind, error))?;
        self.note_write(done.meta.rev);
        Ok(done.meta)
    }

    pub(super) fn svc_record_read(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        standings: &[Standing],
        verified_only: bool,
    ) -> Result<Option<LaneRecord>> {
        let (stores, filter) = self.reading("records", space)?;
        let decl = self.lane_kind(kind)?;
        let view = self.standing_view(space, decl, standings, verified_only)?;
        let mut found = stores
            .documents
            .read_record(&self.shared.instance, decl, id, &view, &filter)
            .map_err(|error| lane_error(kind, error))?;
        if !self.sees_decider(space)
            && let Some(record) = &mut found
        {
            withhold_decider(&mut record.label);
        }
        Ok(found)
    }

    pub(super) fn svc_record_find(&self, space: &str, query: &RecordFind) -> Result<FindPage> {
        let (stores, filter) = self.reading("records", space)?;
        let decl = self.lane_kind(&query.kind)?;
        // Section 7's rules, before anything is read: the refusal names the rule broken.
        query.plan(decl).map_err(|error| match error {
            StoreError::Invalid(why) => invalid(records::RECORD_QUERY_INVALID, why),
            other => host_error(other),
        })?;
        let view = self.standing_view(space, decl, &query.standings, query.verified_only)?;
        let mut page = stores
            .documents
            .find_records(&self.shared.instance, decl, query, &view, &filter)
            .map_err(|error| lane_error(&query.kind, error))?;
        if !self.sees_decider(space) {
            for item in &mut page.items {
                withhold_decider(&mut item.label);
            }
        }
        Ok(page)
    }

    /// `record_match` (section 8): for each text, the readable records whose match field is
    /// identical and the nearest ones with their scores. The host returns scores only.
    ///
    /// The checks, in order: the grant and the space; the kind is a declared kind of this
    /// instance with a match field; section 8's rules, before anything is read; and what the
    /// call admits, which its `verified_only` and `standings` narrow and never widen. Every
    /// statistic is then the caller's own: the store counts only what the reader filter and the
    /// view admit. Each hit carries the label a read gives it, with who affirmed it withheld
    /// from a reader who is neither the operator nor the space's person, as `record_read` and
    /// `record_find` withhold it.
    ///
    /// No model is loaded before step B5, so no text is embedded: `meaning` is off, and each
    /// hit's `fused` is its `words`.
    pub(super) fn svc_record_match(&self, space: &str, query: &RecordMatch) -> Result<MatchPage> {
        let (stores, filter) = self.reading("records", space)?;
        let decl = self.lane_kind(&query.kind)?;
        if decl.matched.is_none() {
            return Err(invalid(
                records::RECORD_KIND_NOT_DECLARED,
                format!(
                    "the kind {} of {} declares no match field",
                    query.kind, self.shared.instance
                ),
            ));
        }
        // Section 8's rules, before anything is read: the refusal names the rule broken.
        query.plan(decl).map_err(|error| match error {
            StoreError::Invalid(why) => invalid(records::RECORD_QUERY_INVALID, why),
            other => host_error(other),
        })?;
        let view = self.standing_view(space, decl, &query.standings, query.verified_only)?;
        let mut page = stores
            .documents
            .match_records(&self.shared.instance, decl, query, None, &view, &filter)
            .map_err(|error| lane_error(&query.kind, error))?;
        if !self.sees_decider(space) {
            for result in &mut page.results {
                for hit in result.identical.iter_mut().chain(&mut result.nearest) {
                    withhold_decider(&mut hit.label);
                }
            }
        }
        Ok(page)
    }

    /// `record_put_cited` (section 4.1): `record_put` on a standing kind, replacing the
    /// record's evidence.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn svc_record_put_cited(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
        evidence: Evidence,
    ) -> Result<RecordMeta> {
        let stores = self.writing("records_write", space, None)?;
        let decl = self.lane_kind(kind)?;
        if !decl.standing {
            return Err(invalid(
                records::RECORD_KIND_NOT_STANDING,
                format!("{kind} is not a standing kind"),
            ));
        }
        self.put_declared(
            space,
            &stores,
            decl,
            id,
            body,
            envelope,
            expect,
            Some(evidence),
        )
    }

    /// `record_decide` (section 6.1): affirm a standing record's wording, or withdraw that.
    /// The checks, in order: the kind is a standing kind of this instance; the call passed the
    /// person gate; the caller is the space's person; the record is readable by the caller.
    /// Readable is all: no standing filter applies to a decision, so a call's `verified_only`
    /// and `standings` play no part here.
    pub(super) fn svc_record_decide(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        decision: Decision,
    ) -> Result<StandingLabel> {
        let stores = self.writing("records_write", space, None)?;
        // 1. A standing kind of the calling instance.
        let decl = self
            .declared_kind(kind)
            .filter(|decl| decl.standing)
            .ok_or_else(|| {
                invalid(
                    records::RECORD_KIND_NOT_STANDING,
                    format!("{kind} is not a standing kind"),
                )
            })?;
        // 2 and 3. A person decided this call, and is the space's.
        let (assurance, by) = self.person_decides(space)?;
        // 4. The record is readable by the caller, which the store checks in the transaction
        // that writes: absent and unreadable are `NotFound`, alike.
        let reader = self.filter(space)?;
        let view = self.space_view(space, STANDINGS.to_vec())?;
        let decided = stores
            .documents
            .decide_record(
                &self.shared.instance,
                decl,
                id,
                RecordDecision {
                    decision,
                    by,
                    at: self.decided_at(),
                    assurance,
                    trace_id: self.context.trace_id.clone(),
                },
                &view,
                &reader,
            )
            .map_err(|error| lane_error(kind, error))?;
        // A decision that took a revision is noted for the call, as every store write is; one
        // that wrote nothing notes nothing.
        if let Some(rev) = decided.rev {
            self.note_write(rev);
        }
        Ok(decided.label)
    }

    /// `doc_own_mark` (section 6.2): mark a document, at the content hash the person was shown,
    /// as the person's own. It needs `records_write` allowed for the space and `documents`,
    /// makes section 6.1's checks 2 and 3, and then the mark's four, in order:
    ///
    /// 1. the document is readable by the caller, else `NotFound`;
    /// 2. its content hash is `content_hash`, else `Conflict`;
    /// 3. its collection is not command-writable, as this host judged it at its start;
    /// 4. it equals its file on disk.
    ///
    /// Checks 3 and 4 are what make a person's say-so cover only a source that did not reach
    /// the host as a command's input, as far as the configuration now tells the host.
    pub(super) fn svc_doc_own_mark(
        &self,
        space: &str,
        doc: &str,
        content_hash: &ContentHash,
        speaker: Option<&str>,
    ) -> Result<Rev> {
        let stores = self.writing("records_write", space, None)?;
        self.require("documents")?;
        let (assurance, by) = self.person_decides(space)?;
        if speaker.is_some_and(|speaker| !is_speaker(speaker)) {
            return Err(ServiceError::Invalid(
                "a mark's speaker must be 1 to 128 characters without a control character"
                    .to_owned(),
            ));
        }
        let reader = self.filter(space)?;
        // 1. Readable, else not found: absent and unreadable alike.
        let document = stores
            .documents
            .get_document(doc, &reader)
            .map_err(host_error)?
            .ok_or_else(|| host_error(StoreError::NotFound))?
            .write;
        // 2. A person marks the bytes they were shown.
        if &document.content_hash != content_hash {
            return Err(ServiceError::Conflict {
                current: Some(document.content_hash.to_string()),
            });
        }
        // 3. No command writes files where it lies.
        if self
            .shared
            .workspace
            .config()
            .command_writable(space, &document.collection)
        {
            return Err(not_granted(
                records::STORE_OWN_MARK_REFUSED,
                "a document can be marked as the person's own only where no command writes files",
            ));
        }
        // 4. It is the file on disk.
        let on_disk =
            self.own_file_hash(space, &document.collection, &document.path, document.size);
        if on_disk.as_ref() != Some(content_hash) {
            return Err(not_granted(
                records::STORE_OWN_MARK_REFUSED,
                "a document can be marked as the person's own only when it equals its file on disk",
            ));
        }
        // The host held this content to its file just now, and says so: the same fact a put
        // into an own collection records.
        stores
            .documents
            .hold_document(doc, content_hash)
            .map_err(host_error)?;
        // The store makes checks 1 and 2 again in the transaction that writes the mark.
        let marked = stores
            .documents
            .mark_document_own(
                OwnMark {
                    doc: doc.to_owned(),
                    doc_hash: content_hash.clone(),
                    speaker: speaker.map(str::to_owned),
                    by,
                    at: self.decided_at(),
                    assurance,
                    trace_id: self.context.trace_id.clone(),
                },
                &reader,
            )
            .map_err(host_error)?;
        if marked.wrote {
            self.note_write(marked.rev);
        }
        Ok(marked.rev)
    }

    /// `doc_own_unmark` (section 6.2): take a mark back, under the grants and the two checks a
    /// mark needs. With no mark, or a document the caller may not read, it is `NotFound`.
    pub(super) fn svc_doc_own_unmark(&self, space: &str, doc: &str) -> Result<Rev> {
        let stores = self.writing("records_write", space, None)?;
        self.require("documents")?;
        self.person_decides(space)?;
        let reader = self.filter(space)?;
        let rev = stores
            .documents
            .unmark_document_own(
                doc,
                &self.decided_at(),
                self.context.trace_id.as_deref(),
                &reader,
            )
            .map_err(host_error)?;
        self.note_write(rev);
        Ok(rev)
    }

    /// `doc_own` (section 6.2): how a document the caller may read is the person's own now, or
    /// `None`. A plugin reads the speaker from it, so the deployer's configuration and the
    /// person's mark reach the plugin's rule through the host and not through a call's input.
    pub(super) fn svc_doc_own(&self, space: &str, doc: &str) -> Result<Option<OwnInfo>> {
        let (stores, reader) = self.reading("documents", space)?;
        let view = self.space_view(space, STANDINGS.to_vec())?;
        stores
            .documents
            .document_own(doc, &view, &reader)
            .map_err(host_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use Standing::{Affirmed, Attested, Unverified};

    #[test]
    fn a_persons_identities_are_the_configured_person_and_its_equivalent_and_no_other() {
        let config = crate::workspace::ConfigFile::parse(
            r#"
config_version = 6
default_space = "garden"
[principal.equivalents]
"human:ada" = "human:corp/ada"
"human:ada-old" = "human:corp/ada"
"agent:ada-laptop" = "human:corp/ada"
[auth]
mode = "none"
[auth.namespaces.corp]
[spaces.garden]
person = "human:ada"
"#,
        )
        .and_then(|file| file.into_config(std::path::Path::new("/w")))
        .expect("a valid configuration");
        // A space with no person has no identity: nobody decides there, and nothing counts.
        assert!(person_identities(&config, None).is_empty());
        // The configured person, and the one principal the equivalents map it to.
        assert_eq!(
            person_identities(&config, Some("human:ada")),
            ["human:ada", "human:corp/ada"]
        );
        // No other: not a principal that maps to the same target, and, for a person named by
        // the namespaced principal, none of the legacy principals that map to it. This is one
        // way and the other way from a reader's identities (`access::identities`), on purpose:
        // a legacy principal gains nothing from the namespaced one.
        assert_eq!(
            person_identities(&config, Some("human:ada-old")),
            ["human:ada-old", "human:corp/ada"]
        );
        assert_eq!(
            person_identities(&config, Some("human:corp/ada")),
            ["human:corp/ada"]
        );
        assert_eq!(
            crate::access::identities(&config, Some("human:corp/ada")),
            [
                "human:corp/ada",
                "agent:ada-laptop",
                "human:ada",
                "human:ada-old"
            ]
        );
        // A person the equivalents do not name is itself alone.
        assert_eq!(person_identities(&config, Some("human:bo")), ["human:bo"]);
    }

    #[test]
    fn a_call_narrows_what_the_space_admits_and_never_widens_it() {
        // Section 6.6. Without `verified_only`, every standing, narrowed by `standings`.
        for verified in [VerifiedAdmits::Affirmed, VerifiedAdmits::AffirmedAttested] {
            assert_eq!(
                admitted(verified, &[], false),
                [Unverified, Attested, Affirmed]
            );
            assert_eq!(admitted(verified, &[Unverified], false), [Unverified]);
            assert_eq!(
                admitted(verified, &[Affirmed, Unverified], false),
                [Unverified, Affirmed]
            );
        }
        // With it, at most what `verified_admits` names, whatever `standings` the call passes.
        assert_eq!(admitted(VerifiedAdmits::Affirmed, &[], true), [Affirmed]);
        assert_eq!(
            admitted(VerifiedAdmits::AffirmedAttested, &[], true),
            [Attested, Affirmed]
        );
        let every = [Unverified, Attested, Affirmed];
        assert_eq!(admitted(VerifiedAdmits::Affirmed, &every, true), [Affirmed]);
        assert_eq!(
            admitted(VerifiedAdmits::AffirmedAttested, &every, true),
            [Attested, Affirmed]
        );
        // Asking for a standing outside it is not an error and returns less.
        assert!(admitted(VerifiedAdmits::Affirmed, &[Unverified], true).is_empty());
        assert!(admitted(VerifiedAdmits::Affirmed, &[Attested, Unverified], true).is_empty());
        assert_eq!(
            admitted(
                VerifiedAdmits::AffirmedAttested,
                &[Attested, Unverified],
                true
            ),
            [Attested]
        );
        for verified in [VerifiedAdmits::Affirmed, VerifiedAdmits::AffirmedAttested] {
            for standings in [&[][..], &[Unverified][..], &every[..]] {
                assert!(
                    !admitted(verified, standings, true).contains(&Unverified),
                    "verified content only never holds an unverified record"
                );
            }
        }
    }
}
