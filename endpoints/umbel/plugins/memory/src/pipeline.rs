//! The write pipeline (section 8.2), the same for remember, capture and import, in this order:
//! shape, mask secrets, scan, hash, expiry; the write itself is the caller's, one batch.
//!
//! The host fills identity, authority and access, scans again and caps the quota (section 6.2),
//! so what this module puts in those fields is a placeholder the host overwrites.

use serde_json::{Value, json};
use umbel_sdk::{CallContext, Cx, Outcome};
use umbel_store::memory::{
    DAY_MS, MAX_MEMORY_SUBJECT_CHARS, MAX_MEMORY_TAG_CHARS, MAX_MEMORY_TAGS, MAX_SUPERSEDES,
    MemoryScope, Millis, Renew, check_memory_id, derive_memory_id, format_instant,
    memory_content_hash,
};
use umbel_store::{
    AccessSet, DerivedFrom, Envelope, MAX_CONSTRAINT_CHARS, MAX_CONSTRAINTS, MemoryClass,
    MemoryFlag, MemoryWrite, Origin, Sensitivity, Source,
};

use crate::fail;
use crate::hygiene::{Counts, Hygiene};
use crate::policy::Policy;

/// What every entry of one call shares: the space, the clock, the trace and the packs.
pub(crate) struct Call {
    pub(crate) space: String,
    pub(crate) now: Millis,
    pub(crate) trace: String,
    pub(crate) principal: String,
    pub(crate) policy: Policy,
    pub(crate) hygiene: Hygiene,
}

impl Call {
    /// The call's space, clock and packs; a failure when a grant or pack refuses.
    pub(crate) fn open(cx: &Cx) -> Result<Self, Outcome> {
        let call = cx.call();
        let space = call.space.clone().ok_or_else(fail::no_space)?;
        let now = cx.now_ms().map_err(|error| fail::host(&error))?;
        let policy = Policy::load(cx)?;
        let hygiene = Hygiene::load(cx)?;
        Ok(Self {
            space,
            now,
            trace: call.trace_id.clone(),
            principal: effective_principal(call).unwrap_or_else(|| "human:unknown".to_owned()),
            policy,
            hygiene,
        })
    }

    /// Check a `project` or `session` label: the pattern of section 3.1, and nothing the secrets
    /// pack would mask, so a token cannot enter the journal as a label. The message never holds
    /// the value.
    pub(crate) fn check_label(&self, what: &str, label: &str) -> Result<(), Outcome> {
        if umbel_store::memory::check_label(what, label).is_err() {
            return Err(fail::invalid(&format!(
                "{what} must match ^[A-Za-z0-9][A-Za-z0-9._-]{{0,127}}$"
            )));
        }
        if self.hygiene.would_mask(label) {
            return Err(fail::invalid(&format!(
                "{what} looks like a secret; labels are journaled and kept in clear"
            )));
        }
        Ok(())
    }
}

/// The caller's effective principal, as the host derives it: the person acted for, else the
/// actor's own `<kind>:<id>`. `None` for a test actor or an actor with no id.
pub(crate) fn effective_principal(call: &CallContext) -> Option<String> {
    if let Some(person) = call.on_behalf_of.as_deref().filter(|p| !p.is_empty()) {
        return Some(format!("human:{person}"));
    }
    let id = call.actor_id.as_deref().filter(|id| !id.is_empty())?;
    matches!(
        call.actor_kind.as_str(),
        "human" | "agent" | "service" | "script"
    )
    .then(|| format!("{}:{id}", call.actor_kind))
}

/// One record before the pipeline.
#[derive(Debug, Clone)]
pub(crate) struct Draft {
    pub(crate) class: MemoryClass,
    pub(crate) subject: String,
    pub(crate) text: String,
    pub(crate) tags: Vec<String>,
    pub(crate) project: Option<String>,
    pub(crate) session: Option<String>,
    pub(crate) sensitivity: Sensitivity,
    pub(crate) valid_from: Option<Millis>,
    pub(crate) valid_until: Option<Millis>,
    pub(crate) ttl_days: Option<u32>,
    pub(crate) confidence: Option<f64>,
    /// `Unspecified` lets the host default it by the authority it assigns (step 5, amendment 1).
    pub(crate) origin: Origin,
    pub(crate) sources: Option<Vec<Source>>,
    pub(crate) derived_from: Option<Vec<DerivedFrom>>,
    pub(crate) constraints: Option<Vec<String>>,
    pub(crate) supersedes: Vec<String>,
}

impl Draft {
    /// A draft with nothing but the body, internal and of no project.
    pub(crate) fn new(class: MemoryClass, subject: String, text: String) -> Self {
        Self {
            class,
            subject,
            text,
            tags: Vec::new(),
            project: None,
            session: None,
            sensitivity: Sensitivity::Internal,
            valid_from: None,
            valid_until: None,
            ttl_days: None,
            confidence: None,
            origin: Origin::Unspecified,
            sources: None,
            derived_from: None,
            constraints: None,
            supersedes: Vec::new(),
        }
    }
}

/// One record after the pipeline: the store's entry, the scan's flags and what was masked.
#[derive(Debug, Clone)]
pub(crate) struct Prepared {
    pub(crate) write: MemoryWrite,
    pub(crate) flags: Vec<MemoryFlag>,
    pub(crate) masked: Counts,
}

/// Step 1, shape: the field caps of section 4 and the characters a one-line field refuses.
fn shape(draft: &Draft, max_text_bytes: usize) -> Result<(), String> {
    let one_line = |text: &str| !text.chars().any(|c| c.is_control() && c != '\t');
    let subject_chars = draft.subject.chars().count();
    if subject_chars == 0 || subject_chars > MAX_MEMORY_SUBJECT_CHARS {
        return Err("subject is 1 to 256 characters".into());
    }
    if !one_line(&draft.subject) {
        return Err("subject is one line with no control character".into());
    }
    if draft.text.len() > max_text_bytes {
        return Err(format!("text holds at most {max_text_bytes} bytes"));
    }
    if draft.text.contains('\0') {
        return Err("text holds no NUL character".into());
    }
    if draft.tags.len() > MAX_MEMORY_TAGS {
        return Err("at most 32 tags".into());
    }
    for tag in &draft.tags {
        let n = tag.chars().count();
        if n == 0 || n > MAX_MEMORY_TAG_CHARS || !one_line(tag) {
            return Err("a tag is 1 to 64 characters on one line".into());
        }
    }
    if let Some(constraints) = &draft.constraints {
        if constraints.len() > MAX_CONSTRAINTS {
            return Err("at most 16 constraints".into());
        }
        if constraints.iter().any(|c| {
            let n = c.chars().count();
            n == 0 || n > MAX_CONSTRAINT_CHARS || c.contains('\0')
        }) {
            return Err("a constraint is 1 to 200 characters".into());
        }
    }
    if draft.supersedes.len() > MAX_SUPERSEDES {
        return Err("supersedes names at most 16 records".into());
    }
    if draft
        .supersedes
        .iter()
        .any(|id| check_memory_id(id).is_err())
    {
        return Err("supersedes holds memory ids: mem- and 24 lowercase hex digits".into());
    }
    if let (Some(from), Some(until)) = (draft.valid_from, draft.valid_until)
        && until <= from
    {
        return Err("validUntil must follow validFrom".into());
    }
    if draft
        .confidence
        .is_some_and(|c| !c.is_finite() || !(0.0..=1.0).contains(&c))
    {
        return Err("confidence is from 0 to 1".into());
    }
    Ok(())
}

impl Call {
    /// Run the pipeline over one draft, the `ordinal`-th entry of the call, with one `draw` from
    /// the random grant for its id.
    pub(crate) fn prepare(
        &self,
        mut draft: Draft,
        ordinal: u32,
        draw: u64,
        max_text_bytes: usize,
    ) -> Result<Prepared, Outcome> {
        // 1. Shape.
        shape(&draft, max_text_bytes).map_err(|what| fail::invalid(&what))?;
        for (what, label) in [("project", &draft.project), ("session", &draft.session)] {
            if let Some(label) = label {
                self.check_label(what, label)?;
            }
        }
        // 2. Mask secrets, before anything is stored or hashed.
        let mut masked = Counts::default();
        let mut mask = |text: &mut String| {
            let (clean, counts) = self.hygiene.mask(text);
            masked.add(&counts);
            *text = clean;
        };
        mask(&mut draft.subject);
        mask(&mut draft.text);
        draft.tags.iter_mut().for_each(&mut mask);
        if let Some(constraints) = draft.constraints.as_mut() {
            constraints.iter_mut().for_each(&mut mask);
        }
        for source in draft.sources.iter_mut().flatten() {
            mask(&mut source.resource);
            for field in [&mut source.id, &mut source.title, &mut source.author] {
                if let Some(text) = field.as_mut() {
                    mask(text);
                }
            }
        }
        if draft.subject.chars().count() > MAX_MEMORY_SUBJECT_CHARS
            || draft
                .tags
                .iter()
                .any(|t| t.chars().count() > MAX_MEMORY_TAG_CHARS)
        {
            return Err(fail::invalid(
                "a subject or tag is too long once its secrets are masked",
            ));
        }
        // 3. Scan: a finding sets `flags`.
        let flags = scan(&draft);
        // 4. Hash.
        let hash = memory_content_hash(&draft.subject, &draft.text);
        // 5. Expiry: the input's TTL or the class's default, never past the class's maximum.
        let class = self.policy.class(draft.class);
        let ttl_days = draft.ttl_days.unwrap_or(class.default_ttl_days);
        if ttl_days == 0 {
            return Err(fail::invalid("ttlDays is at least 1"));
        }
        if ttl_days > class.max_ttl_days {
            return Err(fail::ttl_too_long(draft.class.as_str(), class.max_ttl_days));
        }
        let ttl_ms = Millis::from(ttl_days) * DAY_MS;
        let valid_from = draft.valid_from.unwrap_or(self.now);
        if draft.valid_until.is_some_and(|until| until <= valid_from) {
            return Err(fail::invalid("validUntil must follow validFrom"));
        }
        let access = AccessSet::new([format!("principal:{}", self.principal)])
            .map_err(|_| fail::invalid("the caller has no principal"))?;
        let envelope = Envelope {
            version: 2,
            origin: draft.origin,
            space: self.space.clone(),
            plugin: None,
            agent: None,
            principal: None,
            session: draft.session.clone(),
            trace_id: None,
            observed_at: format_instant(self.now),
            valid_from: Some(format_instant(valid_from)),
            valid_until: draft.valid_until.map(format_instant),
            confidence: draft.confidence,
            authority: None,
            sources: draft.sources,
            generated: None,
            content_hash: Some(hash.to_string()),
            derived_from: draft.derived_from,
            access: access.tokens().to_vec(),
            sensitivity: Some(draft.sensitivity),
            redactions: masked.redactions(),
            constraints: draft.constraints,
            confirmation: None,
        };
        let write = MemoryWrite {
            id: derive_memory_id(&self.space, &self.trace, ordinal, self.now, draw),
            class: draft.class,
            scope: MemoryScope {
                space: self.space.clone(),
                project: draft.project,
                principal: self.principal.clone(),
                agent: None,
                session: draft.session,
            },
            subject: draft.subject,
            text: draft.text,
            tags: draft.tags,
            access,
            sensitivity: draft.sensitivity,
            flags: flags.clone(),
            valid_from,
            valid_until: draft.valid_until,
            expires_at: self.now.saturating_add(ttl_ms),
            supersedes: draft.supersedes,
            // The host keeps this only for a `person` write (step 5, amendment 1).
            renew: Some(Renew {
                ttl_ms,
                max_ttl_ms: Millis::from(class.max_ttl_days) * DAY_MS,
            }),
            envelope,
        };
        Ok(Prepared {
            write,
            flags,
            masked,
        })
    }
}

/// Step 3: `umbel-scan` over `subject`, `text`, `tags` and `constraints`, as the host does.
fn scan(draft: &Draft) -> Vec<MemoryFlag> {
    let mut flags = Vec::new();
    let texts = [draft.subject.as_str(), draft.text.as_str()]
        .into_iter()
        .chain(draft.tags.iter().map(String::as_str))
        .chain(draft.constraints.iter().flatten().map(String::as_str));
    for text in texts {
        let found = umbel_scan::scan_content(text);
        if found.is_instruction_like() {
            flags.push(MemoryFlag::InstructionLike);
        }
        if found.has_hidden_text() {
            flags.push(MemoryFlag::HiddenText);
        }
    }
    flags.sort();
    flags.dedup();
    flags
}

/// One draw from the random grant, as a 53-bit integer, for a record id.
pub(crate) fn draw(cx: &Cx) -> Result<u64, Outcome> {
    let value = cx.random().map_err(|error| fail::host(&error))?;
    Ok((value * 9_007_199_254_740_992.0) as u64)
}

/// An RFC 3339 instant, with `Z` or an offset, in epoch milliseconds.
pub(crate) fn parse_time(what: &str, text: &str) -> Result<Millis, Outcome> {
    chrono::DateTime::parse_from_rfc3339(text)
        .map(|at| at.timestamp_millis())
        .map_err(|_| fail::invalid(&format!("{what} is an RFC 3339 instant")))
}

/// The flags as their wire spellings.
pub(crate) fn flag_names(flags: &[MemoryFlag]) -> Value {
    json!(flags.iter().map(|f| f.as_str()).collect::<Vec<_>>())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn the_effective_principal_is_the_hosts() {
        let mut call = CallContext {
            actor_kind: "agent".into(),
            actor_id: Some("bot".into()),
            ..CallContext::default()
        };
        assert_eq!(effective_principal(&call).as_deref(), Some("agent:bot"));
        call.on_behalf_of = Some("ada".into());
        assert_eq!(effective_principal(&call).as_deref(), Some("human:ada"));
        let test = CallContext {
            actor_kind: "test".into(),
            actor_id: Some("t".into()),
            ..CallContext::default()
        };
        assert_eq!(effective_principal(&test), None);
    }

    #[test]
    fn shape_refuses_control_characters_and_caps() {
        let mut draft = Draft::new(MemoryClass::Semantic, "A\nB".into(), "text".into());
        assert!(shape(&draft, 16).is_err());
        draft.subject = "ok".into();
        draft.text = "x".repeat(17);
        assert!(shape(&draft, 16).is_err());
        draft.text = "a\0b".into();
        assert!(shape(&draft, 16).is_err());
        draft.text = "fine".into();
        draft.tags = vec!["a\u{7}".into()];
        assert!(shape(&draft, 16).is_err());
        draft.tags = vec!["fine".into()];
        assert!(shape(&draft, 16).is_ok());
    }
}
