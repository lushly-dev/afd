//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/mod.rs"]
mod support;

mod access_tokens;
mod authorization_server;
mod discovery;
mod enterprise;
mod gateway;
mod identity_provider;
