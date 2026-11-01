//! A scriptable stdio MCP server for the mounted-loader tests (built only with the `testkit`
//! feature, which `cargo test` enables through the crate's own dev-dependency).
#![allow(missing_docs, unreachable_pub)]

#[path = "../../tests/support/mount_fixture.rs"]
mod fixture;

fn main() {
    fixture::serve_stdio(&fixture::Fixture::from_env());
}
