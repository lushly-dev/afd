# Core Dev Commands Reference

## dev_lint()

```python
async def dev_lint() -> CommandResult[dict]
```

Runs the language-appropriate linter on the current workspace.

**Language Dispatch:**

| Language | Tool | Command |
|---|---|---|
| Python | ruff | `ruff check .` |
| TypeScript | biome | `biome lint .` |
| Rust | clippy | `cargo clippy` |

**Return data:**
- `language` — Detected language
- `linter` — Tool used
- `stdout` — Linter output
- `returncode` — Exit code (0 = clean)

**Failure modes:**
- No language detected → error with suggestion to set `language` in config
- Linter not installed → subprocess error with tool name

## dev_test()

```python
async def dev_test() -> CommandResult[dict]
```

Runs the language-appropriate test runner.

**Language Dispatch:**

| Language | Tool | Command |
|---|---|---|
| Python | pytest | `pytest` |
| TypeScript | vitest | `vitest run` |
| Rust | cargo-test | `cargo test` |

**Return data:**
- `language` — Detected language
- `test_runner` — Tool used
- `stdout` — Test output
- `returncode` — Exit code (0 = all pass)

## dev_build()

```python
async def dev_build() -> CommandResult[dict]
```

Runs the language-appropriate build tool.

**Language Dispatch:**

| Language | Tool | Command |
|---|---|---|
| Python | hatch | `hatch build` |
| TypeScript | turbo | `turbo build` |
| Rust | cargo | `cargo build --release` |

**Return data:**
- `language` — Detected language
- `stdout` — Build output
- `returncode` — Exit code (0 = success)

## dev_skill_lint()

```python
async def dev_skill_lint() -> CommandResult[dict]
```

Delegates to the full `skill_lint` command from `botcore.commands.skill.lint`. Validates all skill directories against the Agent Skills format specification.

**Checks performed:**
- SKILL.md exists and is valid markdown
- Frontmatter has required fields (name, description)
- Name matches directory name
- References directory structure is correct
- Line count within limits

**Return data:**
- `skills_checked` — Number of skills validated
- `errors` — List of validation errors
- `warnings` — List of warnings

## Config Integration

All core commands read from `BotCoreConfig`:

```python
config = load_config(workspace)
# dev_lint uses: config.language, config.linter
# dev_test uses: config.language, config.test_runner
# dev_build uses: config.language
```

Explicit config always wins over auto-detection. Setting `linter = "pylint"` in config makes `dev_lint()` use pylint instead of ruff.
