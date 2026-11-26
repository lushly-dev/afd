//! Failures and warnings (specification, section 9). `details` hold identifiers, codes and counts
//! only: no message, suggestion or detail ever holds pack text (D153).

use serde_json::{Value, json};
use umbel_sdk::{Outcome, failure};

use crate::pack::problem::{self, CATALOG_MISMATCH, DIGEST_MISMATCH, Problem};

const REEXPORT: &str = "Re-export the library with `specimen pack-export`; a pack written by hand can be checked with Specimen's `checkPack`.";
const RETRY_NOTE: &str = "Retry: an export may be replacing the pack. If it persists, re-export it; a hand edit or a partial copy leaves it like this.";
const SERVABLE_NOTE: &str =
    " When `details.servable` is present, pass one of those as `library` to keep working.";

/// `PACK_EMPTY`.
pub(crate) fn pack_empty() -> Outcome {
    failure(
        "PACK_EMPTY",
        "the space's component pack holds no library",
        "Export a library into the space's pack with `specimen pack-export`, or list what the pack holds with `umbel plugin show plugin=components`.",
    )
}

/// `PACK_INVALID` for a problem of the pack itself, which refuses every call.
pub(crate) fn pack_refused(problems: &[Problem]) -> Outcome {
    failure(
        "PACK_INVALID",
        &format!(
            "the component pack itself has {} problem(s), so no library in it can be served",
            problems.len()
        ),
        REEXPORT,
    )
    .with_error_details(json!({
        "problems": problem::shown(problems),
        "count": problems.len(),
    }))
}

fn inconsistent(refused: &[(String, Vec<Problem>)]) -> bool {
    refused.iter().all(|(_, problems)| {
        problems
            .iter()
            .all(|p| p.code == DIGEST_MISMATCH || p.code == CATALOG_MISMATCH)
    })
}

/// `PACK_INVALID` or `PACK_INCONSISTENT`, with what can still be served (section 9.1).
pub(crate) fn library_refused(
    refused: &[(String, Vec<Problem>)],
    servable: &[String],
    named: bool,
) -> Outcome {
    let Some((library, problems)) = refused.first() else {
        return pack_refused(&[]);
    };
    let mut details = json!({
        "library": library,
        "problems": problem::shown(problems),
        "count": problems.len(),
        "refused": refused.iter().map(|(id, _)| id).collect::<Vec<_>>(),
    });
    if !servable.is_empty() && !named {
        details["servable"] = Value::from(servable);
    }
    let retry = inconsistent(refused);
    let (code, advice) = if retry {
        ("PACK_INCONSISTENT", RETRY_NOTE)
    } else {
        ("PACK_INVALID", REEXPORT)
    };
    failure(
        code,
        &format!(
            "the library `{library}` has {} problem(s), so the call was refused and nothing was served from it",
            problems.len()
        ),
        &format!("{advice}{SERVABLE_NOTE}"),
    )
    .with_retryable(retry)
    .with_error_details(details)
}

/// `PACK_TOO_LARGE`.
pub(crate) fn pack_too_large(libraries: &[String]) -> Outcome {
    failure(
        "PACK_TOO_LARGE",
        "the libraries this call touches pass the host's 16 MiB read limit",
        "Pass `library` to read one library; a single library this large has to be split.",
    )
    .with_error_details(json!({ "libraries": libraries }))
}

/// `PACK_UNREADABLE`.
pub(crate) fn pack_unreadable(library: Option<&str>) -> Outcome {
    let outcome = failure(
        "PACK_UNREADABLE",
        "a file the pack listed could not be read",
        "Retry; if it persists, re-export the pack.",
    )
    .with_retryable(true);
    match library {
        Some(library) => outcome.with_error_details(json!({ "library": library })),
        None => outcome,
    }
}

/// The `packs` grant is denied for this instance.
pub(crate) fn not_granted() -> Outcome {
    failure(
        "PLUGIN_GRANT_DENIED",
        "the components plugin does not hold the packs grant",
        "Enable the components plugin with its grants in umbel.toml.",
    )
}

/// `LIBRARY_NOT_FOUND`.
pub(crate) fn library_not_found(library: &str, libraries: &[String]) -> Outcome {
    failure(
        "LIBRARY_NOT_FOUND",
        &format!("the pack holds no library `{library}`"),
        "Pass one of the libraries listed in details, or call components-list.",
    )
    .with_error_details(json!({ "library": library, "libraries": libraries }))
}

/// `TAG_NOT_FOUND`.
pub(crate) fn tag_not_found(tag: &str, nearest: &[String]) -> Outcome {
    failure(
        "TAG_NOT_FOUND",
        &format!("no library in the pack has the tag `{tag}`"),
        "Check the name against details.nearest, or call components-list.",
    )
    .with_error_details(json!({ "tag": tag, "nearest": nearest }))
}

/// `TAG_AMBIGUOUS`.
pub(crate) fn tag_ambiguous(tag: &str, libraries: &[String]) -> Outcome {
    failure(
        "TAG_AMBIGUOUS",
        &format!("the tag `{tag}` is in more than one library"),
        "Pass `library` with one of the libraries in details.",
    )
    .with_error_details(json!({ "tag": tag, "libraries": libraries }))
}

/// `PATTERN_NOT_FOUND` (amendment A31.9).
pub(crate) fn pattern_not_found(pattern: &str, nearest: &[String]) -> Outcome {
    failure(
        "PATTERN_NOT_FOUND",
        &format!("no library in the pack has the pattern `{pattern}`"),
        "Check the name against details.nearest, or call components-pattern-list.",
    )
    .with_error_details(json!({ "pattern": pattern, "nearest": nearest }))
}

/// `PATTERN_AMBIGUOUS` (amendment A31.9).
pub(crate) fn pattern_ambiguous(pattern: &str, libraries: &[String]) -> Outcome {
    failure(
        "PATTERN_AMBIGUOUS",
        &format!("the pattern `{pattern}` is in more than one library"),
        "Pass `library` with one of the libraries in details.",
    )
    .with_error_details(json!({ "pattern": pattern, "libraries": libraries }))
}

/// `OUTPUT_BUDGET_EXCEEDED` for an item that cannot fit.
pub(crate) fn budget_exceeded() -> Outcome {
    failure(
        "OUTPUT_BUDGET_EXCEEDED",
        "one item of this answer does not fit in the call's output budget",
        "Ask for a larger budget per call with `_meta[\"dev.afd/outputBudget\"]`, up to the command's maximum; `maxBytes` only lowers it.",
    )
}

/// `COMPONENTS_INVALID` for input the schema cannot express. `what` names the rule, never a value.
pub(crate) fn invalid(what: &str) -> Outcome {
    failure(
        "COMPONENTS_INVALID",
        &format!("the input was refused: {what}"),
        "Fix the field the message names and run the command again.",
    )
}

/// `COMPONENTS_INVALID` for `tags` that hold a name with no hyphen (amendment A26): the
/// suggestion names the served tags such a name most likely meant, or the served prefixes when
/// none matches. Only tags and prefixes from the catalogs appear, never the caller's names.
pub(crate) fn bare_names(matches: &[String], prefixes: &[String]) -> Outcome {
    let suggestion = if matches.is_empty() {
        format!(
            "A tag is a custom element name, with a hyphen. The libraries served start their tags with {}; `components-list` lists every tag.",
            prefixes.join(", ")
        )
    } else {
        format!(
            "A tag is a custom element name, with a hyphen. Served tags that match the names given: {}. `components-list` lists every tag.",
            matches.join(", ")
        )
    };
    failure(
        "COMPONENTS_INVALID",
        "the input was refused: each of `tags` must be a custom element name the format accepts",
        &suggestion,
    )
    .with_error_details(json!({ "matches": matches, "prefixes": prefixes }))
}

/// `TOO_MANY_TAGS`: more than 128 tags asked for in all (section 6.2).
pub(crate) fn too_many_tags(count: usize) -> Outcome {
    failure(
        "TOO_MANY_TAGS",
        &format!("{count} tags were asked for, and a brief answers at most 128"),
        "Brief part of the page at a time: pass fewer tags, or a smaller part of the source.",
    )
    .with_error_details(json!({ "count": count }))
}

/// `PATTERN_BINDING_INVALID`: active `patternBindings` contain a cycle or exceed the 8-hop limit.
pub(crate) fn pattern_binding_invalid(reason: &str) -> Outcome {
    let message = match reason {
        "cycle" => "active `patternBindings` contain a cycle",
        "depth-exceeded" => "active `patternBindings` exceed the 8-hop resolution limit",
        _ => "active `patternBindings` could not be resolved",
    };
    failure(
        "PATTERN_BINDING_INVALID",
        message,
        "Remove the cycle or shorten the chain in `patternBindings` in `consumers.json` or the library catalog, then run the command again.",
    )
    .with_error_details(json!({ "reason": reason }))
}

/// `OUTPUT_BUDGET_EXCEEDED` for a brief whose floors do not fit (section 6.4). `guidance` counts the
/// deployment's statements, which every brief carries (amendment A28): when none of the tags fit
/// beside them, briefing fewer tags cannot help, so the suggestion says to raise the budget.
pub(crate) fn brief_budget_exceeded(
    fits: usize,
    guidance: usize,
    requested_tags: usize,
) -> Outcome {
    if requested_tags == 0 {
        let mut message = String::from(
            "the brief does not fit in the call's output budget even with every section left out",
        );
        let mut details = json!({ "fits": 0 });
        if guidance > 0 {
            message.push_str(&format!(
                ", beside the deployment's {guidance} guidance statement(s), which every brief carries"
            ));
            details["guidance"] = Value::from(guidance);
        }
        return failure(
            "OUTPUT_BUDGET_EXCEEDED",
            &message,
            "Request fewer patterns at a time, raise `maxBytes` if you set it, or ask for a larger budget per call with `_meta[\"dev.afd/outputBudget\"]`, up to the command's 96 000.",
        )
        .with_error_details(details);
    }
    let mut message = format!(
        "the brief does not fit in the call's output budget even with every section left out; the first {fits} requested tag(s) would"
    );
    let suggestion = if guidance > 0 && fits == 0 {
        "The deployment's guidance (details.guidance statements) is part of every brief and leaves no room for one tag: raise `maxBytes` if you set it, or ask for a larger budget per call with `_meta[\"dev.afd/outputBudget\"]`, up to the command's 96 000."
    } else {
        "Brief fewer tags at a time (details.fits says how many fit), or ask for a larger budget per call with `_meta[\"dev.afd/outputBudget\"]`, up to the command's 96 000; `maxBytes` only lowers it."
    };
    let mut details = json!({ "fits": fits });
    if guidance > 0 {
        message.push_str(&format!(
            ", beside the deployment's {guidance} guidance statement(s), which every brief carries"
        ));
        details["guidance"] = Value::from(guidance);
    }
    failure("OUTPUT_BUDGET_EXCEEDED", &message, suggestion).with_error_details(details)
}

/// Adds `LIBRARY_VERSION_MISMATCH` for one library (section 6.5). Every value is a checked
/// identifier: the catalog's package and version, and the caller's own.
pub(crate) fn warn_version(
    outcome: Outcome,
    library: &str,
    package: &str,
    installed: &str,
    pack: &str,
) -> Outcome {
    outcome.with_warning_details(
        "LIBRARY_VERSION_MISMATCH",
        &format!(
            "the library `{library}` was built from {package}@{pack}, and {installed} is installed; facts may differ"
        ),
        json!({ "library": library, "package": package, "installed": installed, "pack": pack }),
    )
}

/// Adds `CONTENT_FLAGGED` when any served item was flagged.
pub(crate) fn warn_flagged(outcome: Outcome, count: usize) -> Outcome {
    if count == 0 {
        return outcome;
    }
    outcome.with_warning_details(
        "CONTENT_FLAGGED",
        &format!("{count} item(s) in the content part matched the instruction or hidden-text scan"),
        json!({ "count": count }),
    )
}
