//! The leak probes of section 12 on a fresh workspace, through library actors (exact until
//! phase 5): bo never sees ada's private record through any read, write or bundle, and a planted
//! term gives bo the answer an absent one does; a hit has no score; the memory head is the
//! caller's; ada's agent reads ada's records; a shared record is read and not written by bo; a
//! shared agent record is not pushed to bo; an idempotency key is the writer's; beta stays in
//! beta, and bo is refused it before any handler; a group share follows membership at once; a
//! transcript stays private under `default_access = "space"`. `exit_memory.rs` runs the same
//! probes on the exit's stores (`support/probes.rs`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use support::{Options, Ws, probes};

#[tokio::test]
async fn bo_never_sees_adas_private_memory() {
    let mut ws = Ws::new(&Options::default());
    let groups = probes::run(&mut ws).await;
    assert_eq!(groups, 14);
    eprintln!("leak probes: {groups} groups passed");
}
