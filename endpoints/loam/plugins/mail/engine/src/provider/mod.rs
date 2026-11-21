//! The provider interface (the specification's section 5.1): what sync asks
//! of an account's provider, in words that name no protocol. iCloud
//! implements it over IMAP ([`imap`]); Gmail will implement it over its API.
//!
//! Reading never changes the mailbox: a mailbox is opened for reading with
//! [`Provider::open`]. Changing it (the specification's section 9) opens it
//! with [`Provider::open_to_change`], and only an operation does
//! ([`crate::operate`]).

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

/// The ids a mailbox's messages are returned by, read from the messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Returned {
    /// Every id returned, including mail that arrived after the mailbox was
    /// opened, such as a copy the engine made meanwhile.
    pub ids: Vec<String>,
    /// How many of them the mailbox held when it was opened: what its count
    /// then is compared with.
    pub held_when_opened: u64,
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
    /// How many messages the provider says the mailbox holds now, when it
    /// says. Fewer than the store shows means some left unreported.
    pub held: Option<u64>,
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

/// A mailbox opened to change it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedToChange {
    /// The generation its ids belong to.
    pub validity: String,
}

/// Where a mailbox will put the next message it is given: its generation,
/// and the id the next message will get. A copy whose answer was lost is
/// found among the ids from there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextId {
    /// The generation.
    pub validity: String,
    /// The next id.
    pub next: String,
}

/// Where messages went when they were copied or moved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Copied {
    /// The generation of the mailbox they went to.
    pub validity: String,
    /// Each message's id before and its id in the mailbox it went to. A
    /// message the provider left out was not copied.
    pub ids: Vec<(String, String)>,
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

    /// Opens a mailbox and asks what changed since `cursor`, which belongs
    /// to the generation `validity`, in as few requests as the provider
    /// can. The changes are `None` when the mailbox's generation is no
    /// longer `validity`: its ids are new, and it is listed again.
    async fn open_since(
        &mut self,
        mailbox: &str,
        validity: &str,
        cursor: &str,
    ) -> Result<(Opened, Option<Since>), ProviderError> {
        let opened = self.open(mailbox).await?;
        if opened.validity != validity {
            return Ok((opened, None));
        }
        let since = self.changes(cursor).await?;
        Ok((opened, Some(since)))
    }

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

    /// Opens a mailbox to change it. Nothing else opens one that way.
    async fn open_to_change(&mut self, _mailbox: &str) -> Result<OpenedToChange, ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// Where the mailbox `mailbox` will put the next message it is given,
    /// read without opening it.
    async fn next_id(&mut self, _mailbox: &str) -> Result<NextId, ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// Every id the open mailbox returns its messages by: read from the
    /// messages themselves, not a listing. Sync asks for it only when the
    /// provider holds fewer messages than the store shows, as iCloud did when
    /// mail left its trash without being reported. Every provider answers it
    /// from the messages, never from its listing: a listing is what fell
    /// behind.
    async fn returned(&mut self) -> Result<Returned, ProviderError>;

    /// Which of `ids` the open mailbox holds now, by any account the
    /// provider gives of it: a message one account leaves out is still
    /// held. Where being held must be sure, as before the last copy of a
    /// message could go, the caller asks [`Provider::flags_of`] instead.
    async fn present(&mut self, _ids: &[String]) -> Result<Vec<String>, ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// Every id the open mailbox holds from `from` on: what arrived since a
    /// [`NextId`].
    async fn ids_from(&mut self, _from: &str) -> Result<Vec<String>, ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// The flags or labels of the messages `ids` names in the open mailbox.
    /// A message the provider does not return is left out.
    async fn flags_of(&mut self, _ids: &[String]) -> Result<Vec<FlagsSeen>, ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// Copies the messages `ids` names from the mailbox opened to change it
    /// into `to`, and says where each went.
    async fn copy(&mut self, _ids: &[String], _to: &str) -> Result<Copied, ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// Whether [`Provider::move_to`] moves in one step. Without it, a move
    /// is a copy, a flag and a removal of exactly what was copied.
    fn moves(&self) -> bool {
        false
    }

    /// Moves the messages `ids` names from the mailbox opened to change it
    /// into `to` in one step, and says where each went.
    async fn move_to(&mut self, _ids: &[String], _to: &str) -> Result<Copied, ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// Sets (`on`) or clears the flags `flags` on the messages `ids` names in
    /// the mailbox opened to change it.
    async fn set_flags(
        &mut self,
        _ids: &[String],
        _flags: &[&str],
        _on: bool,
    ) -> Result<(), ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// Removes from the mailbox opened to change it exactly the messages
    /// `ids` names, which carry the delete flag: never another message that
    /// carries it.
    async fn remove(&mut self, _ids: &[String]) -> Result<(), ProviderError> {
        Err(ProviderError::Refused("changing mail"))
    }

    /// Ends the connection politely. Failing to is not an error.
    async fn close(&mut self);
}

/// Opens connections to accounts' providers.
#[async_trait]
pub trait Connector: Send + Sync {
    /// Connects to `account`'s provider and signs in.
    async fn connect(&self, account: &AccountRow) -> Result<Box<dyn Provider>, ProviderError>;
}
