//! The clauses every memory read adds to its own statement (phase 3 section 5.3): the reader
//! filter, the intervals of 4.1, expiry and flags, scope, class, tag and authority filters, and
//! section 9.3's push rule. Records are aliased `r`, versions `v`.

use umbel_store::memory::{AsOf, ProjectMatch, PushFilter, ReadFlags, ScopeQuery};
use umbel_store::{Authority, MemoryClass, ReaderFilter};

use crate::sql::Sql;

impl Sql {
    /// The record is readable by `reader`.
    pub(crate) fn and_memory_readable(&mut self, reader: &ReaderFilter) -> &mut Self {
        self.and_readable("record_access", &[("id", "r.id")], reader)
    }

    /// The version matches both instants: `recordedAt ≤ R < recordedUntil` and
    /// `validFrom ≤ V < validUntil`, an absent end being open.
    pub(crate) fn and_as_of(&mut self, as_of: AsOf) -> &mut Self {
        self.push(" AND v.recorded_at <= ")
            .bind(as_of.recorded)
            .push(" AND (v.recorded_until IS NULL OR v.recorded_until > ")
            .bind(as_of.recorded)
            .push(") AND v.valid_from <= ")
            .bind(as_of.valid)
            .push(" AND (v.valid_until IS NULL OR v.valid_until > ")
            .bind(as_of.valid)
            .push(")")
    }

    /// Expiry measured at `flags.now`, and flagged records, unless the flags let them through.
    pub(crate) fn and_flags(&mut self, flags: ReadFlags) -> &mut Self {
        if !flags.include_expired {
            self.push(" AND r.expires > ").bind(flags.now);
        }
        if !flags.include_flagged {
            self.push(" AND r.flagged = 0");
        }
        self
    }

    /// The scope labels.
    pub(crate) fn and_scope(&mut self, scope: &ScopeQuery) -> &mut Self {
        match &scope.project {
            ProjectMatch::Any => {}
            ProjectMatch::Exact(p) => {
                self.push(" AND r.project = ").bind(p);
            }
            ProjectMatch::ExactOrUnset(p) => {
                self.push(" AND (r.project IS NULL OR r.project = ")
                    .bind(p)
                    .push(")");
            }
        }
        if let Some(principal) = &scope.principal {
            if scope.equivalents.is_empty() {
                self.push(" AND r.owner = ").bind(principal);
            } else {
                // The principal and the legacy principals it stands for (phase 5 section 4.6).
                self.push(" AND r.owner IN ").bind_list(
                    std::iter::once(principal.as_str())
                        .chain(scope.equivalents.iter().map(String::as_str)),
                );
            }
        }
        if let Some(agent) = &scope.agent {
            self.push(" AND r.agent_id = ").bind(agent);
        }
        if let Some(session) = &scope.session {
            self.push(" AND r.session = ").bind(session);
        }
        self
    }

    /// Only these classes; empty is every class.
    pub(crate) fn and_classes(&mut self, classes: &[MemoryClass]) -> &mut Self {
        if !classes.is_empty() {
            self.push(" AND r.class IN ")
                .bind_list(classes.iter().map(|c| c.as_str()));
        }
        self
    }

    /// Records holding every one of these tags.
    pub(crate) fn and_tags(&mut self, tags: &[String]) -> &mut Self {
        for tag in tags {
            self.push(
                " AND EXISTS (SELECT 1 FROM record_derived d, json_each(d.tags) j \
                 WHERE d.id = r.id AND j.value = ",
            )
            .bind(tag)
            .push(")");
        }
        self
    }

    /// Only these authorities of the matching version; empty is every authority.
    pub(crate) fn and_authorities(&mut self, authorities: &[Authority]) -> &mut Self {
        if !authorities.is_empty() {
            self.push(" AND v.authority IN ")
                .bind_list(authorities.iter().map(|a| a.as_str()));
        }
        self
    }

    /// Section 9.3's rule as one condition: never flagged; the version's authority listed in
    /// `own` or `foreign` by whose the record is; and a record with no project, when `project`
    /// names one, also listed in `unset_project`.
    pub(crate) fn and_push(&mut self, push: &PushFilter, project: &ProjectMatch) -> &mut Self {
        self.push(" AND r.flagged = 0 AND (CASE WHEN r.owner = ")
            .bind(&push.caller)
            .push(" THEN v.authority IN ")
            .bind_list(push.own.iter().map(|a| a.as_str()))
            .push(" ELSE v.authority IN ")
            .bind_list(push.foreign.iter().map(|a| a.as_str()))
            .push(" END)");
        if !matches!(project, ProjectMatch::Any) {
            self.push(" AND (r.project IS NOT NULL OR v.authority IN ")
                .bind_list(push.unset_project.iter().map(|a| a.as_str()))
                .push(")");
        }
        self
    }
}
