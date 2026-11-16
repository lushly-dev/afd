//! The Windows system calls the Umbel host makes, behind safe functions. The host forbids
//! `unsafe` code, so the FFI lives here, in two modules that allow it, and nowhere else:
//!
//! - [`security`]: a file's or directory's owner and discretionary ACL, read from an open handle
//!   so that what is judged is the object that was opened, and the SID of the user the process
//!   runs as. Every SID is given in its string form (`S-1-5-18`), never as an account name.
//! - [`volume`]: the drive type of the volume that holds a path, which tells a network drive from
//!   a local one.
//!
//! This crate only reads; what is allowed is the host's policy (`src/auth/files.rs`). On every
//! other platform the library is empty.

#[cfg(windows)]
pub mod security;
#[cfg(windows)]
pub mod volume;
