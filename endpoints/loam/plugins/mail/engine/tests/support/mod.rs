//! Test doubles shared by the integration tests.

#[cfg(feature = "test-doubles")]
#[allow(unreachable_pub)]
pub use loam_mail::doubles::{http, imap, smtp};

#[cfg(not(feature = "test-doubles"))]
#[allow(unreachable_pub)]
#[path = "../../src/doubles/http.rs"]
pub mod http;

#[cfg(not(feature = "test-doubles"))]
#[allow(unreachable_pub)]
#[path = "../../src/doubles/imap.rs"]
pub mod imap;

#[cfg(not(feature = "test-doubles"))]
#[allow(unreachable_pub)]
#[path = "../../src/doubles/smtp.rs"]
pub mod smtp;

#[allow(unreachable_pub)]
pub mod synced;
