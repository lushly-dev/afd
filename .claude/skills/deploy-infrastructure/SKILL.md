---
name: deploy-infrastructure
source: botcore
description: >
  Guides containerization, CI/CD pipeline setup, and production deployment. Covers Dockerfile best practices, GitHub Actions workflows, secret management, health checks, resource limits, environment parity, and rollback strategies. Use when building Docker images, configuring pipelines, preparing deployments, or reviewing infrastructure code. Triggers: Docker, CI/CD, deployment, Kubernetes, pipeline, container, GitHub Actions, infrastructure, deploy.

version: 1.0.0
triggers:
  - infrastructure
  - Docker
  - CI/CD
  - deployment
  - Kubernetes
  - pipeline
  - container
  - GitHub Actions
  - deploy
  - Dockerfile
  - rollback
  - health check
portable: true
---

# Deploying Infrastructure

Best practices for containerization, CI/CD pipelines, and production deployment.

## Capabilities

1. Author and review Dockerfiles using multi-stage builds, non-root users, and minimal layers
2. Configure CI/CD pipelines (GitHub Actions) with lint, test, build, security, and deploy stages
3. Enforce secret management practices -- never commit secrets, use secret managers
4. Implement health check endpoints (liveness and readiness probes)
5. Define resource requests and limits for containerized workloads
6. Plan rollback strategies using blue-green/canary deployments and feature flags
7. Maintain environment parity across dev, staging, and production

## Core Principles

- **Immutable artifacts**: Build once, deploy the same image to every environment. Tag images with specific versions, never `latest`.
- **Fail fast**: Pipeline stages should catch issues early -- lint before test, test before build, build before deploy.
- **Least privilege**: Containers run as non-root. Secrets live in secret managers, not in code or committed env files.
- **Environment parity**: Keep base images, dependency versions, and database engines identical across environments. Only values change.
- **Rollback readiness**: Every deployment must be reversible in under 5 minutes. Database migrations must be backward-compatible.

## Workflow

### Dockerfile

```dockerfile
# Multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

Key rules:
- Use multi-stage builds to reduce final image size
- Pin base image tags to specific versions
- Run as non-root user (`USER node`)
- Configure `.dockerignore` to exclude unnecessary files
- Combine RUN commands to minimize layers
- Define a HEALTHCHECK instruction

### CI/CD Pipeline

```yaml
# GitHub Actions
name: CI
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - run: npm run build
```

Pipeline stages and fail-fast behavior:

| Stage    | Purpose           | Fail Fast    |
|----------|-------------------|--------------|
| Lint     | Code style        | Yes          |
| Test     | Unit/integration  | Yes          |
| Build    | Compile/bundle    | Yes          |
| Security | Dependency scan   | Warn         |
| Deploy   | Ship to env       | Manual gate  |

### Secret Management

Never store secrets in source code or committed files. Reference them from a secret manager.

```yaml
# Wrong: hardcoded secret
DATABASE_URL: postgres://user:password@host/db

# Correct: referenced from secret store
DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

| Tool                  | Use Case                 |
|-----------------------|--------------------------|
| GitHub Secrets        | CI/CD pipelines          |
| AWS Secrets Manager   | Production apps          |
| HashiCorp Vault       | Enterprise, multi-cloud  |
| Doppler               | Cross-platform sync      |

### Health Checks

Implement both liveness and readiness endpoints:

```typescript
// Liveness -- is the process running?
app.get('/health/live', (req, res) => res.send('OK'));

// Readiness -- can it accept traffic?
app.get('/health/ready', async (req, res) => {
  const dbOk = await checkDatabase();
  const cacheOk = await checkCache();
  if (dbOk && cacheOk) return res.send('OK');
  res.status(503).send('Not Ready');
});
```

### Resource Limits

```yaml
# Kubernetes resource specification
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

### Environment Parity

| Aspect           | Requirement                        |
|------------------|------------------------------------|
| Base images      | Same versions across environments  |
| Environment vars | Same names, different values       |
| Dependencies     | Exact versions via lockfiles       |
| Database         | Same engine version                |

## Quick Reference -- Anti-Patterns

| Avoid                              | Instead                         |
|------------------------------------|---------------------------------|
| `latest` tags                      | Specific version tags           |
| Root user in containers            | Non-root user                   |
| Secrets in committed env files     | Secret manager                  |
| Manual deployments                 | Automated pipelines             |
| No health checks                   | Liveness + readiness probes     |

## Checklist

- [ ] Dockerfile uses multi-stage builds and non-root user
- [ ] `.dockerignore` is configured
- [ ] Base image tags are pinned (no `latest`)
- [ ] Health check instruction defined in Dockerfile
- [ ] CI pipeline runs lint, test, build stages
- [ ] Secrets are stored in a secret manager, not in code or git
- [ ] Health check endpoints (`/health/live`, `/health/ready`) implemented
- [ ] Resource requests and limits defined for containers
- [ ] Rollback mechanism tested and completes in under 5 minutes
- [ ] Database migrations are backward-compatible
- [ ] Environment parity verified across dev, staging, production
- [ ] Feature flags used for risky changes
- [ ] Blue-green or canary deployment strategy documented

## When to Escalate

- Multi-cloud or hybrid-cloud networking configurations requiring specialized platform knowledge
- Kubernetes cluster administration (node scaling, RBAC policies, custom operators)
- Compliance-driven infrastructure requirements (SOC 2, HIPAA, PCI-DSS audit controls)
- Production incident response involving infrastructure failures outside application scope
- Cost optimization across cloud providers requiring billing and resource analysis
