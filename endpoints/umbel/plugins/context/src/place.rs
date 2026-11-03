//! Placement under the byte budget and the omissions list (section 9.4, steps 1 to 5).

use serde_json::{Value, json};

use crate::select::Lane;
use crate::settings::Shares;

/// Bytes kept for `omissions` (step 1).
pub(crate) const OMISSIONS_RESERVE: u64 = 2048;
/// The most entries `omissions` holds (the bundle schema's `maxItems`).
const MAX_OMISSIONS: usize = 64;

/// What placement decided, per lane (in the selection's order): the indices of the items placed
/// and of those omitted for `budget`, each in rank order.
#[derive(Debug, Clone, Default)]
pub(crate) struct Placement {
    pub(crate) placed: Vec<Vec<usize>>,
    pub(crate) out: Vec<Vec<usize>>,
}

/// An item's cost: its canonical JSON with its text, and its source, as AFD measures them, each
/// with the comma that separates it from the next.
fn cost(lane: &Lane, index: usize) -> u64 {
    let item = &lane.items[index];
    let size = |value: &Value| serde_json::to_string(value).map_or(u64::MAX, |t| t.len() as u64);
    size(&item.json)
        .saturating_add(size(&item.source))
        .saturating_add(2)
}

impl Placement {
    /// How many items are placed in all.
    pub(crate) fn count(&self) -> usize {
        self.placed.iter().map(Vec::len).sum()
    }

    /// Move the last placed item (the last section's last) to the omissions, for `budget`.
    pub(crate) fn pop_last(&mut self) -> bool {
        for (placed, out) in self.placed.iter_mut().zip(&mut self.out).rev() {
            if let Some(index) = placed.pop() {
                out.push(index);
                out.sort_unstable();
                return true;
            }
        }
        false
    }
}

/// Steps 2 to 4: each running lane's share of `room`, items in rank order within it (one that
/// does not fit is set aside and the next still tried), unused bytes carried on, a second pass
/// over what was set aside, and at most `max_items` per section.
pub(crate) fn place(lanes: &[Lane], shares: &Shares, max_items: usize, room: u64) -> Placement {
    let running: Vec<bool> = lanes.iter().map(|lane| lane.gap.is_none()).collect();
    let total: f64 = lanes
        .iter()
        .zip(&running)
        .filter(|(_, run)| **run)
        .map(|(lane, _)| shares.of(lane.section))
        .sum();
    let count = running.iter().filter(|run| **run).count();
    let share = |lane: &Lane| -> u64 {
        // Shares of the sections not running are divided among the others in proportion.
        let part = if total > 0.0 {
            shares.of(lane.section) / total
        } else {
            1.0 / count.max(1) as f64
        };
        (room as f64 * part).floor() as u64
    };
    let mut placement = Placement {
        placed: vec![Vec::new(); lanes.len()],
        out: vec![Vec::new(); lanes.len()],
    };
    let mut aside: Vec<Vec<usize>> = vec![Vec::new(); lanes.len()];
    let mut carry = 0u64;
    for (n, lane) in lanes.iter().enumerate() {
        if !running[n] {
            continue;
        }
        let mut left = share(lane).saturating_add(carry);
        for index in 0..lane.items.len() {
            if lane.items[index].capped || placement.placed[n].len() >= max_items {
                placement.out[n].push(index);
                continue;
            }
            let price = cost(lane, index);
            if price <= left {
                left -= price;
                placement.placed[n].push(index);
            } else {
                aside[n].push(index);
            }
        }
        carry = left;
    }
    // The second pass: what remains, to the items set aside, in section and rank order.
    for (n, lane) in lanes.iter().enumerate() {
        for &index in &aside[n] {
            let price = cost(lane, index);
            if placement.placed[n].len() < max_items && price <= carry {
                carry -= price;
                placement.placed[n].push(index);
            } else {
                placement.out[n].push(index);
            }
        }
        placement.placed[n].sort_unstable();
        placement.out[n].sort_unstable();
    }
    placement
}

/// The omissions list and what it leaves out.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Omissions {
    pub(crate) list: Vec<Value>,
    /// Item-level omissions not listed.
    pub(crate) more: u64,
    /// Every item omitted for `budget`, listed or not.
    pub(crate) budget: u64,
    pub(crate) authority: u64,
    pub(crate) flagged: u64,
    pub(crate) unreadable: u64,
}

fn entries(lanes: &[Lane], placement: &Placement, keep: usize) -> Vec<Value> {
    let mut list = Vec::new();
    let mut listed = 0usize;
    for (n, lane) in lanes.iter().enumerate() {
        let name = lane.section.name();
        if let Some(gap) = lane.gap {
            list.push(json!({ "section": name, "reason": gap.reason() }));
        }
        for &index in &placement.out[n] {
            if listed < keep {
                list.push(
                    json!({ "section": name, "reason": "budget", "id": lane.items[index].id }),
                );
            }
            listed += 1;
        }
        for (reason, count) in [
            ("authority", lane.authority),
            ("flagged", lane.flagged),
            ("unreadable", lane.unreadable),
        ] {
            if count > 0 {
                list.push(json!({ "section": name, "reason": reason, "count": count }));
            }
        }
    }
    list
}

/// Step 5: section-level and count entries always, one per section and reason; item-level
/// `budget` entries in section and rank order up to the schema's 64 entries and `reserve`
/// bytes, the rest counted in `omittedMore`. Only what the caller can read is named or counted:
/// every id and count comes from a read under the caller's filter.
pub(crate) fn omissions(lanes: &[Lane], placement: &Placement, reserve: u64) -> Omissions {
    let budget: usize = placement.out.iter().map(Vec::len).sum();
    let fixed = entries(lanes, placement, 0).len();
    let mut keep = budget.min(MAX_OMISSIONS.saturating_sub(fixed));
    let size = |list: &[Value]| serde_json::to_string(list).map_or(u64::MAX, |t| t.len() as u64);
    let mut list = entries(lanes, placement, keep);
    while keep > 0 && size(&list) > reserve {
        keep -= 1;
        list = entries(lanes, placement, keep);
    }
    Omissions {
        list,
        more: (budget - keep) as u64,
        budget: budget as u64,
        authority: lanes.iter().map(|lane| lane.authority).sum(),
        flagged: lanes.iter().map(|lane| lane.flagged).sum(),
        unreadable: lanes.iter().map(|lane| lane.unreadable).sum(),
    }
}
