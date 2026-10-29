# Agent Security and Supply Chain

Guidance for auditing AI agent permission models, subagent orchestration, supply chain threats, and secret management.

## The `--dangerously-skip-permissions` Pattern

Using this flag enables full autonomy but removes the human-in-the-loop safety net.

> **Audit Guidance:** In codebases that **intentionally use** this flag for automated
> workflows (e.g., subagent orchestration, CI pipelines), log as INFORMATIONAL
> with a reminder note, not as CRITICAL. Only flag as critical if the usage
> appears unintentional or in user-facing code.

**When Acceptable:**

- Subagent orchestration systems (parent spawns child agents)
- CI/CD pipelines running in isolated containers
- Development tools where user explicitly opts in

**When Critical:**

- In production code serving external users
- Without containerization or sandboxing
- If enabled by default without user consent

**Mitigations (when used intentionally):**

1. Run agent in **Docker container** with mounted project only
2. Apply **network allowlisting** (block all except required APIs)
3. Use **gVisor** or **MicroVMs** for high-security environments
4. Implement **honeypot files** to detect unauthorized access

```bash
# Safe pattern: Run in container with network restrictions
docker run --rm -it \
  -v $(pwd):/project:rw \
  --network=restricted \
  claude-agent --dangerously-skip-permissions
```

## Subagent Permission Inheritance

When spawning subagents, apply **least privilege**:

```python
# Bad: Subagent inherits all parent capabilities
spawn_agent(task="summarize docs", inherit_all=True)

# Good: Subagent gets only required capabilities
spawn_agent(
    task="summarize docs",
    allowed_tools=["read_files"],
    denied_tools=["write_files", "run_command", "network"]
)
```

## Supply Chain Security

### AI-Specific Threats: Slopsquatting

AI models can hallucinate plausible package names that don't exist. Attackers register these on PyPI/npm.

**Detection checklist:**

- [ ] Is the package less than 30 days old?
- [ ] Does it have fewer than 1000 downloads?
- [ ] Is the maintainer account recently created?
- [ ] Does the package name look like a typo of a popular package?

**Tooling:**

- **Socket.dev** -- Behavioral analysis of packages
- **Phylum** -- Reputation-based scanning
- **Trivy MCP** -- Container and dependency scanning

```python
def verify_package(name: str) -> bool:
    """Check package reputation before install."""
    response = requests.get(f"https://pypi.org/pypi/{name}/json")
    if response.status_code == 404:
        raise SecurityError(f"Package '{name}' does not exist - hallucination?")

    data = response.json()
    age_days = (datetime.now() - parse(data["info"]["release_date"])).days
    if age_days < 30:
        logger.warning(f"Package '{name}' is only {age_days} days old")
    return True
```

### General Supply Chain Controls

- Generate SBOM on every release build (CycloneDX or SPDX format)
- Sign commits and verify CI artifacts
- Use Subresource Integrity (SRI) for CDN-loaded scripts
- Verify lockfile integrity on every build
- Audit transitive dependencies, not just direct ones

## Secret Management

### Ephemeral Secrets (Best Practice)

Static secrets in `.env` are a liability. Move to **Just-In-Time** credentials.

```python
async def get_db_connection():
    # Request short-lived credential (5 min TTL)
    cred = await vault.get_dynamic_secret("database/creds/app")
    conn = await asyncpg.connect(
        user=cred.username,
        password=cred.password,  # Valid for 5 mins only
    )
    return conn
```

### Secret Masking

```python
REDACTION_SET = set()

def register_secret(value: str):
    REDACTION_SET.add(value)

def redact(text: str) -> str:
    for secret in REDACTION_SET:
        text = text.replace(secret, "[REDACTED]")
    return text
```

### Agent-Specific Secret Controls

- [ ] `.claudeignore` protects secret files from agent access
- [ ] `.gitignore` includes `.env`, credentials, and key files
- [ ] `.env` files are NOT readable by agents (Claude Code can read them by default)
- [ ] Secrets stored in secrets manager, not in code or config
- [ ] Ephemeral/JIT credentials preferred over static secrets
- [ ] Secret values never included in audit output -- report location only
