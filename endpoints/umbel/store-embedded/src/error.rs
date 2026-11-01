//! Mapping SQLite's failures to the store's error model.

use rusqlite::ErrorCode;
use umbel_store::StoreError;

/// A failure inside a store method: the store's own error, or one from SQLite not yet mapped.
pub(crate) enum Fail {
    Store(StoreError),
    Sql(rusqlite::Error),
}

impl From<StoreError> for Fail {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

impl From<rusqlite::Error> for Fail {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<Fail> for StoreError {
    fn from(fail: Fail) -> Self {
        match fail {
            Fail::Store(error) => error,
            Fail::Sql(error) => map_sql(&error),
        }
    }
}

/// A lock wait that ran out is `Busy`; a damaged file is `Corrupt`; everything else is `Io`.
pub(crate) fn map_sql(error: &rusqlite::Error) -> StoreError {
    match error {
        rusqlite::Error::SqliteFailure(failure, _) => match failure.code {
            ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked => StoreError::Busy,
            ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase => {
                StoreError::Corrupt(error.to_string())
            }
            _ => StoreError::Io(error.to_string()),
        },
        rusqlite::Error::FromSqlConversionFailure(..)
        | rusqlite::Error::InvalidColumnType(..)
        | rusqlite::Error::IntegralValueOutOfRange(..) => StoreError::Corrupt(error.to_string()),
        _ => StoreError::Io(error.to_string()),
    }
}

/// A revision as SQLite's integer.
pub(crate) fn to_i64(value: u64) -> Result<i64, StoreError> {
    i64::try_from(value).map_err(|_| StoreError::invalid("a revision is at most 2^63 - 1"))
}

/// A stored integer as a revision or count.
pub(crate) fn to_u64(value: i64) -> Result<u64, StoreError> {
    u64::try_from(value).map_err(|_| StoreError::Corrupt("a stored count is negative".to_owned()))
}
