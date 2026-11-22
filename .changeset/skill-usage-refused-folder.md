---
"lushly-botcore": patch
---

### Fixed

- **A repository git refuses lists the skills its folder holds** (lushly-dev/afd#2051). Git stops at `detected dubious ownership` for every command in a folder another account owns. Since the collection began reading what a project holds from git, such a folder said nothing, for good, and its project held no skills: no size, nothing in `quiet`. A repository git could not read, with no commit on record, is now read as it lies, as it was before, whatever stopped git: for a first collection that only timed out, that lists unmerged work until git answers the next hour. An account with no commit is older than any commit, so it never replaces one, and a folder with a commit on record keeps it through a failed read and a rebuild. Only a `SKILL.md` that is a file is read from a folder: a pipe by that name no longer holds a collection.
