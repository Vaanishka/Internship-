import { BoundaryAuthToken, BoundaryTarget, ClusterState } from '../core/types';
import { checkVaultPolicyCapability } from './vaultPolicy';

export interface DecisionOutcome {
  allowed: boolean;
  ruleTriggered: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
  status: number;
  kind: string;
  message: string;
  userLogin?: string;
}

export function getActiveVaultLeader(state: ClusterState): 'vault-0' | 'vault-1' | 'vault-2' | null {
  for (const nodeId of ['vault-0', 'vault-1', 'vault-2'] as const) {
    const node = state.vault.nodes[nodeId];
    const pod = state.k8s.pods.find((p) => p.namespace === 'vault' && p.name === nodeId);
    if (node.state === 'leader' && !node.sealed && pod && pod.status === 'Running' && pod.ready === '1/1') {
      return nodeId;
    }
  }
  return null;
}

export function getAuthorizedTargetIdsForUser(state: ClusterState, userId: string): Set<string> {
  const user = state.boundary.users.find((u) => u.id === userId);
  if (!user) return new Set();

  const matchingManagedGroupIds = state.boundary.managedGroups
    .filter((mg) => mg.groupNames.some((g) => user.ldapGroups.includes(g)))
    .map((mg) => mg.id);

  const principalSet = new Set<string>([user.id, ...matchingManagedGroupIds]);
  const allowedTargets = new Set<string>();

  for (const role of state.boundary.roles) {
    if (!role.principalIds.some((pid) => principalSet.has(pid))) continue;
    for (const grant of role.grantStrings) {
      if (grant === 'ids=*;type=*;actions=*') {
        state.boundary.targets.forEach((t) => allowedTargets.add(t.id));
      } else if (grant.includes('actions=read,authorize-session')) {
        const idsMatch = grant.match(/ids=([^;]+)/);
        if (idsMatch) {
          idsMatch[1].split(',').forEach((id) => allowedTargets.add(id.trim()));
        }
      }
    }
  }
  return allowedTargets;
}

/**
 * Evaluates Annexure A-6.1 Decision Rules R1 through R6 in exact order.
 */
export function evaluateBoundarySessionAuthorization(
  state: ClusterState,
  authToken: BoundaryAuthToken | null,
  target: BoundaryTarget,
  now = Date.now()
): DecisionOutcome {
  // Check if postgres-0 or boundary-controller is down
  const pgPod = state.k8s.pods.find((p) => p.namespace === 'boundary' && p.name === 'postgres-0');
  if (!pgPod || pgPod.status !== 'Running') {
    return {
      allowed: false,
      ruleTriggered: 'R1',
      status: 503,
      kind: 'Internal',
      message: 'Controller unable to query backing database (postgres-0 unreachable).'
    };
  }

  // (R1) Is Boundary auth token present and valid (unexpired)?
  if (!authToken || authToken.expiresAt <= now) {
    return {
      allowed: false,
      ruleTriggered: 'R1',
      status: 401,
      kind: 'Unauthenticated',
      message: 'Unauthenticated: invalid or expired authentication token.'
    };
  }

  // (R2) Does user's role grant authorize-session on target?
  const allowedTargetIds = getAuthorizedTargetIdsForUser(state, authToken.userId);
  if (!allowedTargetIds.has(target.id)) {
    return {
      allowed: false,
      ruleTriggered: 'R2',
      status: 403,
      kind: 'PermissionDenied',
      message: 'Forbidden.'
    };
  }

  // (R3) Is Vault reachable, unsealed, and credential-store token valid?
  const leader = getActiveVaultLeader(state);
  if (!leader) {
    return {
      allowed: false,
      ruleTriggered: 'R3',
      status: 500,
      kind: 'Internal',
      message: 'Error: credential store error: Vault is sealed'
    };
  }

  const credStore = state.boundary.credentialStores[0];
  if (!credStore || !credStore.caCertValid) {
    return {
      allowed: false,
      ruleTriggered: 'R3',
      status: 500,
      kind: 'Internal',
      message: 'Error: credential store error: x509: certificate signed by unknown authority or missing IP SAN'
    };
  }

  const vaultTokenObj = state.vault.tokens[credStore.vaultToken];
  if (!vaultTokenObj || vaultTokenObj.revoked || (vaultTokenObj.expiresAt > 0 && vaultTokenObj.expiresAt <= now)) {
    return {
      allowed: false,
      ruleTriggered: 'R3',
      status: 500,
      kind: 'Internal',
      message: 'Error: credential store error: Vault token expired or invalid'
    };
  }

  // (R4) Does Vault policy allow required path + lease renewal paths?
  const hasTokenLookup = checkVaultPolicyCapability(state, vaultTokenObj.policies, 'auth/token/lookup-self', 'read');
  const hasTokenRenew = checkVaultPolicyCapability(state, vaultTokenObj.policies, 'auth/token/renew-self', 'update');
  const hasLeaseRenew = checkVaultPolicyCapability(state, vaultTokenObj.policies, 'sys/leases/renew', 'update');
  if (!hasTokenLookup || !hasTokenRenew || !hasLeaseRenew) {
    return {
      allowed: false,
      ruleTriggered: 'R4',
      status: 500,
      kind: 'Internal',
      message: 'Error: credential store error: Vault returned 403 permission denied on token/lease renewal check'
    };
  }

  for (const libId of target.brokeredCredentialSourceIds) {
    const lib = state.boundary.credentialLibraries.find((l) => l.id === libId);
    if (!lib) continue;
    const reqCap = lib.httpMethod === 'POST' ? 'update' : 'read';
    if (!checkVaultPolicyCapability(state, vaultTokenObj.policies, lib.vaultPath, reqCap)) {
      return {
        allowed: false,
        ruleTriggered: 'R4',
        status: 500,
        kind: 'Internal',
        message: `Error: credential store error: permission denied on path "${lib.vaultPath}"`
      };
    }
  }

  // (R5) Can Boundary worker reach target + port?
  const workerPod = state.k8s.pods.find((p) => p.namespace === 'boundary' && p.name.startsWith('boundary-worker'));
  if (!workerPod || workerPod.status !== 'Running') {
    return {
      allowed: false,
      ruleTriggered: 'R5',
      status: 502,
      kind: 'Internal',
      message: 'Error: worker unable to connect to target (no active boundary-worker).'
    };
  }

  let targetIp = target.directAddress || '10.10.0.30';
  if (target.hostSetIds.length > 0) {
    const hs = state.boundary.hostSets.find((h) => h.id === target.hostSetIds[0]);
    const host = hs ? state.boundary.hosts.find((h) => h.id === hs.hostIds[0]) : undefined;
    if (host) targetIp = host.address;
  }

  const targetMachine = Object.values(state.hosts).find((h) => h.ip === targetIp);
  if (!targetMachine || !targetMachine.poweredOn) {
    return {
      allowed: false,
      ruleTriggered: 'R5',
      status: 502,
      kind: 'Internal',
      message: 'Error: worker unable to connect to target: dial tcp: i/o timeout'
    };
  }
  if (target.defaultPort === 5432 && targetMachine.services.postgresql !== 'active') {
    return {
      allowed: false,
      ruleTriggered: 'R5',
      status: 502,
      kind: 'Internal',
      message: 'Error: worker unable to connect to target: connection refused on port 5432'
    };
  }
  if (target.defaultPort === 22 && targetMachine.services.ssh !== 'active') {
    return {
      allowed: false,
      ruleTriggered: 'R5',
      status: 502,
      kind: 'Internal',
      message: 'Error: worker unable to connect to target: connection refused on port 22'
    };
  }

  // (R6) Authorized
  return {
    allowed: true,
    ruleTriggered: 'R6',
    status: 200,
    kind: 'Authorized',
    message: 'Session authorized.',
    userLogin: authToken.loginName
  };
}
