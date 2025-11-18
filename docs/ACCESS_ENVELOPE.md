# Access Envelope and Policies

**Version:** 1.0  
**Last Updated:** 2025-11-18  
**Owner:** Security & Compliance

---

## Overview

This document defines access control policies, role-based permissions, and operational procedures for the RastUp platform. It establishes the "access envelope" — the boundary of who can access what, when, and under what conditions.

## Principles

1. **Least Privilege**: Users and services have only the minimum access required
2. **Just-In-Time (JIT) Elevation**: Elevated permissions granted temporarily when needed
3. **Separation of Duties**: Critical operations require multiple approvals
4. **Audit Everything**: All access and privileged operations logged immutably
5. **Zero Trust**: Verify explicitly, assume breach, use least privilege

## Role-Based Access Control (RBAC)

### User Roles

| Role | Description | Permissions |
|------|-------------|-------------|
| **User** | Standard platform user | Own profile, bookings, messages |
| **Provider** | Service provider (model, photographer, etc.) | User + service profile management, accept bookings |
| **Admin** | Internal staff | Read-only access to most resources |
| **Support** | Customer support staff | Admin + user impersonation (with audit) |
| **Trust** | Trust & Safety team | Support + content moderation, user suspension |
| **Finance** | Finance team | Read-only financial data, payout management |
| **Engineering** | Engineering team | Production read-only, write via CI/CD |
| **Security** | Security team | Full audit log access, security controls |
| **Super Admin** | Emergency access | Full access (requires MFA + approval) |

### Permission Matrix

| Resource | User | Provider | Admin | Support | Trust | Finance | Engineering | Security | Super Admin |
|----------|------|----------|-------|---------|-------|---------|-------------|----------|-------------|
| Own Profile | RW | RW | R | RW* | RW* | - | R | R | RW |
| Other Profiles | R | R | R | R | RW* | - | R | R | RW |
| Bookings (own) | RW | RW | R | RW* | RW* | R | R | R | RW |
| Bookings (other) | - | - | R | R | RW* | R | R | R | RW |
| Messages (own) | RW | RW | R | R* | R* | - | - | R | RW |
| Messages (other) | - | - | - | R* | R* | - | - | R | RW |
| Payments | RW | RW | R | R | R | RW | R | R | RW |
| Content Moderation | - | - | - | - | RW | - | - | R | RW |
| Feature Flags | - | - | - | - | - | - | RW | R | RW |
| Infrastructure | - | - | - | - | - | - | R | R | RW |
| Audit Logs | - | - | - | - | - | - | R | RW | RW |
| Secrets | - | - | - | - | - | - | - | R | RW |

**Legend**: R = Read, W = Write, RW = Read/Write, * = With audit trail, - = No access

## Access Control Mechanisms

### 1. Authentication

#### User Authentication
- **Primary**: Email + password with bcrypt hashing
- **MFA**: TOTP (Google Authenticator, Authy) required for:
  - Admin, Support, Trust, Finance, Engineering, Security, Super Admin roles
  - High-value transactions (> $1000)
  - Account settings changes
- **OAuth**: Google, Apple Sign-In (optional)
- **Session**: JWT tokens (15 min access, 30 day refresh)

#### Service Authentication
- **AWS IAM**: Role-based access for services
- **API Keys**: Scoped keys for external integrations
- **mTLS**: Service-to-service authentication

### 2. Authorization

#### GraphQL Directives

```graphql
directive @auth(requires: Role!) on FIELD_DEFINITION

type Query {
  user(id: ID!): User @auth(requires: USER)
  users: [User!]! @auth(requires: ADMIN)
  auditLogs: [AuditLog!]! @auth(requires: SECURITY)
}

type Mutation {
  updateUser(id: ID!, input: UserInput!): User @auth(requires: USER)
  suspendUser(id: ID!, reason: String!): User @auth(requires: TRUST)
  rotateSecret(name: String!): Secret @auth(requires: SECURITY)
}
```

#### Middleware Checks

```typescript
// Check if user has required role
function requireRole(role: Role) {
  return (req, res, next) => {
    if (!req.user || !req.user.roles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Check if user owns resource
function requireOwnership(resourceType: string) {
  return async (req, res, next) => {
    const resource = await getResource(resourceType, req.params.id);
    if (resource.userId !== req.user.id && !req.user.roles.includes('ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
```

### 3. Just-In-Time (JIT) Elevation

For sensitive operations requiring temporary elevated access:

```bash
# Request JIT elevation
npm run access:request-elevation -- \
  --role=SUPER_ADMIN \
  --reason="Emergency database restore" \
  --duration=1h

# Approval required from 2 security team members
# Notification sent to security@rastup.com

# After approval, temporary token issued
export ELEVATED_TOKEN=<token>

# Use elevated token for operations
npm run db:restore -- --token=$ELEVATED_TOKEN --snapshot=<snapshot-id>

# Elevation automatically expires after duration
# All actions logged to audit trail
```

#### JIT Elevation Requirements

| Operation | Required Role | Approvers | Max Duration |
|-----------|--------------|-----------|--------------|
| Database restore | SUPER_ADMIN | 2 Security | 1 hour |
| Secret rotation | SECURITY | 1 Security | 2 hours |
| User data export | SUPER_ADMIN | 2 Security + Legal | 1 hour |
| Production deployment | ENGINEERING | 1 Engineering Manager | 4 hours |
| Feature flag change (prod) | ENGINEERING | 2 Engineers | N/A |
| Payment refund (> $1000) | FINANCE | 1 Finance Manager | N/A |

### 4. Two-Person Rule

Critical operations require approval from two authorized individuals:

- Production database changes
- Secret rotation
- Feature flag changes (production)
- User data exports (DSAR, legal hold)
- Payment refunds > $1000
- Account suspensions (permanent)

### 5. Separation of Duties

No single individual can:
- Deploy code and approve deployment
- Create user and verify user identity
- Process payment and issue refund
- Moderate content and appeal decision

## Infrastructure Access

### AWS Access

#### Production Environment

- **Console Access**: Read-only via SSO (Okta)
- **CLI Access**: Via temporary credentials with MFA
- **Write Operations**: Only via CI/CD or JIT elevation

```bash
# Assume role with MFA
aws sts assume-role \
  --role-arn arn:aws:iam::123456789:role/EngineerReadOnly \
  --role-session-name engineer-session \
  --serial-number arn:aws:iam::123456789:mfa/engineer \
  --token-code 123456

# Temporary credentials valid for 1 hour
```

#### Staging/Dev Environments

- **Console Access**: Read/write via SSO
- **CLI Access**: Via temporary credentials (no MFA required)

### Database Access

#### Production Database

- **Direct Access**: Prohibited (except emergencies with JIT elevation)
- **Read-Only Access**: Via read replica with VPN
- **Write Access**: Only via application or approved migration scripts

```bash
# Connect to read replica (VPN required)
psql -h rastup-prod-replica.us-east-1.rds.amazonaws.com \
  -U readonly_user \
  -d rastup

# Write access requires JIT elevation
npm run access:request-elevation -- \
  --role=DATABASE_ADMIN \
  --reason="Emergency data fix" \
  --duration=30m
```

#### Staging Database

- **Direct Access**: Allowed for engineers via VPN
- **Credentials**: Stored in 1Password team vault

### Secrets Access

- **Production Secrets**: AWS Secrets Manager, access logged
- **Rotation**: Automated 90-day rotation
- **Emergency Access**: JIT elevation required

```bash
# Retrieve secret (logged)
aws secretsmanager get-secret-value \
  --secret-id rastup/prod/stripe-api-key

# Rotate secret (requires approval)
npm run secrets:rotate -- \
  --secret=stripe-api-key \
  --approval-ticket=SEC-1234
```

## User Impersonation

Support and Trust teams can impersonate users for troubleshooting:

### Requirements

- Valid support ticket or trust case
- User consent (unless trust investigation)
- MFA verification
- Time-limited session (max 30 minutes)
- All actions logged

### Procedure

```bash
# Request impersonation
npm run support:impersonate -- \
  --user-id=<user-id> \
  --ticket=SUP-1234 \
  --reason="Troubleshoot booking issue"

# Approval required from Support Manager
# Temporary impersonation token issued

# Use impersonation token
export IMPERSONATION_TOKEN=<token>

# All actions logged with impersonation context
# Session expires after 30 minutes
```

### Audit Trail

```json
{
  "event": "user.impersonation.start",
  "timestamp": "2025-11-18T14:30:00Z",
  "actor": {
    "id": "support-123",
    "email": "support@rastup.com",
    "role": "SUPPORT"
  },
  "target": {
    "id": "user-456",
    "email": "user@example.com"
  },
  "context": {
    "ticket": "SUP-1234",
    "reason": "Troubleshoot booking issue",
    "duration": "30m"
  }
}
```

## Network Access

### VPN Access

Required for:
- Database connections (staging, prod read replica)
- Internal admin tools
- Bastion host access

**Setup**:
```bash
# Install WireGuard
brew install wireguard-tools

# Configure VPN
sudo wg-quick up rastup-vpn

# Verify connectivity
ping internal-admin.rastup.internal
```

### IP Allowlisting

Production admin endpoints restricted to:
- Office IPs
- VPN IPs
- Approved cloud IPs (CI/CD)

### Bastion Host

For emergency SSH access to infrastructure:

```bash
# Connect via bastion (requires VPN + SSH key)
ssh -J bastion.rastup.com user@internal-server.rastup.internal

# All sessions logged
# Max session duration: 1 hour
```

## Audit and Compliance

### Audit Logging

All privileged operations logged to immutable audit trail:

```json
{
  "event": "database.query.execute",
  "timestamp": "2025-11-18T14:30:00Z",
  "actor": {
    "id": "engineer-123",
    "email": "engineer@rastup.com",
    "role": "ENGINEERING",
    "elevated": true,
    "elevation_expires": "2025-11-18T15:30:00Z"
  },
  "resource": {
    "type": "database",
    "id": "rastup-prod",
    "query": "UPDATE users SET email = ... WHERE id = ..."
  },
  "result": "success",
  "metadata": {
    "ip": "192.168.1.100",
    "user_agent": "psql/14.5",
    "mfa_verified": true
  }
}
```

### Access Reviews

- **Quarterly**: Review all user roles and permissions
- **Annually**: Full access audit by external auditor
- **On Departure**: Immediate revocation of all access

### Compliance

- **SOC 2 Type II**: Annual audit of access controls
- **PCI DSS**: Quarterly access review for payment systems
- **GDPR**: Data access logged and reportable

## Emergency Procedures

### Break-Glass Access

In case of emergency (e.g., all admins unavailable):

1. Contact on-call security engineer
2. Retrieve break-glass credentials from secure vault (requires 2 keys)
3. Use credentials to gain temporary Super Admin access
4. Document all actions taken
5. Rotate break-glass credentials after use
6. Conduct post-incident review

### Account Lockout

If admin account locked:

1. Contact security@rastup.com
2. Verify identity via video call + government ID
3. Security team resets MFA and issues temporary password
4. User must reset password and re-enroll MFA immediately

### Compromised Credentials

If credentials compromised:

1. Immediately revoke all sessions
2. Rotate affected secrets
3. Review audit logs for unauthorized access
4. Notify affected users if needed
5. Conduct security review

## References

- RBAC Implementation: `docs/security/rbac_and_mfa.md`
- IAM Policies: `ops/config/iam-policies.json`
- Audit Logging: `docs/security/audit_logging.md`
- Incident Response: `ops/runbooks/incident_response.md`

## Contacts

- **Security Team**: security@rastup.com
- **Compliance**: compliance@rastup.com
- **Emergency**: +1-555-SECURITY (24/7)

---

**Review Cadence**: Quarterly or after significant changes
