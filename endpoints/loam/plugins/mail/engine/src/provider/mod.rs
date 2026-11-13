//! The provider interface (the specification's section 5.1): what sync asks
//! of an account's provider, in words that name no protocol. iCloud
//! implements it over IMAP ([`imap`]); Gmail will implement it over its API.
//!
//! Reading never changes the mailbox. The interface has no operation that
//! writes; those arrive with phase D.

pub mod imap;

use std::fmt;

use async_trait::async_trait;

use crate::parts::Structure;
use crate::store::{AccountRow, HeaderSeen, Role};

/// Why a provider refused. The words are the engine's own: never text from
/// the provider's reply, which can quote a mailbox's name or a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    /// The provider refused the stored credential (`SIGN_IN_REQUIRED`).
    SignIn,
    /// There is no credential for the account.
    NoCredential,
    /// The keychain that holds the credential refused: locked, or access
    /// denied.
    Keychain,
    /// The provider could not be reached, or the connection dropped
    /// (`PROVIDER_UNAVAILABLE`). Worth trying again.
    Unavailable(&'static str),
    /// The provider refused a request: a mailbox it will not open, for one.
    Refused(&'static str),
    /// The provider said something the engine cannot read.
    Protocol(&'static str),
    /// The provider's reply nests deeper than the engine reads: what a
    /// message's own structure can make it. The connection is closed; the
    /// same request would fail the same way.
    TooDeep,
}

impl ProviderError {
    /// Whether trying again on a new connection may help.
    #[must_use]
    pub fn retryable(&self) -> bool {
        matches!(self, Self::Unavailable(_) | Self::Protocol(_))
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SignIn => write!(f, "the provider refused the stored sign-in"),
            Self::NoCredential => write!(f, "there is no stored sign-in for the account"),
            Self::Keychain => write!(f, "the keychain refused to give the account's sign-in"),
            Self::Unavailable(what) => write!(f, "the provider could not be reached: {what}"),
            Self::Refused(what) => write!(f, "the provider refused: {what}"),
            Self::Protocol(what) => write!(f, "the provider's reply could not be read: {what}"),
            Self::TooDeep => write!(f, "the provider's reply nests deeper than the engine reads"),
        }
    }
}

impl std::error::Error for ProviderError {}

/// A mailbox as the provider lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteMailbox {
    /// The provider's own name for it, as the provider wants it back.
    pub key: String,
    /// The name to show.
    pub name: String,
    /// What it is for: from the provider's flag where it gives one, else from
    /// the provider's known names, else [`Role::None`].
    pub role: Role,
}

/// A mailbox the provider opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opened {
    /// The generation its ids belong to: IMAP's `UIDVALIDITY`, or `""`.
    pub validity: String,
}

/// Every id a mailbox holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listing {
    /// The ids, newest first.
    pub ids: Vec<String>,
    /// Where the next pass starts: what this listing covers.
    pub cursor: String,
}

/// The flags or labels a message carries now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlagsSeen {
    /// The provider's id for the message.
    pub provider_id: String,
    /// Its flags or labels.
    pub flags: Vec<String>,
}

/// What left a mailbox since a cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Gone {
    /// The provider names what left.
    Named(Vec<String>),
    /// The provider lists what remains of what the cursor covered; the
    /// engine compares.
    Remaining(Vec<String>),
}

/// What changed in a mailbox since a cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changes {
    /// Ids that arrived, newest first.
    pub added: Vec<String>,
    /// What left.
    pub gone: Gone,
    /// Messages the cursor covered whose flags or labels may have changed.
    pub flags: Vec<FlagsSeen>,
    /// Where the next pass starts.
    pub cursor: String,
}

/// The answer to "what changed since this cursor".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Since {
    /// The changes.
    Changes(Changes),
    /// The provider no longer answers for that cursor: list the mailbox again.
    TooOld,
    /// The mailbox's generation changed since it was opened: open it again.
    NewGeneration,
}

/// A message's bytes as the provider returned them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fetched {
    /// The provider's id for it.
    pub provider_id: String,
    /// The bytes, exactly as returned.
    pub bytes: Vec<u8>,
}

/// The bytes of one part of a message, as the provider returned them: its
/// body, still in its transfer encoding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartFetched {
    /// The part's place, such as `1.2`.
    pub place: String,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// One connection to an account's provider. A mailbox is opened, and the
/// operations after it act on that mailbox.
#[async_trait]
pub trait Provider: Send {
    /// Every mailbox the account has that can hold mail.
    async fn mailboxes(&mut self) -> Result<Vec<RemoteMailbox>, ProviderError>;

    /// Opens a mailbox for reading.
    async fn open(&mut self, mailbox: &str) -> Result<Opened, ProviderError>;

    /// Lists every id the open mailbox holds.
    async fn list(&mut self) -> Result<Listing, ProviderError>;

    /// What changed in the open mailbox since `cursor`.
    async fn changes(&mut self, cursor: &str) -> Result<Since, ProviderError>;

    /// The flags or labels of every message the open mailbox holds.
    async fn flags(&mut self) -> Result<Vec<FlagsSeen>, ProviderError>;

    /// The headers of the messages `ids` names. A message the provider does
    /// not return is left out; that is not an error (the specification's
    /// section 5.4).
    async fn headers(&mut self, ids: &[String]) -> Result<Vec<HeaderSeen>, ProviderError>;

    /// The whole of each message `ids` names, with the same rule.
    async fn messages(&mut self, ids: &[String]) -> Result<Vec<Fetched>, ProviderError>;

    /// The MIME structure of the message `id` names, or `None` when the
    /// provider does not return it (the specification's M20).
    /// [`ProviderError::TooDeep`] when it nests deeper than the engine reads.
    async fn structure(&mut self, id: &str) -> Result<Option<Structure>, ProviderError>;

    /// The parts of one message at `places`. A part the provider does not
    /// return is left out.
    async fn parts(
        &mut self,
        id: &str,
        places: &[String],
    ) -> Result<Vec<PartFetched>, ProviderError>;

    /// Ends the connection politely. Failing to is not an error.
    async fn close(&mut self);
}

/// Opens connections to accounts' providers.
#[async_trait]
pub trait Connector: Send + Sync {
    /// Connects to `account`'s provider and signs in.
    async fn connect(&self, account: &AccountRow) -> Result<Box<dyn Provider>, ProviderError>;
}
