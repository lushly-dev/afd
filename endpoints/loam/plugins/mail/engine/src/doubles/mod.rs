//! Test doubles compiled only under the `test-doubles` feature (plugin.spec.md,
//! section 12.4). Never compiled into release builds (enforced by
//! `compile_error!` in `crate`).

pub mod config;
pub mod http;
pub mod imap;
pub mod smtp;
pub mod world;
