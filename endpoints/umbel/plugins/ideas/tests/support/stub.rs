//! A stub of the host's services for calling the plugin's handler directly, where a host cannot
//! be made to fail on purpose: records kept in memory, finds by kind and key, every wording a
//! seed, and a match that answers what the test says. It is not the host: the integration tests
//! run against the real one, and this only shows how the plugin answers a host refusal.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use umbel_sdk::umbel_store::lane::{
    Decision, FindPage, LaneRecord, MatchPage, RecordFind, RecordMatch, Standing, StandingLabel,
};
use umbel_sdk::umbel_store::{ContentHash, Envelope, Expect, Record, RecordMeta};
use umbel_sdk::{CallContext, Cx, HostError, HostServices, Level, PersonDecision, Plugin};

/// What the stub holds and answers.
#[derive(Default)]
pub struct State {
    /// `(kind, id)` to body.
    pub records: BTreeMap<(String, String), Value>,
    /// The error `record_match` answers.
    pub match_error: Option<HostError>,
    /// Every log line.
    pub logs: Vec<String>,
    /// Draws so far.
    pub draws: u64,
    /// The wordings that read affirmed.
    pub affirmed: BTreeSet<String>,
    /// Every `record_decide` the plugin made, in order: the wording's id and the decision.
    pub decides: Vec<(String, Decision)>,
    /// Run inside each `record_decide`, to change the store in the middle of a call.
    pub on_decide: Option<fn(&mut State)>,
}

#[derive(Clone, Default)]
pub struct Stub {
    pub state: Arc<Mutex<State>>,
}

fn lane(kind: &str, id: &str, body: &Value, affirmed: bool) -> LaneRecord {
    let envelope = Envelope::from_value(serde_json::json!({
        "version": 1, "origin": "agent-inferred", "space": "main", "plugin": "ideas",
        "agent": null, "principal": "human:ada", "session": null, "traceId": "t",
        "observedAt": "2026-01-01T00:00:00.000Z", "validFrom": null, "validUntil": null,
        "confidence": null, "authority": null, "sources": null, "generated": null,
        "contentHash": null, "derivedFrom": null, "access": ["space"],
        "sensitivity": "internal"
    }))
    .unwrap();
    LaneRecord {
        record: Record {
            ns: "ideas".to_owned(),
            kind: kind.to_owned(),
            id: id.to_owned(),
            rev: 1,
            content_hash: ContentHash::of(body.to_string().as_bytes()),
            body: body.clone(),
            envelope,
        },
        created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        flags: Vec::new(),
        label: (kind == "wording").then_some(StandingLabel {
            standing: if affirmed {
                Standing::Affirmed
            } else {
                Standing::Unverified
            },
            affirmed: None,
            source: None,
        }),
    }
}

impl HostServices for Stub {
    fn config(&self) -> Result<Value, HostError> {
        Ok(Value::Null)
    }

    fn log(&self, _level: Level, message: &str) {
        self.state.lock().unwrap().logs.push(message.to_owned());
    }

    fn pack_list(&self, _pack: &str) -> Result<Vec<String>, HostError> {
        Ok(Vec::new())
    }

    fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError> {
        let file = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("packs")
            .join(pack)
            .join(path);
        std::fs::read(file).map_err(|error| HostError::NotFound(error.to_string()))
    }

    fn events(
        &self,
        _space: Option<&str>,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Value, HostError> {
        Ok(Value::Null)
    }

    fn now_ms(&self) -> Result<i64, HostError> {
        Ok(super::NOW)
    }

    fn random(&self) -> Result<f64, HostError> {
        let mut state = self.state.lock().unwrap();
        state.draws += 1;
        Ok((state.draws as f64 * 0.618_033_988_75) % 1.0)
    }

    fn record_put(
        &self,
        _space: &str,
        kind: &str,
        id: &str,
        body: Value,
        _envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta, HostError> {
        let mut state = self.state.lock().unwrap();
        let key = (kind.to_owned(), id.to_owned());
        match &expect {
            Expect::Absent if state.records.contains_key(&key) => {
                return Err(HostError::Conflict { current: None });
            }
            Expect::Hash(hash)
                if state
                    .records
                    .get(&key)
                    .is_none_or(|body| ContentHash::of(body.to_string().as_bytes()) != *hash) =>
            {
                return Err(HostError::Conflict { current: None });
            }
            _ => {}
        }
        let hash = ContentHash::of(body.to_string().as_bytes());
        state.records.insert(key, body);
        Ok(RecordMeta {
            ns: "ideas".to_owned(),
            kind: kind.to_owned(),
            id: id.to_owned(),
            rev: 1,
            content_hash: hash,
        })
    }

    fn record_read(
        &self,
        _space: &str,
        kind: &str,
        id: &str,
        _standings: &[Standing],
        _verified_only: bool,
    ) -> Result<Option<LaneRecord>, HostError> {
        let state = self.state.lock().unwrap();
        Ok(state
            .records
            .get(&(kind.to_owned(), id.to_owned()))
            .map(|body| lane(kind, id, body, state.affirmed.contains(id))))
    }

    fn record_find(&self, _space: &str, query: &RecordFind) -> Result<FindPage, HostError> {
        let state = self.state.lock().unwrap();
        let passes = |body: &Value| {
            query.keys.iter().all(|filter| {
                let value = body.pointer(filter.key.as_str());
                match value {
                    Some(Value::String(text)) => filter.any.contains(text),
                    Some(Value::Array(items)) => items.iter().any(|item| {
                        item.as_str()
                            .is_some_and(|text| filter.any.contains(&text.to_owned()))
                    }),
                    _ => false,
                }
            }) && (query.standings.is_empty() || query.standings.contains(&Standing::Unverified))
        };
        let items: Vec<LaneRecord> = state
            .records
            .iter()
            .filter(|((kind, _), body)| *kind == query.kind && passes(body))
            .map(|((kind, id), body)| lane(kind, id, body, state.affirmed.contains(id)))
            .collect();
        let total = items.len() as u64;
        // In id order, from after the cursor, which is the last id of the page before.
        let rest: Vec<LaneRecord> = items
            .into_iter()
            .filter(|item| {
                query
                    .after
                    .as_deref()
                    .is_none_or(|after| item.record.id.as_str() > after)
            })
            .collect();
        let more = rest.len() > query.limit as usize;
        let page: Vec<LaneRecord> = rest.into_iter().take(query.limit as usize).collect();
        let next = more
            .then(|| page.last().map(|item| item.record.id.clone()))
            .flatten();
        Ok(FindPage {
            items: page,
            next,
            total: query.total.then_some(total),
            admitted: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
            cut: false,
        })
    }

    fn record_decide(
        &self,
        _space: &str,
        kind: &str,
        id: &str,
        decision: Decision,
    ) -> Result<StandingLabel, HostError> {
        let mut state = self.state.lock().unwrap();
        if !state
            .records
            .contains_key(&(kind.to_owned(), id.to_owned()))
        {
            return Err(HostError::NotFound(id.to_owned()));
        }
        state.decides.push((id.to_owned(), decision));
        if let Some(hook) = state.on_decide {
            hook(&mut state);
        }
        let standing = match decision {
            Decision::Affirm => {
                state.affirmed.insert(id.to_owned());
                Standing::Affirmed
            }
            Decision::Withdraw => {
                state.affirmed.remove(id);
                Standing::Unverified
            }
        };
        Ok(StandingLabel {
            standing,
            affirmed: None,
            source: None,
        })
    }

    fn record_match(&self, _space: &str, _query: &RecordMatch) -> Result<MatchPage, HostError> {
        let state = self.state.lock().unwrap();
        Err(state
            .match_error
            .clone()
            .unwrap_or_else(|| HostError::Io("no match in the stub".to_owned())))
    }
}

impl Stub {
    /// Call `command` of the plugin with `input`, as an agent acting for `ada` in `main`.
    pub fn call(&self, command: &str, input: Value) -> Value {
        let call = CallContext {
            command: command.to_owned(),
            trace_id: "t".to_owned(),
            space: Some("main".to_owned()),
            spaces: vec!["main".to_owned()],
            actor_kind: "agent".to_owned(),
            actor_id: Some("gardener-bot".to_owned()),
            on_behalf_of: Some("ada".to_owned()),
            interface: "mcp".to_owned(),
            ..CallContext::default()
        };
        self.run(call, input)
    }

    /// Call `command` as the space's person at a terminal: the host counts the caller a person.
    pub fn person(&self, command: &str, input: Value) -> Value {
        self.run(self.person_context(command), input)
    }

    /// Call `command` as the space's person deciding on the page at `level`, pulling `excluded`
    /// out.
    pub fn page(&self, command: &str, input: Value, level: &str, excluded: &[&str]) -> Value {
        let mut call = self.person_context(command);
        call.person = false;
        call.interface = "mcp".to_owned();
        call.person_decision = Some(PersonDecision {
            surface: "mcp".to_owned(),
            person: "local/ada".to_owned(),
            namespace: String::new(),
            auth_time: String::new(),
            acr: String::new(),
            level: level.to_owned(),
            excluded: excluded.iter().map(|id| (*id).to_owned()).collect(),
        });
        self.run(call, input)
    }

    /// Call `command` as the person page renders page `page` of a preview: the stdio caller
    /// acting for `ada`, with `CallContext.preview_page` set.
    pub fn paged(&self, command: &str, input: Value, page: u32) -> Value {
        let call = CallContext {
            command: command.to_owned(),
            trace_id: "t".to_owned(),
            space: Some("main".to_owned()),
            spaces: vec!["main".to_owned()],
            actor_kind: "agent".to_owned(),
            actor_id: Some("gardener-bot".to_owned()),
            on_behalf_of: Some("ada".to_owned()),
            preview_page: Some(page),
            ..CallContext::default()
        };
        self.run(call, input)
    }

    fn person_context(&self, command: &str) -> CallContext {
        CallContext {
            command: command.to_owned(),
            trace_id: "t".to_owned(),
            space: Some("main".to_owned()),
            spaces: vec!["main".to_owned()],
            actor_kind: "human".to_owned(),
            actor_id: Some("ada".to_owned()),
            on_behalf_of: Some("ada".to_owned()),
            interface: "cli".to_owned(),
            person: true,
            ..CallContext::default()
        }
    }

    fn run(&self, call: CallContext, input: Value) -> Value {
        let command = call.command.clone();
        let mut cx = Cx::new(call, self.clone());
        umbel_plugin_ideas::plugin()
            .handle(&command, input, &mut cx)
            .into_value()
    }

    /// The decisions recorded so far, as `(wording id, "affirm" | "withdraw")`.
    pub fn decided(&self) -> Vec<(String, &'static str)> {
        self.state
            .lock()
            .unwrap()
            .decides
            .iter()
            .map(|(id, decision)| {
                let name = match decision {
                    Decision::Affirm => "affirm",
                    Decision::Withdraw => "withdraw",
                };
                (id.clone(), name)
            })
            .collect()
    }

    /// A record's body.
    pub fn body(&self, kind: &str, id: &str) -> Option<Value> {
        self.state
            .lock()
            .unwrap()
            .records
            .get(&(kind.to_owned(), id.to_owned()))
            .cloned()
    }
}
