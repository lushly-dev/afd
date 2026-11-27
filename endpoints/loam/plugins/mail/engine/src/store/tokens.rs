//! The tokens agents and approvers present to a running server (the
//! specification's 3.3 and 3.4, and plugin.spec.md section 4). Only a token's
//! SHA-256 is kept.

use rusqlite::{Connection, OptionalExtension, params};

use super::{Store, StoreError};

/// Ensures the persistent 32-byte non-bearer instance identity key exists in
/// `instance_proof_key` (phase 5 no-terminal amendment, sections 5.1 and 5.2).
/// Generated once from the operating system's random source; survives restarts,
/// rebuilds, and `unpair`.
pub(super) fn ensure_proof_key(connection: &Connection, now: i64) -> Result<(), StoreError> {
    let exists: Option<i64> = connection
        .query_row("SELECT 1 FROM instance_proof_key WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()?;
    if exists.is_some() {
        return Ok(());
    }
    let mut secret = vec![0u8; 32];
    getrandom::fill(&mut secret).map_err(|_| StoreError::Random)?;
    connection.execute(
        "INSERT OR IGNORE INTO instance_proof_key (id, secret, created_at)
         VALUES (1, ?1, ?2)",
        params![secret.as_slice(), now],
    )?;
    Ok(())
}

/// Whether a token belongs to an ordinary agent or to a trusted approver
/// client such as Loam (step F1, M30).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TokenRole {
    /// An ordinary MCP agent token.
    #[default]
    Agent,
    /// An approver token: also an agent token, and named to `McpServer::with_approver`.
    Approver,
}

impl TokenRole {
    /// The role as stored in SQLite and returned in JSON.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Approver => "approver",
        }
    }

    /// Parses a stored or caller-supplied role string.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "agent" => Some(Self::Agent),
            "approver" => Some(Self::Approver),
            _ => None,
        }
    }
}

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
    /// Whether the token is an ordinary agent or an approver.
    pub role: TokenRole,
}

impl Store {
    /// Every token, oldest first.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn tokens(&self) -> Result<Vec<TokenRow>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT id, name, hash, created_at, role FROM token ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([], |row| {
            let hash: Vec<u8> = row.get(2)?;
            let role: String = row.get(4)?;
            Ok((row.get(0)?, row.get(1)?, hash, row.get(3)?, role))
        })?;
        let mut tokens = Vec::new();
        for row in rows {
            let (id, name, hash, created_at, role) = row?;
            // The table's check keeps every hash 32 bytes long.
            let hash: [u8; 32] = hash
                .try_into()
                .map_err(|_| StoreError::NotFound("token's hash"))?;
            let role = TokenRole::parse(&role).ok_or(StoreError::NotFound("token's role"))?;
            tokens.push(TokenRow {
                id,
                name,
                hash,
                created_at,
                role,
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
            "INSERT INTO token (id, name, hash, created_at, role) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                token.id,
                token.name,
                token.hash.as_slice(),
                token.created_at,
                token.role.as_str(),
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

    /// Deletes the token `id` directly by primary key, returning whether a row
    /// was removed (`false` if already absent).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn delete_token_by_id(&mut self, id: &str) -> Result<bool, StoreError> {
        let deleted = self
            .connection
            .execute("DELETE FROM token WHERE id = ?1", [id])?;
        Ok(deleted > 0)
    }

    /// Reads the persistent 32-byte non-bearer instance identity proof key.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] if the key row is missing or malformed, or when
    /// the database refuses.
    pub fn proof_key(&self) -> Result<[u8; 32], StoreError> {
        let bytes: Vec<u8> = self
            .connection
            .query_row(
                "SELECT secret FROM instance_proof_key WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("instance_proof_key"))?;
        bytes
            .try_into()
            .map_err(|_| StoreError::NotFound("instance_proof_key"))
    }
}
