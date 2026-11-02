//! The eval harness (specification section 10, decision D65): a deterministic fixture
//! generator, a seeded query set, `knowledge-eval`, and the gate that holds ranking changes to
//! account.
//!
//! - [`fixture`] writes the thousand-document, two-space workspace and its query set from a seed;
//!   [`rng`] and [`words`] make every word, and nothing in it is real;
//! - [`queries`] is the query set's shape (`schemas/eval-queries.v1.json`);
//! - [`metrics`] is recall, nDCG and MRR;
//! - `knowledge-eval` (see the `run` module) runs each query through the same ranking code as
//!   `knowledge-search`, as the principal the query names, and returns the report
//!   (`schemas/eval-report.v1.json`) as its result;
//! - [`gate`] is the CI gate and the gate a later retrieval lane must pass.

pub mod fixture;
pub mod gate;
pub mod metrics;
pub mod queries;
pub mod rng;
mod run;
pub mod words;

pub(crate) use run::run;
