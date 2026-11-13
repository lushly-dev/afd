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

## An instance

The plugin declares no `[config]`. Everything an instance tunes is its `vocabulary` pack: the
types, the provisional bands and the limits, replaced whole by a space override. An instance for
one person lets the whole space read what is written:

```toml
[spaces.garden]
person = "human:local"

[plugins.ideas]
source = "compiled:ideas"

[plugins.ideas.grants.records_write]
allow = ["garden"]
default_access = "space"
```

## Leaving with everything

`ideas-export` answers pages of at most 1000 items; a writer of files keeps each page:

```sh
after=""
n=0
while :; do
  page=$(umbel ideas-export ${after:+--after "$after"})
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
