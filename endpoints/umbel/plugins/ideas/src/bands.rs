//! Bands from scores (specification, section 6.2). A band is the plugin's reading of a score
//! against the pack's provisional thresholds, shown beside it so the calling agent can weigh
//! it. Never a refusal.

use umbel_store::lane::MeaningState;

use crate::pack::{Bands, Matching};

/// Which score the bands read, and the table they read it against.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Reading<'a> {
    /// `words` or `fused`.
    pub(crate) on: &'static str,
    pub(crate) bands: &'a Bands,
}

/// The reading for a match: `fused` against `[bands.fused.<model id>]` when the meaning lane
/// served a model the pack has a table for, `words` against `[bands.words]` otherwise (6.4).
pub(crate) fn reading<'a>(matching: &'a Matching, meaning: &MeaningState) -> Reading<'a> {
    if let MeaningState::Served(model) = meaning
        && let Some(bands) = matching.fused.get(&model.to_string())
    {
        return Reading { on: "fused", bands };
    }
    Reading {
        on: "words",
        bands: &matching.words,
    }
}

/// The band of a score.
pub(crate) fn band(bands: &Bands, score: f64) -> &'static str {
    if score >= bands.likely_same {
        "likely-same"
    } else if score >= bands.related {
        "related"
    } else {
        "distant"
    }
}

/// The wire spelling of whether the scores hold meaning.
pub(crate) fn meaning_name(meaning: &MeaningState) -> String {
    match meaning {
        MeaningState::Served(model) => model.to_string(),
        MeaningState::Off => "off".to_owned(),
        MeaningState::Incomplete => "incomplete".to_owned(),
        MeaningState::Failed => "failed".to_owned(),
    }
}
