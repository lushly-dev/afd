# CLI Commands

Lushbot agent CLI for orchestrating Claude Code workers.

## Launch Single Agent

```bash
lush agent launch --issue 19 --repo lushbot

# Preview prompt without launching
lush agent launch --issue 19 --repo lushbot --dry-run
```

**What happens:**

1. Fetches issue title and body from GitHub
2. Extracts spec path from issue body
3. Generates focused prompt with completion instructions
4. Launches Windows Terminal with `--dangerously-skip-permissions`

## Launch Parallel Agents (Wave)

```bash
lush agent wave --issues 20,21 --repo lushbot
```

Launches multiple agents in split panes.

## Track Sessions

```bash
# Show all tracked sessions
lush agent status

# Mark session as closed
lush agent close issue-19

# Clear all tracked sessions
lush agent clear
```

## Supported Repositories

| Repo | Path |
|------|------|
| `afd` | `d:\Github\lushly-dev\AFD` |
| `lushbot` | `d:\Github\lushly-dev\lushbot` |
| `lushly` | `d:\Github\lushly-dev\lushly` |
| `violet` | `d:\Github\lushly-dev\Violet` |
| `fast-af` | `d:\Github\lushly-dev\fast-af` |

## Manual Launch (Fallback)

```powershell
$script = @'
$prompt = @"
Work on issue #19: [description]. Read spec at [path].
"@
claude --dangerously-skip-permissions $prompt
'@
$script | Out-File -Path ".claude-agent-launch.ps1"

Start-Process wt -ArgumentList @(
  '--title', 'issue-19',
  '-d', 'd:\Github\lushly-dev\lushbot',
  'pwsh', '-NoExit', '-File', '.claude-agent-launch.ps1'
)
```

## Completion Instructions

Agents receive these steps automatically:

1. Create branch: `feat/issue-{number}`
2. Run build and test
3. Commit with conventional message
4. Push and create PR
5. Update STATUS-{issue}.md
