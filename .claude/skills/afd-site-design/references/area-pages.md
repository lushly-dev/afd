# A tool's page

How to build the page for one member of the AFD family (Violet, Specimen, …), on
either side. Part of the two-site proposal on `lush/site-two-doors`.

## It is not a template

Each page gets the sections its tool needs. Violet's design page is long, with a
live token tree. Specimen's turns on a comparison and a brief for agents. What they
share is the opening, the section scaffold and a handful of parts. Don't force a tool
into another tool's outline.

Give a tool both sides only when each has something to say. The dev side shows
commands, code and packages. The design side shows what a person sees and what an
agent is told.

## The product hero

Someone who lands here knows what the tool is before they scroll. In order:

| Part | Class | Rule |
|------|-------|------|
| Crumb and status | `.opening-label` with `.crumb`, `.edition` | The side's home, then the name in `<b>`. The status opens with its ladder word and carries `data-maturity` ([patterns](patterns.md)). |
| Name | `h1.area-name` | The tool's name, as the display word. Eight letters or more: add `.area-name--long`. |
| What it is | `p.area-is` | One heavy line naming the kind of thing, then a thin line in a `<span>`. "A design token engine." |
| Description | `p.area-lead` | 15 to 35 words. What it does and for whom, in plain words. |
| The way in | `.opening-actions` | One button to the page's demo, one text link. |
| Install | `p.hero-install` | Dev side only: the line and a Copy button. |
| Proof | `figure.area-figure` | One small picture drawn by the tool itself, with a caption row and a `.hero-answer` sentence read from the same run. |
| Facts | `dl.hero-facts` | Three, under a rule: a count, a way in, a difference. |

```html
<section class="opening opening--area" id="top">
	<div class="opening-art" aria-hidden="true"><span class="slash"></span></div>
	<div class="wrap">
		<div class="opening-label">
			<span class="crumb"><a href="../">Agent-First Development</a> / <b>Violet</b></span>
			<span data-maturity="violet" class="edition">Preview, on npm</span>
		</div>
		<div class="area-hero">
			<div class="area-hero-text">
				<h1 class="area-name">Violet</h1>
				<p class="area-is">A design token engine.<br><span>Every change is a command.</span></p>
				<p class="area-lead">…15 to 35 words…</p>
				<div class="opening-actions">…</div>
				<p class="hero-install"><code>npm install …</code><button type="button" data-copy-inline>Copy</button></p>
			</div>
			<figure class="area-figure">
				<figcaption><span>One command</span><span>Three callers</span></figcaption>
				…the proof…
				<p class="hero-answer"><span class="mono">The same answer</span><span data-hero-answer>…</span></p>
			</figure>
		</div>
		<dl class="hero-facts">…three <div><dt><dd></div>…</dl>
	</div>
</section>
```

The design side adds `opening--design` (mint) to the section. No crop marks, and only
the wide slash.

## Sections

```html
<section class="d-section d-section--ink" id="terminal">
	<span class="big-numeral" aria-hidden="true">03</span>   <!-- colour fields only -->
	<div class="wrap">
		<div class="editorial-heading">
			<span class="section-index"><span class="fig-chip">Fig. 01</span>The commands</span>
			<h2>Call it.<br><span>The tree answers.</span></h2>
		</div>
		<p class="d-lead">…</p>
		…
	</div>
</section>
```

`--rest` (cream), `--ink` (demos), `--deep` (packages, the foot) and `--agent` (mint:
the part about the agent). The salmon slab (`.slab`) is a page's one line, once, at
least two sections after the hero. Follow the field placement rules in `SKILL.md`.

A demo section opens with `p.surface-hint`: "Try it", then one sentence saying what
to do and what is real.

## Shared parts (`css/area-kit.css`)

| Part | Classes | For |
|------|---------|-----|
| Marks | `.mark[data-mark]` | A status, a basis, a result. See `SKILL.md`. |
| Chips | `.chips` (dark), `.chips--light` | Pick one of a few. `aria-pressed`, or `role="tab"` with `aria-selected`. |
| Code behind tabs | `.code-tabs` with `.command-source` panels | Several ways to use the tool. `initTabs()` from `js/util.js`. |
| Two results | `.result-pair`, `.result-notes`, `.result-live` | A success beside a failure. |
| Package layers | `.layers`, `.layer`, `.layer-wide` | Endpoints on top, foundation at the bottom. On deep green. |
| Install rows | `.installs` with `.install-command` | One row per layer, each with a copy button. |
| Where it runs | `ul.family-list.runs-list` | A name, a sentence and a command per row. |
| Steps | `ol.steps` | A short process in order, on a dark field. |
| A recorded run | `.record` with `.record-list`, `figure.command-source.record-out`, `p.record-foot` | For a tool that cannot run in a tab: a button per line of one real run, what the tool printed, a sentence on what to notice, and a line saying when and from what it was recorded. |
| One command, each caller | `figure.area-figure.hero-callers` | A hero's proof: the same call written for the CLI, for code and for an agent, then the one answer. |
| The foot | `.area-start`, `.area-status`, `.start-links` | How to start, and where the tool stands. |

A part a second tool's page needs moves here under a neutral name. One tool's own
figures stay in `css/<tool>.css` (both sides) and `css/<tool>-dev.css`.

## The demo runs the tool

The page is not a description of the tool: it runs it.

- **Violet** bundles the real command registry and an in-memory store
  (`scripts/build-site-violet.mjs` → `js/vendor/violet.js`). The tree on the page is a
  live store, and every edit is a real command.
- **Specimen** renders in Chromium through a native host, which a tab cannot start.
  Its other half needs neither: a capture is a JSON file and comparing two is a plain
  function. `scripts/build-site-specimen.mjs` runs the real host over a small project
  in `site/specimen/bench/`, and writes the captures, the theme audit and a component
  pack as the tool emits them. The page compares them with the real `specimen-diff`
  command. Commands that need the host fail the way a command reports any failure,
  with a code and a suggestion.

- **Umbel** is the MCP server for an AFD repo, built from plugins. It is a native
  program, so none of it runs in a tab. `scripts/build-site-umbel.mjs` makes a real
  workspace inside the repository with one plugin that ships with Umbel (fed by
  Specimen's pack) and the repository's own AFD server mounted as a second, runs a
  fixed list of commands and one MCP session, and writes each line with its exit code
  and exactly what Umbel printed to `site/umbel/runs.json`, with the manifest and the
  configuration as used. The pages show that run and say it is recorded. One thing does run in the tab: the page recomputes
  the pack's digest from the pack's files and compares it with the one Umbel printed.
  A result that names a path on the build machine is refused, so `workspace show` is
  not recorded.

- **Botcore** is a Python package, so none of it runs in a tab either. It has a dev
  side only. `scripts/build-site-botcore.mjs` makes a small Python project in a
  temporary directory and records, with the real package: `botcore init` in a Python, a
  TypeScript and a Rust project; one MCP session (the tool list, the start answer, a
  page of reference, a lint that fails, the fix, the tests); the skills before and
  after they drift, with `skill-seed --update`; a plugin that adds a command; and the
  same commands registered one tool each with the same MCP library. It writes
  `site/botcore/runs.json`. What runs in the tab is the arithmetic: the page counts, in
  bytes, what each kind of tool list makes an agent read, and the reader chooses which
  pages of reference the agent opened. Botcore prints absolute paths, so the script
  writes the temporary directory as `<workspace>`, says so on the page, and changes
  nothing else.

- **FAST-AF** is a component library and its runtime, and all of it runs in a tab.
  `scripts/build-site-fast-af.mjs` bundles every component with the runtime calls the
  page makes (`js/vendor/fast-af.js`), bundles Microsoft's own FAST Element from npm at
  the release FAST-AF carries (`js/vendor/ms-fast-element.js`), and writes the
  component pack, unedited, with versions read from the packages and the provenance
  record (`site/fast-af/library.json`). The page mounts the markup a story rendered,
  taken from the pack, so every example is a live component; listens for the events the
  record names; wires three components to this site's command registry and prints the
  wiring function it is running; and runs one scoped-registry test on both runtimes
  from the same function. A claim about how FAST-AF differs from FAST is that test's
  result, not a sentence. Components are mounted in a stage, a shadow root that holds
  their theme, so the site's styles and theirs stay apart. Mount parsed markup with
  `document.importNode`, which upgrades the elements before they connect; `innerHTML`
  connects a parent before its children are components.

So: find the part of the tool that can really run in a tab and build on it. For the
rest, use what the tool wrote, unedited, and say which is which. Rebuild the vendor
bundle and the data when the tool changes; both are committed, so the site deploys
without a build. Captures record the Git revision, so recapture after committing.

When nothing of a tool can run in a tab, find something the page can check for itself
about the recorded result (a digest, a count, an equality), so the page is still doing
work and not only showing a transcript.

Read every number from the run: counts in a hero, a status, a sentence that sums a
result up. A page script may hold what something *means* ("It stays the same and
nothing says it should"); the tool's own word and number come from the data.

## Words

- Name the kind of thing in the first screen. A heading like "Call it. The tree
  answers." belongs further down, once the reader knows what "it" is.
- A status block (`.area-status`) says what is released, what is not, and what the
  tool does not do yet. Keep it current with the tool's README. A tool that is not
  released says so in the hero's corner ("In development, not released") and offers a
  build line where a released one offers an install line.
- A figure that describes something the page cannot run says so in a line under it
  ("described, not run"), with the reason.
- When two things on the page look the same on purpose, say so beside them, and draw
  them so the point is visible: Specimen's theme audit puts each picture on the page
  colour of its theme.
- Plain words for the design side (a "screen", a "picture"); the tool's own keys for
  the dev side (`dom`, `a11y`).

## Links

- The nav's switch links the same tool on the other side; the footer does too.
- Each home page's family row links to the tool's page on its own side.
- A tool with a page on one side only points the switch at the other side's home.

## Before you write a claim, run it

A tool's README is a claim, not evidence. Botcore's said its commands could be called
in process through `get_client()`, that the run tool's output was capped at 8 KB and
that it shipped nine skills; the run or the source showed otherwise on each. Its start answer also
named a function the run tool could not call. The page says only what the recorded
run shows, and anything the run contradicts goes to the owner as a finding, not onto
the page as copy.
