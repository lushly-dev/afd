# Conflict Resolution

Strategies for preventing, detecting, and resolving git merge conflicts, including patterns for agentic conflict handling.

## Prevention Strategies

The best conflict is one that never happens. These practices minimize conflict frequency:

### 1. Keep Branches Short-Lived

| Branch Age | Conflict Risk | Recommendation |
|---|---|---|
| Hours | Very low | Ideal for trunk-based development |
| 1-2 days | Low | Acceptable for feature branches |
| 3-7 days | Medium | Rebase frequently from main |
| 1+ weeks | High | Split into smaller changes |

### 2. Merge Main into Feature Branches Regularly

```bash
# Daily or before each work session:
git fetch origin
git merge origin/main
# Or, for a cleaner history:
git rebase origin/main
```

### 3. Enforce Consistent Formatting

Formatting differences are the most common source of trivial conflicts. Automate formatting to eliminate them:

```bash
# Pre-commit hook: format staged files
npx lint-staged        # JS/TS projects
black --check .        # Python projects
gofmt -w .             # Go projects
cargo fmt              # Rust projects
```

### 4. Define Code Ownership

When specific files have clear owners, conflicts decrease because fewer people edit the same files simultaneously.

```
# CODEOWNERS
/src/auth/          @auth-team
/src/billing/       @billing-team
/src/shared/utils/  @platform-team
```

### 5. Communicate About Shared Files

If two developers must edit the same file:
- Coordinate timing (one merges first, the other rebases)
- Split the file into smaller modules to reduce overlap
- Use feature flags to work in the same file without conflicting logic

## Types of Conflicts

### Content Conflicts

Both branches modified the same lines in a file.

```
<<<<<<< HEAD
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
=======
function calculateTotal(items: Item[], discount: number): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0) * (1 - discount);
>>>>>>> feat/add-discount
```

**Resolution**: Combine both changes -- add the discount parameter AND keep the existing logic:

```typescript
function calculateTotal(items: Item[], discount: number = 0): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0) * (1 - discount);
}
```

### Delete/Modify Conflicts

One branch deleted a file that another branch modified.

```bash
CONFLICT (modify/delete): src/legacy-auth.ts deleted in HEAD and modified in feat/update-auth.
```

**Resolution**: Determine intent. If the deletion was intentional (replaced by new code), confirm the modification is captured in the replacement. If the deletion was accidental, keep the modified version.

### Rename Conflicts

Both branches renamed the same file differently.

```bash
CONFLICT (rename/rename): src/utils.ts renamed to src/helpers.ts in HEAD and to src/lib/utils.ts in feat/reorganize.
```

**Resolution**: Choose the more appropriate name and location, then ensure all imports reference the correct path.

### Binary Conflicts

Binary files (images, compiled assets) cannot be merged textually.

**Resolution**: Choose one version. Use Git LFS for binary files to reduce conflict frequency.

## Resolution Process

### Step 1: Identify All Conflicts

```bash
git status
# Look for "both modified", "deleted by us", "deleted by them", etc.
```

### Step 2: Understand the Intent

Before editing any file, answer:
- What was the purpose of changes on each branch?
- Are the changes complementary (both needed) or contradictory (choose one)?
- Is there a third option that satisfies both intents?

### Step 3: Resolve Each File

```bash
# Open the conflicted file and look for markers:
#   <<<<<<< HEAD          (your branch)
#   =======               (divider)
#   >>>>>>> other-branch  (incoming branch)

# After editing, remove ALL markers and stage:
git add <resolved-file>
```

### Step 4: Verify the Resolution

```bash
# Run tests to confirm nothing is broken
npm test              # or pytest, cargo test, go test
# Run the linter
npm run lint          # or equivalent
# Check for remaining conflict markers
git diff --check
```

### Step 5: Complete the Merge

```bash
# If merging:
git merge --continue

# If rebasing:
git rebase --continue
```

## Resolution Strategies

### Ours vs Theirs

When one side's changes should win entirely:

```bash
# Keep our version for a specific file:
git checkout --ours <file>
git add <file>

# Keep their version for a specific file:
git checkout --theirs <file>
git add <file>
```

**Warning**: Use sparingly. This discards one side's changes entirely.

### Manual Three-Way Merge

The most reliable approach. View all three versions:

```bash
# View the common ancestor:
git show :1:<file>    # base version

# View our version:
git show :2:<file>    # HEAD

# View their version:
git show :3:<file>    # incoming branch
```

Compare each version against the base to understand what each branch changed, then combine both sets of changes.

### Rerere (Reuse Recorded Resolution)

Git can remember how you resolved a conflict and apply the same resolution automatically next time:

```bash
# Enable rerere globally:
git config --global rerere.enabled true

# After resolving a conflict, git records the resolution.
# Next time the same conflict occurs, git applies it automatically.
```

## Merge vs Rebase

| Aspect | Merge | Rebase |
|---|---|---|
| History | Preserves branch topology | Linear history |
| Conflict handling | Single conflict resolution | Conflict per replayed commit |
| Safety | Never rewrites history | Rewrites commit hashes |
| Best for | Shared/public branches | Local/private branches |
| Undo ease | Easy (revert merge commit) | Hard (reflog required) |

### When to Merge

- The branch has been pushed and others have based work on it
- You want to preserve the exact history of when changes were integrated
- The branch has many commits and rebasing would be tedious

### When to Rebase

- The branch is local and not shared
- You want a clean, linear history
- You are updating a feature branch before opening a PR
- You are maintaining a stacked PR chain

### Golden Rule

**Never rebase commits that have been pushed to a shared branch.** Rebasing rewrites commit hashes, which breaks anyone who has based work on those commits.

## Agentic Conflict Resolution

When AI agents encounter merge conflicts:

### Safe Approach

1. **Detect the conflict** -- Check `git status` for conflict markers
2. **Read both sides** -- Use `git show :2:<file>` (ours) and `git show :3:<file>` (theirs)
3. **Read the base** -- Use `git show :1:<file>` for the common ancestor
4. **Analyze intent** -- Compare each side against the base to understand what changed
5. **Propose resolution** -- Generate the merged content
6. **Validate** -- Run tests and linting
7. **Request review** -- Present the resolution to a human for approval before committing

### When Agents Should NOT Auto-Resolve

- Conflicting business logic (requires domain knowledge)
- Security-sensitive code (authentication, authorization, encryption)
- Database migrations (ordering matters)
- API contracts (breaking changes need coordination)
- Configuration files with environment-specific values

### When Agents CAN Auto-Resolve

- Import ordering conflicts
- Formatting-only conflicts (whitespace, line endings)
- Lock file conflicts (regenerate the lock file)
- Auto-generated code (regenerate from source)
- Changelog conflicts (combine entries)
