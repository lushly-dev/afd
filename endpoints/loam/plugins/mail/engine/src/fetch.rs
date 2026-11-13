//! Fetching a message someone opens, ahead of sync's queue (the
//! specification's section 5.3): the whole of a message of 1 MiB or less, a
//! larger one in parts (M20), and a file of one held in parts, from a mailbox
//! that shows it, in the generation the store knows.

use std::fmt;

use crate::engine::Engine;
use crate::parts::{self, Structure};
use crate::provider::{Connector, Provider, ProviderError};
use crate::store::{AccountRow, MessageId, PartSeen, Place, Shown, StoreError};

/// Why a message could not be fetched now.
#[derive(Debug)]
pub enum FetchError {
    /// No mailbox the engine syncs shows the message now.
    NotShown,
    /// The file is larger than the engine reads back from its log.
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
            Self::TooLarge => write!(f, "the file is over 256 MiB, more than the engine reads"),
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

/// What to fetch of a message.
enum Wanted {
    /// The whole message.
    Whole,
    /// Its structure and the parts that hold its text.
    InParts,
    /// The part at this place, of a message held in parts.
    Part(String),
}

/// What a fetch returned.
enum Got {
    Whole(Vec<u8>),
    InParts(Structure, Vec<(String, Vec<u8>)>),
    Part(Vec<u8>),
}

/// Fetches the body of `message` and records it, unless it is held: the
/// whole of a message of 1 MiB or less, a larger one in parts, as sync
/// would ([`crate::sync::Options::whole_limit`]). Returns whether it
/// fetched.
///
/// # Errors
/// A [`FetchError`] saying why it could not; what was held stays held.
pub async fn fetch_body(engine: &Engine, message: MessageId, now: i64) -> Result<bool, FetchError> {
    let listed = engine
        .with_store(|store| store.message_listed(message))?
        .ok_or(FetchError::Store(StoreError::NotFound("message")))?;
    if listed.held_whole || listed.held_in_parts {
        return Ok(false);
    }
    let wanted = if listed.size > engine.sync_options().whole_limit {
        Wanted::InParts
    } else {
        Wanted::Whole
    };
    fetch(engine, message, &wanted, now).await?;
    Ok(true)
}

/// Fetches the part at `place` of a message held in parts and records it,
/// unless its bytes are held. Returns whether it fetched.
///
/// # Errors
/// A [`FetchError`] saying why it could not; what was held stays held.
pub async fn fetch_part(
    engine: &Engine,
    message: MessageId,
    place: &str,
    now: i64,
) -> Result<bool, FetchError> {
    let (held, structure) = engine
        .with_store(|store| Ok((store.part_held(message, place)?, store.structure(message)?)))?;
    if held {
        return Ok(false);
    }
    if structure
        .and_then(|structure| structure.leaf(place).map(|leaf| leaf.size))
        .is_some_and(|size| size > crate::store::READ_LIMIT)
    {
        return Err(FetchError::TooLarge);
    }
    fetch(engine, message, &Wanted::Part(place.to_string()), now).await?;
    Ok(true)
}

/// Fetches what `wanted` names from each mailbox that shows the message, of
/// an account the engine has, newest observation first, until one returns
/// it, and records it.
async fn fetch(
    engine: &Engine,
    message: MessageId,
    wanted: &Wanted,
    now: i64,
) -> Result<(), FetchError> {
    let (shown, accounts) =
        engine.with_store(|store| Ok((store.where_shown(message)?, store.accounts()?)))?;
    let connector = engine.connector().cloned().ok_or(FetchError::NoConnector)?;
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
        match fetch_from(connector.as_ref(), &account, &place, wanted).await {
            Ok(got) => {
                let recorded = engine.with_store(|store| match &got {
                    Got::Whole(bytes) => store
                        .record_parts(
                            &[PartSeen {
                                message,
                                place: Place::Whole,
                                bytes,
                            }],
                            now,
                        )
                        .map(drop),
                    Got::InParts(structure, texts) => {
                        let texts: Vec<(&str, &[u8])> = texts
                            .iter()
                            .map(|(place, bytes)| (place.as_str(), bytes.as_slice()))
                            .collect();
                        store.record_in_parts(message, structure, &texts, now)
                    }
                    Got::Part(bytes) => {
                        let Wanted::Part(at) = wanted else {
                            return Ok(());
                        };
                        let kind = if store
                            .structure(message)?
                            .is_some_and(|structure| parts::text_places(&structure).contains(at))
                        {
                            Place::Text(at)
                        } else {
                            Place::Attachment(at)
                        };
                        store
                            .record_parts(
                                &[PartSeen {
                                    message,
                                    place: kind,
                                    bytes,
                                }],
                                now,
                            )
                            .map(drop)
                    }
                });
                return match recorded {
                    Ok(()) => Ok(()),
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

/// What `wanted` names, from one mailbox that shows the message.
async fn fetch_from(
    connector: &dyn Connector,
    account: &AccountRow,
    place: &Shown,
    wanted: &Wanted,
) -> Result<Got, FetchError> {
    let mut provider = connector.connect(account).await?;
    let fetched = fetch_in(provider.as_mut(), place, wanted).await;
    provider.close().await;
    fetched
}

async fn fetch_in(
    provider: &mut dyn Provider,
    place: &Shown,
    wanted: &Wanted,
) -> Result<Got, FetchError> {
    let opened = provider.open(&place.mailbox_key).await?;
    if opened.validity != place.validity {
        return Err(FetchError::Moved);
    }
    let id = std::slice::from_ref(&place.provider_id);
    match wanted {
        Wanted::Whole => {
            let mut found = provider.messages(id).await?;
            found
                .pop()
                .map(|fetched| Got::Whole(fetched.bytes))
                .ok_or(FetchError::NotReturned)
        }
        Wanted::InParts => {
            let structure = match provider.structure(&place.provider_id).await {
                Ok(structure) => structure.ok_or(FetchError::NotReturned)?,
                // Held as a structure past the limit: the message is shown
                // with its headers alone, and never asked for again.
                Err(ProviderError::TooDeep) => {
                    return Ok(Got::InParts(Structure::too_deep(), Vec::new()));
                }
                Err(error) => return Err(error.into()),
            };
            let places = parts::text_places(&structure);
            let texts = if places.is_empty() {
                Vec::new()
            } else {
                provider.parts(&place.provider_id, &places).await?
            };
            if texts.len() < places.len() {
                return Err(FetchError::NotReturned);
            }
            Ok(Got::InParts(
                structure,
                texts
                    .into_iter()
                    .map(|part| (part.place, part.bytes))
                    .collect(),
            ))
        }
        Wanted::Part(at) => provider
            .parts(&place.provider_id, std::slice::from_ref(at))
            .await?
            .pop()
            .map(|part| Got::Part(part.bytes))
            .ok_or(FetchError::NotReturned),
    }
}
