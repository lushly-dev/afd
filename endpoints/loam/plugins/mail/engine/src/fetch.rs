//! Fetching a message someone opens, ahead of sync's queue (the
//! specification's section 5.3): the whole of a message of 1 MiB or less,
//! from a mailbox that shows it, in the generation the store knows.

use std::fmt;

use crate::engine::Engine;
use crate::provider::{Connector, ProviderError};
use crate::store::{AccountRow, MessageId, PartSeen, Place, Shown, StoreError};
use crate::sync::WHOLE_LIMIT;

/// Why a message could not be fetched now.
#[derive(Debug)]
pub enum FetchError {
    /// No mailbox the engine syncs shows the message now.
    NotShown,
    /// The message is larger than the engine fetches whole (M20).
    TooLarge,
    /// The mailbox's generation changed since the message was seen: sync
    /// must list it again first.
    Moved,
    /// The provider did not return it.
    NotReturned,
    /// Other bytes are already held for it: the body fetched is set aside,
    /// not recorded (5.3).
    Conflict,
    /// This build cannot reach a provider.
    NoConnector,
    /// The provider refused or could not be reached.
    Provider(ProviderError),
    /// The store refused.
    Store(StoreError),
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotShown => write!(f, "no mailbox shows the message now"),
            Self::TooLarge => write!(f, "the message is over 1 MiB, more than is fetched whole"),
            Self::Moved => write!(f, "the mailbox changed since the message was seen"),
            Self::NotReturned => write!(f, "the provider did not return the message"),
            Self::Conflict => write!(
                f,
                "the body fetched differs from what is held, and was set aside"
            ),
            Self::NoConnector => write!(f, "this build of the engine cannot reach a provider"),
            Self::Provider(error) => error.fmt(f),
            Self::Store(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for FetchError {}

impl From<StoreError> for FetchError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl From<ProviderError> for FetchError {
    fn from(error: ProviderError) -> Self {
        Self::Provider(error)
    }
}

/// Fetches the whole of `message` and records it, unless it is held whole
/// already. Returns whether it fetched.
///
/// # Errors
/// A [`FetchError`] saying why it could not; what was held stays held.
pub async fn fetch_whole(
    engine: &Engine,
    message: MessageId,
    now: i64,
) -> Result<bool, FetchError> {
    let (listed, shown, accounts) = engine.with_store(|store| {
        Ok((
            store.message_listed(message)?,
            store.where_shown(message)?,
            store.accounts()?,
        ))
    })?;
    let listed = listed.ok_or(FetchError::Store(StoreError::NotFound("message")))?;
    if listed.held_whole {
        return Ok(false);
    }
    if listed.size > WHOLE_LIMIT {
        return Err(FetchError::TooLarge);
    }
    let connector = engine.connector().cloned().ok_or(FetchError::NoConnector)?;
    // Each mailbox that shows it, of an account the engine has, newest
    // observation first, until one returns it.
    let places: Vec<(Shown, AccountRow)> = shown
        .into_iter()
        .filter_map(|place| {
            accounts
                .iter()
                .find(|account| account.id == place.account)
                .cloned()
                .map(|account| (place, account))
        })
        .collect();
    let mut last = FetchError::NotShown;
    let mut refused = Vec::new();
    for (place, account) in places {
        if refused.contains(&account.id) {
            continue;
        }
        match fetch_from(connector.as_ref(), &account, &place).await {
            Ok(bytes) => {
                let recorded = engine.with_store(|store| {
                    store.record_parts(
                        &[PartSeen {
                            message,
                            place: Place::Whole,
                            bytes: &bytes,
                        }],
                        now,
                    )
                });
                return match recorded {
                    Ok(_) => Ok(true),
                    Err(StoreError::Conflict) => Err(FetchError::Conflict),
                    Err(error) => Err(FetchError::Store(error)),
                };
            }
            // Another mailbox of the account would refuse the same way;
            // one of another account may not.
            Err(
                error @ FetchError::Provider(
                    ProviderError::SignIn | ProviderError::Keychain | ProviderError::NoCredential,
                ),
            ) => {
                refused.push(account.id);
                last = error;
            }
            Err(error) => last = error,
        }
    }
    Err(last)
}

/// The whole of a message, from one mailbox that shows it.
async fn fetch_from(
    connector: &dyn Connector,
    account: &AccountRow,
    place: &Shown,
) -> Result<Vec<u8>, FetchError> {
    let mut provider = connector.connect(account).await?;
    let fetched = async {
        let opened = provider.open(&place.mailbox_key).await?;
        if opened.validity != place.validity {
            return Err(FetchError::Moved);
        }
        let mut found = provider
            .messages(std::slice::from_ref(&place.provider_id))
            .await?;
        found.pop().ok_or(FetchError::NotReturned)
    }
    .await;
    provider.close().await;
    Ok(fetched?.bytes)
}
