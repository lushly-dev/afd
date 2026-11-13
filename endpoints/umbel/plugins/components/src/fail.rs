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
        "Export a library into the space's pack with `specimen pack-export`, or list what the pack holds with `umbel plugin-show components`.",
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

/// `TOO_MANY_TAGS`: more than 128 tags asked for in all (section 6.2).
pub(crate) fn too_many_tags(count: usize) -> Outcome {
    failure(
        "TOO_MANY_TAGS",
        &format!("{count} tags were asked for, and a brief answers at most 128"),
        "Brief part of the page at a time: pass fewer tags, or a smaller part of the source.",
    )
    .with_error_details(json!({ "count": count }))
}

/// `OUTPUT_BUDGET_EXCEEDED` for a brief whose floors do not fit (section 6.4).
pub(crate) fn brief_budget_exceeded(fits: usize) -> Outcome {
    failure(
        "OUTPUT_BUDGET_EXCEEDED",
        &format!(
            "the brief does not fit in the call's output budget even with every section left out; the first {fits} requested tag(s) would"
        ),
        "Brief fewer tags at a time (details.fits says how many fit), or ask for a larger budget per call with `_meta[\"dev.afd/outputBudget\"]`, up to the command's 96 000; `maxBytes` only lowers it.",
    )
    .with_error_details(json!({ "fits": fits }))
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
