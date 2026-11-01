//! A deliberately breakable in-memory store for `suite_detects.rs`. With `Fault::None` it is a
//! correct backend (the suite passes against it); every other fault breaks one rule the suite
//! exists to catch.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use umbel_store::conformance::Stores;
use umbel_store::{
    AccessSet, Change, ChangeKind, ContentHash, Direction, DocGraph, DocMeta, Document,
    DocumentStore, DocumentWrite, Edge, EdgeKey, Envelope, Expect, GraphBatch, GraphStore,
    ListQuery, Node, Page, ReaderFilter, Record, RecordMeta, Rev, StoreError, Subgraph,
    canonical_json, check_identifier, check_record, record_target,
};

/// What is broken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Fault {
    None,
    GetLeaksUnreadable,
    GetAnswersNotFoundForUnreadable,
    ListLeaksUnreadable,
    ListUnordered,
    RecordsLeak,
    ChangesLeak,
    ChangesIgnoreTrace,
    DeleteChangeVisibleToAll,
    RevisionGap,
    LostWrite,
    IgnoreExpect,
    SkipEnvelopeCheck,
    LowerApplied,
    ApplyNotAtomic,
    UnfilteredCoCitation,
    EdgeEndpointLeak,
    NodeLeak,
    SubgraphLeak,
    ReplaceKeepsOldEdges,
}

type RecordKey = (String, String, String);
type StoredRecord = (Rev, ContentHash, Value, Envelope);

#[derive(Default)]
struct State {
    docs: BTreeMap<String, (Rev, DocumentWrite)>,
    records: BTreeMap<RecordKey, StoredRecord>,
    changes: Vec<(Change, AccessSet)>,
    applied: Rev,
    nodes: BTreeMap<(String, String), (String, String)>,
    edges: BTreeMap<(String, String, String, String), u64>,
    writes: usize,
}

pub(crate) struct Fake {
    fault: Fault,
    state: Mutex<State>,
}

impl Fake {
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn next_rev(&self, state: &State) -> Rev {
        let head = state.changes.last().map_or(0, |(c, _)| c.rev);
        if self.fault == Fault::RevisionGap && state.writes % 3 == 2 {
            head + 2
        } else {
            head + 1
        }
    }

    fn check_expect(&self, expect: &Expect, current: Option<&str>) -> Result<(), StoreError> {
        let holds = self.fault == Fault::IgnoreExpect
            || match expect {
                Expect::Any => true,
                Expect::Absent => current.is_none(),
                Expect::Hash(h) => current == Some(h.as_str()),
            };
        if holds {
            Ok(())
        } else {
            Err(StoreError::Conflict {
                current: current.map(str::to_owned),
            })
        }
    }

    fn envelope_ok(&self, envelope: &Envelope) -> Result<(), StoreError> {
        if self.fault == Fault::SkipEnvelopeCheck {
            Ok(())
        } else {
            envelope.check("main").map(|_| ())
        }
    }
}

/// A factory whose stores survive reopening: one `Fake` per directory.
pub(crate) fn factory(fault: Fault) -> impl Fn(&Path, &str) -> Result<Stores, StoreError> {
    let registry: Mutex<BTreeMap<PathBuf, Arc<Fake>>> = Mutex::new(BTreeMap::new());
    move |dir, _space| {
        let mut registry = registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let fake = registry
            .entry(dir.to_owned())
            .or_insert_with(|| {
                Arc::new(Fake {
                    fault,
                    state: Mutex::new(State::default()),
                })
            })
            .clone();
        Ok(Stores {
            documents: fake.clone(),
            graph: fake,
            index: None,
        })
    }
}

impl DocumentStore for Fake {
    fn put_document(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta, StoreError> {
        if self.fault == Fault::SkipEnvelopeCheck {
            // Everything but the envelope's own rules.
            let mut sound = doc.clone();
            sound.envelope = umbel_store::conformance::samples::envelope(&["space"], "x", "x");
            sound.access = AccessSet::new(["space"])?;
            sound.envelope.access = sound.access.tokens().to_vec();
            sound.check("main").or_else(|e| {
                if doc.envelope.access.is_empty() {
                    Ok(())
                } else {
                    Err(e)
                }
            })?;
        } else {
            doc.check("main")?;
        }
        let mut state = self.lock();
        self.check_expect(
            &expect,
            state
                .docs
                .get(&doc.id)
                .map(|(_, d)| d.content_hash.as_str()),
        )?;
        let rev = self.next_rev(&state);
        state.writes += 1;
        if self.fault == Fault::LostWrite && state.writes % 11 == 10 {
            return Ok(doc.meta(rev));
        }
        state.changes.push((
            Change {
                rev,
                kind: ChangeKind::Put,
                target: doc.id.clone(),
                content_hash: Some(doc.content_hash.as_str().to_owned()),
                trace_id: doc.envelope.trace_id.clone(),
                at: doc.envelope.observed_at.clone(),
            },
            doc.access.clone(),
        ));
        let meta = doc.meta(rev);
        state.docs.insert(doc.id.clone(), (rev, doc));
        Ok(meta)
    }

    fn delete_document(
        &self,
        id: &str,
        expect: Expect,
        envelope: Envelope,
    ) -> Result<Rev, StoreError> {
        check_identifier("a document id", id)?;
        self.envelope_ok(&envelope)?;
        let mut state = self.lock();
        let Some((_, doc)) = state.docs.get(id).cloned() else {
            return Err(StoreError::NotFound);
        };
        self.check_expect(&expect, Some(doc.content_hash.as_str()))?;
        let rev = self.next_rev(&state);
        state.writes += 1;
        let access = if self.fault == Fault::DeleteChangeVisibleToAll {
            AccessSet::new(["space"])?
        } else {
            doc.access.clone()
        };
        state.changes.push((
            Change {
                rev,
                kind: ChangeKind::Delete,
                target: id.to_owned(),
                content_hash: Some(doc.content_hash.as_str().to_owned()),
                trace_id: envelope.trace_id.clone(),
                at: envelope.observed_at.clone(),
            },
            access,
        ));
        state.docs.remove(id);
        Ok(rev)
    }

    fn get_document(
        &self,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<Option<Document>, StoreError> {
        let state = self.lock();
        let Some((rev, doc)) = state.docs.get(id) else {
            return Ok(None);
        };
        if reader.admits(&doc.access) || self.fault == Fault::GetLeaksUnreadable {
            Ok(Some(Document {
                rev: *rev,
                write: doc.clone(),
            }))
        } else if self.fault == Fault::GetAnswersNotFoundForUnreadable {
            Err(StoreError::NotFound)
        } else {
            Ok(None)
        }
    }

    fn list_documents(
        &self,
        query: &ListQuery,
        reader: &ReaderFilter,
    ) -> Result<Page<DocMeta>, StoreError> {
        if !(1..=umbel_store::MAX_LIST_LIMIT).contains(&query.limit) {
            return Err(StoreError::invalid("limit"));
        }
        let state = self.lock();
        let mut items: Vec<DocMeta> = state
            .docs
            .values()
            .filter(|(_, d)| reader.admits(&d.access) || self.fault == Fault::ListLeaksUnreadable)
            .filter(|(_, d)| query.collection.as_ref().is_none_or(|c| &d.collection == c))
            .filter(|(_, d)| query.doc_type.as_ref().is_none_or(|t| &d.doc_type == t))
            .filter(|(_, d)| {
                query
                    .prefix
                    .as_ref()
                    .is_none_or(|p| d.id.starts_with(p.as_str()))
            })
            .filter(|(_, d)| {
                query
                    .after
                    .as_ref()
                    .is_none_or(|a| d.id.as_str() > a.as_str())
            })
            .map(|(rev, d)| d.meta(*rev))
            .collect();
        if self.fault == Fault::ListUnordered {
            items.reverse();
        }
        let next = if items.len() > query.limit as usize {
            items.truncate(query.limit as usize);
            items.last().map(|m| m.id.clone())
        } else {
            None
        };
        Ok(Page { items, next })
    }

    fn changes(
        &self,
        after: Rev,
        limit: u32,
        reader: &ReaderFilter,
        trace: Option<&str>,
    ) -> Result<Vec<Change>, StoreError> {
        if !(1..=umbel_store::MAX_CHANGES_LIMIT).contains(&limit) {
            return Err(StoreError::invalid("limit"));
        }
        let state = self.lock();
        Ok(state
            .changes
            .iter()
            .filter(|(c, _)| c.rev > after)
            .filter(|(c, _)| {
                self.fault == Fault::ChangesIgnoreTrace
                    || trace.is_none_or(|t| c.trace_id.as_deref() == Some(t))
            })
            .filter(|(_, a)| reader.admits(a) || self.fault == Fault::ChangesLeak)
            .take(limit as usize)
            .map(|(c, _)| c.clone())
            .collect())
    }

    fn head(&self) -> Result<Rev, StoreError> {
        Ok(self.lock().changes.last().map_or(0, |(c, _)| c.rev))
    }

    fn put_record(
        &self,
        ns: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta, StoreError> {
        let (hash, access) =
            if self.fault == Fault::SkipEnvelopeCheck && envelope.check("main").is_err() {
                let mut sound = envelope.clone();
                sound.origin = umbel_store::Origin::UserStated;
                sound.access = vec!["space".to_owned()];
                sound.sensitivity = Some(umbel_store::Sensitivity::Internal);
                check_record(ns, kind, id, &body, &sound, "main")?
            } else {
                check_record(ns, kind, id, &body, &envelope, "main")?
            };
        let mut state = self.lock();
        let key = (ns.to_owned(), kind.to_owned(), id.to_owned());
        self.check_expect(&expect, state.records.get(&key).map(|r| r.1.as_str()))?;
        let rev = self.next_rev(&state);
        state.writes += 1;
        state.changes.push((
            Change {
                rev,
                kind: ChangeKind::Record,
                target: record_target(ns, kind, id),
                content_hash: Some(hash.as_str().to_owned()),
                trace_id: envelope.trace_id.clone(),
                at: envelope.observed_at.clone(),
            },
            access,
        ));
        state.records.insert(
            key,
            (
                rev,
                hash.clone(),
                serde_json::from_str(&canonical_json(&body)).unwrap_or(body),
                envelope,
            ),
        );
        Ok(RecordMeta {
            ns: ns.to_owned(),
            kind: kind.to_owned(),
            id: id.to_owned(),
            rev,
            content_hash: hash,
        })
    }

    fn get_record(
        &self,
        ns: &str,
        kind: &str,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<Option<Record>, StoreError> {
        let state = self.lock();
        let key = (ns.to_owned(), kind.to_owned(), id.to_owned());
        Ok(state
            .records
            .get(&key)
            .filter(|r| self.record_visible(r, reader))
            .map(|r| to_record(&key, r)))
    }

    fn list_records(
        &self,
        ns: &str,
        kind: &str,
        after: Option<&str>,
        limit: u32,
        reader: &ReaderFilter,
    ) -> Result<Page<Record>, StoreError> {
        if !(1..=umbel_store::MAX_LIST_LIMIT).contains(&limit) {
            return Err(StoreError::invalid("limit"));
        }
        let state = self.lock();
        let mut items: Vec<Record> = state
            .records
            .iter()
            .filter(|(k, _)| k.0 == ns && k.1 == kind && after.is_none_or(|a| k.2.as_str() > a))
            .filter(|(_, r)| self.record_visible(r, reader))
            .map(|(k, r)| to_record(k, r))
            .collect();
        let next = if items.len() > limit as usize {
            items.truncate(limit as usize);
            items.last().map(|r| r.id.clone())
        } else {
            None
        };
        Ok(Page { items, next })
    }
}

impl Fake {
    fn record_visible(
        &self,
        record: &(Rev, ContentHash, Value, Envelope),
        reader: &ReaderFilter,
    ) -> bool {
        self.fault == Fault::RecordsLeak
            || AccessSet::new(record.3.access.iter().cloned()).is_ok_and(|a| reader.admits(&a))
    }
}

fn to_record(key: &RecordKey, r: &StoredRecord) -> Record {
    Record {
        ns: key.0.clone(),
        kind: key.1.clone(),
        id: key.2.clone(),
        rev: r.0,
        content_hash: r.1.clone(),
        body: r.2.clone(),
        envelope: r.3.clone(),
    }
}

impl Fake {
    fn origin_readable(state: &State, origin: &str, reader: &ReaderFilter) -> bool {
        state
            .docs
            .get(origin)
            .is_some_and(|(_, d)| reader.admits(&d.access))
    }

    fn node_readable(&self, state: &State, id: &str, reader: &ReaderFilter) -> bool {
        self.fault == Fault::EdgeEndpointLeak
            || state
                .nodes
                .keys()
                .any(|(origin, n)| n == id && Self::origin_readable(state, origin, reader))
    }

    fn aggregate(
        &self,
        state: &State,
        reader: &ReaderFilter,
        keep: impl Fn(&str, &str, &str) -> bool,
    ) -> Vec<Edge> {
        let mut sums: BTreeMap<(String, String, String), (u64, bool)> = BTreeMap::new();
        for ((origin, from, to, kind), weight) in &state.edges {
            if !keep(from, to, kind) {
                continue;
            }
            let readable = Self::origin_readable(state, origin, reader);
            let leak_weight = self.fault == Fault::UnfilteredCoCitation && kind == "co_cited";
            if !readable && !leak_weight {
                continue;
            }
            let entry = sums
                .entry((from.clone(), to.clone(), kind.clone()))
                .or_insert((0, false));
            entry.0 += weight;
            entry.1 |= readable;
        }
        sums.into_iter()
            .filter(|((from, to, _), (_, any_readable))| {
                (*any_readable || self.fault != Fault::UnfilteredCoCitation)
                    && self.node_readable(state, from, reader)
                    && self.node_readable(state, to, reader)
            })
            .map(|((from, to, kind), (weight, _))| Edge {
                from,
                to,
                kind,
                weight,
            })
            .collect()
    }
}

impl GraphStore for Fake {
    fn apply(&self, batch: GraphBatch, applied: Rev) -> Result<(), StoreError> {
        batch.check()?;
        let mut state = self.lock();
        let head = state.changes.last().map_or(0, |(c, _)| c.rev);
        if applied < state.applied && self.fault != Fault::LowerApplied {
            return Err(StoreError::Conflict {
                current: Some(state.applied.to_string()),
            });
        }
        if applied > head {
            return Err(StoreError::invalid("applied past head"));
        }
        let mut seen = BTreeSet::new();
        let staged = if self.fault == Fault::ApplyNotAtomic {
            None
        } else {
            Some(state.nodes.clone())
        };
        let staged_edges = state.edges.clone();
        for (doc, contribution) in &batch.entries {
            if !seen.insert(doc.clone()) {
                restore(&mut state, staged, staged_edges);
                return Err(StoreError::invalid("twice"));
            }
            if contribution.is_some() && !state.docs.contains_key(doc) {
                restore(&mut state, staged, staged_edges);
                return Err(StoreError::invalid("not stored"));
            }
            let replaced = self.fault != Fault::ReplaceKeepsOldEdges;
            state.nodes.retain(|(o, _), _| o != doc);
            if replaced {
                state.edges.retain(|(o, ..), _| o != doc);
            }
            if let Some(DocGraph { nodes, edges }) = contribution {
                for Node { id, kind, label } in nodes {
                    state
                        .nodes
                        .insert((doc.clone(), id.clone()), (kind.clone(), label.clone()));
                }
                for Edge {
                    from,
                    to,
                    kind,
                    weight,
                } in edges
                {
                    state.edges.insert(
                        (doc.clone(), from.clone(), to.clone(), kind.clone()),
                        *weight,
                    );
                }
            }
        }
        state.applied = state.applied.max(applied);
        if self.fault == Fault::LowerApplied {
            state.applied = applied;
        }
        Ok(())
    }

    fn clear(&self, applied: Rev) -> Result<(), StoreError> {
        let mut state = self.lock();
        if applied < state.applied {
            return Err(StoreError::Conflict {
                current: Some(state.applied.to_string()),
            });
        }
        state.nodes.clear();
        state.edges.clear();
        state.applied = applied;
        Ok(())
    }

    fn applied(&self) -> Result<Rev, StoreError> {
        Ok(self.lock().applied)
    }

    fn neighbors(
        &self,
        node: &str,
        kinds: &[String],
        direction: Direction,
        limit: u32,
        reader: &ReaderFilter,
    ) -> Result<Vec<Edge>, StoreError> {
        if limit == 0 {
            return Err(StoreError::invalid("limit"));
        }
        let state = self.lock();
        let mut edges = self.aggregate(&state, reader, |from, to, kind| {
            (kinds.is_empty() || kinds.iter().any(|k| k == kind))
                && match direction {
                    Direction::Out => from == node,
                    Direction::In => to == node,
                    Direction::Both => from == node || to == node,
                }
        });
        edges.truncate(limit as usize);
        Ok(edges)
    }

    fn nodes(&self, ids: &[String], reader: &ReaderFilter) -> Result<Vec<Node>, StoreError> {
        if ids.len() > umbel_store::MAX_NODE_LOOKUP {
            return Err(StoreError::invalid("too many"));
        }
        let state = self.lock();
        Ok(self.collect_nodes(
            &state,
            reader,
            |id| ids.iter().any(|i| i == id),
            self.fault == Fault::NodeLeak,
        ))
    }

    fn edges_of_kind(
        &self,
        kind: &str,
        limit: u32,
        after: Option<&EdgeKey>,
        reader: &ReaderFilter,
    ) -> Result<Vec<Edge>, StoreError> {
        if limit == 0 {
            return Err(StoreError::invalid("limit"));
        }
        let state = self.lock();
        let mut edges = self.aggregate(&state, reader, |_, _, k| k == kind);
        edges.retain(|e| {
            after
                .is_none_or(|a| (e.from.as_str(), e.to.as_str()) > (a.from.as_str(), a.to.as_str()))
        });
        edges.truncate(limit as usize);
        Ok(edges)
    }

    fn subgraph(&self, reader: &ReaderFilter) -> Result<Subgraph, StoreError> {
        let state = self.lock();
        Ok(Subgraph {
            nodes: self.collect_nodes(&state, reader, |_| true, self.fault == Fault::SubgraphLeak),
            edges: self.aggregate(&state, reader, |_, _, _| true),
        })
    }
}

impl Fake {
    fn collect_nodes(
        &self,
        state: &State,
        reader: &ReaderFilter,
        wanted: impl Fn(&str) -> bool,
        leak: bool,
    ) -> Vec<Node> {
        let mut nodes: BTreeMap<String, (String, String)> = BTreeMap::new();
        for ((origin, id), (kind, label)) in &state.nodes {
            if !wanted(id) || !(leak || Self::origin_readable(state, origin, reader)) {
                continue;
            }
            let entry = nodes
                .entry(id.clone())
                .or_insert((kind.clone(), label.clone()));
            if label < &entry.1 {
                entry.1 = label.clone();
            }
        }
        nodes
            .into_iter()
            .map(|(id, (kind, label))| Node { id, kind, label })
            .collect()
    }
}

fn restore(
    state: &mut State,
    nodes: Option<BTreeMap<(String, String), (String, String)>>,
    edges: BTreeMap<(String, String, String, String), u64>,
) {
    if let Some(nodes) = nodes {
        state.nodes = nodes;
        state.edges = edges;
    }
}
