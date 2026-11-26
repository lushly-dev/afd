//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/components.rs"]
mod components;
#[path = "../support/mounted.rs"]
mod mounted;
#[path = "../support/person_canaries.rs"]
mod person_canaries;
#[path = "../support/mod.rs"]
mod support;

mod access_filter;
mod approvals;
mod auth_keys;
mod auth_layers;
mod auth_show;
mod call_person;
#[cfg(feature = "cli")]
mod cli;
mod cli_authority_prompt;
mod cli_confirm_preview;
mod cli_stdin_input;
mod compiled_limits;
#[cfg(feature = "component")]
mod component_components;
#[cfg(feature = "component")]
mod component_journal;
#[cfg(feature = "component")]
mod component_replay;
mod config_v3;
mod config_v4;
mod config_v5;
mod config_v6;
mod config_v7;
mod config_v8;
mod confirm_binding;
mod confirmations;
mod context_hook;
mod contexts_pipelines;
mod cursor_v1;
mod cursors;
mod default_tools;
mod doctor;
mod doctor_auth;
mod doctor_config_checks;
mod doctor_pack_checks;
mod doctor_plugins;
mod doctor_sealed;
mod doctor_stores;
mod events_index;
mod events_scale;
mod first_class_plugins;
mod grants;
#[cfg(all(feature = "component", feature = "mounted", feature = "cli"))]
mod hello_three_ways;
mod hybrid_surface;
mod journal_digest;
mod journal_events;
mod journal_secret;
mod limits;
mod manifest;
mod manifest_v2;
mod manifest_v3;
mod manifest_v4;
mod manifest_v5;
mod manifest_v6;
mod manifest_v7;
mod memory_grants;
mod mount_naming;
mod multi_process;
mod no_auth_server;
mod packs;
mod person_local;
mod person_page;
mod person_page_gateway;
mod person_paged;
mod person_pending;
mod person_ttl;
mod pipeline_attestation;
mod pipeline_expose;
mod plugin_commands;
mod plugin_compiled;
mod plugin_conflicts;
mod plugin_instructions;
mod plugin_mounted;
#[cfg(feature = "cli")]
mod plugin_scaffold;
mod plugin_spaces;
mod principal_v1;
#[cfg(feature = "cli")]
mod process;
mod protocol_http;
mod protocol_stdio;
mod readable_collections;
mod records_eval;
mod records_exit;
mod records_find;
mod records_match;
mod records_meaning;
mod records_own_source;
mod records_person_page;
mod records_put;
mod records_quota;
mod records_scale;
mod records_standing;
mod require_human;
mod schemas;
mod scope_gate;
mod seal;
mod shared_nonces;
mod skills;
#[cfg(feature = "cli")]
mod smoke;
mod space_visibility;
mod store_commands;
mod store_grants;
mod store_truncate_wal;
mod tasks;
mod testkit;
mod trusted_keys;
mod trusted_proxies;
mod usage;
mod workspace;
