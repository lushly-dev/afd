//! `components-brief`: declared by the manifest, implemented in the specification's step C2.

use umbel_sdk::Outcome;

use crate::fail;

pub(crate) fn run() -> Outcome {
    fail::brief_not_implemented()
}
