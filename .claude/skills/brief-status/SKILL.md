---
name: brief-status
description: >
  Writes a short, visual status brief for the owner on one area of work: decisions
  needed, where it stands, what's next, risks and how the work is going. Use when
  asked for a status brief, a readout or "where are we on X?"; to close a session, use
  do-end-session.
argument-hint: "[area]"
metadata:
  source: afd
  version: 0.1.0
  portable: true
---

# Brief status

The brief is a page the owner reads in about five minutes to get back up to speed
and make the calls only they can make, the way a team briefs a VP after a month on
a feature. It is short-lived: the status document stays the record, and the page is
never committed.

## Scope

The argument names the area: a unit, feature, epic or issue. Without one, brief the
area this session is working in, and ask only when there is neither. Cover what has
happened since the last brief recorded in the area's status document (`STATUS.md`
in this repository), or since the work began if none is recorded.

## Gather

- **Start from the status document, then check it against the code.** It is often
  behind: merged steps still read "in review". Where it and `main` (merged PRs, the
  log) disagree, `main` wins. Say so in the brief and correct the document. A long
  one needs only its tables and its latest session-log entries.
- **Read the owner's decisions before judging.** A direction the owner chose
  (recorded in the status document, a spec or agent memory) is not drift or scope
  creep. If the evidence says it is costly, raise it as a decision with that
  evidence instead.
- **Look past the repository when the host allows.** If you can list recent sessions
  on the area, skim their endings for questions raised but never recorded.
- Label estimates, approximate counts and your own judgement as such.

## Shape

- **Decisions come first.** The first screen gives the status in one sentence (on
  track, at risk or blocked) and the decisions needed. Each decision has the question,
  the options, a recommendation, and what it blocks if left open.
- **Then the story:** what landed as outcomes in plain words rather than step by step;
  the next one to three moves; the risks that change a plan or a decision; and a review
  of how the work is being done (rework, review rounds, CI reruns, time spent waiting),
  with evidence and one to three proposed changes.
- **Cut to what the owner needs to decide.** Where a section restates a spec, reduce it
  to a line and a link.
- **Link everything you cite:** every PR, issue, commit and file, as full URLs.

## The page

One self-contained HTML file, written outside the working tree (the host's scratch or
temp directory). Follow the repository's design system, its colours and type, if it
has one; otherwise use your judgement. Add diagrams, illustrations, callouts or motion
where they explain something.

Render it and look at it at desktop and phone widths before showing it: hand-placed
diagram labels overlap. Then show it as a private artifact or page if the host
offers one, otherwise give the file's path.

## Afterwards

Record the brief's date in the status document's session log, so the next brief
knows where to start. When the owner answers a decision, record the answer where the
area keeps its decisions, and update the spec questions or issues it settles.
