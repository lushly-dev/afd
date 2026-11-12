//! `lane_status`: what the store holds for one declared kind (records host specification,
//! sections 11.1 and 12.3). Counts and the stored declaration, never a record.

use std::collections::BTreeMap;

use rusqlite::params;
use umbel_store::StoreError;
use umbel_store::lane::{LaneStatus, RecordDecl};

use super::{kind_row, lane_state};
use crate::SqliteStore;
use crate::error::{Fail, to_u64};

impl SqliteStore {
    pub(crate) fn lane_state_of(
        &self,
        ns: &str,
        decl: &RecordDecl,
    ) -> Result<LaneStatus, StoreError> {
        let kind = decl.kind.as_str();
        self.pool().with(|conn| {
            // One snapshot for every count.
            let tx = conn.transaction()?;
            let count = |sql: &str| -> Result<u64, Fail> {
                let found: i64 = tx.query_row(sql, params![ns, kind], |row| row.get(0))?;
                Ok(to_u64(found)?)
            };
            let state = lane_state(&tx, ns, decl)?;
            let stored = kind_row(&tx, ns, kind)?.map(|row| row.decl);
            let records = count("SELECT COUNT(*) FROM records WHERE ns = ?1 AND kind = ?2")?;
            let unindexed = count(
                "SELECT COUNT(*) FROM records r WHERE r.ns = ?1 AND r.kind = ?2 AND NOT EXISTS
                   (SELECT 1 FROM record_lane l WHERE l.ns = r.ns AND l.kind = r.kind AND l.id = r.id)",
            )?;
            let affirmed = count(
                "SELECT COUNT(*) FROM record_lane WHERE ns = ?1 AND kind = ?2 AND affirmed_seq IS NOT NULL",
            )?;
            let evidence = count(
                "SELECT COUNT(*) FROM record_evidence e JOIN record_lane l ON l.lane = e.lane
                 WHERE l.ns = ?1 AND l.kind = ?2",
            )?;
            let with_match = count(
                "SELECT COUNT(*) FROM record_lane WHERE ns = ?1 AND kind = ?2 AND match_digest IS NOT NULL",
            )?;
            let mut vectors = BTreeMap::new();
            {
                let mut statement = tx.prepare(
                    "SELECT v.model, COUNT(*) FROM record_vectors v JOIN record_lane l ON l.lane = v.lane
                     WHERE l.ns = ?1 AND l.kind = ?2 GROUP BY v.model",
                )?;
                let mut rows = statement.query(params![ns, kind])?;
                while let Some(row) = rows.next()? {
                    vectors.insert(row.get::<_, String>(0)?, to_u64(row.get(1)?)?);
                }
            }
            Ok(LaneStatus {
                state,
                stored,
                affirmed,
                evidence,
                records,
                unindexed,
                with_match,
                vectors,
            })
        })
    }
}
