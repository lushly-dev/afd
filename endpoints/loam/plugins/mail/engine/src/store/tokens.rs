//! The tokens agents present to a running server (the specification's 3.3
//! and 3.4). Only a token's SHA-256 is kept.

use rusqlite::params;

use super::{Store, StoreError};

/// A token, as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenRow {
    /// Stable, made with the token: the actor's id.
    pub id: String,
    /// The person's name for it, for display.
    pub name: String,
    /// The token's SHA-256.
    pub hash: [u8; 32],
    /// When it was made, in milliseconds since the epoch.
    pub created_at: i64,
}

impl Store {
    /// Every token, oldest first.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn tokens(&self) -> Result<Vec<TokenRow>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT id, name, hash, created_at FROM token ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([], |row| {
            let hash: Vec<u8> = row.get(2)?;
            Ok((row.get(0)?, row.get(1)?, hash, row.get(3)?))
        })?;
        let mut tokens = Vec::new();
        for row in rows {
            let (id, name, hash, created_at) = row?;
            // The table's check keeps every hash 32 bytes long.
            let hash: [u8; 32] = hash
                .try_into()
                .map_err(|_| StoreError::NotFound("token's hash"))?;
            tokens.push(TokenRow {
                id,
                name,
                hash,
                created_at,
            });
        }
        Ok(tokens)
    }

    /// Keeps a new token.
    ///
    /// # Errors
    /// When the database refuses, as it does for an id or a hash already
    /// kept.
    pub fn add_token(&mut self, token: &TokenRow) -> Result<(), StoreError> {
        self.connection.execute(
            "INSERT INTO token (id, name, hash, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                token.id,
                token.name,
                token.hash.as_slice(),
                token.created_at
            ],
        )?;
        Ok(())
    }

    /// Forgets the token `id`, so that it is refused from now on.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when no token has that id, or when the
    /// database refuses.
    pub fn remove_token(&mut self, id: &str) -> Result<TokenRow, StoreError> {
        let token = self
            .tokens()?
            .into_iter()
            .find(|token| token.id == id)
            .ok_or(StoreError::NotFound("token"))?;
        self.connection
            .execute("DELETE FROM token WHERE id = ?1", [id])?;
        Ok(token)
    }
}
