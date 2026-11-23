# Epics

An epic is the one issue for a body of work that takes several pull requests: a
feature in `docs/features/`, a Loam or Umbel phase, or an initiative with its own
plan. It gives the work a single entry point that issue lists, the owner's focus
view and the factory can read. Progress itself lives in the plan or `STATUS.md`,
not in the epic.

## When to open one

- A proposal moves to `active/`, or a phase specification is approved: the session
  that does it opens the epic. A proposal the owner is actively shaping may have
  one before that (Patterns, Pointing and their siblings do).
- Three or more issues already serve one outcome that has a plan: open the epic and
  attach them.
- Not for a single issue with a checklist, a polish backlog, a rolling log, or a
  proposal nobody is working on; those stay ordinary issues.

Look before opening: the `Epic:` line under the title of the area's `STATUS.md`,
and `gh issue list --search "type:Epic"`. Also search titles
(`gh issue list --search "Epic in:title"`), which finds an epic whose type was
never set.

## Shape

- **Type `Epic`**, the organization's issue type, which is what tools query. A
  title prefix alone is not an epic; set the type on one that lacks it with
  `updateIssueIssueType` (see [The GraphQL calls](#the-graphql-calls)): `gh`
  2.88.1 has no `--type` flag.
- **Title** `Epic: <name>, <the outcome in a clause>`. Lushly's epics use
  `epic(<area>): <outcome>`, its own convention; tools match either.
- **Body:** the outcome in a sentence, the plan or `STATUS.md` as a full
  `https://github.com/lushly-dev/afd/blob/main/...` URL, and the line "This is an
  epic: work happens in its sub-issues, and its plan or STATUS document is the
  source of truth for progress." A dated summary may follow; never keep live
  progress in the body, where it goes stale.
- **Labels:** `status:deferred`, `type:feature` and the area labels, with no
  execution profile. The type and that body line are the deferral reason, so an
  epic needs no deferral comment. Triage never dispatches an epic; it dispatches
  the sub-issues.
- **The plan links back:** the line under the title of its `STATUS.md` (or phase
  specification) reads `Epic: [#<n>](<issue URL>).`

## Sub-issues

Attach children as real sub-issues with `addSubIssue`, and detach one with
`removeSubIssue` (see [The GraphQL calls](#the-graphql-calls)), then read the
link back. A "Parent: #N" line in a body is invisible to every tool that reads
the tree.

- An issue has one parent, and a parent holds at most 100 sub-issues.
- A follow-up filed from a plan, a specification or a review goes under its epic
  when it is filed, not in a later sweep.
- Nest an epic under a programme epic when its plan is one phase of a larger one:
  Loam's active phases sit under the Loam epic. Keep it to two levels.
- An issue that serves no epic stays unparented; don't force a fit.

## The GraphQL calls

`gh` 2.88.1 (2026-03-12), on at least one of the owner's machines, has no
`--parent`, `--remove-parent` or `--type` flag on `gh issue create` or
`gh issue edit`, so use these calls, which work on any `gh`. Each takes node ids;
look one up by number:

```bash
gh api graphql -F n=<number> -f query='query($n:Int!){repository(owner:"lushly-dev",name:"afd"){issue(number:$n){id}}}' --jq .data.repository.issue.id
```

- **Attach:** `addSubIssue` with `issueId` the epic's id and `subIssueId` the
  child's. "Issue may not contain duplicate sub-issues" means it is already
  attached there.

  ```bash
  gh api graphql -f epic=<epic id> -f child=<child id> -f query='mutation($epic:ID!,$child:ID!){addSubIssue(input:{issueId:$epic,subIssueId:$child}){issue{number}}}'
  ```

- **Move** a child that has another parent: the same call with
  `replaceParent:true` beside `subIssueId`, which takes it from its old parent.

- **Detach:** `removeSubIssue`, with the same two inputs.
- **Type `Epic`:** `updateIssueIssueType` with `issueId` and `issueTypeId`. Read
  the type's id from the organization, never from memory:

  ```bash
  gh api graphql -f query='{organization(login:"lushly-dev"){issueTypes(first:20){nodes{id name}}}}'
  gh api graphql -f id=<issue id> -f type=<Epic type id> -f query='mutation($id:ID!,$type:ID!){updateIssueIssueType(input:{issueId:$id,issueTypeId:$type}){issue{number issueType{name}}}}'
  ```

- **Read back** every change; the call succeeding is not the proof. The child
  names its parent, and the epic lists the child and its own type:

  ```bash
  gh api graphql -F n=<number> -f query='query($n:Int!){repository(owner:"lushly-dev",name:"afd"){issue(number:$n){issueType{name} parent{number} subIssues(first:100){nodes{number}}}}}'
  ```

## Closing

Close an epic when its whole scope is done, usually as its feature moves to
`complete/`. One plan finishing doesn't close an epic other plans share (Python
name parity sits under the parity closure epic). Children still open are either
moved under the epic that now owns them or left unparented, and the archive names
them, as [the features README](../../../../docs/features/README.md)
requires.
