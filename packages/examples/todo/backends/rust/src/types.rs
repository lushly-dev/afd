//! Domain types, serialized in the shared wire format (`spec/commands.schema.json`):
//! camelCase keys, unset fields omitted, timestamps as ISO 8601 with milliseconds.

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize, Serializer};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    #[default]
    Medium,
    High,
}

impl Priority {
    /// Sort rank: high > medium > low.
    pub fn rank(self) -> u8 {
        match self {
            Priority::Low => 1,
            Priority::Medium => 2,
            Priority::High => 3,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Priority::Low => "low",
            Priority::Medium => "medium",
            Priority::High => "high",
        }
    }
}

fn iso_millis<S: Serializer>(value: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn optional_iso_millis<S: Serializer>(
    value: &Option<DateTime<Utc>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => iso_millis(value, serializer),
        None => serializer.serialize_none(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub priority: Priority,
    pub completed: bool,
    #[serde(serialize_with = "iso_millis")]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "iso_millis")]
    pub updated_at: DateTime<Utc>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "optional_iso_millis"
    )]
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoStats {
    pub total: usize,
    pub completed: usize,
    pub pending: usize,
    pub by_priority: PriorityStats,
    pub completion_rate: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct PriorityStats {
    pub low: usize,
    pub medium: usize,
    pub high: usize,
}

/// `sortBy` values of `todo-list`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortBy {
    #[default]
    CreatedAt,
    UpdatedAt,
    Priority,
    Title,
}

/// `sortOrder` values of `todo-list`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Asc,
    #[default]
    Desc,
}
