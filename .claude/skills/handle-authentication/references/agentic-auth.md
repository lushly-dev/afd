# Agentic Authentication and Agent Identity

Authentication and authorization patterns for AI agents, MCP servers, machine-to-machine flows, delegation, and agent identity management.

## The Agentic Auth Challenge

Traditional IAM assumes predictable application behavior and a single authenticated principal. AI agents introduce:

- **Dynamic permissions** -- Agents need task-specific, context-dependent scopes
- **Delegation chains** -- Human -> Agent -> Sub-agent -> Tool, each with attenuated permissions
- **Continuous operation** -- Agents run 24/7; static credentials are high-risk
- **Non-deterministic behavior** -- Same agent may need different permissions per task
- **Accountability gaps** -- Actions must trace back to a human sponsor

## Agent Authentication Patterns

### 1. Client Credentials (Machine-to-Machine)

For autonomous agents with no human in the loop:

```typescript
// Agent authenticates as itself
async function getAgentToken(): Promise<string> {
  const response = await fetch('https://auth.example.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: AGENT_CLIENT_ID,
      client_secret: AGENT_CLIENT_SECRET,
      scope: 'read:documents write:summaries', // Minimal scope
    }),
  });

  const { access_token, expires_in } = await response.json();
  return access_token; // Short-lived: 5-15 minutes
}
```

### 2. On-Behalf-Of (Delegated Access)

Agent acts on behalf of a human user with attenuated permissions:

```typescript
// OAuth 2.0 Token Exchange (RFC 8693)
async function getOnBehalfOfToken(
  userToken: string,
  requiredScope: string
): Promise<string> {
  const response = await fetch('https://auth.example.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: userToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: requiredScope, // Must be subset of user's scopes
      audience: 'https://api.example.com',
      // Actor claim identifies the agent
      actor_token: agentIdentityToken,
      actor_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    }),
  });

  return (await response.json()).access_token;
}
```

### Resulting Token Structure

```json
{
  "sub": "user_alice",
  "act": {
    "sub": "agent_summarizer",
    "client_id": "agent_client_123"
  },
  "scope": "read:documents",
  "tid": "tenant_acme",
  "exp": 1700000900,
  "delegation_chain": ["user_alice", "agent_orchestrator", "agent_summarizer"]
}
```

### 3. Authorization Code + PKCE (Interactive)

When an agent needs user consent for specific resources:

```
1. Agent opens browser/redirect for user consent
2. User authenticates and approves specific scopes
3. Agent receives authorization code
4. Agent exchanges code for tokens (with PKCE)
5. Agent operates within granted scopes
```

## MCP Server Authentication

The Model Context Protocol mandates OAuth 2.1 for HTTP-based MCP servers.

### MCP Auth Architecture

```
MCP Client (AI Agent)
  |
  | 1. Discovers OAuth metadata
  v
MCP Server (.well-known/oauth-protected-resource)
  |
  | 2. Redirects to Authorization Server
  v
Authorization Server (.well-known/oauth-authorization-server)
  |
  | 3. Issues access token with resource indicator
  v
MCP Client -> MCP Server (Bearer token in requests)
```

### Resource Indicators (RFC 8707)

MCP clients must include the resource indicator to prevent token misuse:

```typescript
// Authorization request includes resource indicator
const authUrl = new URL(authServerMetadata.authorization_endpoint);
authUrl.searchParams.set('resource', 'https://mcp-server.example.com');
authUrl.searchParams.set('scope', 'mcp:tools:read mcp:tools:execute');
```

### MCP Client Registration Options (Preferred Order)

1. **Out-of-band registration** -- Pre-registered client with known relationship
2. **Client ID Metadata Document (CIMD)** -- Client describes itself via URL it controls
3. **Dynamic Client Registration (DCR)** -- RFC 7591, programmatic registration
4. **Manual entry** -- User provides client information

### MCP Server Authorization Example

```typescript
// MCP server validates access token per-tool
async function handleToolCall(
  request: McpToolRequest,
  accessToken: string
): Promise<McpToolResponse> {
  // Validate token
  const claims = await validateAccessToken(accessToken, {
    audience: 'https://mcp-server.example.com',
    requiredScopes: getToolScopes(request.tool),
  });

  // Check tool-specific authorization
  const authorized = await checkToolAuthorization(
    claims.sub,
    request.tool,
    request.params,
    { tenantId: claims.tid, agentId: claims.act?.sub }
  );

  if (!authorized) {
    return { error: 'FORBIDDEN', message: `Not authorized for tool: ${request.tool}` };
  }

  return executeToolSafely(request);
}
```

## Agent Identity Management

### Agent Identity Schema

```typescript
interface AgentIdentity {
  agentId: string;                    // Unique agent identifier
  name: string;                       // Human-readable name
  type: 'autonomous' | 'delegated' | 'orchestrator';

  // Ownership and accountability
  ownerId: string;                    // Human sponsor
  teamId: string;                     // Owning team

  // Credential management
  clientId: string;                   // OAuth client ID
  credentialRotationDays: number;     // Max credential age
  lastCredentialRotation: Date;

  // Permission boundaries
  maxScopes: string[];                // Maximum grantable scopes
  allowedResources: string[];         // Resource patterns agent can access
  allowedTools: string[];             // MCP tools agent can invoke

  // Operational limits
  rateLimit: { requests: number; window: string };
  maxTokenLifetime: number;           // Seconds
  requireHumanApproval: string[];     // Actions needing human-in-the-loop

  // Audit
  createdAt: Date;
  lastActiveAt: Date;
  auditLogRetention: number;          // Days
}
```

### Agent Credential Lifecycle

```typescript
// Create agent with short-lived, auto-rotating credentials
async function provisionAgent(config: AgentConfig): Promise<AgentCredentials> {
  // Register OAuth client for agent
  const client = await authServer.registerClient({
    client_name: config.name,
    grant_types: ['client_credentials'],
    scope: config.maxScopes.join(' '),
    token_endpoint_auth_method: 'private_key_jwt',
  });

  // Store credentials in vault with auto-rotation
  await vault.storeSecret(`agents/${config.agentId}/credentials`, {
    clientId: client.client_id,
    privateKey: client.private_key,
    rotateEvery: '7d',
  });

  return { clientId: client.client_id, status: 'provisioned' };
}

// Automatic credential rotation
async function rotateAgentCredentials(agentId: string): Promise<void> {
  const oldCreds = await vault.getSecret(`agents/${agentId}/credentials`);
  const newKey = await generateKeyPair();

  await authServer.rotateClientKey(oldCreds.clientId, newKey.publicKey);
  await vault.updateSecret(`agents/${agentId}/credentials`, {
    ...oldCreds,
    privateKey: newKey.privateKey,
    lastRotated: new Date(),
  });
}
```

## Delegation Chains and Scope Attenuation

### Principle: Permissions Can Only Decrease

```
Human (full access)
  -> Orchestrator Agent (read + write + execute)
    -> Summarizer Agent (read only)         # Attenuated
    -> Writer Agent (read + write)           # Attenuated
      -> Formatter Sub-Agent (read only)     # Further attenuated
```

### Implementation

```typescript
async function delegateToSubAgent(
  parentToken: string,
  subAgentId: string,
  taskScopes: string[]
): Promise<string> {
  const parentClaims = decodeToken(parentToken);

  // Enforce attenuation: sub-agent cannot exceed parent scopes
  const allowedScopes = taskScopes.filter(s => parentClaims.scope.includes(s));
  if (allowedScopes.length < taskScopes.length) {
    logger.warn('Scope attenuation applied', {
      requested: taskScopes,
      granted: allowedScopes,
    });
  }

  // Exchange for sub-agent token
  return tokenExchange({
    subjectToken: parentToken,
    actorId: subAgentId,
    scope: allowedScopes.join(' '),
    lifetime: Math.min(parentClaims.exp - now(), MAX_SUBAGENT_TOKEN_LIFETIME),
  });
}
```

## Audit and Traceability

Every agent action must be traceable to a human sponsor:

```typescript
interface AgentAuditEntry {
  timestamp: Date;
  agentId: string;
  humanSponsor: string;          // Always present
  delegationChain: string[];     // Full chain from human to acting agent
  action: string;
  resource: string;
  decision: 'allow' | 'deny';
  scopes: string[];
  tokenId: string;               // JWT jti for correlation
  metadata: {
    ip: string;
    toolName?: string;           // MCP tool if applicable
    tenantId?: string;
  };
}
```

## Common Anti-Patterns

- **Static API keys for agents** -- Use short-lived OAuth tokens with automatic rotation
- **Shared service accounts** -- Each agent must have its own identity
- **No delegation tracking** -- Always maintain the full delegation chain in tokens
- **Over-privileged agents** -- Start with minimal scopes; expand only when needed
- **No human sponsor** -- Every agent must be traceable to a responsible human
- **No rate limiting** -- Agents can execute faster than humans; apply rate limits
- **Credential rotation neglect** -- Automate rotation; alert on stale credentials
