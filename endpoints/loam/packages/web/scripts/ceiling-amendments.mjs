/**
 * The one place D115's end date and the amendments that raise a ceiling after it are recorded (Loam's D161,
 * D163, #1929). `scripts/ceiling-raises.mjs` reads both; `budget` runs it.
 *
 * `D115_ENDS_ON` is the last day, in UTC, on which D115 lets a pull request raise a ceiling with no approval.
 * Set to `'2026-11-30'` by the owner's decision (2026-11-27, recorded in #2260); D161 in `endpoints/loam/docs/decisions.md`
 * records it, as "D115 ends on YYYY-MM-DD", and the check refuses a date D161 does not hold.
 * Once `main` holds a date, a change that moves or unsets it must rewrite D161's "D115 ends on <date>" too. If set to `null`,
 * the check says it is inert; it still reads the base's date, so a change cannot unset one `main` holds.
 *
 * From the day after it, the rules D115 amended apply again as they were written: phase 0's 8.1 ("raising a
 * ceiling needs an amendment with the reason"), phase 2's 2.4 (a step over its allowance moves code out or
 * amends the table first) and phase 3's 13 (an allowance the coordinator approved). A pull request that raises,
 * adds or removes a ceiling then carries one entry here per row it changes, other than a lowering:
 *
 *   {
 *     row: 'jsGzip',                   // the key in `budget.mjs`'s `CEILINGS` or the paint ceiling's object
 *     from: 108_800,                   // the ceiling on the base, or `null` for a new row
 *     to: 109_400,                     // the ceiling this pull request sets, or `null` for a removed row
 *     measured: 109_012,               // what the step measured; above `from` and at or under `to`
 *     reason: 'Why the step needs it, in words a reviewer can check against the diff',
 *     amendment: 'endpoints/loam/docs/phases/2-scope-projects/spec.md#24-the-budget-and-the-rule',
 *     approvedBy: 'coordinator',       // or 'owner'
 *     approval: 'https://github.com/lushly-dev/afd/pull/1234#issuecomment-1', // or a decision, 'D170'
 *     approvedOn: '2026-12-01',
 *   }
 *
 * The amendment is a section of a Loam specification under `endpoints/loam/docs/phases/`, named by its heading's
 * anchor, that names the row and writes the new ceiling with its thousands separated ("109,400"). An approval
 * that names a decision (`D170`) needs that decision's row to name the row. One run spanning several merged pull
 * requests accepts a chain of entries (108,800 to 109,400, then 109,400 to 110,000). Entries stay as the ledger of raises after D115.
 */

/** @type {string | null} */
export const D115_ENDS_ON = '2026-11-30';

/** @type {readonly import('./ceiling-raises.mjs').CeilingAmendment[]} */
export const CEILING_AMENDMENTS = Object.freeze([]);
