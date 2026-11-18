import { ClusterState } from '../core/types';

export type VaultCapability = 'create' | 'read' | 'update' | 'delete' | 'list' | 'sudo' | 'deny';

export interface ParsedPolicyRule {
  pathPattern: string;
  capabilities: VaultCapability[];
}

export function parseVaultPolicyHcl(hclText: string): ParsedPolicyRule[] {
  const rules: ParsedPolicyRule[] = [];
  const regex = /path\s+"([^"]+)"\s*\{\s*capabilities\s*=\s*\[([^\]]*)\]\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(hclText)) !== null) {
    const pathPattern = match[1].trim();
    const rawCaps = match[2]
      .split(',')
      .map((s) => s.replace(/["'\s]/g, ''))
      .filter(Boolean) as VaultCapability[];
    rules.push({ pathPattern, capabilities: rawCaps });
  }
  return rules;
}

function vaultPathMatches(pattern: string, targetPath: string): boolean {
  const cleanPattern = pattern.replace(/^\/+|\/+$/g, '');
  const cleanTarget = targetPath.replace(/^\/+|\/+$/g, '');
  if (cleanPattern === '*') return true;
  if (cleanPattern === cleanTarget) return true;
  if (cleanPattern.endsWith('/*')) {
    const prefix = cleanPattern.slice(0, -2);
    return cleanTarget === prefix || cleanTarget.startsWith(prefix + '/');
  }
  if (cleanPattern.endsWith('*')) {
    const prefix = cleanPattern.slice(0, -1);
    return cleanTarget.startsWith(prefix);
  }
  return false;
}

export function checkVaultPolicyCapability(
  state: ClusterState,
  policyNames: string[],
  targetPath: string,
  requiredCap: VaultCapability
): boolean {
  if (policyNames.includes('root')) return true;
  let allowed = false;

  for (const policyName of policyNames) {
    const hcl = state.vault.policies[policyName];
    if (!hcl) continue;
    const rules = parseVaultPolicyHcl(hcl);
    for (const rule of rules) {
      if (vaultPathMatches(rule.pathPattern, targetPath)) {
        if (rule.capabilities.includes('deny')) return false;
        if (rule.capabilities.includes(requiredCap) || rule.capabilities.includes('sudo')) {
          allowed = true;
        }
      }
    }
  }
  return allowed;
}