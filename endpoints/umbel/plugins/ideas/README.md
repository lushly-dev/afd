# ideas

The `ideas` plugin of AFD Umbel: a store of a person's ideas, each a few sentences, typed, kept
for good, matched against what is held, and marked by whether the person affirmed it. The design
is in the [plugin specification](../../docs/plugins/ideas/spec.md).

Agents capture, match, ask and find; the person confirms an agent's proposals in bulk. Each idea's
wording is a standing record of the host's record lane: the host computes its standing, and only
the space's person affirms it, inside a call they confirmed.

## Commands

| Command | Does | Surfaces |
| --- | --- | --- |
| `ideas-capture` | Saves one or many ideas, each with the nearest held ideas and their bands | MCP, CLI |
| `ideas-match` | The nearest held ideas to statements or to held ideas, saving nothing | MCP, CLI |
| `ideas-ask` | The held ideas that bear on a question, ranked, the seeds among them named | MCP, CLI |
| `ideas-find` | Lists ideas by type, tags, standing, who said them, state and text | MCP, CLI |
| `ideas-open` | One idea, its wordings, its standing and its decisions | MCP, CLI |
| `ideas-guide` | The types, standings, bands, limits and counts | MCP, CLI |
| `ideas-export` | Every record of the space in pages, the last with a manifest | CLI |
| `ideas-import` | Restores an archive, affirming again as the person at a terminal | CLI |

The review commands are section 8's: an agent stages proposals with `ideas-review-stage`, and
the person confirms a part with `ideas-review-apply`, reading it in pages on the local person
page and unchecking what they disagree with, or at a terminal. `ideas-review-report` reads what
the person decided.

## A local instance

One person, one machine, an agent over stdio, and the local person page for review (the
specification, sections 9 and 11). It needs the `umbel-first-party` binary, which compiles this
plugin and `memory` in, and the review host's local page, which needs its `auth` feature:

```sh
cargo install --locked --path endpoints/umbel/first-party
mkdir -p ~/ideas
```

Write `~/ideas/umbel.toml`:

```toml
config_version = 7
default_space = "garden"

# The stdio agent acts for the person, so its captures are theirs.
[principal]
local_id = "gardener"
on_behalf_of = "gardener"

# Only the space's person affirms.
[spaces.garden]
person = "human:gardener"

[plugins]
enabled = ["memory", "ideas"]

[plugins.memory]
source = "compiled:memory"

[plugins.memory.grants.memory_write]
allow = ["garden"]

[plugins.ideas]
source = "compiled:ideas"

# The agent, the operator and the page read the same records.
[plugins.ideas.grants.records_write]
allow = ["garden"]
default_access = "space"

# A long review is read in one decision.
[person]
decision_ttl_s = 3600

[person.local]
enabled = true
bind = "127.0.0.1:7421"

[mcp]
first_class_tools = ["ideas-capture", "ideas-ask", "ideas-guide", "memory-remember"]
instructions = """\
Umbel is an AFD server. Every tool returns a CommandResult as JSON text: { success, data, error: \
{ code, message, suggestion } }; follow error.suggestion to recover. The command tools listed \
are the common ones. Call afd-discover to find others, afd-detail for a schema, and afd-call to \
run one. Use afd-batch for several independent commands and afd-pipe to chain them. This \
instance keeps the person's ideas. When they share a view, a claim or a question they want kept, \
save it with ideas-capture, not memory; facts about the person and how to work with them go to \
memory-remember. When they ask what they think, or want something written in their voice, call \
ideas-ask and use only the ideas that bear on the question. Ideas the person has not affirmed \
are marked seed; say so when you rely on one. To review, stage proposals with ideas-review-stage \
and give the person the page address ideas-review-apply returns."""
```

The space's `verified_levels` is left at its default, so `ideas-ask` with `verifiedOnly` leaves out
what was affirmed on the local page (the specification's section 17, row 16). With more first-party
plugins enabled, add their tools to `first_class_tools`, up to eight: `components-brief`,
`context-bundle`, `knowledge-search` and `knowledge-open` (section 11.1). The host refuses a name no
enabled plugin registers.

Give the agent's harness the server over stdio, and keep the page served in a terminal while the
person reviews:

```sh
umbel-first-party --workspace ~/ideas serve --stdio
umbel-first-party --workspace ~/ideas call person-page-serve '{"open": true}'
```

`--workspace` goes before the verb. After `call <command>`, every word is the command's input, so
a `--workspace` there is refused with `INVALID_INPUT`.

Then:

1. The person talks; the agent captures with `ideas-capture`, and answers in their voice only
   after `ideas-ask`.
2. When seeds have piled up, the agent stages a review with `ideas-review-stage`, in groups. Each
   `affirm`, `decline` and `reword` names the held wording's `version`; a `duplicate` names
   `idea` and `keep`.
3. The agent calls `ideas-review-apply` with part `"*"` and the digest. Over MCP that takes two
   refusals before the page:
   - The first call is refused by AFD, `CONFIRMATION_REQUIRED` with no page address, because
     the command needs an acknowledgement. Its suggestion says how to send one. Through
     `afd-call`, `confirm: true` goes beside `command` and `input`, not inside `input`:
     `{ "command": "ideas-review-apply", "input": { "review": "...", "part": "*", "digest": "..." }, "confirm": true }`.
     Through the command's own tool, when `first_class_tools` lists it, `confirm: true` goes
     among its arguments. A harness that shows a confirmation form instead has the same effect
     when the form is accepted.
   - The call with `confirm: true` is refused by the host, `CONFIRMATION_REQUIRED` again, now
     with the page's address in `error.details.url`. The agent gives the person that link.
4. The person reads every page in the browser, unchecks what they disagree with, and approves on
   the last page. The agent sends the same call again, with `confirm: true`: what was unchecked
   is pulled, the rest applied at level `local`.
5. `ideas-review-report` says how the reviews went: what was declined and pulled, how often a
   folded duplicate was among capture's candidates, and the common rewordings.

`tests/ideas_first_use.rs` in `first-party` walks these steps on this file as written, over
`afd-call`, and runs every `umbel-first-party` command in this README's `sh` blocks through the
binary's own argument parser.

### Reading the page from another computer

The page listens only on loopback: it checks that a request's `Host` is `127.0.0.1:<port>`, and
that a form's `Origin` is the page's own. A browser on another computer, through a plain HTTP
proxy on a LAN or tailnet address, fails those checks, and "Next page" is refused.

**On a private network you control, name the page's public origin.** Put a TLS-terminating
HTTPS proxy on the serving computer itself, reachable only on that private network (a tailnet's
own HTTPS proxy, for one), forwarding to `http://127.0.0.1:7421`, and tell the page its address:

```toml
[person.local]
enabled = true
bind = "127.0.0.1:7421"
public_origin = "https://garden-host.example-tailnet.ts.net:8443"
```

Use the proxy's private-network serving only, never a mode that publishes the address to the
internet (no public "funnel" exposure). The origin must serve this page alone, with nothing else
mounted at another path on it. The proxy must pass the browser's `Host` on unchanged, port
included, or set it to the bind, `127.0.0.1:7421`: a proxy that drops the port gets 421.

The page then also accepts that origin's `Host` and a form posted from it, and the link the
agent gives, the list `person-page-serve` prints, and `--open` name the public origin. The
origin must be `https`, with no path, query or user information. `umbel doctor` warns while it
is set: anyone who can reach that origin can approve the person's decisions with no sign-in, so
never expose it beyond a private network you control, and keep the proxy on the computer that
serves the page.

**Otherwise, an SSH tunnel** from the computer you browse on to the one that serves the page:

```sh
ssh -L 7421:127.0.0.1:7421 <the serving computer>
```

Then open the link the agent gives, unchanged. The browser sees `127.0.0.1:7421`, a loopback
address and a secure context, so both checks pass. Either way, do not serve the page on a
network address itself: it has no sign-in, and whoever reaches it can approve the person's
decisions.

### The paragraph for the server's instructions

A deployer's `mcp.instructions` replaces AFD's default whole, so the paragraph starts with the
default's sentences for the hybrid strategy (section 11.2). It is the text above, and
`tests/instructions.rs` holds that the three agree:

> Umbel is an AFD server. Every tool returns a CommandResult as JSON text: { success, data, error: {
> code, message, suggestion } }; follow error.suggestion to recover. The command tools listed are
> the common ones. Call afd-discover to find others, afd-detail for a schema, and afd-call to run
> one. Use afd-batch for several independent commands and afd-pipe to chain them. This instance
> keeps the person's ideas. When they share a view, a claim or a question they want kept, save it
> with ideas-capture, not memory; facts about the person and how to work with them go to
> memory-remember. When they ask what they think, or want something written in their voice, call
> ideas-ask and use only the ideas that bear on the question. Ideas the person has not affirmed are
> marked seed; say so when you rely on one. To review, stage proposals with ideas-review-stage and
> give the person the page address ideas-review-apply returns.

It does not tell an agent to call `ideas-guide` first: in phase 0.10 that led one model to call it
before every request.

## Leaving with everything

`ideas-export` answers pages of at most 1000 items; a writer of files keeps each page:

```sh
after=""
n=0
while :; do
  input=$(jq -nc --arg after "$after" 'if $after == "" then {} else { after: $after } end')
  page=$(umbel-first-party --workspace ~/ideas call ideas-export "$input")
  n=$((n + 1))
  printf '%s\n' "$page" > "ideas-archive-$n.json"
  after=$(printf '%s' "$page" | jq -r '.data.next // empty')
  [ -z "$after" ] && break
done
```

`ideas-import` reads one page at a time, at a terminal, as the space's person.

## Limits

Statements of 1 to 600 characters on one line; 64 ideas a capture; 0 to 8 tags each. Stored text
is data, not instructions: a statement is never in a message, a suggestion, a detail or a log line.
