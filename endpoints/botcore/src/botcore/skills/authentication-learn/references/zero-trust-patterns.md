# Zero Trust Authentication Patterns

Continuous verification, device trust, micro-segmentation, and policy enforcement for zero trust architectures.

## Core Principles

Zero trust operates on "never trust, always verify":

1. **No implicit trust** -- Network location does not grant trust
2. **Least privilege** -- Minimum access for minimum time
3. **Continuous verification** -- Reassess trust throughout the session, not just at login
4. **Assume breach** -- Design as if attackers are already inside

## Continuous Verification

### Beyond Login-Time Authentication

Traditional auth verifies once at login. Zero trust reassesses trust signals throughout the session:

```typescript
interface TrustSignals {
  identity: {
    authMethod: string;          // passkey, sso, password+mfa
    authTime: Date;              // When last authenticated
    authStrength: number;        // 0-100 score
  };
  device: {
    managed: boolean;            // MDM enrolled
    osPatched: boolean;          // Up-to-date OS
    diskEncrypted: boolean;
    firewallEnabled: boolean;
    trustScore: number;          // 0-100
  };
  behavior: {
    location: string;            // Geo-IP
    usualLocation: boolean;      // Within normal pattern
    timeOfDay: string;           // Within usual hours
    requestPattern: string;      // Normal vs anomalous
    riskScore: number;           // 0-100
  };
  network: {
    type: string;                // corporate, vpn, public
    ipReputation: number;        // 0-100
    tlsVersion: string;
  };
}
```

### Trust Score Evaluation

```typescript
function evaluateTrustScore(signals: TrustSignals): TrustDecision {
  const score = calculateCompositeScore(signals);

  if (score >= 80) {
    return { level: 'high', action: 'allow', stepUp: false };
  }
  if (score >= 50) {
    return { level: 'medium', action: 'allow', stepUp: true,
             challenge: 'mfa' }; // Require step-up auth
  }
  if (score >= 30) {
    return { level: 'low', action: 'restrict',
             restrictions: ['read_only', 'no_export', 'no_admin'] };
  }
  return { level: 'none', action: 'deny', reason: 'Trust score below threshold' };
}

function calculateCompositeScore(signals: TrustSignals): number {
  return (
    signals.identity.authStrength * 0.35 +
    signals.device.trustScore * 0.25 +
    signals.behavior.riskScore * 0.25 +  // Inverted: 100 = low risk
    signals.network.ipReputation * 0.15
  );
}
```

### Step-Up Authentication

When trust degrades mid-session, require re-authentication:

```typescript
async function enforceStepUp(
  req: Request,
  requiredLevel: 'mfa' | 'passkey' | 'full_reauth'
): Promise<void> {
  const session = req.session;
  const authAge = Date.now() - session.lastAuthTime;

  switch (requiredLevel) {
    case 'mfa':
      if (authAge > 15 * 60 * 1000 || !session.mfaVerified) {
        throw new StepUpRequired('MFA verification needed');
      }
      break;
    case 'passkey':
      if (authAge > 5 * 60 * 1000 || session.authMethod !== 'webauthn') {
        throw new StepUpRequired('Passkey verification needed');
      }
      break;
    case 'full_reauth':
      throw new StepUpRequired('Full re-authentication required');
  }
}

// Usage: Protect sensitive operations
app.post('/api/admin/delete-user', async (req, res) => {
  await enforceStepUp(req, 'passkey'); // Require recent passkey auth
  // Proceed with deletion
});
```

## Device Trust Assessment

### Device Posture Checking

```typescript
interface DevicePosture {
  deviceId: string;
  platform: string;
  osVersion: string;
  patchLevel: string;
  managed: boolean;              // MDM/UEM enrolled
  compliant: boolean;            // Meets security policy
  encrypted: boolean;            // Disk encryption
  screenLock: boolean;           // Lock screen enabled
  biometricAvailable: boolean;
  jailbroken: boolean;           // Rooted/jailbroken detection
  lastCheckIn: Date;
}

function assessDeviceTrust(posture: DevicePosture): number {
  let score = 0;
  if (posture.managed) score += 25;
  if (posture.compliant) score += 25;
  if (posture.encrypted) score += 20;
  if (posture.screenLock) score += 10;
  if (!posture.jailbroken) score += 10;
  if (posture.biometricAvailable) score += 10;

  // Penalize stale posture data
  const hoursSinceCheck = (Date.now() - posture.lastCheckIn.getTime()) / 3600000;
  if (hoursSinceCheck > 24) score -= 20;

  return Math.max(0, Math.min(100, score));
}
```

## Micro-Segmentation

### API-Level Segmentation

```typescript
// Define resource sensitivity tiers
const RESOURCE_TIERS = {
  public: { minTrust: 0, requireMFA: false, requireManaged: false },
  internal: { minTrust: 30, requireMFA: false, requireManaged: false },
  confidential: { minTrust: 60, requireMFA: true, requireManaged: false },
  restricted: { minTrust: 80, requireMFA: true, requireManaged: true },
};

// Middleware enforces tier requirements
function requireTier(tier: keyof typeof RESOURCE_TIERS) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const config = RESOURCE_TIERS[tier];
    const trustScore = await evaluateTrustScore(req.trustSignals);

    if (trustScore.score < config.minTrust) {
      return res.status(403).json({ error: 'Insufficient trust level' });
    }
    if (config.requireMFA && !req.session.mfaVerified) {
      return res.status(403).json({ error: 'MFA required', challenge: 'mfa' });
    }
    if (config.requireManaged && !req.devicePosture?.managed) {
      return res.status(403).json({ error: 'Managed device required' });
    }
    next();
  };
}

// Usage
app.get('/api/public/status', requireTier('public'), getStatus);
app.get('/api/reports', requireTier('internal'), getReports);
app.get('/api/pii/customers', requireTier('confidential'), getCustomers);
app.post('/api/admin/keys', requireTier('restricted'), manageKeys);
```

## Behavioral Analysis

### Anomaly Detection Signals

```typescript
interface BehavioralContext {
  // Location
  geoIp: string;
  isKnownLocation: boolean;
  distanceFromLastLogin: number;      // km
  impossibleTravel: boolean;          // Login from distant location too quickly

  // Temporal
  hourOfDay: number;
  isUsualHour: boolean;
  daysSinceLastLogin: number;

  // Activity
  requestRate: number;                // Requests per minute
  isNormalRate: boolean;
  accessedResources: string[];
  unusualResourceAccess: boolean;
  failedAttempts: number;
}

function calculateBehavioralRisk(ctx: BehavioralContext): number {
  let risk = 0; // 0 = no risk, 100 = maximum risk

  if (ctx.impossibleTravel) risk += 40;
  if (!ctx.isKnownLocation) risk += 15;
  if (!ctx.isUsualHour) risk += 10;
  if (!ctx.isNormalRate) risk += 15;
  if (ctx.unusualResourceAccess) risk += 10;
  if (ctx.failedAttempts > 3) risk += 10;

  return Math.min(100, risk);
}
```

## Zero Trust for Agents

AI agents must also be subject to zero trust verification:

```typescript
async function evaluateAgentTrust(
  agentId: string,
  request: AgentRequest
): Promise<TrustDecision> {
  const signals = {
    // Agent identity strength
    authMethod: await getAgentAuthMethod(agentId), // client_credentials, delegated
    credentialAge: await getCredentialAge(agentId),

    // Delegation chain integrity
    delegationChainValid: await validateDelegationChain(request.delegationChain),
    humanSponsorActive: await isHumanSponsorActive(request.humanSponsor),

    // Behavioral signals
    requestPattern: await analyzeAgentPattern(agentId, request),
    scopeEscalation: detectScopeEscalation(request.requestedScopes, request.currentScopes),

    // Rate and volume
    recentRequestCount: await getRecentRequestCount(agentId),
    withinLimits: await checkRateLimits(agentId),
  };

  return evaluateAgentTrustScore(signals);
}
```

## Implementation Checklist

- [ ] Every request verified (no trusted networks/zones)
- [ ] Session trust reassessed periodically, not just at login
- [ ] Device posture checked and factored into access decisions
- [ ] Step-up authentication triggered on trust score degradation
- [ ] Resources classified by sensitivity tier
- [ ] API access controlled by tier requirements
- [ ] Behavioral anomalies (impossible travel, unusual access) detected
- [ ] Agent identities subject to same zero trust principles
- [ ] All access decisions logged for audit
- [ ] Denial reasons returned to clients for corrective action
