import { ClusterState, HostId } from '../core/types';
import { appendBackendLogToDraft } from '../core/store';

/**
 * Runs every second across windows idempotently based on wall-clock timestamps.
 * Returns true if any state changed.
 */
export function tickClusterReconciler(state: ClusterState, now = Date.now()): boolean {
  let mutated = false;

  // 1. Keepalived VRRP VIP failover check (haproxy-1 prio 101 vs haproxy-2 prio 100)
  const h1 = state.hosts['haproxy-1'];
  const h2 = state.hosts['haproxy-2'];
  const h1Alive = h1.poweredOn && h1.services.keepalived === 'active' && h1.services.haproxy === 'active';
  const h2Alive = h2.poweredOn && h2.services.keepalived === 'active' && h2.services.haproxy === 'active';

  let desiredVip: 'haproxy-1' | 'haproxy-2' | 'none' = 'none';
  if (h1Alive) desiredVip = 'haproxy-1';
  else if (h2Alive) desiredVip = 'haproxy-2';

  if (state.vipHolder !== desiredVip) {
    const prev = state.vipHolder;
    state.vipHolder = desiredVip;
    mutated = true;
    if (desiredVip === 'haproxy-2') {
      h2.journal.keepalived.push(`Nov 17 ${new Date(now).toTimeString().slice(0, 8)} haproxy-2 Keepalived_vrrp[895]: (VI_1) Entering MASTER STATE`);
      h2.journal.keepalived.push(`Nov 17 ${new Date(now).toTimeString().slice(0, 8)} haproxy-2 Keepalived_vrrp[895]: (VI_1) setting VIPs: 10.10.0.100/24 dev eth0`);
      appendBackendLogToDraft(state, {
        component: 'haproxy',
        podOrHost: 'haproxy-2',
        message: `VRRP failover: ${prev} down -> haproxy-2 (prio 100) transitioned to MASTER and claimed VIP 10.10.0.100`,
        timestampMs: now
      });
    } else if (desiredVip === 'haproxy-1') {
      h1.journal.keepalived.push(`Nov 17 ${new Date(now).toTimeString().slice(0, 8)} haproxy-1 Keepalived_vrrp[910]: (VI_1) Entering MASTER STATE (preempt prio 101)`);
      appendBackendLogToDraft(state, {
        component: 'haproxy',
        podOrHost: 'haproxy-1',
        message: `VRRP preempt: haproxy-1 (prio 101) reclaimed VIP 10.10.0.100 from ${prev}`,
        timestampMs: now
      });
    }
  }

  // 2. Node poweroff -> NotReady transition & Worker pod rescheduling
  for (const node of state.k8s.nodes) {
    const host = state.hosts[node.name as HostId];
    if (!host) continue;
    const shouldBeReady = host.poweredOn && host.services.kubelet === 'active';
    if (!shouldBeReady && node.status === 'Ready') {
      node.status = 'NotReady';
      node.notReadySince = now;
      mutated = true;
      appendBackendLogToDraft(state, {
        component: 'k8s',
        podOrHost: 'kube-controller-manager',
        message: `Node ${node.name} (${node.internalIp}) status changed to NotReady (heartbeat missed)`,
        isError: true,
        timestampMs: now
      });

      // If worker node went down, reschedule non-DaemonSet pods to surviving worker and mark Longhorn degraded
      if (node.name === 'k8s-worker-1' || node.name === 'k8s-worker-2') {
        const otherWorker = node.name === 'k8s-worker-1' ? 'k8s-worker-2' : 'k8s-worker-1';
        for (const pvc of state.k8s.pvcs) {
          pvc.replicaHealth = 'degraded';
        }
        appendBackendLogToDraft(state, {
          component: 'longhorn',
          podOrHost: 'longhorn-manager',
          message: `Volume replicas on ${node.name} marked degraded; scheduling replica rebuild on ${otherWorker}`,
          timestampMs: now
        });
        for (const pod of state.k8s.pods) {
          if (pod.node === node.name && !pod.name.startsWith('kube-proxy') && !pod.name.startsWith('calico-node') && !pod.name.startsWith('speaker-')) {
            pod.node = otherWorker;
            pod.restarts += 1;
            appendBackendLogToDraft(state, {
              component: 'k8s',
              podOrHost: 'kube-scheduler',
              message: `Rescheduled pod ${pod.namespace}/${pod.name} from failed node ${node.name} to ${otherWorker}`,
              timestampMs: now
            });
          }
        }
      }
    } else if (shouldBeReady && node.status === 'NotReady') {
      node.status = 'Ready';
      node.notReadySince = undefined;
      mutated = true;
      for (const pvc of state.k8s.pvcs) {
        pvc.replicaHealth = 'healthy';
      }
      appendBackendLogToDraft(state, {
        component: 'k8s',
        podOrHost: 'kube-controller-manager',
        message: `Node ${node.name} recovered and is Ready; Longhorn volume replicas healthy`,
        timestampMs: now
      });
    }
  }

  // 3. Active Boundary sessions: check 120s/max window expiry & periodic Vault lease renewal
  for (const session of Object.values(state.boundary.sessions)) {
    if (session.status !== 'active') continue;

    if (now >= session.expiresAt) {
      session.status = 'terminated';
      session.terminatedAt = now;
      session.terminationReason = 'session max_seconds (window) expired';
      mutated = true;

      const lease = state.vault.leases[session.vaultLeaseId];
      if (lease) {
        if (lease.path.startsWith('database/')) {
          state.vault.revokedDbUsers[lease.username] = lease.secretValue;
          state.postgresAppDb.activeRoles = state.postgresAppDb.activeRoles.filter((r) => r.rolname !== lease.username);
        }
        delete state.vault.leases[session.vaultLeaseId];
      }

      appendBackendLogToDraft(state, {
        component: 'boundary',
        podOrHost: 'boundary-worker',
        banner: '══════════ STEP 5/5 · SESSION TERMINATION & AUTO-REVOCATION ══════════',
        message: `session ${session.id} reached session_max_seconds limit -> tearing down proxy tunnel (reason=session expired)`,
        timestampMs: now
      });
      appendBackendLogToDraft(state, {
        component: 'boundary',
        podOrHost: 'boundary-controller',
        message: `-> Vault PUT /v1/sys/leases/revoke lease_id=${session.vaultLeaseId}`,
        timestampMs: now + 5
      });
      appendBackendLogToDraft(state, {
        component: 'vault',
        podOrHost: 'vault/vault-0',
        message: `lease revoked ${session.vaultLeaseId} (credential invalidated on ${session.targetName}; zero standing privileges)`,
        timestampMs: now + 12
      });
    }
  }

  // 4. Expire any standalone Vault leases past their expiresAt
  for (const [leaseId, lease] of Object.entries(state.vault.leases)) {
    if (now >= lease.expiresAt) {
      if (lease.path.startsWith('database/')) {
        state.vault.revokedDbUsers[lease.username] = lease.secretValue;
        state.postgresAppDb.activeRoles = state.postgresAppDb.activeRoles.filter((r) => r.rolname !== lease.username);
      }
      delete state.vault.leases[leaseId];
      mutated = true;
      appendBackendLogToDraft(state, {
        component: 'vault',
        podOrHost: 'vault/vault-0',
        message: `TTL expired for lease ${leaseId} -> automatically revoked credential ${lease.username}`,
        timestampMs: now
      });
    }
  }

  return mutated;
}