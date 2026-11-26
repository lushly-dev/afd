//! The keys each later manifest version adds: known from that version on, and named and refused
//! before it, saying which version.

use super::Tbl;
use crate::plugins::error::PluginError;

/// The top-level keys each manifest version after 1 adds, with the reason an earlier one refuses
/// them.
pub(super) const TOP_KEYS: &[(u32, &[(&str, &str)])] =
    &[(6, super::v6::TOP_KEYS_V6), (7, super::v7::TOP_KEYS_V7)];

impl Tbl<'_> {
    /// [`check_keys`](Self::check_keys) with the keys each later manifest version adds: known from
    /// that version on, and named and refused before it, saying which version.
    pub(super) fn check_versioned_keys(
        &self,
        known: &[&str],
        reserved: &[(&str, &str)],
        versioned: &[(u32, &[(&str, &str)])],
    ) -> Result<(), PluginError> {
        let mut known = known.to_vec();
        let mut reserved = reserved.to_vec();
        for (version, keys) in versioned {
            if self.manifest_version >= *version {
                known.extend(keys.iter().map(|(name, _)| *name));
            } else {
                reserved.extend_from_slice(keys);
            }
        }
        self.check_keys(&known, &reserved)
    }
}
