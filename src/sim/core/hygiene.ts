// src/sim/core/hygiene.ts
import { ClusterState } from './types';

export const FORBIDDEN_EMPLOYEE_SUBSTRINGS = [
  '10.10.0.30',
  '10.10.0.31',
  '10.10.0.32',
  'STEP 1/5',
  'STEP 2/5',
  'STEP 3/5',
  'STEP 4/5',
  'STEP 5/5'
];

export class HygieneViolationError extends Error {
  constructor(message: string) {
    super(`SECRETS HYGIENE VIOLATION: ${message}`);
    this.name = 'HygieneViolationError';
  }
}

/**
 * Scans every byte written to the /employee terminal.
 * Fails immediately if any target IP (10.10.0.30/.31/.32), Vault-generated password/OTP,
 * unredacted token (unless explicitly allowed via -keyring-type=none), or backend narration appears.
 */
export function assertEmployeeOutputHygiene(
  output: string,
  state: ClusterState,
  allowUnredactedAuthToken = false
): void {
  for (const forbidden of FORBIDDEN_EMPLOYEE_SUBSTRINGS) {
    if (output.includes(forbidden)) {
      throw new HygieneViolationError(`Employee terminal attempted to print forbidden string: "${forbidden}"`);
    }
  }

  // Check active and historical dynamic lease passwords / OTPs
  for (const lease of Object.values(state.vault.leases)) {
    if (lease.secretValue && lease.secretValue.length >= 4 && output.includes(lease.secretValue)) {
      throw new HygieneViolationError(`Employee terminal attempted to print dynamic secret for lease ${lease.leaseId}`);
    }
  }
  for (const oldSecret of Object.values(state.vault.revokedDbUsers)) {
    if (oldSecret && oldSecret.length >= 4 && output.includes(oldSecret)) {
      throw new HygieneViolationError(`Employee terminal attempted to print revoked dynamic password`);
    }
  }
  for (const session of Object.values(state.boundary.sessions)) {
    if (session.brokeredSecret && output.includes(session.brokeredSecret)) {
      throw new HygieneViolationError(`Employee terminal attempted to print brokered secret for session ${session.id}`);
    }
  }

  // Check Boundary auth tokens (at_...) unless -keyring-type=none was explicitly passed
  if (!allowUnredactedAuthToken) {
    for (const tok of Object.values(state.boundary.authTokens)) {
      if (tok.token && output.includes(tok.token)) {
        throw new HygieneViolationError(`Employee terminal attempted to print unredacted Boundary token ${tok.id}`);
      }
    }
  }

  // Check Vault tokens
  if (output.includes(state.vault.rootToken)) {
    throw new HygieneViolationError('Employee terminal attempted to print Vault root token');
  }
}