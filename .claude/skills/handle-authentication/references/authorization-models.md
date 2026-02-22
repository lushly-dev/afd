# Authorization Models

Comprehensive guide to RBAC, ABAC, ReBAC, and policy engines (Cedar, OPA, Zanzibar) for designing fine-grained access control.

## Model Comparison

| Model | Grants based on | Best for | Complexity |
|---|---|---|---|
| RBAC | Role membership | Simple apps, admin panels | Low |
| ABAC | Attribute evaluation | Compliance-heavy, context-dependent | Medium |
| ReBAC | Entity relationships | Document sharing, social, multi-tenant | Medium-High |
| Cedar/*BAC | Any combination | Unified policy across models | Medium |

## RBAC (Role-Based Access Control)

Users are assigned roles; roles have permissions. Simple, widely understood, but rigid.

### Structure

```
User -> Role -> Permission -> Resource
```

### Implementation Pattern

```typescript
// Role definitions
const ROLES = {
  viewer: ['read'],
  editor: ['read', 'write'],
  admin: ['read', 'write', 'delete', 'manage_users'],
  owner: ['read', 'write', 'delete', 'manage_users', 'manage_billing'],
};

// Middleware
function requirePermission(permission: string) {
  return (req, res, next) => {
    const userRole = req.user.role;
    if (!ROLES[userRole]?.includes(permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Usage
app.delete('/api/posts/:id', requirePermission('delete'), deletePost);
```

### Limitations

- **Role explosion** -- Large systems accumulate hundreds of roles
- **No context** -- Cannot express "only during business hours" or "only own resources"
- **No relationships** -- Cannot express "owner of this document"

## ABAC (Attribute-Based Access Control)

Decisions based on attributes of the subject, resource, action, and environment.

### Attribute Categories

| Category | Examples |
|---|---|
| Subject | department, clearance_level, job_title, location |
| Resource | classification, owner, created_date, sensitivity |
| Action | read, write, approve, export |
| Environment | time_of_day, ip_address, device_trust_level |

### Implementation Pattern

```typescript
interface PolicyContext {
  subject: { id: string; department: string; clearance: number; };
  resource: { type: string; classification: string; owner: string; };
  action: string;
  environment: { time: Date; ip: string; deviceTrust: string; };
}

function evaluate(ctx: PolicyContext): boolean {
  // Example: Only finance department with clearance >= 3
  // can export confidential resources during business hours
  if (ctx.action === 'export' && ctx.resource.classification === 'confidential') {
    return (
      ctx.subject.department === 'finance' &&
      ctx.subject.clearance >= 3 &&
      isBusinessHours(ctx.environment.time)
    );
  }
  return false;
}
```

## ReBAC (Relationship-Based Access Control)

Decisions based on relationships between entities. Inspired by Google Zanzibar.

### Core Concepts

```
# Relationship tuples: (object, relation, subject)
document:readme#owner@user:alice
document:readme#viewer@team:engineering#member
folder:docs#parent@document:readme
```

### Relationship Traversal

```
Can user:bob view document:readme?

1. Check: document:readme#viewer@user:bob? -> No
2. Check: document:readme#editor@user:bob? -> No
3. Check: document:readme#owner@user:bob? -> No
4. Traverse: document:readme has parent folder:docs
5. Check: folder:docs#viewer@user:bob? -> No
6. Check: folder:docs#viewer@team:engineering#member? -> Yes
7. Check: team:engineering#member@user:bob? -> Yes
8. Result: ALLOW (inherited via folder -> team membership)
```

### Implementation with OpenFGA

```yaml
# Authorization model
model
  schema 1.1

type user

type team
  relations
    define member: [user]

type folder
  relations
    define owner: [user]
    define viewer: [user, team#member]
    define can_view: viewer or owner

type document
  relations
    define parent: [folder]
    define owner: [user]
    define editor: [user, team#member]
    define viewer: [user, team#member]
    define can_view: viewer or editor or owner or can_view from parent
    define can_edit: editor or owner
```

## Cedar Policy Language

Cedar unifies RBAC, ABAC, and ReBAC in a single policy language. Default-deny with forbid-overrides-permit.

### Policy Structure

```cedar
// RBAC: Admins can do anything
permit(
  principal in Group::"admins",
  action,
  resource
);

// ABAC: Department-based access with conditions
permit(
  principal,
  action == Action::"ViewReport",
  resource
) when {
  principal.department == resource.department &&
  principal.clearance >= resource.requiredClearance
};

// ReBAC: Owner access
permit(
  principal,
  action,
  resource
) when {
  principal == resource.owner
};

// Forbid overrides: Block outside business hours
forbid(
  principal,
  action == Action::"Export",
  resource
) when {
  context.hour < 9 || context.hour > 17
};
```

### Cedar Authorization Check

```typescript
import { Cedar } from '@cedar-policy/cedar-wasm';

const cedar = await Cedar.create();

const decision = cedar.isAuthorized({
  principal: 'User::"alice"',
  action: 'Action::"ViewDocument"',
  resource: 'Document::"report-q4"',
  context: {
    hour: 14,
    ip_address: '10.0.1.50',
  },
  policies: policySet,
  entities: entityStore,
});

if (decision.decision === 'Allow') {
  // Proceed
} else {
  // Deny with diagnostics
  console.log('Denied. Reasons:', decision.diagnostics);
}
```

## Policy Engine Comparison

| Feature | Cedar | OPA/Rego | Zanzibar/OpenFGA |
|---|---|---|---|
| Language | Cedar (purpose-built) | Rego (general-purpose) | DSL (relationship tuples) |
| Primary model | RBAC + ABAC + ReBAC | ABAC + RBAC | ReBAC |
| Default deny | Yes (built-in) | Configurable | Yes |
| Forbid overrides | Yes (built-in) | Manual implementation | N/A |
| Formal verification | Yes (provable analysis) | No | No |
| Performance | Sub-millisecond | Sub-millisecond | Low-latency (distributed) |
| Best for | Unified app authz | Infra policy (K8s, APIs) | Relationship-heavy (docs, social) |
| Managed service | AWS Verified Permissions | Styra DAS | Auth0 FGA, Oso Cloud |

## Choosing an Authorization Model

```
Start with RBAC if:
  - < 10 roles cover your needs
  - No per-resource ownership
  - Simple admin/user/viewer hierarchy

Add ABAC when:
  - Compliance requires attribute-based rules
  - Context matters (time, location, device trust)
  - Cross-cutting policies (data classification)

Add ReBAC when:
  - Resources have owners, editors, viewers
  - Sharing/collaboration is a core feature
  - Permissions inherit through hierarchies (folders, orgs)

Use Cedar/*BAC when:
  - You need multiple models in one system
  - Policies must be auditable and analyzable
  - Authorization logic must be decoupled from code
```

## Authorization Anti-Patterns

- **Client-side only** -- Never enforce authorization only in the frontend
- **Implicit deny missing** -- Always default to deny; explicitly grant access
- **God roles** -- Avoid roles with `*` permissions; enumerate explicitly
- **Permission checks in controllers only** -- Enforce at service/data layer too
- **Stale role assignments** -- Implement periodic access reviews and expiration
- **No audit trail** -- Log every authorization decision for compliance
