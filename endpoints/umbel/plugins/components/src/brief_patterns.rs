//! Pattern binding traversal, component link rewriting, and explicit `patterns[]` resolution
//! for `components-brief` (Patterns spec §8).

use std::collections::{BTreeMap, HashSet};

use serde_json::{Value, json};
use umbel_sdk::Outcome;

use crate::entry::{Entry, Section};
use crate::pack::Library;
use crate::pack::schema_pattern::{ComponentPattern, PatternRecord, is_visible_approval};
use crate::{fail, select};

/// Maximum binding traversal hops before refusing as depth-exceeded.
const MAX_BINDING_HOPS: usize = 8;

/// Failure while walking active `patternBindings`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BindingError {
    Cycle,
    DepthExceeded,
}

impl BindingError {
    pub(crate) fn reason(self) -> &'static str {
        match self {
            Self::Cycle => "cycle",
            Self::DepthExceeded => "depth-exceeded",
        }
    }
}

/// Result of resolving `(library, pattern)` through active `patternBindings` and `approvalStatus`.
pub(crate) enum PatternResolve<'a> {
    Visible {
        library: usize,
        record: &'a PatternRecord,
        rebound: bool,
    },
    Hidden,
    NotFound,
}

pub(crate) fn find_pattern<'a>(
    libraries: &'a [Library],
    library: &str,
    pattern: &str,
) -> Option<(usize, &'a PatternRecord)> {
    let index = libraries.iter().position(|lib| lib.id == library)?;
    let record = libraries[index]
        .patterns
        .iter()
        .find(|p| p.pattern == pattern)?;
    Some((index, record))
}

/// Resolves `(library, pattern)` through active `patternBindings` while enforcing `approvalStatus`
/// visibility, cycle detection, and the 8-hop traversal limit. When a bound local copy is still
/// `proposed` (and `include_proposed` is false), falls back to the last visible target or the
/// approved upstream pattern (Patterns spec §8).
pub(crate) fn resolve_pattern<'a>(
    libraries: &'a [Library],
    pattern_bindings: &BTreeMap<String, String>,
    library: &str,
    pattern: &str,
    include_proposed: bool,
) -> Result<PatternResolve<'a>, BindingError> {
    let mut current_lib = library.to_owned();
    let mut current_pat = pattern.to_owned();
    let mut visited: HashSet<(String, String)> = HashSet::new();
    visited.insert((current_lib.clone(), current_pat.clone()));

    let mut bound_target: Option<(usize, &'a PatternRecord)> = None;
    let mut hops = 0usize;
    loop {
        let key = format!("{current_lib}/{current_pat}");
        let Some(next) = pattern_bindings.get(&key) else {
            break;
        };
        let Some((next_lib, next_pat)) = next.split_once('/') else {
            break;
        };
        if !visited.insert((next_lib.to_owned(), next_pat.to_owned())) {
            return Err(BindingError::Cycle);
        }
        hops += 1;
        if hops > MAX_BINDING_HOPS {
            return Err(BindingError::DepthExceeded);
        }
        if let Some((idx, rec)) = find_pattern(libraries, next_lib, next_pat)
            && is_visible_approval(rec.approval_status.as_deref(), include_proposed)
        {
            bound_target = Some((idx, rec));
            current_lib = next_lib.to_owned();
            current_pat = next_pat.to_owned();
        } else {
            // Bound target is missing or not yet approved: fall back to last visible target
            // or the original upstream pattern.
            break;
        }
    }
    if let Some((idx, rec)) = bound_target {
        return Ok(PatternResolve::Visible {
            library: idx,
            record: rec,
            rebound: true,
        });
    }
    match find_pattern(libraries, library, pattern) {
        Some((idx, rec))
            if is_visible_approval(rec.approval_status.as_deref(), include_proposed) =>
        {
            Ok(PatternResolve::Visible {
                library: idx,
                record: rec,
                rebound: false,
            })
        }
        Some(_) => Ok(PatternResolve::Hidden),
        None => Ok(PatternResolve::NotFound),
    }
}

/// Nearest visible pattern names (never leaking hidden `proposed` or `deprecated` pattern ids).
fn nearest_visible_patterns(
    query: &str,
    libraries: &[Library],
    include_proposed: bool,
) -> Vec<String> {
    if query.contains('/') {
        let candidates: Vec<String> = libraries
            .iter()
            .flat_map(|lib| {
                lib.patterns
                    .iter()
                    .filter(|p| is_visible_approval(p.approval_status.as_deref(), include_proposed))
                    .map(|p| format!("{}/{}", lib.id, p.pattern))
            })
            .collect();
        select::nearest(query, candidates.iter().map(String::as_str))
    } else {
        let mut seen = HashSet::new();
        let candidates: Vec<&str> = libraries
            .iter()
            .flat_map(|lib| {
                lib.patterns
                    .iter()
                    .filter(|p| is_visible_approval(p.approval_status.as_deref(), include_proposed))
                    .map(|p| p.pattern.as_str())
            })
            .filter(|name| seen.insert(*name))
            .collect();
        select::nearest(query, candidates)
    }
}

/// Rewrites component `Section::Patterns` links to match resolved `patternBindings` and drops
/// links to loaded patterns hidden by `approvalStatus`, preserving verification provenance.
pub(crate) fn resolve_entry_patterns(
    entry: &mut Entry,
    libraries: &[Library],
    pattern_bindings: &BTreeMap<String, String>,
    include_proposed: bool,
) -> Result<(), BindingError> {
    for (name, section) in &mut entry.sections {
        if *name != "patterns" {
            continue;
        }
        let Section::Patterns(links) = section else {
            continue;
        };
        let mut resolved: Vec<ComponentPattern> = Vec::with_capacity(links.len());
        let mut seen: HashSet<(String, String)> = HashSet::new();
        for cp in links.drain(..) {
            match resolve_pattern(
                libraries,
                pattern_bindings,
                &cp.library,
                &cp.pattern,
                include_proposed,
            )? {
                PatternResolve::Visible {
                    library: target_idx,
                    record: target_rec,
                    rebound,
                } => {
                    let mut updated = cp;
                    if rebound {
                        updated.library = libraries[target_idx].id.clone();
                        updated.pattern = target_rec.pattern.clone();
                    }
                    let hidden_keep_ids: HashSet<&str> = target_rec
                        .keep
                        .iter()
                        .filter(|st| {
                            !is_visible_approval(st.approval_status.as_deref(), include_proposed)
                        })
                        .map(|st| st.id.as_str())
                        .collect();
                    if !hidden_keep_ids.is_empty() {
                        updated
                            .keep
                            .retain(|k| !hidden_keep_ids.contains(k.id.as_str()));
                    }
                    if seen.insert((updated.library.clone(), updated.pattern.clone())) {
                        resolved.push(updated);
                    }
                }
                PatternResolve::Hidden => {
                    // Hidden by `approvalStatus`: omit link from component entry too.
                }
                PatternResolve::NotFound => {
                    // Preserve cross-library link when its owning library was not loaded.
                    if !libraries.iter().any(|l| l.id == cp.library)
                        && seen.insert((cp.library.clone(), cp.pattern.clone()))
                    {
                        resolved.push(cp);
                    }
                }
            }
        }
        *links = resolved;
    }
    entry
        .sections
        .retain(|(_, section)| section.list_len() != Some(0));
    Ok(())
}

/// Pre-resolved explicit `input.patterns[]` items and any unresolved/ambiguous entries.
pub(crate) struct ResolvedExplicit {
    pub(crate) resolved: Vec<(usize, String)>,
    pub(crate) unknown: Vec<Value>,
}

/// Resolves explicit `input.patterns[]` up front, reporting unknown, hidden, and ambiguous
/// requests in `unknown[]` and checking `default_library` consistently with `tags`.
pub(crate) fn resolve_explicit_patterns(
    input: &Value,
    libraries: &[Library],
    library_names: &[String],
    pattern_bindings: &BTreeMap<String, String>,
    default_library: Option<&str>,
    include_proposed: bool,
) -> Result<ResolvedExplicit, Outcome> {
    let mut seen_raw: HashSet<String> = HashSet::new();
    let mut resolved: Vec<(usize, String)> = Vec::new();
    let mut seen_resolved: HashSet<(usize, String)> = HashSet::new();
    let mut unknown: Vec<Value> = Vec::new();

    for raw in input
        .get("patterns")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if !seen_raw.insert(raw.to_owned()) {
            continue;
        }
        if let Some((lib, pat)) = raw.split_once('/') {
            match resolve_pattern(libraries, pattern_bindings, lib, pat, include_proposed) {
                Ok(PatternResolve::Visible {
                    library: idx,
                    record: rec,
                    ..
                }) => {
                    if seen_resolved.insert((idx, rec.pattern.clone())) {
                        resolved.push((idx, rec.pattern.clone()));
                    }
                }
                Ok(PatternResolve::Hidden | PatternResolve::NotFound) => {
                    let nearest = nearest_visible_patterns(raw, libraries, include_proposed);
                    unknown.push(json!({
                        "pattern": raw,
                        "reason": "not-found",
                        "nearest": nearest,
                    }));
                }
                Err(err) => return Err(fail::pattern_binding_invalid(err.reason())),
            }
            continue;
        }

        // Bare pattern id: find every library that owns or rebinds `raw` to a visible pattern.
        let mut candidates: Vec<(&str, usize, &str)> = Vec::new();
        for lib in libraries {
            let owns_or_binds = lib.patterns.iter().any(|p| p.pattern == raw)
                || pattern_bindings.contains_key(&format!("{}/{raw}", lib.id));
            if !owns_or_binds {
                continue;
            }
            match resolve_pattern(libraries, pattern_bindings, &lib.id, raw, include_proposed) {
                Ok(PatternResolve::Visible {
                    library: target_idx,
                    record: target_rec,
                    ..
                }) => candidates.push((lib.id.as_str(), target_idx, target_rec.pattern.as_str())),
                Ok(PatternResolve::Hidden | PatternResolve::NotFound) => {}
                Err(err) => return Err(fail::pattern_binding_invalid(err.reason())),
            }
        }
        let mut unique_targets: Vec<(usize, &str)> = Vec::new();
        for &(_, target_idx, target_pat) in &candidates {
            if !unique_targets.contains(&(target_idx, target_pat)) {
                unique_targets.push((target_idx, target_pat));
            }
        }
        match unique_targets.as_slice() {
            [] => {
                let nearest = nearest_visible_patterns(raw, libraries, include_proposed);
                unknown.push(json!({
                    "pattern": raw,
                    "reason": "not-found",
                    "nearest": nearest,
                }));
            }
            [(idx, pat)] => {
                if seen_resolved.insert((*idx, (*pat).to_owned())) {
                    resolved.push((*idx, (*pat).to_owned()));
                }
            }
            _ => {
                let chosen = match default_library {
                    Some(default) if !library_names.iter().any(|name| name == default) => {
                        return Err(fail::library_not_found(default, library_names));
                    }
                    Some(default) => candidates
                        .iter()
                        .find(|(source_lib, target_idx, _)| {
                            *source_lib == default || libraries[*target_idx].id == default
                        })
                        .map(|&(_, idx, pat)| (idx, pat)),
                    None => None,
                };
                if let Some((idx, pat)) = chosen {
                    if seen_resolved.insert((idx, pat.to_owned())) {
                        resolved.push((idx, pat.to_owned()));
                    }
                } else {
                    let mut holder_libs: Vec<&str> = candidates
                        .iter()
                        .map(|&(_, target_idx, _)| libraries[target_idx].id.as_str())
                        .collect();
                    holder_libs.sort_unstable();
                    holder_libs.dedup();
                    unknown.push(json!({
                        "pattern": raw,
                        "reason": "ambiguous",
                        "libraries": holder_libs,
                    }));
                }
            }
        }
    }

    Ok(ResolvedExplicit { resolved, unknown })
}
