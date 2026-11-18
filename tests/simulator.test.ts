// tests/simulator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getClusterStore } from '../src/sim/core/store';
import { TerminalShellSession } from '../src/sim/shells/shellEngine';
import { assertEmployeeOutputHygiene, HygieneViolationError } from '../src/sim/core/hygiene';

describe('Secure Access Platform Simulator - Full Acceptance Suite (§13)', () => {
  beforeEach(() => {
    getClusterStore().reset();
  });

  it('TC-01..TC-05: Admin SSH to jump-host, kubectl nodes/pods/pvc/svc/cert & idempotent ansible-playbook (changed=0)', () => {
    const admin = new TerminalShellSession('admin');

    // First SSH prompt
    const ssh1 = admin.executeLine('ssh admin@10.10.0.30');
    expect(ssh1.output).toContain("The authenticity of host '10.10.0.30 (10.10.0.30)' can't be established.");
    const ssh2 = ssh1.promptInput!.onInput('yes');
    expect(ssh2.output).toContain("Permanently added '10.10.0.30'");
    const ssh3 = ssh2.promptInput!.onInput('Jump@Admin2026');
    expect(ssh3.output).toContain('Welcome to Ubuntu 24.04.1 LTS');
    expect(admin.getPrompt()).toBe('admin@jump-host:~$ ');

    // Check 5 Ready nodes
    const nodes = admin.executeLine('kubectl get nodes -o wide');
    expect(nodes.output).toContain('k8s-master-1');
    expect(nodes.output).toContain('k8s-worker-2');

    // Idempotent Ansible run -> changed=0 on all 8 hosts
    admin.executeLine('cd secure-access-platform');
    const pb = admin.executeLine('ansible-playbook -i ansible/inventory/hosts.ini ansible/site.yml');
    expect(pb.output).toContain('PLAY RECAP');
    expect(pb.output).toContain('changed=0');
  });

  it('TC-17..TC-22: Alice completes 5-step flow, dynamic DB user created & auto-revoked on \\q, Bob/Mallory RBAC enforced', () => {
    const emp = new TerminalShellSession('employee');
    const store = getClusterStore();

    // Alice LDAP authentication
    const authPrompt = emp.executeLine('boundary authenticate ldap -auth-method-id=amldap_9fK2pQx7Lz -login-name=alice');
    const authRes = authPrompt.promptInput!.onInput('Alice@Yotta26');
    expect(authRes.output).toContain('The token was successfully stored in the chosen keyring');

    // Targets list has no private IPs
    const targetsRes = emp.executeLine('boundary targets list -recursive');
    expect(targetsRes.output).toContain('production-db');
    expect(targetsRes.output).not.toContain('10.10.0.32');

    // Connect to production-db
    const connRes = emp.executeLine('boundary connect postgres -dbname=appdb -target-name=production-db -target-scope-name=Production-Access');
    expect(connRes.output).toContain('psql (16.4');
    expect(emp.getPrompt()).toBe('appdb=> ');

    // Verify dynamic Vault username
    const userRes = emp.executeLine('SELECT current_user;');
    expect(userRes.output).toContain('v-token-prod-db-o-');
    expect(Object.keys(store.getState().vault.leases).length).toBe(1);

    // Exit psql -> lease immediately revoked (Step 5/5)
    emp.executeLine('\\q');
    expect(Object.keys(store.getState().vault.leases).length).toBe(0);
    const banners = store.getState().backendLogs.map((l) => l.banner).filter(Boolean);
    expect(banners).toContain('══════════ STEP 1/5 · IDENTITY AUTHENTICATION  (User → Boundary Controller) ══════════');
    expect(banners).toContain('══════════ STEP 5/5 · SESSION TERMINATION & AUTO-REVOCATION ══════════');

    // Bob denied on production-db (Forbidden)
    const bobPrompt = emp.executeLine('boundary authenticate ldap -auth-method-id=amldap_9fK2pQx7Lz -login-name=bob');
    bobPrompt.promptInput!.onInput('Bob@Yotta26');
    const bobDb = emp.executeLine('boundary connect postgres -dbname=appdb -target-name=production-db -target-scope-name=Production-Access');
    expect(bobDb.output).toContain('Forbidden');
    expect(bobDb.output).toContain('403');

    // Mallory sees no targets
    const malPrompt = emp.executeLine('boundary authenticate ldap -auth-method-id=amldap_9fK2pQx7Lz -login-name=mallory');
    malPrompt.promptInput!.onInput('Mallory@Yotta26');
    const malTargets = emp.executeLine('boundary targets list -recursive');
    expect(malTargets.output).toBe('No targets found');
  });

  it('Secrets Hygiene Guard (§11.6): Employee ping/ssh time out without leaking 10.10.0.30/.31/.32 and guard blocks forbidden strings', () => {
    const emp = new TerminalShellSession('employee');
    const pingRes = emp.executeLine('ping 10.10.0.30');
    expect(pingRes.output).toContain('Request timed out.');
    expect(pingRes.output).not.toContain('10.10.0.30');

    const sshRes = emp.executeLine('ssh ops@10.10.0.30');
    expect(sshRes.output).toContain('Connection timed out');
    expect(sshRes.output).not.toContain('10.10.0.30');

    expect(() =>
      assertEmployeeOutputHygiene('Leaked target IP 10.10.0.32', getClusterStore().getState())
    ).toThrow(HygieneViolationError);
  });

  it('TC-15 & TC-16: Keepalived VIP failover and Vault leader failover + 3-key Shamir unseal work end-to-end', () => {
    const admin = new TerminalShellSession('admin');
    const store = getClusterStore();
    const s1 = admin.executeLine('ssh admin@10.10.0.30');
    const s2 = s1.promptInput!.onInput('yes');
    s2.promptInput!.onInput('Jump@Admin2026');

    // Stop keepalived on haproxy-1 -> VIP moves to haproxy-2
    admin.executeLine('ssh haproxy-1 sudo systemctl stop keepalived');
    expect(store.getState().vipHolder).toBe('haproxy-2');
    const ipOut = admin.executeLine('ssh haproxy-2 ip a');
    expect(ipOut.output).toContain('10.10.0.100/24');

    // Delete vault-0 -> vault-1 becomes leader, vault-0 is sealed (0/3)
    admin.executeLine('kubectl delete pod vault-0 -n vault');
    expect(store.getState().vault.nodes['vault-1'].state).toBe('leader');
    expect(store.getState().vault.nodes['vault-0'].sealed).toBe(true);

    // Unseal vault-0 with 3 Shamir keys
    const keys = store.getState().vault.unsealKeys;
    admin.executeLine(`kubectl exec -n vault vault-0 -- vault operator unseal ${keys[0]}`);
    admin.executeLine(`kubectl exec -n vault vault-0 -- vault operator unseal ${keys[1]}`);
    admin.executeLine(`kubectl exec -n vault vault-0 -- vault operator unseal ${keys[2]}`);
    expect(store.getState().vault.nodes['vault-0'].sealed).toBe(false);
  });
});