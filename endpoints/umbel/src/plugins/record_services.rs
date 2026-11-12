//! The record lane's services (records host specification, sections 4.2, 7, 11.2 and 13; D159,
//! D163, D164, D169): writing a record of a kind the instance's manifest declares, and reading
//! and finding such records. Each read is filtered by the caller's reader filter; a write is
//! given the access set the host owns and its text is scanned, flagged and never blocked.
//!
//! No message here holds a record's text or a key's value.
//!
//! **Seams.** This is that specification's step B2. Evidence and `record_put_cited`, the person's
//! decision, the marks and what a call admits (`verified_only`, `standings`) are step B3's, and
//! the vector after a put's write is step B5's: [`CallServices::standing_view`] and
//! [`CallServices::put_declared`] say where each joins.

use std::sync::Arc;

use serde_json::Value;
use umbel_sdk::HostError as ServiceError;
use umbel_store::lane::{
    FindPage, LaneRecord, LaneWrite, RecordDecl, RecordFind, Standing, StandingView, extract,
};
use umbel_store::{Envelope, Expect, MemoryFlag, RecordMeta, StoreError};

use super::grants::CallServices;
use crate::access::effective_principal_of;
use crate::store::{SpaceStores, host_error, records};
use crate::workspace::DefaultAccess;

type Result<T> = std::result::Result<T, ServiceError>;

fn invalid(code: &str, message: impl std::fmt::Display) -> ServiceError {
    ServiceError::Invalid(format!("{code}: {message}"))
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

    /// What the host derives for one read (section 11.2): the space's own collections, its
    /// command-writable ones, and the standings the call admits (section 6.6).
    ///
    /// Step B3's seam. Until it lands the store holds no standing fact, a space's `person` and
    /// `verified_admits` are not acted on, and a call cannot ask for a standing: the view admits
    /// everything, and a call that asks is refused, never answered as if it had not asked. On a
    /// kind without standing that refusal is section 7's own rule.
    fn standing_view(
        &self,
        decl: &RecordDecl,
        standings: &[Standing],
        verified_only: bool,
    ) -> Result<StandingView> {
        if !standings.is_empty() || verified_only {
            return Err(invalid(
                records::RECORD_QUERY_INVALID,
                if decl.standing {
                    "standings and verified_only are not served yet for a standing kind"
                } else {
                    "standings must be empty and verified_only false for a kind without standing"
                },
            ));
        }
        Ok(StandingView {
            own: Vec::new(),
            command_writable: Vec::new(),
            admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
        })
    }

    /// `record_put` on a declared kind (section 4.2), after step 1, the grant and the space,
    /// which the caller made. Step 6, the evidence, is step B3's, and step 8, the vector after
    /// the write, is step B5's.
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
            // plugin sent (D71). The person gate's proof, the table's first row, is step B3's.
            envelope.version = umbel_store::MEMORY_ENVELOPE_VERSION;
            envelope.authority = Some(
                crate::authority::record_authority(&self.context)
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
        // 7. One transaction, as the writer: an existing record it may not read is taken.
        let writer = self.filter(space)?;
        let lane = LaneWrite {
            evidence: None,
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
        let view = self.standing_view(decl, standings, verified_only)?;
        stores
            .documents
            .read_record(&self.shared.instance, decl, id, &view, &filter)
            .map_err(|error| lane_error(kind, error))
    }

    pub(super) fn svc_record_find(&self, space: &str, query: &RecordFind) -> Result<FindPage> {
        let (stores, filter) = self.reading("records", space)?;
        let decl = self.lane_kind(&query.kind)?;
        // Section 7's rules, before anything is read: the refusal names the rule broken.
        query.plan(decl).map_err(|error| match error {
            StoreError::Invalid(why) => invalid(records::RECORD_QUERY_INVALID, why),
            other => host_error(other),
        })?;
        let view = self.standing_view(decl, &query.standings, query.verified_only)?;
        stores
            .documents
            .find_records(&self.shared.instance, decl, query, &view, &filter)
            .map_err(|error| lane_error(&query.kind, error))
    }
}
