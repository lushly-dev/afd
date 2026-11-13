# Host specification: a review on the person page, and a local page

| Field | Value |
| --- | --- |
| Serves | The host part of what the [Ideas plan](../../../../../docs/features/active/ideas/ideas.proposal.md) calls P15, cut to what the [Ideas plugin's version 1](spec.md) needs: a preview in pages bound to one digest, items a person can pull out, a decision lifetime long enough to read them, a list of pending decisions on the page, and a page served on the local machine for an instance with no sign-in. Step A3 of that plan, host part. The part of P15 that changes AFD's relay is step A4's and is not here |
| Owner | Repository owner approves; the Ideas plan's owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), the [phase 5 specification](../../phases/5-auth-hosted/spec.md) (sections 7.1 to 7.5), the [records host specification](host-records.spec.md) (section 6.1), the [decision log](../../decisions.md) (D71, D86, D97, D115, D116, D161, and D180, made here), and the [Ideas plugin specification](spec.md) (sections 8 and 9) |
| Elevation | Exact names, shapes, codes, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

Code paths are relative to `endpoints/umbel/`.

## Status

- **State:** written 2026-11-12 for step A3 of the Ideas plan, beside the plugin's specification. **Decided under the
  owner's direction of 2026-11-11 and 2026-11-12** that the plan carry on through its phases on its recommendations,
  and on his requirements of 2026-11-12: review in bulk with an agent's help, confirmed in a browser and not at a
  terminal, and authentication optional in Umbel. **The owner has not read this specification.** Every decision here
  stays open to him (the [Ideas status](../../../../../docs/features/active/ideas/STATUS.md), Q2). It decides D180.
  Nothing is implemented. **Revised the same day after an independent review** (three blockers, nine improvements),
  all taken: section 6.2 now specifies how a call reaches the gate at all in mode `none`; an unpaged preview stays
  exactly `{ preview }`; a `local` assurance gets envelope version 4; the form's fields, the local page's rules, the
  lifetime from the last page, `verified_levels`, and step H0 are added.
- **Why a companion and not a section of the plugin's specification:** D158 places a plugin's host changes in a file
  of their own beside it, and Umbel's CI refuses a pull request that changes `plugins/` and host code together
  (`.github/workflows/umbel.yml:383` to `:393`). Steps H1 to H3 change only host code, so they are planned, reviewed and
  merged apart from the plugin's steps.
- **Last verified:** 2026-11-12 against `origin/main` at `8a5348ce`, by reading: `src/person/mod.rs` (whole),
  `src/person/page.rs:1` to `:80`, `src/person/service.rs:1` to `:60`, `:480` to `:530` and `:705` to `:870`,
  `src/middleware.rs:425` to `:500`, `src/auth/mod.rs:50` to `:60` and `:97`, `src/principal.rs:420` to `:500`,
  `src/workspace/hosted.rs:166` to `:175`, `:521` to `:527` and `:1603` to `:1619`, `src/surfaces/http/listener.rs:100`
  to `:290`, `src/plugins/manifest/v5.rs:70` to `:140` and `:280` to `:420`, `store/src/envelope.rs:137` to `:170`, and
  the phase 5 specification's sections 7.1 to 7.5; for the revision, `src/plugins/manifest.rs:480` to `:490`,
  `src/plugins/loader.rs:1340` to `:1365` and `:1495` to `:1505`, `src/person/service.rs:190` to `:200`,
  `src/host/mod.rs:785` to `:800`, `src/person/page.rs:136` to `:142`, `:185` to `:222`, `:595` to `:602` and `:680` to
  `:702`, `src/cli/preview.rs:14` to `:20` and `:85` to `:98`, `store/src/envelope.rs:183` to `:196`,
  `packages/rust/src/server/human_relay.rs:10` to `:22`, `confirmations.rs:66` to `:74`, and
  `.github/workflows/umbel.yml:378` to `:395`. **No Rust was built or run.**
- **Step H0 is merged** (#1081). **Step H1, the shapes, is implemented** (2026-11-12) on the branch
  `lush/ideas-h1-shapes`, amended below ([H1](#amendments-from-step-h1), A1 to A8): configuration version 7 with
  `[person]`, `[person.local]` and a space's `verified_levels`, parsed and validated, and its schema; the person
  decision version 2; `Assurance::local()`, a version-aware `is_valid` and envelope version 4; `CallContext.preview_page`;
  `PersonDecision.excluded` and `level`. Nothing acts on them yet.
- **Not done:** steps H2 and H3. **Follow-ups:** the [table at the end](#follow-ups).

## What this specification serves

A person decides on hundreds of ideas in one sitting. Today each person-gated call is one decision on one page, which
shows at most 6000 characters (`src/person/service.rs:851`), lives ten minutes (`PERSON_DECISION_TTL_S = 600`,
`src/auth/mod.rs:97`), and is served only in a hosted mode behind a login with user verification (phase 5, 7.1:
"served over MCP only in a hosted mode"). A local instance over stdio has no page at all: mode `none` is the default
(`src/workspace/hosted.rs:166` to `:175`), binds only a loopback address (`check_bind`, `hosted.rs:1603`), and over
stdio the caller is an agent acting for `principal.on_behalf_of` (`src/principal.rs:430`). So the review the plugin
specifies has nowhere to be confirmed but the terminal, which the owner has ruled out as the place for it.

| Principle | How this serves it |
| --- | --- |
| 1. Empty host | The page learns nothing about ideas. It shows pages of text and items a command's preview returns, and records which items the person pulled out |
| 3. Everything is a command | The decision still runs one command with one input, as today. The local page is a CLI built-in, `person-page-serve` |
| 9. Stored content is untrusted input | Item text is rendered as the preview is today: sanitised, escaped, no script |
| 12. Small surfaces | Four changes, each the least that lets a person confirm a long review by exception in a browser |

Decisions served: D86, D97, D115, D116, D161. New: D180.

## Trajectory refresh

Nothing here leans on a standard the trajectory watch tracks beyond what phase 5 leans on. URL-mode elicitation is
not used by the local page: the call is refused with the page's address and retried, as a client without elicitation
retries today. Better Auth, which the owner's hosted instance will use, cannot yet report user verification (`acr`,
`amr`) before its version 1.8, and Umbel accepts only RFC 8176's user-verification methods (`UV_AMR_METHODS`,
`src/auth/mod.rs:56`). That is a seam for the hosted instance (the plugin specification's follow-ups), not for this
document.

## Terms

| Term | Meaning |
| --- | --- |
| Paged preview | A `confirm_preview` that answers one page of several, with the number of pages |
| Item | One entry of a preview page that the person may pull out: an id and its text |
| Pulled out | Unchecked by the person on the page before confirming. Its id is recorded in the decision as `excluded` |
| Local page | The person page served on a loopback address, by `umbel person-page-serve`, for an instance in mode `none`, with no login |
| `local` | The assurance a decision made on the local page records: level `local`, method `local-page` |

## 1. What changes, and where

| Change | Where | Section |
| --- | --- | --- |
| A preview may answer pages and items | `src/person/service.rs` (`preview`), `sdk/src/cx.rs` (`CallContext.preview_page`) | 2 |
| A decision records the pages shown and the items pulled out | `src/shared/person.rs`, `schemas/person-decision.v2.json`, `src/person/mod.rs` (`PersonMark`), `sdk/src/cx.rs` (`PersonDecision`) | 3 |
| A decision's lifetime is a workspace setting | `src/workspace/config.rs`, `src/auth/mod.rs`, `src/person/page.rs` | 4 |
| The page lists the person's pending decisions | `src/person/page.rs` | 5 |
| The local page, its assurance and its gate | `src/plugins/loader.rs`, `src/host/mod.rs`, `src/person/service.rs`, `src/person/page.rs`, `src/commands/person_page.rs` (new), `src/middleware.rs`, `src/person/mod.rs`, `store/src/envelope.rs`, `schemas/provenance-envelope.v4.json` | 6 |

Versions: workspace configuration 6 becomes **7** (sections 4 and 6), with `schemas/workspace-config.v7.json`. The
person decision record becomes version 2. The provenance envelope gains version 4, written only for a `local` assurance
(6.4). The manifest, the plugin protocol, the WIT world and the store traits are unchanged. If phase 6 takes
configuration version 7 first, the second to land renumbers, as D170 rules.

## 2. A paged preview with items

A preview answers today with `data` holding exactly one member, `preview`, a string; the page (`service.rs:747`) and
the CLI (`src/cli/preview.rs:16`, `:88` to `:97`) refuse anything else. **That stays the answer whenever the host does
not ask for a page**: at the CLI, and in the host's own check before a decision is begun. When the page renders a
decision it always asks for a page, and the preview may then answer:

```json
{ "preview": "Review rev-… · 42 decisions · page 2 of 5", "page": 2, "pages": 5,
  "items": [ { "id": "prp-0c1…", "text": "AFFIRM · Mulch beds before the first frost. · reason: said twice" } ] }
```

| Member | Rule |
| --- | --- |
| `preview` | String. The page's heading text. Rendered as today |
| `page`, `pages` | Integers, `1 <= page <= pages <= MAX_PREVIEW_PAGES` (200). Both or neither |
| `items` | Optional, 0 to `MAX_PREVIEW_ITEMS` (100) a page. Each `id` matches `^[A-Za-z0-9._-]{1,64}$` and is unique across all pages of the decision; each `text` is a string |

An answer of exactly `{ preview }` is a decision of one page with no items, as today. Any other member, or a rule
broken, makes the page "could not be shown" (only Decline). **The page is cut nowhere**: the heading and every item's
text must render within the 6000 characters `render` allows (`service.rs:851`); a page `render` would cut is "could
not be shown". A plugin that wants more says so in more pages.

**Which page.** `CallContext` (`sdk/src/cx.rs:28`) gains `preview_page: Option<u32>`, host-owned, as `person_check`
is (`src/person/mod.rs:53`). The page sets it to `Some(n)` on every render, from 1. `None` means "not the page": the
preview answers exactly `{ preview }`. The page number is never part of the command's input, so it is never part of
the digest the decision binds.

**Moving between pages.** The form (`POST <path>/d/<id>`) gains two fields beside `login` (hosted only), `csrf` and
`decision`, which are all it takes today (`page.rs:682`): `page`, the page posted from, and `action`, one of `next`,
`previous`, `approve` or `decline`; and one repeated field `k`, the zero-based position on that page of each item
left checked. Positions and not ids keep the form inside its 4096 bytes (`MAX_FORM_BYTES`, `page.rs:57`). The host
maps positions to ids from the page it rendered, stores that page's unchecked ids in the decision's row, and answers
`next` and `previous` with `303 See Other` to `GET <path>/d/<id>?page=<n>`. A page reached again shows the person's
earlier choices.

**Every page before Confirm.** The row holds the SHA-256 of each page rendered. Approve is offered only on a page
reached after every page from 1 to `pages` was rendered, each with the same `pages`. A page that renders with another
`pages`, or a seen page that renders with another hash, clears the record and the choices, and the person starts from
page 1 with the line "The review changed while you read it." Decline is always offered.

**The page's request limit** stays 30 a minute for a decision (`PAGE_REQUESTS_PER_MINUTE`, `page.rs:60`). A page costs
a `POST` and a `GET`, so a person may turn 15 pages a minute, faster than a page of 6000 characters is read.

## 3. What a decision records, and what the command is told

`person-decision.v1.json` becomes version 2, adding to the decision row:

| Field | Holds |
| --- | --- |
| `pages` | The pages rendered, as `[{ "page", "hash", "items": [ids] }]` |
| `excluded` | The item ids the person unchecked, at most `MAX_EXCLUDED` (2000), each an id a rendered page listed |
| `level`, `method` | As today, plus `local` and `local-page` (section 6) |

On Approve the excluded set is final. A position that names no item of the page posted from is refused with "This
request changed", and nothing is recorded.

The run is told: `PersonMark` (`src/person/mod.rs:121`) gains `excluded: Vec<String>`, and `umbel_sdk::PersonDecision`
(`sdk/src/cx.rs:130`) gains `excluded: Vec<String>` and `level: String`. `attested` (`src/person/mod.rs:254`) fills
both. **The command's input and its digest are unchanged**: what the person pulled out reaches the command only
through this host-owned field. A plugin that answers items must honour it; the host cannot enforce that, as it cannot
enforce which records a handler affirms (records host specification, 6.1).

**Adding the fields breaks a plugin's test**: `plugins/knowledge/src/proposal/apply.rs:1067` builds a
`PersonDecision` with every field. So step H0 (section 10) first derives `Default` for `PersonDecision` in `sdk/` and
changes that test to `..PersonDecision::default()`. H0 touches `sdk/` and `plugins/` and no `src/`, `wit/` or
`schemas/`, so CI's plugin-isolation rule passes it (`.github/workflows/umbel.yml:383` to `:393`), and H1 then adds the
fields with no plugin change.

## 4. A decision's lifetime

Workspace configuration version 7 adds:

```toml
[person]
decision_ttl_s = 3600
```

| Key | Type, default | Rule |
| --- | --- | --- |
| `person.decision_ttl_s` | integer, 600 | 60 to `PERSON_DECISION_TTL_MAX_S` (86 400). The lifetime of every person decision begun on this host |

`PERSON_DECISION_TTL_S` (`src/auth/mod.rs:97`) becomes the default. **A decision's expiry moves** to the render's time
plus `decision_ttl_s` each time the page renders one of its pages, up to 24 hours after it began, so the lifetime runs
from the last page the person was shown, not from when an agent began it. A decision that expires unread loses only
the choices made on it; the agent's next call begins another. On the hosted page a login lives until its
decision expires, no longer capped at `LOGIN_TTL_MS` (`page.rs:55`): the ID token's `auth_time` is still held to
`max_age_s` at the return, so the login itself is as fresh as today. A longer lifetime keeps a pending decision
spendable for longer; it is still spent once, for one command, one input digest and one caller.

## 5. Pending decisions on the page

`GET <path>/d/` lists the decisions that are pending, unexpired and for the person viewing: on the hosted page after a
login (a new login row with no decision, then the list), on the local page for the local person (section 6). Each line
shows the command, the space, when it was begun and when it expires, and links to its page. No preview is run for the
list. This is how a person reaches a decision when the harness cannot open a link: the refusal names the list's
address, and the person opens it in any browser on the machine.

## 6. The local page

### 6.1 Configuration

```toml
[person.local]
enabled = true
bind = "127.0.0.1:7421"
```

| Key | Type, default | Rule |
| --- | --- | --- |
| `person.local.enabled` | bool, `false` | Only with `auth.mode = "none"`, else `WORKSPACE_CONFIG_INVALID` |
| `person.local.bind` | socket address, `127.0.0.1:7421` | A loopback address, as `check_bind` holds `http.bind` (`hosted.rs:1603`) |

### 6.2 How a call reaches the gate today, and what changes

In mode `none` a person-gated command never reaches the plugin gate over MCP. `mcp_exposed` is
`expose.mcp && !require_human` (`src/plugins/manifest.rs:485`); `mcp_registered` adds such a command only where
`person_page_served` holds (`src/plugins/loader.rs:1344` to `:1361`), which is false in mode `none`; where it is
registered, it is `HostVerified` (`loader.rs:1499` to `:1502`), which AFD refuses unless a `HumanRelay` is installed
(`packages/rust/src/server/human_relay.rs:15` to `:19`). `PersonService::build` returns `None` outside the hosted
modes (`src/person/service.rs:196`), the ledger exists only when hosted (`src/host/mod.rs:792`), and `admit`,
`attested` and `for_of_mcp` accept only a verified decision over HTTP (`src/person/mod.rs:186` to `:192`, `:264` to
`:275`, `:412` to `:421`).

**Chosen: a registration that is not `HostVerified`, gated by Umbel's own plugin gate, with a call that is refused and
sent again.** Not a local `HumanRelay`: AFD relays only an MCP 2026-07-28 request with URL elicitation and refuses
every other call (`human_relay.rs:15` to `:19`), so a harness without elicitation could never confirm; a refusal that
names the page's address works with every stdio client and needs no AFD change.

| Piece | Change |
| --- | --- |
| `loader::local_page_served(config)` (new) | `auth.mode == None && person.local.enabled` |
| `loader::mcp_registered` | Also true for `person_mcp(command) && command.expose.mcp` when `local_page_served`. `definitions` sets `HostVerified` only when `person_page_served`; the local registration has no confirmation mode, so AFD's own confirmation (`mcp.confirmations`, default `off`, `packages/rust/src/server/confirmations.rs:66`) is the only thing AFD adds, and a form it might ask for grants nothing the plugin gate needs |
| `PersonService::build` | Builds a local service when `local_page_served`: no OIDC provider, no login rows, the same decision store, and section 6.3's page |
| `Host` ledger (`src/host/mod.rs:792`) | Built when hosted or when `local_page_served` |
| `person::for_of_local(config, context)` (new) | Only a stdio caller (`Transport::Stdio`, `Authentication::Process`, `src/principal.rs:430`): `{ actor, clientId: null, issuer: null, namespace: "local", subject: <effective principal> }`. Anything else is refused |
| `person_gate` (`src/middleware.rs:440`) | A new arm before the `needs_preview` refusal (`:477`): over MCP, when `local_page_served` and the command's `person.mcp` is `verified`. It builds `for_of_local`, then looks in the ledger for a decided, unexpired, unspent decision for this command, this input digest and this `for`. **None**: it begins one (after the host's own run of the preview as the caller, as `service.rs:483` does) and refuses with section 7's `CONFIRMATION_REQUIRED`; a second call while it is pending refuses again with the same decision. **Decided**: it spends it once (`person:<id>`, then `person-run:<id>` as `admit` does) and returns the mark |
| Who writes the mark | `person_gate` returns `Result<Option<PersonMark>, CommandError>`, and the plugin gate's wrapper inserts the returned mark under `PERSON_DECISION_KEY` and `humanPresent` `{ level: "local", method: "local-page" }` into the context it hands the handler. The context hook still clears both on every incoming MCP call (`src/principal.rs:488` to `:496`), so only the gate sets them |
| `attested` (`src/person/mod.rs:254`) | Accepts, beside a verified mark, a mark with `level = "local"`, `method = "local-page"`, `surface = "mcp"`, only when `local_page_served`, and only with `for_of_local` |
| `gate_proof` (`src/person/mod.rs:328`) | Over MCP with `local_page_served`: such a mark gives `Assurance::local()` |
| `umbel person-page-serve` (new, `src/commands/person_page.rs`) | A host built-in in the `person` domain, CLI only, operator only, `inspect`. Binds `person.local.bind` and serves sections 2 to 5's routes with 6.3's rules until interrupted; prints the list's address; `--open` opens it. Decisions live in `state/shared/person.sqlite3`, which every process of the workspace shares, so the stdio server that began a decision and this process need not be one. **It needs the `auth` feature**, as the person store does (`src/person/mod.rs:28` to `:35`): without it the command and `[person.local]` are refused with `WORKSPACE_CONFIG_INVALID`, "the local person page needs a build with the auth feature, such as umbel-first-party" |

The CLI's terminal path is unchanged. HTTP in mode `none` (`agent:loopback`) is not served this way.

### 6.3 The local page's own rules

| Rule | Hosted page today | Local page |
| --- | --- | --- |
| Login | OIDC, a login row and a `__Host-` cookie (`page.rs:25` to `:31`) | None, so no cookie: `__Host-` needs `Secure`, which plain HTTP cannot set |
| CSRF token | HMAC of the decision and login ids under `person.key` (`page.rs:599`, `:700`) | HMAC of the decision id and the string `local` under `person.key` |
| Origin of a post | `https://<public host>` (`page.rs:139` to `:141`) | Exactly `http://<bind>`, or `null` with `Sec-Fetch-Site: same-origin` |
| Host header | Must name the public URL's host (`host_ok`, `page.rs:187` to `:220`) | Must equal `<bind>`'s address and port exactly, **against DNS rebinding**: a page on another site that rebinds its name to `127.0.0.1` sends its own name as `Host` and is refused |
| Headers, escaping, request limit | As `page.rs` sets them | The same |

### 6.4 Assurance, stored

`umbel_store::Assurance` (`store/src/envelope.rs:137`) gains `Assurance::local()`, level `local`, method `local-page`,
no namespace, `authTime` or `acr`. `Assurance::is_valid` accepts only the two shapes today (`envelope.rs:187` to
`:195`), fixed by `schemas/provenance-envelope.v3.json:351` to `:375`. **Chosen: envelope version 4**, the same as 3
with a third assurance shape, written only for an envelope that carries a `local` assurance; every other envelope
stays version 3. So every stored record, fixture and conformance case today stays byte-identical, and a reader that
knows only version 3 refuses a `local` envelope instead of misreading it. `is_valid` becomes version-aware (`local`
valid only at version 4). `schemas/provenance-envelope.v4.json` is added; the store's conformance suite gains a case
that a version 3 envelope with `local` is refused and a version 4 one is stored and read back.

### 6.5 What the local page proves, and what turning it on relaxes

| Assurance | How | What it shows | What it does not |
| --- | --- | --- | --- |
| `terminal` | The CLI's prompt, answered at a terminal with no agent variable set (D86, records host 6.1) | A process with a terminal answered | That a person typed it: a process that unsets the variables and holds a pseudo-terminal passes (D74, D86) |
| `local` | A form posted to the loopback page with its CSRF token | Something on this machine reached the port, fetched the page and posted it | **That a person clicked.** An agent with a shell can start `person-page-serve` itself, fetch the form and post it; an agent driving a browser can click it. The Origin, Host and CSRF checks stop another web site, not a local process |
| `verified` | A fresh login with user verification on the hosted page (phase 5, 7.2) | The person the call is for logged in, with user verification, for this decision | That they read what they confirmed |

**Turning on `person.local` relaxes, for that workspace, what step B3's review made strict** (the records host
specification's A37 and D161): at a terminal an agent variable withholds the proof, but on the local page nothing
does. `local` is not stronger than `terminal`. It is offered because the owner asked that review happen in a browser
and that Umbel run without authentication.

**Verified content and `local`.** Workspace configuration version 7 adds `spaces.<id>.verified_levels`, the levels of
affirmation a call's `verified_only` admits, default `["terminal", "verified"]`. The records host specification's
6.6 clause for `<affirmed>` gains, under `verified_only` only, a condition that the decision row's assurance level is
in that list. An ordinary read still labels a `local` affirmation `affirmed`, with its level; only a request for
verified content leaves it out unless the deployer lists `local`.

## 7. Failures

| Code | When | Retryable | Suggestion |
| --- | --- | --- | --- |
| `CONFIRMATION_REQUIRED` | 6.2's `person_gate` arm found no decided decision. `details`: `{ "decision": "<id>", "url": "http://<bind>/d/<id>", "list": "http://<bind>/d/" }` | Yes | "Ask the person to open the url (or the list) in a browser on this machine and confirm; then send the same call again. If nothing answers there, the person runs umbel person-page-serve" |
| `PERSON_DECISION_EXPIRED` | A local decision expired before it was decided | Yes | Send the call again: a new decision is begun |
| `CONFIRMATION_DECLINED` | The person declined on the page | No | Ask the person what to change, and stage it again |
| `WORKSPACE_CONFIG_INVALID` | `person.local.enabled` outside mode `none` or without the `auth` feature; a `bind` that is not loopback; `decision_ttl_s` out of range; a `verified_levels` entry that is not a level | No | Fix the key named |
| `PERSON_PAGE_BIND_FAILED` | `person-page-serve` cannot bind its address | Yes | Another `person-page-serve` may be running: open its list, or stop it |

## 8. Security

| Threat | Handling |
| --- | --- |
| An agent confirms its own review on the local page | Not prevented, and stated (6.5): it can start `person-page-serve` and post the form. The decision records `local`, so does every affirmation it gives, and `verified_only` leaves `local` out by default. Every applied review can be undone |
| Another web site posts to the local page | 6.3: Origin exactly `http://<bind>`, a CSRF token bound to the decision |
| DNS rebinding | 6.3: the Host header must equal the bind's address and port |
| A page shows less than is applied | Every page rendered before Approve, none cut (2); the plugin binds its part's digest in the input |
| An item id smuggles text into the decision | Ids are 1 to 64 characters of `[A-Za-z0-9._-]`, posted as positions; only ids are stored |
| The local page is reached from the network | It binds a loopback address only, and refuses any other (6.1) |
| A long-lived decision is replayed | Spent once in the nonce store, bound to command, input digest and caller, as today |
| A request forges the local mark | The context hook clears it on every MCP call; only the plugin gate's local arm sets it (6.2) |

## 9. Tests

| File | Proves |
| --- | --- |
| `tests/person_paged.rs` | 2 and 3: an unpaged preview is exactly `{ preview }` at the CLI and in the host's check; on the page every render sets `preview_page`; `next`, `previous` and the `303`s; positions mapped to ids, kept across pages; Approve only after every page; a changed page restarts; a cut page cannot be approved; a position past the page is refused; the form within 4096 bytes at 100 items |
| `tests/person_ttl.rs` | 4: the default is 600 s; `decision_ttl_s` is honoured; each render moves the expiry, never past 24 hours; out of range is refused; the hosted login lives until the decision expires |
| `tests/person_pending.rs` | 5: the list shows only the viewer's pending, unexpired decisions, on both pages |
| `tests/person_local.rs` | 6: a stdio call registered and refused with the page's address; decided on the local page; the same call again runs once with `level = "local"` and the excluded ids, and a third does not; another input or command finds no decision; HTTP in mode `none` and the CLI are not served this way; a forged mark is cleared; CSRF, Origin and Host refusals, a rebinding `Host` among them; `person.local` outside mode `none`, without `auth`, or on a non-loopback bind is refused |
| `store` conformance, `envelope` group (extended) | 6.4: `local` refused at version 3, stored and read back at version 4; every existing case unchanged |
| `tests/records_standing.rs` (extended) | A decision on the local page affirms, with level `local`; `verified_only` leaves it out under the default `verified_levels` and admits it when listed; at a terminal still `terminal` |

## 10. Implementation plan

"The Umbel gate" is the command list step B1 recorded in the [records host specification](host-records.spec.md)
status block. CI refuses a pull request that changes `plugins/` together with `src/`, `wit/` or `schemas/`
(`.github/workflows/umbel.yml:383` to `:393`); H0 changes `sdk/` and `plugins/` only, and H1 to H3 change no plugin.

| Step | Deliverable | Exit |
| --- | --- | --- |
| H0. Room in the SDK | `#[derive(Default)]` on `umbel_sdk::PersonDecision`; `plugins/knowledge/src/proposal/apply.rs:1067`'s test builds it with `..PersonDecision::default()` | The Umbel gate |
| H1. Shapes | Configuration version 7 (`[person]`, `[person.local]`, `spaces.<id>.verified_levels`), parsed and validated, and its schema; `person-decision.v2.json`; `Assurance::local()`, version-aware `is_valid` and `provenance-envelope.v4.json` (6.4); `CallContext.preview_page`; `PersonDecision.excluded` and `level`; the version constants | The Umbel gate; the envelope conformance cases; `person_ttl.rs` for the parsing half |
| H2. Paged preview, items, lifetime and the list | Sections 2 to 5 on the hosted page | The Umbel gate; `person_paged.rs`, `person_ttl.rs`, `person_pending.rs` |
| H3. The local page | Section 6: registration, the local service and ledger, `for_of_local`, the gate's arm and the mark it writes, `attested` and `gate_proof`'s local arms, `person-page-serve` with 6.3's rules, `verified_levels` in the 6.6 clause, the doctor's `person.local` check (passes when disabled; warns when enabled, naming 6.5's limit) | The Umbel gate; `person_local.rs`; `records_standing.rs` extended |

H1 needs H0; H2 needs H1; H3 needs H2. The plugin's step C4 needs H3.

## 11. Out of scope, with seams

| Not here | Where | Seam |
| --- | --- | --- |
| A login on the local page | The owner's choice, section 12 row 6 | `[person.local]` may gain `login = "<namespace>"`; a decision made with one records `verified` |
| The relay's list for a hosted client without URL elicitation | Step A4, an AFD change | Section 5's list is the page it would point to |
| Better Auth's user verification | The hosted instance | `uv_amr` and `acr_values` as phase 5 has them (`src/auth/mod.rs`); since D181 (2026-11-12) a passkey login, `uv_amr = ["mfa"]` with `acr_values` `phr` or `phrh` only |

## 12. For the owner

**The owner has not read this specification.** Each row is a choice he could reasonably want otherwise.

| # | Chosen here | The alternative, and its cost |
| --- | --- | --- |
| 1 | **A local page with no login, recorded as `local`** | No local page: review is confirmed at a terminal, which the owner ruled out |
| 2 | **The page runs as its own command, `person-page-serve`**, not inside every stdio server | Each stdio server binds the port: several harness sessions would fight for it, and the page would die with the session that bound it |
| 3 | **The lifetime is one workspace setting, moved by each page shown**, not a per-command manifest key as the plan's P15 had it | A manifest key: a manifest version for one number, and the deployer could not shorten it |
| 4 | **Items are pulled out on the page; nothing else is edited there** | Flip a decision or reword on the page: free text on the page, stored in a decision, and a larger page to secure |
| 5 | **Every page must be shown before Approve** | Approve from page 1: what applies would include pages never shown |
| 6 | **No login on the local page in version 1** | A login through Better Auth on the local page: sign-in to run and keep, **without raising the assurance today**, since Better Auth cannot report user verification (`acr`, `amr`) before its 1.8 and Umbel accepts only RFC 8176's user-verification methods (`src/auth/mod.rs:56`). It would become worth it once that lands |
| 7 | **A registration that is not `HostVerified`, refused and sent again**, not a local `HumanRelay` (6.2) | A local relay: one call when the harness offers URL elicitation, none at all when it does not |
| 8 | **Envelope version 4, only for `local`** (6.4) | Amend version 3: one schema, but a reader of version 3 would accept a level it does not know |
| 9 | **`verified_only` leaves `local` out by default** | Admit it: a request for verified content would return what an agent may have confirmed on the local page |

## Amendments

### Amendments from step H1

Step H1 (shapes) found these points this document had wrong against the code, or had not settled, and took the
narrowest reading of each. None changes a decision row.

| # | Point | Decision |
| --- | --- | --- |
| A1 | Section 3 says the decision row gains "`level`, `method`: as today, plus `local` and `local-page`". Version 1 of the row has a `level` and no `method` (`schemas/person-decision.v1.json`) | Version 2 adds only `pages` and `excluded`. `level` becomes `verified` or `local`, and the method follows from it, as the mark's does. A `local` decision records no `authTime` or `acr`, and its `for` is the local person: namespace `local`, no issuer, no client (`schemas/person-decision.v2.json`'s `allOf`). A page's `hash` is `sha256:` and 64 hex digits, as `previewHash` is |
| A2 | `PERSON_VERSION` becomes 2 in H1, but no row holds a page or an item until H2 | The row's test view (`Decision::to_v2`, `src/shared/person.rs:127`) writes `pages` and `excluded` as empty lists until H2 stores them. No column is added in H1 |
| A3 | Section 6.4 says version 4 is "written only for an envelope that carries a `local` assurance" and leaves open whether a reader accepts a version 4 envelope without one | The store refuses it: version 4 holds a confirmation with a `local` assurance and nothing else (`check_version_3_fields`, `store/src/envelope.rs:529`), and the schema says the same. So no envelope has two spellings. `LOCAL_ASSURANCE_ENVELOPE_VERSION` names the 4 |
| A4 | Section 6.4 makes `is_valid` version-aware and names no signature; three callers hold an assurance outside an envelope | `Assurance::is_valid(&self, version: u32)` (`store/src/envelope.rs:204`). A lane decision (`store/src/lane.rs:805`) and `memory-confirm` (`store-embedded/src/memory/change.rs:137`) pass version 3, so neither takes `local` before H3 decides where a `local` decision is stored. `src/provenance.rs` passes the event's own envelope version |
| A5 | Section 4 places `PERSON_DECISION_TTL_MAX_S` beside `PERSON_DECISION_TTL_S` in `src/auth/mod.rs` | The configuration reads it, so it lives with the configuration's other limits: `PERSON_DECISION_TTL_MIN_S` (60), `PERSON_DECISION_TTL_MAX_S` (86 400) and `DEFAULT_DECISION_TTL_S`, which is `crate::auth::PERSON_DECISION_TTL_S`, in `src/workspace/person.rs:35`. `src/auth/` is unchanged |
| A6 | Section 7 refuses "a `verified_levels` entry that is not a level", and leaves an empty list and a repeated level open | Each entry is `terminal`, `verified` or `local`, at most once, and the list names at least one (`verified_levels`, `src/workspace/person.rs:208`). An empty list would make `verified_only` admit no affirmation at all, which no deployer needs a setting for. The levels are `AssuranceLevel` |
| A7 | Section 6.1 leaves open which key a refusal names, and whether a disabled page's `bind` is checked | `bind` is checked whether or not the page is enabled. `enabled = true` outside mode `none`, or without the `auth` feature, is refused at `person.local.enabled` (`local_page`, `src/workspace/person.rs:165`); `enabled = false` is accepted in any mode. The schema states the mode rule; the feature is not a schema's to state |
| A8 | Section 3 gives `PersonMark.excluded` to section 3's step, and section 2 gives H1 `CallContext.preview_page` with nothing to set it | `PersonMark` gains `excluded` in H1 (absent from the mark when empty, so a mark written before reads), and `attested` fills `PersonDecision.excluded` and `level` from the mark. The host sets `preview_page` to `None` everywhere until H2 (`src/plugins/compiled.rs:241`). Configuration version 7's tests are in `tests/config_v7.rs`, which section 9 does not name, beside `tests/person_ttl.rs`'s parsing half; the version 2 decision's and version 4 envelope's schema tests are in `tests/schemas/review.rs` |

## Follow-ups

| Date | Raised by | Follow-up | Where it goes |
| --- | --- | --- | --- |
| 2026-11-12 | This specification | Revised after an independent review the same day (three blockers, nine improvements, all taken: the registration path, the unpaged preview, the stored assurance, the page's fields, the local page's rules, H0, the lifetime) | A focused pass on the revision, before H0 |
| 2026-11-12 | This specification | Whether the scope resolver, which lists a person-gated command only to callers whose namespace serves verified commands (`loader.rs:1353` to `:1357`), filters anything in mode `none`, where `filter_tools_by_scope` gates `person_page_served` (`loader.rs:1348`) | H3, read and pinned in `person_local.rs` |
| 2026-11-12 | The plugin's step C1 | A `confirm_preview` target must declare `returns = { preview: string }` with `additionalProperties = false` (`src/plugins/manifest/v4.rs:197`), which refuses section 2's paged answer with `items`. The plugin declares that `returns` today (its amendment C1-3) | Step H2: admit the paged shape in the rule |
| 2026-11-12 | Step H1's review | An event's envelope is capped at `PROVENANCE_VERSION`, 3 (`src/provenance.rs:432`), so `is_confirmation(.., 3)` would silently drop a journaled confirmation whose assurance is `local` from the event, where the store keeps it in version 4 | H3: give the event its own version 4 for a `local` confirmation, or refuse to journal one, and pin it in `person_local.rs` |
