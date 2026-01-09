# Part 3: Service Abstraction Layer

> **Goal**: Create a clean interface between local and cloud services so the same AFD commands work identically whether running on a user's laptop, in a Docker container, on Cloudflare Workers, or in a mobile app.

## The Problem

AFD commands need to interact with external services:
- **Database** - Store and retrieve data
- **Storage** - Files, blobs, assets
- **Cache** - Fast key-value lookups
- **Queue** - Async job processing
- **Auth** - User identity

Without abstraction, you end up with:
```rust
// ❌ Tightly coupled - only works on Cloudflare
async fn create_item(env: &Env, input: CreateInput) -> CommandResult<Item> {
    let db = env.d1("MY_DB")?;  // Cloudflare-specific
    // ...
}
```

With abstraction:
```rust
// ✅ Works anywhere - local, cloud, mobile
async fn create_item(ctx: &AppContext, input: CreateInput) -> CommandResult<Item> {
    let db = ctx.database();  // Returns trait object
    // ...
}
```

## Architecture: Ports & Adapters

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AFD Commands (Business Logic)                   │
│                                                                         │
│   create_item()    get_item()    list_items()    delete_item()         │
│         │              │              │               │                 │
└─────────┼──────────────┼──────────────┼───────────────┼─────────────────┘
          │              │              │               │
          ▼              ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              PORTS (Traits)                             │
│                                                                         │
│   Database        Storage         Cache           Queue        Auth     │
│   trait           trait           trait           trait        trait    │
└─────────┬──────────────┬──────────────┬───────────────┬─────────────────┘
          │              │              │               │
    ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
    ▼           ▼  ▼           ▼  ▼           ▼  ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ SQLite │ │  D1    │ │ Files  │ │  R2    │ │ Memory │ │   KV   │
│ Local  │ │ Cloud  │ │ Local  │ │ Cloud  │ │ Local  │ │ Cloud  │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘

           ADAPTERS (Implementations)
```

## Service Traits (Ports)

### Database Port

```rust
// src/services/database.rs
use async_trait::async_trait;
use serde::{de::DeserializeOwned, Serialize};

/// Database operations port.
/// Implementations: SQLite (local), D1 (Cloudflare), Postgres (cloud)
#[async_trait]
pub trait Database: Send + Sync {
    /// Execute a query returning multiple rows
    async fn query<T: DeserializeOwned + Send>(
        &self,
        sql: &str,
        params: &[Value],
    ) -> Result<Vec<T>, DatabaseError>;
    
    /// Execute a query returning a single row
    async fn query_one<T: DeserializeOwned + Send>(
        &self,
        sql: &str,
        params: &[Value],
    ) -> Result<Option<T>, DatabaseError>;
    
    /// Execute a mutation (INSERT, UPDATE, DELETE)
    async fn execute(
        &self,
        sql: &str,
        params: &[Value],
    ) -> Result<ExecuteResult, DatabaseError>;
    
    /// Run migrations
    async fn migrate(&self, migrations: &[Migration]) -> Result<(), DatabaseError>;
    
    /// Begin a transaction
    async fn transaction<F, T>(&self, f: F) -> Result<T, DatabaseError>
    where
        F: FnOnce(&dyn Database) -> BoxFuture<'_, Result<T, DatabaseError>> + Send;
}

#[derive(Debug)]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<i64>,
}
```

### Storage Port

```rust
// src/services/storage.rs
use async_trait::async_trait;
use bytes::Bytes;

/// Object storage port.
/// Implementations: Filesystem (local), R2 (Cloudflare), S3 (AWS)
#[async_trait]
pub trait Storage: Send + Sync {
    /// Store an object
    async fn put(&self, key: &str, data: Bytes, opts: PutOptions) -> Result<(), StorageError>;
    
    /// Retrieve an object
    async fn get(&self, key: &str) -> Result<Option<Bytes>, StorageError>;
    
    /// Delete an object
    async fn delete(&self, key: &str) -> Result<(), StorageError>;
    
    /// List objects with prefix
    async fn list(&self, prefix: &str) -> Result<Vec<ObjectInfo>, StorageError>;
    
    /// Check if object exists
    async fn exists(&self, key: &str) -> Result<bool, StorageError>;
    
    /// Get a presigned URL for direct access
    async fn presign(&self, key: &str, expires: Duration) -> Result<String, StorageError>;
}

#[derive(Default)]
pub struct PutOptions {
    pub content_type: Option<String>,
    pub cache_control: Option<String>,
    pub metadata: HashMap<String, String>,
}
```

### Cache Port

```rust
// src/services/cache.rs
use async_trait::async_trait;
use serde::{de::DeserializeOwned, Serialize};

/// Key-value cache port.
/// Implementations: HashMap (local), KV (Cloudflare), Redis (cloud)
#[async_trait]
pub trait Cache: Send + Sync {
    /// Get a value
    async fn get<T: DeserializeOwned + Send>(&self, key: &str) -> Result<Option<T>, CacheError>;
    
    /// Set a value with optional TTL
    async fn set<T: Serialize + Send + Sync>(
        &self,
        key: &str,
        value: &T,
        ttl: Option<Duration>,
    ) -> Result<(), CacheError>;
    
    /// Delete a value
    async fn delete(&self, key: &str) -> Result<(), CacheError>;
    
    /// Check if key exists
    async fn exists(&self, key: &str) -> Result<bool, CacheError>;
    
    /// Atomic increment
    async fn incr(&self, key: &str, delta: i64) -> Result<i64, CacheError>;
}
```

### Queue Port

```rust
// src/services/queue.rs
use async_trait::async_trait;
use serde::{de::DeserializeOwned, Serialize};

/// Message queue port.
/// Implementations: Channel (local), Queue (Cloudflare), SQS (AWS)
#[async_trait]
pub trait Queue: Send + Sync {
    /// Send a message to the queue
    async fn send<T: Serialize + Send + Sync>(
        &self,
        message: &T,
        opts: SendOptions,
    ) -> Result<MessageId, QueueError>;
    
    /// Receive messages (for consumers)
    async fn receive<T: DeserializeOwned + Send>(
        &self,
        max: usize,
    ) -> Result<Vec<Message<T>>, QueueError>;
    
    /// Acknowledge message processing
    async fn ack(&self, id: &MessageId) -> Result<(), QueueError>;
    
    /// Return message to queue (for retry)
    async fn nack(&self, id: &MessageId) -> Result<(), QueueError>;
}
```

### Auth Port

```rust
// src/services/auth.rs
use async_trait::async_trait;

/// Authentication port.
/// Implementations: None (local), JWT (cloud), OAuth (cloud)
#[async_trait]
pub trait Auth: Send + Sync {
    /// Validate a token and return user info
    async fn validate(&self, token: &str) -> Result<Option<User>, AuthError>;
    
    /// Get current user from context
    fn current_user(&self) -> Option<&User>;
    
    /// Check if user has permission
    fn has_permission(&self, permission: &str) -> bool;
}

#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub roles: Vec<String>,
    pub metadata: HashMap<String, Value>,
}
```

## Application Context

All services are bundled into an `AppContext` that commands receive:

```rust
// src/context.rs
use std::sync::Arc;

/// Application context passed to all commands.
/// Contains service adapters configured for the current environment.
pub struct AppContext {
    database: Arc<dyn Database>,
    storage: Arc<dyn Storage>,
    cache: Arc<dyn Cache>,
    queue: Arc<dyn Queue>,
    auth: Arc<dyn Auth>,
    config: AppConfig,
}

impl AppContext {
    pub fn database(&self) -> &dyn Database { self.database.as_ref() }
    pub fn storage(&self) -> &dyn Storage { self.storage.as_ref() }
    pub fn cache(&self) -> &dyn Cache { self.cache.as_ref() }
    pub fn queue(&self) -> &dyn Queue { self.queue.as_ref() }
    pub fn auth(&self) -> &dyn Auth { self.auth.as_ref() }
    pub fn config(&self) -> &AppConfig { &self.config }
}
```

## Adapters (Implementations)

### Local Adapters

```rust
// src/adapters/local/mod.rs

pub mod database;  // SQLite via rusqlite or sqlx
pub mod storage;   // Filesystem
pub mod cache;     // HashMap with LRU eviction
pub mod queue;     // tokio::sync::mpsc channel
pub mod auth;      // Always authenticated (dev mode)

/// Build AppContext for local development
pub fn build_local_context(config: LocalConfig) -> AppContext {
    AppContext {
        database: Arc::new(SqliteDatabase::new(&config.db_path)),
        storage: Arc::new(FilesystemStorage::new(&config.storage_path)),
        cache: Arc::new(MemoryCache::new(config.cache_size)),
        queue: Arc::new(ChannelQueue::new()),
        auth: Arc::new(DevAuth::new()),  // Always returns test user
        config: config.into(),
    }
}
```

### Cloudflare Adapters

```rust
// src/adapters/cloudflare/mod.rs

pub mod database;  // D1
pub mod storage;   // R2
pub mod cache;     // KV
pub mod queue;     // Queues
pub mod auth;      // Access/JWT

/// Build AppContext from Cloudflare Worker environment
pub fn build_cloudflare_context(env: &worker::Env) -> AppContext {
    AppContext {
        database: Arc::new(D1Database::new(env.d1("DB").unwrap())),
        storage: Arc::new(R2Storage::new(env.bucket("STORAGE").unwrap())),
        cache: Arc::new(KvCache::new(env.kv("CACHE").unwrap())),
        queue: Arc::new(CfQueue::new(env.queue("QUEUE").unwrap())),
        auth: Arc::new(AccessAuth::new(env)),
        config: AppConfig::from_env(env),
    }
}
```

### AWS/Generic Cloud Adapters

```rust
// src/adapters/aws/mod.rs

pub mod database;  // RDS PostgreSQL via sqlx
pub mod storage;   // S3 via aws-sdk-s3
pub mod cache;     // ElastiCache Redis
pub mod queue;     // SQS
pub mod auth;      // Cognito

/// Build AppContext for AWS deployment
pub async fn build_aws_context(config: AwsConfig) -> AppContext {
    AppContext {
        database: Arc::new(PostgresDatabase::connect(&config.db_url).await),
        storage: Arc::new(S3Storage::new(&config.bucket)),
        cache: Arc::new(RedisCache::connect(&config.redis_url).await),
        queue: Arc::new(SqsQueue::new(&config.queue_url)),
        auth: Arc::new(CognitoAuth::new(&config.user_pool_id)),
        config: config.into(),
    }
}
```

## Command Integration

Commands receive `AppContext` and use services through traits:

```rust
// src/commands/items/create.rs
use crate::{AppContext, CommandResult, success, failure};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct CreateItemInput {
    pub name: String,
    pub data: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct CreateItemOutput {
    pub id: String,
    pub name: String,
}

/// Create a new item.
/// Works identically on local SQLite, Cloudflare D1, or AWS RDS.
pub async fn create_item(
    ctx: &AppContext,
    input: CreateItemInput,
) -> CommandResult<CreateItemOutput> {
    let id = uuid::Uuid::new_v4().to_string();
    
    // Database insert - works on any adapter
    ctx.database()
        .execute(
            "INSERT INTO items (id, name) VALUES (?, ?)",
            &[id.clone().into(), input.name.clone().into()],
        )
        .await
        .map_err(|e| failure(CommandError::internal(&e.to_string())))?;
    
    // Optional: Store blob data
    if let Some(data) = input.data {
        ctx.storage()
            .put(&format!("items/{}/data", id), data.into(), Default::default())
            .await
            .map_err(|e| failure(CommandError::internal(&e.to_string())))?;
    }
    
    // Optional: Invalidate cache
    ctx.cache().delete("items:list").await.ok();
    
    success(CreateItemOutput { id, name: input.name })
}
```

## Configuration

Environment-based configuration determines which adapters to use:

```toml
# mint.toml

[services]
# Local development (default)
[services.local]
database = "sqlite:./data/app.db"
storage = "./data/files"
cache = "memory"
queue = "channel"

# Cloudflare Workers
[services.cloudflare]
database = "d1:MY_DB"
storage = "r2:MY_BUCKET"
cache = "kv:MY_KV"
queue = "queue:MY_QUEUE"

# AWS
[services.aws]
database = "postgres:${DATABASE_URL}"
storage = "s3:${S3_BUCKET}"
cache = "redis:${REDIS_URL}"
queue = "sqs:${SQS_QUEUE_URL}"
```

## Service Matrix

| Service | Local | Cloudflare | AWS | Supabase |
|---------|-------|------------|-----|----------|
| Database | SQLite | D1 | RDS Postgres | Postgres |
| Storage | Filesystem | R2 | S3 | Storage |
| Cache | Memory/LRU | KV | ElastiCache | - |
| Queue | Channel | Queues | SQS | - |
| Auth | Dev (always auth) | Access | Cognito | Auth |

## Migration Strategy

The service layer supports progressive migration:

```
Phase 1: Local Development
├─ All adapters = local
├─ Fast iteration
└─ No cloud costs

Phase 2: Cloud Backend, Local Frontend
├─ Database = cloud (D1/Postgres)
├─ Storage = cloud (R2/S3)
├─ Cache = local (for speed)
└─ Auth = cloud

Phase 3: Full Cloud
├─ All adapters = cloud
├─ Horizontal scaling
└─ Production ready

Phase 4: Hybrid (Advanced)
├─ Database = cloud (primary)
├─ Cache = local + cloud (write-through)
├─ Storage = cloud with local cache
└─ Edge deployment
```

## Implementation in Mint

The `mint` CLI handles service configuration:

```bash
# Initialize with local services (default)
mint new my-app

# Initialize for Cloudflare
mint new my-app --platform cloudflare

# Initialize for AWS
mint new my-app --platform aws

# Switch platforms later
mint config set platform cloudflare

# Run with specific service config
mint dev --services local     # All local
mint dev --services cloud     # All cloud
mint dev --services hybrid    # Mix (defined in mint.toml)
```

## Benefits

1. **Same Commands Everywhere**: Write once, run on laptop, phone, edge, or cloud
2. **Easy Testing**: Use local adapters in tests, no cloud dependencies
3. **Gradual Migration**: Start local, move to cloud service by service
4. **Vendor Flexibility**: Switch from Cloudflare to AWS by changing adapters
5. **Cost Control**: Local development is free, cloud only in production

---

## Additional Service Traits

### Telemetry Port (Observability)

```rust
// src/services/telemetry.rs
use async_trait::async_trait;
use std::collections::HashMap;

/// Telemetry port for logging, metrics, and tracing.
/// Implementations: Console (local), OpenTelemetry (cloud), Datadog, etc.
#[async_trait]
pub trait Telemetry: Send + Sync {
    /// Log a structured message
    fn log(&self, level: LogLevel, message: &str, fields: &HashMap<String, Value>);
    
    /// Record a metric
    fn metric(&self, name: &str, value: f64, tags: &HashMap<String, String>);
    
    /// Start a trace span
    fn span(&self, name: &str) -> Box<dyn Span>;
    
    /// Record an error (for error tracking services)
    fn error(&self, error: &dyn std::error::Error, context: &HashMap<String, Value>);
}

pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

pub trait Span: Send {
    fn set_attribute(&mut self, key: &str, value: Value);
    fn add_event(&mut self, name: &str, attributes: &HashMap<String, Value>);
    fn end(self: Box<Self>);
}
```

**Local Adapter:**
```rust
// Logs to stderr with structured JSON
pub struct ConsoleTelemetry {
    min_level: LogLevel,
}

impl Telemetry for ConsoleTelemetry {
    fn log(&self, level: LogLevel, message: &str, fields: &HashMap<String, Value>) {
        if level >= self.min_level {
            let entry = json!({
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "level": level.as_str(),
                "message": message,
                "fields": fields,
            });
            eprintln!("{}", serde_json::to_string(&entry).unwrap());
        }
    }
    // ...
}
```

**Cloud Adapter (OpenTelemetry):**
```rust
pub struct OtelTelemetry {
    tracer: opentelemetry::global::BoxedTracer,
    meter: opentelemetry::metrics::Meter,
    logger: opentelemetry::logs::Logger,
}
```

### Secrets Port (Credential Management)

```rust
// src/services/secrets.rs
use async_trait::async_trait;

/// Secrets management port.
/// Implementations: Env (local), Vault, AWS Secrets Manager, 1Password
#[async_trait]
pub trait Secrets: Send + Sync {
    /// Get a secret value
    async fn get(&self, key: &str) -> Result<Option<String>, SecretsError>;
    
    /// Get a secret, returning error if not found
    async fn require(&self, key: &str) -> Result<String, SecretsError> {
        self.get(key).await?.ok_or_else(|| SecretsError::NotFound(key.to_string()))
    }
    
    /// Set a secret (if supported)
    async fn set(&self, key: &str, value: &str) -> Result<(), SecretsError>;
    
    /// Delete a secret (if supported)
    async fn delete(&self, key: &str) -> Result<(), SecretsError>;
    
    /// List available secret keys (not values)
    async fn list(&self) -> Result<Vec<String>, SecretsError>;
}
```

**Local Adapter (Environment Variables):**
```rust
pub struct EnvSecrets {
    prefix: Option<String>,
}

#[async_trait]
impl Secrets for EnvSecrets {
    async fn get(&self, key: &str) -> Result<Option<String>, SecretsError> {
        let env_key = match &self.prefix {
            Some(p) => format!("{}_{}", p, key.to_uppercase()),
            None => key.to_uppercase(),
        };
        Ok(std::env::var(&env_key).ok())
    }
    // ...
}
```

### RateLimit Port (Request Throttling)

```rust
// src/services/rate_limit.rs
use async_trait::async_trait;
use std::time::Duration;

/// Rate limiting port.
/// Implementations: InMemory (local), Redis (cloud), Cloudflare Rate Limiting
#[async_trait]
pub trait RateLimit: Send + Sync {
    /// Check if request is allowed, consume one token if so
    async fn check(&self, key: &str, config: &RateLimitConfig) -> Result<RateLimitResult, RateLimitError>;
    
    /// Check without consuming (peek)
    async fn peek(&self, key: &str, config: &RateLimitConfig) -> Result<RateLimitResult, RateLimitError>;
    
    /// Reset limit for a key
    async fn reset(&self, key: &str) -> Result<(), RateLimitError>;
}

pub struct RateLimitConfig {
    /// Maximum requests allowed
    pub limit: u32,
    /// Time window
    pub window: Duration,
    /// Algorithm to use
    pub algorithm: RateLimitAlgorithm,
}

pub enum RateLimitAlgorithm {
    FixedWindow,
    SlidingWindow,
    TokenBucket { refill_rate: u32 },
}

pub struct RateLimitResult {
    pub allowed: bool,
    pub remaining: u32,
    pub reset_at: chrono::DateTime<chrono::Utc>,
    pub retry_after: Option<Duration>,
}
```

### Validation Helpers (Input Sanitization)

```rust
// src/services/validation.rs

/// Input validation utilities
pub struct Validator;

impl Validator {
    /// Sanitize string input (prevent XSS, SQL injection markers)
    pub fn sanitize_string(input: &str, max_length: usize) -> Result<String, ValidationError> {
        if input.len() > max_length {
            return Err(ValidationError::TooLong { max: max_length, actual: input.len() });
        }
        
        // Remove null bytes and control characters
        let sanitized: String = input
            .chars()
            .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
            .collect();
        
        Ok(sanitized)
    }
    
    /// Validate email format
    pub fn validate_email(input: &str) -> Result<String, ValidationError> {
        let email = input.trim().to_lowercase();
        if !email.contains('@') || !email.contains('.') {
            return Err(ValidationError::InvalidFormat("email"));
        }
        Ok(email)
    }
    
    /// Validate URL
    pub fn validate_url(input: &str) -> Result<url::Url, ValidationError> {
        url::Url::parse(input).map_err(|_| ValidationError::InvalidFormat("url"))
    }
}
```

### i18n Port (Internationalization)

```rust
// src/services/i18n.rs
use async_trait::async_trait;

/// Internationalization port.
/// Implementations: Static (local), ICU (full), Fluent
#[async_trait]
pub trait I18n: Send + Sync {
    /// Get current locale
    fn locale(&self) -> &str;
    
    /// Set locale for this context
    fn set_locale(&mut self, locale: &str) -> Result<(), I18nError>;
    
    /// Translate a message key
    fn t(&self, key: &str) -> String;
    
    /// Translate with parameters
    fn t_with(&self, key: &str, params: &HashMap<String, Value>) -> String;
    
    /// Format a number according to locale
    fn format_number(&self, value: f64) -> String;
    
    /// Format a date according to locale
    fn format_date(&self, date: &chrono::DateTime<chrono::Utc>, style: DateStyle) -> String;
    
    /// Format currency
    fn format_currency(&self, amount: f64, currency: &str) -> String;
}

pub enum DateStyle {
    Short,    // 1/1/25
    Medium,   // Jan 1, 2025
    Long,     // January 1, 2025
    Full,     // Wednesday, January 1, 2025
    Custom(&'static str),
}
```

**Usage in Commands:**
```rust
pub async fn list_items(ctx: &AppContext, input: ListInput) -> CommandResult<ListOutput> {
    let items = ctx.database().query("SELECT * FROM items", &[]).await?;
    
    // Log with telemetry
    ctx.telemetry().log(LogLevel::Info, "Listed items", &hashmap!{
        "count" => items.len().into(),
        "user_id" => ctx.auth().current_user().map(|u| u.id.clone()).into(),
    });
    
    // Format dates according to user's locale
    let formatted_items: Vec<_> = items.iter().map(|item| {
        FormattedItem {
            id: item.id.clone(),
            name: item.name.clone(),
            created_at: ctx.i18n().format_date(&item.created_at, DateStyle::Medium),
        }
    }).collect();
    
    success(ListOutput { items: formatted_items })
}
```

## Updated AppContext

```rust
pub struct AppContext {
    // Core services
    database: Arc<dyn Database>,
    storage: Arc<dyn Storage>,
    cache: Arc<dyn Cache>,
    queue: Arc<dyn Queue>,
    auth: Arc<dyn Auth>,
    
    // Additional services
    telemetry: Arc<dyn Telemetry>,
    secrets: Arc<dyn Secrets>,
    rate_limit: Arc<dyn RateLimit>,
    i18n: Arc<dyn I18n>,
    
    config: AppConfig,
}
```

## Updated Service Matrix

| Service | Local | Cloudflare | AWS |
|---------|-------|------------|-----|
| Database | SQLite | D1 | RDS Postgres |
| Storage | Filesystem | R2 | S3 |
| Cache | Memory/LRU | KV | ElastiCache |
| Queue | Channel | Queues | SQS |
| Auth | Dev (always auth) | Access | Cognito |
| **Telemetry** | Console/JSON | Workers Analytics | CloudWatch |
| **Secrets** | Env vars | Workers Secrets | Secrets Manager |
| **RateLimit** | In-memory | Rate Limiting | API Gateway |
| **I18n** | Static JSON | Static JSON | Static JSON |

---

## Implementation Phases

### Phase 3.1: Core Traits (Day 1)
- [ ] Define all port traits (Database, Storage, Cache, Queue, Auth)
- [ ] Create `AppContext` struct
- [ ] Error types for each service

### Phase 3.2: Local Adapters (Days 2-3)
- [ ] SQLite database adapter
- [ ] Filesystem storage adapter
- [ ] Memory cache adapter
- [ ] Channel queue adapter
- [ ] Dev auth adapter

### Phase 3.3: Cloudflare Adapters (Days 4-5)
- [ ] D1 database adapter
- [ ] R2 storage adapter
- [ ] KV cache adapter
- [ ] Queue adapter
- [ ] Access auth adapter

### Phase 3.4: AWS Adapters (Optional, Days 6-7)
- [ ] PostgreSQL database adapter
- [ ] S3 storage adapter
- [ ] Redis cache adapter
- [ ] SQS queue adapter
- [ ] Cognito auth adapter

### Phase 3.5: Mint Integration (Day 8)
- [ ] `mint.toml` service configuration
- [ ] Platform templates
- [ ] `mint config` command
- [ ] Documentation
