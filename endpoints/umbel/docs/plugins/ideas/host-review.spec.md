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
  `PersonDecision.excluded` and `level`. Nothing acts on them yet. **Step H2, the paged preview,
  items, lifetime and the list on the hosted page, is implemented** (2026-11-13) on the branch
  `lush/ideas-h2-paged`, amended below ([H2](#amendments-from-step-h2), A9 to A20), and resolves the
  plugin's follow-up C1-3 (A19). **Step H3, the local page, is implemented** (2026-11-13) on the
  branch `lush/ideas-h3-local`, amended below ([H3](#amendments-from-step-h3), A26 to A45, A41 to A45 from its security review): the local
  registration, service and ledger, `for_of_local`, the plugin gate's local arm and the mark it hands
  the handler, `attested` and `gate_proof`'s local arms, `umbel person page-serve` with 6.3's rules,
  `verified_levels` in the 6.6 clause, and the doctor's `person.local`. It resolves the follow-ups
  addressed to H3.
- **A public origin behind a proxy** (2026-11-14), on the branch `lush/ideas-page-public-origin`, amended below
  ([A46 to A50](#amendments-for-a-public-origin-behind-a-proxy)): `person.local.public_origin`, the host option the
  plugin's first use asked for (its F-4). Not reviewed independently.
- **Not done:** nothing of steps H0 to H3. **Follow-ups:** the [table at the end](#follow-ups).

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
| `person.local.public_origin` | `https` origin, not set | Added by [A46](#amendments-for-a-public-origin-behind-a-proxy): the page's origin behind a TLS-terminating proxy on this machine |

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
| `local` | A form posted to the loopback page with its CSRF token | Something on this machine reached the port, fetched the page and posted it | **That a person clicked, or which person.** An agent with a shell can start `person-page-serve` itself, fetch the form and post it; an agent driving a browser can click it. Loopback is shared by every account on the machine: another user can open the list and the previews, read what they show, and approve. The Origin, Host and CSRF checks stop another web site, not a local process or another local account |
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

### Amendments from step H2

Step H2 (sections 2 to 5 on the hosted page) found these points this document had wrong against
the code, or had not settled, and took the narrowest reading of each. None changes a decision row.

| # | Point | Decision |
| --- | --- | --- |
| A9 | Section 2 says the form "gains two fields beside `login`, `csrf` and `decision`", and then gives a new field `action` the values `approve` and `decline` that `decision` holds | One field for one choice, and the field keeps its name: `decision` takes `next`, `previous`, `approve` or `decline`. The knowledge plugin's relay tests post phase 5's form (`plugins/knowledge/tests/relay_kit/mod.rs:632`), which a host step may not change, so `page` may be left out and then names page 1, the only page an unpaged preview has. `login`, `csrf`, `page` and `decision` come at most once each and `k` repeated; any other field, a `page` outside 1 to 200, or a `k` that is not 0 to 99 is refused as a forged form is (`decide`, `src/person/page.rs`) |
| A10 | Section 2 sends `next` and `previous` to `GET <path>/d/<id>?page=<n>` and does not say how that request finds its login | By the browser's own login cookies: the page renders for the first of them (at most 8) that is a verified, live login of this decision in this browser (`login_cookies`, `page.rs:606`; `verified_login`, `src/shared/person.rs`). Without one, the address starts a login as before. A query other than one `page` is 404 (`open`, `page.rs:373`) |
| A11 | Section 2 offers Approve "only on a page reached after every page ... was rendered", and names "This request changed" for a bad position only | The store checks it again when Approve is posted: every page from 1 to `pages` recorded (`every_page_seen`, `src/shared/person.rs:155`). A page that could not be shown is not recorded, so it blocks Approve. Every post that names what was not rendered (a position past the page or repeated, a page not recorded, a move before page 1 or past the last, Approve before every page) answers `403` "This request changed" and records nothing (`Decided::Changed`, `decide`, `src/shared/person.rs:1130`) |
| A12 | Section 2 clears the record when the review changes and starts from page 1, and calls an item id "unique across all pages" without saying what a repeat does | A changed render clears the pages and the choices; the host then renders page 1 once more with the line. If that render changes again, the page offers only Decline (`respond`, `page.rs:870`). A page whose item id another recorded page lists is "could not be shown" and clears nothing (`Rendered::Duplicate`) |
| A13 | Section 3 keeps `previewHash` and does not say which page it hashes once there are several; v1's login row kept whether its one preview could be shown, and that gated Approve | `previewHash` is the hash of the page Approve or Decline was posted from (a Decline from a page never recorded: the first page the login rendered). A page's hash is the SHA-256 of `{ page, pages, heading, items }` as shown, after D97's cleaning (`PreviewPage`, `src/person/service.rs`). The login's `preview_ok` is still written and no longer gates Approve; the decision's pages do |
| A14 | Section 2's "the page is cut nowhere" might be read as applying only to a paged answer | It applies to every page, an exactly `{ preview }` answer included: one over 6000 characters, which the page used to cut and offer for Approve, now offers only Decline. Characters are counted after D97's cleaning, line ends not counted (`preview_page_of`, `src/person/service.rs:113`). The CLI's own rendering, which cuts and counts, is unchanged (`src/cli/preview.rs`) |
| A15 | Section 3 adds `pages` and `excluded` to the decision row and names no store change | The person store's schema becomes version 2: `decisions` gains `pages_total`, `pages` and `excluded` (JSON, ids only), `logins` gains `namespace` (A18). A version 1 file is migrated in place (`src/shared/person.rs:761`). A row whose `pages` or `excluded` cannot be read is unusable, never read as nothing pulled out |
| A16 | Section 2 makes `preview_page` host-owned "as `person_check` is" and names no carrier | The `extra` key `dev.umbel/preview-page`, `{ "preview", "page" }`, read by `person::page_of` (`src/person/mod.rs:389`) only for the preview it names, and cleared by the context hook on every MCP call (`src/principal.rs:501`), so an MCP call's context gains one `null` key and its context digest changes (`tests/context_hook.rs` updated) |
| A17 | Section 4 lets a login live "until its decision expires" and moves the decision's expiry, not the login's | A decision's login has ten minutes to come back from the provider (`LOGIN_START_TTL_MS`); verified, it takes its decision's expiry, and each render moves the rendering login's expiry with the decision's. A decision's expiry becomes the later of itself and the render's time plus `decision_ttl_s`, capped at a day after it began (`render`, `src/shared/person.rs`; `MAX_DECISION_LIFE_MS`). The cookie's `Max-Age` runs to that cap; the row, not the cookie, decides. **Freshness:** `auth_time` is still held to `max_age_s` at the return, and an Approve more than `decision_ttl_s` after the login's `auth_time` is refused ("Sign in again", `Decided::Stale`). This deliberately relaxes D115's `max_age_s` for the time a person reads a long review, bounded by the deployer's own setting |
| A18 | Section 5 says "a new login row with no decision, then the list" and leaves open which login issuer, how long, and how a link on the list is opened | The list's login row has an empty `decision` and its namespace: `?namespace=<id>` names it, else the page's only namespace, else a page of links, one a namespace (`list`, `page.rs:508`). It lives ten minutes (`LIST_LOGIN_TTL_MS`, `page.rs:66`), renders the list once at the return, and decides nothing. A link opens the decision's own page, which asks for its own login: phase 5 binds each verified decision to a fresh login for it, and the list does not loosen that |
| A19 | The plugin's follow-up C1-3: the `returns` a `confirm_preview` target must declare refuses section 2's paged answer | The rule admits, beside the required `preview` string, the optional members `page` and `pages` (`type = "integer"`) and `items` (`type = "array"`), still closed and requiring only `preview` (`is_preview_returns`, `src/plugins/manifest/v4.rs:203`). No other member is admitted |
| A20 | Section 9 asks `person_paged.rs` to show an unpaged preview "at the CLI and in the host's check" | The host's check is pinned there. The CLI builds its own context, which never carries the key; `page_of`'s unit test and `cli_confirm_preview.rs` (unchanged, the preview answering `{ preview }`) pin that half. `tests/person_paged.rs` also covers the duplicate id and the move refusals |

### Amendments from step H2's review

An independent review of step H2 found one blocker and seven smaller points; all are taken here.

| # | Point | Decision |
| --- | --- | --- |
| A21 | **Blocker.** A post named only its page and positions, which the store mapped to whatever that page held now: a second tab that showed the review again after it changed made the first tab's old form apply its positions to the new page's ids | The CSRF token binds the page shown: an HMAC of the decision, the login, the page number and the page's hash (`umbel/person/csrf/2`, `csrf`, `src/person/page.rs`). A post's token must match the page recorded under its number (or, for Decline only, the page that could not be shown), and the store refuses a move or an Approve whose hash is not that page's, in the same transaction (`Choice.hash`, `decide`, `src/shared/person.rs`). The form's fields are unchanged |
| A22 | A page recorded before that could not be shown on a later render stayed "seen" and counted toward Approve | A render that cannot be shown of a recorded page clears the pages and the choices, as a changed render does, and the person starts again from page 1 (`respond`, `page.rs`; `clear_pages`) |
| A23 | Two processes opening a version 1 store at once could both run the migration | The migration takes the write lock, reads the version again inside it, and adds the columns only if it is still 1 (`migrate_from_1`, `src/shared/person.rs`) |
| A24 | `GET <path>/d/` writes a login row per request, bounded only by the page's per-peer limit | At most 64 list logins started and not returned live at once (`MAX_LIVE_LIST_LOGINS`); past it, `429` |
| A25 | A `GET` with the login's cookie records a page and moves the expiry, whatever site linked to it | It renders for the cookie only when `Sec-Fetch-Site` is `same-origin` or `none`; otherwise it starts a fresh login (`open`, `page.rs`) |

### Amendments from step H3

Step H3 (section 6, the local page) found these points this document had wrong against the code,
or had not settled, and took the narrowest reading of each. None changes a decision row's columns;
the person store keeps schema version 2.

| # | Point | Decision |
| --- | --- | --- |
| A26 | 6.2 has the plugin gate's wrapper insert the mark "into the context it hands the handler". AFD's middleware cannot: `next()` takes no arguments and each link clones the context it was built with (`MiddlewareNext`, `packages/rust/src/commands.rs:896`; `middleware_chain`, `:2147`) | The gate holds the mark in `LocalMarks`, keyed by the call's trace id, while the call runs (`HeldMark`, dropped when it returns), and the host's wrapper around each plugin handler (`Shared2`, `src/plugins/loader.rs`) takes it, once and only for its own command, and runs the handler with the mark and `humanPresent` `{ level: "local", method: "local-page" }` in its context (`LocalMarks::take`, `src/person/mod.rs`). A command the handler runs in process under the same trace finds it taken. A call with no trace id is refused before anything is spent. A raw compiled plugin's finished definition (`PluginCommand::Definition`) has no host wrapper: its call is admitted and spent, and carries no mark, so it is told no decision and records no standing |
| A27 | 6.2 says AFD's own confirmation is `mcp.confirmations`, "default `off`" | Umbel's default is `enforce` (`src/workspace/config.rs:935`), so a locally registered command with a `confirm_prompt` first answers AFD's `CONFIRMATION_REQUIRED` asking for `confirm: true`. That acknowledgement is AFD's, outside the input and its digest, and grants nothing the plugin gate needs; the local arm's refusal follows it. The tests send it |
| A28 | 6.2 sets `HostVerified` "only when `person_page_served`" | Where no page is served the command is not registered for MCP at all, and stays `HostVerified` as before; only the local registration drops it (`person_mcp(command) && (hosted \|\| !served)`, `definitions`). `loader::person_mcp_served` (hosted or local) decides the registration, here and in `plugin-show` |
| A29 | 6.2 and 3 leave the local mark's `authTime` and `acr`, and what the plugin is told, open; A1 left how a stored row says `local` | The mark has `namespace` `local` and empty `authTime` and `acr`. The plugin is told `level = "local"`, an empty `namespace`, `auth_time` and `acr` (as `sdk/src/cx.rs` documents) and `person` the local person's subject. A row is a local decision when its `for` is the local person (namespace `local`, no issuer, no client) and it holds no `auth_time` or `acr` (`Decision::is_local`, `src/shared/person.rs`); its journaled `level` and `to_v2` say `local`. The hosted ledger never admits one (`Ledger::admit`), and the local page decides only one (`decide_local`; `decide` refuses one) |
| A30 | 6.2's `for_of_local` names the subject "the effective principal" | The effective principal string (`human:ada`, or `agent:local` without `principal.on_behalf_of`), which the decision schema's subject pattern admits. Besides `Transport::Stdio` and `Authentication::Process`, the caller's interface is MCP and its principal names no namespace or issuer. Refused otherwise with `PERSON_VERIFICATION_UNAVAILABLE` |
| A31 | 6.2 lists "None" and "Decided" and leaves a declined or expired decision open | The arm reads every row for the command and input digest, newest first (`PersonStore::for_call`), keeps the local person's, and takes the first that answers: pending and live, `CONFIRMATION_REQUIRED` with it again; approved and live, spent (`person:<id>`, then `person-run:<id>`) and its mark; declined, `CONFIRMATION_DECLINED`; pending past its expiry, `PERSON_DECISION_EXPIRED`. A declined or expired one is answered once, spending `person:<id>` as it is, so the call sent again begins a new decision. An approved one already spent is passed over. Begun decisions count under `person_pages_per_hour`, as on the hosted page |
| A32 | 6.4 names the envelope's schema and not the principal's, whose `humanPresent` admits only `terminal` and `verified`, and is `null` over stdio | `schemas/principal.v1.json` admits the third shape `{ level: "local", method: "local-page", at }`, over stdio only (refused at the CLI, over HTTP and from the library). Only the handler's context carries it; nothing journals it |
| A33 | 6.3 leaves the local page's `GET` and the form's fields open | Like A25, a page or the list renders only for a request whose `Sec-Fetch-Site`, when sent, is `same-origin` or `none`; one that sends none (not a browser, which no other site can drive) renders. The form has no `login` field, and a post that names one is refused. `/d/` takes no query; `/d/return` is 404. The page says it has no sign-in and that anything on this machine can open it |
| A34 | 6.5 adds a condition to the 6.6 clause for `<affirmed>` "under `verified_only` only", and does not say what a record affirmed at an unlisted level is then | `StandingView.levels` (`store/src/lane.rs`): for a call with `verified_only`, the space's `verified_levels`; empty otherwise. With levels, the clause admits `<affirmed>` at a listed level (`json_extract(c.assurance, '$.level')`), and attested or unverified only for a record that is not affirmed at all (`and_admitted`, `store-embedded/src/lane/standing.rs`): a record affirmed on the local page is left out, never read as attested in its place, and its label still says `affirmed` at level `local` wherever it is read. A lane decision and mark may record `local` (`DECISION_ASSURANCE_VERSION` is 4, `store/src/lane.rs`): a decision is a lane row, not an envelope. The store's conformance suite gains `levels_admit_an_affirmation_only_at_a_level_they_list` |
| A35 | The follow-up of H1's review: an event's envelope is capped at version 3 (`src/provenance.rs:432`) | Refuse, not version 4: the memory service maps a local mark to `Assurance::local()` (`svc_memory_confirm`, `src/plugins/memory_services.rs`), which a memory envelope, version 3, refuses, so no confirmation with `local` is recorded or journaled to be dropped. `tests/person_local.rs` pins the versions (`no_journaled_confirmation_carries_local`) |
| A36 | 6.2 calls the command `umbel person-page-serve` | The CLI projects `<domain> <action>`, so it is `umbel person page-serve` (or `umbel call person-page-serve`), the command `person-page-serve`. Category `person`; `person` is not added to the host domains, as neither `auth` nor `usage` is. "Operator only": any caller that is not the CLI's is refused with `COMMAND_NOT_EXPOSED`, in every mode (`commands::operator_only` refuses only in hosted modes). Input `{ open?: boolean }`; the address goes to standard error; it answers `{ list, bind }` when interrupted. Registered in every build; without the `auth` feature it refuses with `WORKSPACE_CONFIG_INVALID`, the message of 6.2 |
| A37 | 6.2 places the page in `src/commands/person_page.rs` and names nothing an embedder or a test serves | The command is there; the server is `Host::local_person_server` (`src/host/mod.rs`, `src/surfaces/http/person.rs`), as `person_server` is for mode `gateway`: the routes at the root, the page's body cap and its limit, plain HTTP, no `/health` and no per-IP layer. The person page's `Host` check, origin and CSRF switch on the service being local (`PersonPage.local`, `src/person/page.rs`); the CSRF label stays `umbel/person/csrf/2`, with `local` where a login id goes |
| A38 | Section 7 suggests "the person runs umbel person-page-serve" | The suggestion names `umbel person page-serve` (A36) |
| A39 | The doctor's check is named in section 10 and nowhere placed | `person.local`, after `http.config` and the hosted profile's checks, in every mode, skipped without a readable configuration: `pass` when the page is off, `warn` when it is on, naming 6.5's limit (`person_local`, `src/doctor.rs`). It is not one of `AUTH_CHECKS` |
| A40 | Section 9 places the local list's test in `person_local.rs`, and the follow-up in `person_pending.rs` | `tests/person_pending.rs` holds it; the local harness both use is `tests/support/local.rs`. The principal schema's local shape is pinned in `tests/schemas/phase5_records.rs`. The scope resolver follow-up is answered in `person_local.rs`: the local service is no hosted one, so `ScopePolicy::set_person` is never called and nothing is withheld; over stdio a command in `mcp.first_class_tools` is listed, and any locally registered command is callable by name |
| A41 | The security review of H3 (blocker): a mark a person makes on the local page makes a record attested, and the level filter of A34 held only affirmations | The attested arm under `levels` holds the mark that makes the document the person's own to the same levels (`json_extract(o.assurance, '$.level')`, `push_marked`, `store-embedded/src/lane/standing.rs`); an own collection needs no mark and is unaffected. A record attested only through a local mark is left out of a call for verified content unless the space lists `local`. The conformance case `levels_admit_an_affirmation_only_at_a_level_they_list` gains such a record, and `records_standing.rs` a case end to end |
| A42 | `Decision::is_local` reads a hosted namespace named `local` (a CLI decision has no issuer or client) as the local page's | `local` is reserved as a namespace id in every configuration version (`namespaces`, `src/workspace/hosted.rs`; `workspace-config.v7.json`) |
| A43 | 6.5 and the doctor said nothing of other accounts on the machine | The doctor, every local page (the list included) and 6.5 say that loopback is shared by every account, which can read the list and the previews and approve |
| A44 | The gate spent a decision before it knew it could hand the mark over | The local arm reserves the call's slot first (`LocalMarks::reserve`, then `HeldMark::fill`); a call with no trace, or one whose trace another call in flight holds, is refused before anything is spent |
| A45 | A memory confirmation under a local mark was refused by the store with a message that did not name `local`, and the doctor did not name a space that admits `local` | `svc_memory_confirm` refuses it first, naming level `local`; the doctor's `person.local` warns, page or no page, for each space whose `verified_levels` lists `local`. `person_local.rs` adds a race of two calls after one approval, mode `gateway` refused, the binds `[::]` and `[::ffff:127.0.0.1]` refused and `[::1]` served, memory confirmation end to end, and a pipeline whose step needs its own decision: the local registration is not `HostVerified`, so AFD admits it as a step, and the step meets the gate as a call of its own |

### Amendments for a public origin behind a proxy

The plugin's first use (its specification's F-4) found that the local page cannot be used from another of the
deployer's own computers through a proxy: the page answers only a `Host` that is the bind and a post whose `Origin` is
`http://<bind>`, and the links the host hands out name `127.0.0.1`. The SSH tunnel stays the way without a proxy. This
adds one optional key; without it nothing changes. Mode `oauth`, mode `gateway` and `[http.person]` are untouched.

| # | Point | Decision |
| --- | --- | --- |
| A46 | 6.1 has no way to name the origin a proxy serves the page at | `person.local.public_origin`, optional, not set by default, e.g. `"https://garden-host.example-tailnet.ts.net:8443"`: an origin a TLS-terminating proxy on this same machine (a private-network HTTPS proxy, say) forwards to the loopback bind. Checked at open, each refusal a `WORKSPACE_CONFIG_INVALID` naming the key (`public_origin`, `src/workspace/person.rs`): the scheme is `https`; no user information, query or fragment; no path but `/`; the host in its canonical form, lowercase (`check_canonical_host`, as `http.person.public_url`'s); a port written with no leading zero. It is kept as a browser's `Origin` writes it: a trailing `/` and an explicit `:443` are dropped. `person.local.bind` stays loopback, as 6.1 already requires. The schema `workspace-config.v7.json` gains the key with a pattern; the host's rules are the stricter |
| A47 | 6.3's `Host` and `Origin` rules name the bind only | With the key set, the local page (`PersonPage.public`, `src/person/page.rs`) also admits a `Host` naming the public origin's host, case-insensitively, and port, a port not written being 443 on either side; and a post whose `Origin` is exactly the public origin. The two are accepted independently, since a proxy may or may not rewrite `Host`: `Origin` public with `Host` the bind passes. The bind's `Host` and `Origin`, and `null` with `Sec-Fetch-Site: same-origin`, are unchanged. Every link, form action and redirect the page writes is relative (`/d/...`), and the local page sets no cookie (6.3), so the page works unchanged under either origin; there is no `Secure` cookie to break plain HTTP on the bind. The page's own notice adds that it is also served at the public origin, so anything that reaches that address can do what anything on this machine can |
| A48 | Section 7's `CONFIRMATION_REQUIRED` and `person-page-serve` name `http://<bind>` | The links the host hands out use the public origin when set (`PersonService::links`, `src/person/service.rs`): the error's `url` and `list` and its message, `PersonService::url` (the CLI's and the relay's link, which today reach only a hosted page: the local page is not served to the CLI, 6.2), and the list `umbel person page-serve` prints, opens with `--open` and answers. It still binds `person.local.bind`, and says so. The suggestion's wording ("in a browser on this machine") is unchanged |
| A49 | 6.5 and the doctor assume only this machine reaches the page | The doctor's `person.local`, while the page is enabled and the key is set, adds to its warning that anyone who can reach that origin can confirm the local person's decisions with no login, so it must be reachable only on a private network the deployer controls, through a proxy on this same machine. It stays a warning, not a failure, and its other wording is unchanged. A `local` decision still records `local`: what reaches the page through the proxy is no better proven than what reaches the bind |
| A50 | Whether the key needs configuration version 8 | No: added to version 7 additively, as D188 adds keys, since it is optional with today's behaviour as its default and nothing outside this repository reads version 7. `config_version` stays 7, and `umbel init` writes no new key. Tests: `tests/person_local.rs` (the public `Host` and `Origin` admitted, others refused, `Origin` public with `Host` the bind, the default port's two spellings, the links handed out, the refusals at open, the doctor), `tests/config_v7.rs` (the schema and the host agree), and the unit tests of `public_origin` |

## Follow-ups

| Date | Raised by | Follow-up | Where it goes |
| --- | --- | --- | --- |
| 2026-11-12 | This specification | Revised after an independent review the same day (three blockers, nine improvements, all taken: the registration path, the unpaged preview, the stored assurance, the page's fields, the local page's rules, H0, the lifetime) | A focused pass on the revision, before H0 |
| 2026-11-12 | This specification | Whether the scope resolver, which lists a person-gated command only to callers whose namespace serves verified commands (`loader.rs:1353` to `:1357`), filters anything in mode `none`, where `filter_tools_by_scope` gates `person_page_served` (`loader.rs:1348`) | H3: done, A40. Nothing is withheld in mode `none` |
| 2026-11-12 | The plugin's step C1 | A `confirm_preview` target must declare `returns = { preview: string }` with `additionalProperties = false` (`src/plugins/manifest/v4.rs:197`), which refuses section 2's paged answer with `items`. The plugin declares that `returns` today (its amendment C1-3) | Step H2: done, A19. The plugin's `ideas-review-preview` may now declare `page`, `pages` and `items` (step C4) |
| 2026-11-13 | Step H2's review | The list's namespace chooser names the page's namespace ids before any sign-in (`list`, `src/person/page.rs`), and `pending_for` reads every pending row and filters by person in Rust, with no index on the person (`src/shared/person.rs`) | Open; the chooser only when several namespaces have a person login, the scan bounded by `person_pages_per_hour`. An index on `for`'s namespace and subject if a deployment holds many pending decisions |
| 2026-11-13 | Step H2's review | A14 makes the page refuse to approve a page it would cut, but the CLI's prompt still shows a cut preview with "(N lines not shown)" and lets the person confirm it (`src/cli/preview.rs`, D97). The plugin's step C3 refuses an over-long terminal confirmation on its own side | Open: phase 4's D97 and `tests/cli_confirm_preview.rs` specify the cut, so changing the CLI is a decision of its own, not a part of H2 |
| 2026-11-13 | Step H2 | The list of pending decisions on the local page, which has no login (section 5, "on the local page for the local person") | H3: done, A33 and A40 |
| 2026-11-12 | Step H1's review | An event's envelope is capped at `PROVENANCE_VERSION`, 3 (`src/provenance.rs:432`), so `is_confirmation(.., 3)` would silently drop a journaled confirmation whose assurance is `local` from the event, where the store keeps it in version 4 | H3: done, refused (A35) |
| 2026-11-13 | Step H3 | A raw compiled plugin's finished definition is admitted on the local page and told nothing (A26) | Open: no first-party plugin answers items that way. Give `CommandDefinition` a host wrapper in AFD, or refuse such a command a local registration |
| 2026-11-13 | Step H3 | The doctor's `person.local` cannot see whether a `person-page-serve` is running, and nothing tells the agent's harness that the page is down beyond the refusal's suggestion | Open: a probe of `http://<bind>/d/` like `auth.person_listener`'s, if the owner wants one |
| 2026-11-14 | The plugin's first use, F-4 | A host option to use the local page through a proxy on another of the deployer's computers | Done, A46 to A50 |
