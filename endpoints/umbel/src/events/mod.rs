//! The event log: a projection of the journal, one stream and one cursor set per space
//! (specification section 6).
//!
//! The journal is the source of truth; an event stream can always be rebuilt from it. Every
//! write, to the journal and to a stream, happens under the workspace lock; reads take none.

mod cursor;
mod error;
mod event;
mod projector;
mod store;
mod stream;

pub use cursor::Cursor;
pub use error::INVALID_CURSOR;
pub use event::{EVENT_VERSION, Event, RECORD_KEY, RecordRef};
pub use projector::{RepairReport, RepairedSpace};

pub(crate) use error::{EventsError, invalid_cursor};
pub(crate) use projector::{ProjectingSink, Projector};
pub(crate) use store::{read as read_cursor, valid_consumer, write as write_cursor};
pub(crate) use stream::read_after;
