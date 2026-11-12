//! Standing as a lane read sees it (records host specification, section 6): the label a record
//! carries and the clause that admits it.
//!
//! **This is the seam for that specification's step B3.** Until then the store writes no
//! decision and no evidence, so no standing fact exists: every record of a standing kind is
//! `unverified`, with no affirmation and no source, and a view admits it exactly when it admits
//! `unverified`. Step B3 replaces both functions with section 6.3's clause and section 6.5's
//! label, read from `record_lane.affirmed_seq`, `record_evidence`, `documents` and `doc_own`.

use umbel_store::lane::{RecordDecl, Standing, StandingLabel, StandingView};

use crate::sql::Sql;

/// The label of a record of `decl`'s kind: `None` for a kind without standing.
pub(super) fn label(decl: &RecordDecl) -> Option<StandingLabel> {
    decl.standing.then_some(StandingLabel {
        standing: Standing::Unverified,
        affirmed: None,
        source: None,
    })
}

/// ` AND <the view admits the record's standing>` over `record_lane l` (section 6.6): a clause
/// of the statement, so a total and a candidate count only admitted records. A kind without
/// standing has no standing to filter on.
pub(super) fn and_admitted(sql: &mut Sql, decl: &RecordDecl, view: &StandingView) {
    if decl.standing && !view.admits(Standing::Unverified) {
        sql.push(" AND 0");
    }
}
