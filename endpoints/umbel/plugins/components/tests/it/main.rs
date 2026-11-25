//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/mod.rs"]
mod support;

mod brief_patterns;
mod budget;
mod canonical;
mod check;
mod component_manifest;
mod consumers;
mod content_stays_content;
mod default_pack;
mod facts;
mod fast_af;
mod fixtures_invalid;
mod guidance;
mod list;
mod no_plugin_dependency;
mod open;
mod pack_format_2;
mod pattern_commands;
mod patterns;
mod refusal;
mod render;
mod scale;
mod sections;
mod select;
mod spaces;
mod surfaces;
mod themes;
mod twenty_tags;
