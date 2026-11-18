import { CommandExecutionResult, ProgramContext } from './types';
import { ClusterState, K8sPod } from '../core/types';
import { normalizeLinuxPath, readFileNode } from '../vfs/vfs';
import { checkVaultPolicyCapability } from '../policy/vaultPolicy';
import { getActiveVaultLeader } from '../policy/boundaryDecision';
import { appendBackendLogToDraft } from '../core/store';
import { BOUNDARY_CRED_STORE_TOKEN, VAULT_SHAMIR_KEYS } from '../core/initialState';

export function executeVaultCli(
  ctx: ProgramContext,
  targetPod: 'vault-0' | 'vault-1' | 'vault-2' = 'vault-0'
): CommandExecutionResult {
  const { args, state, updateState, frame } = ctx;
  const sub = args[0] || 'status';
  const node = state.vault.nodes[targetPod] || state.vault.nodes['vault-0'];

  if (sub === 'status') {
    const leader = getActiveVaultLeader(state);
    const haMode = node.sealed ? 'sealed' : node.state === 'leader' ? 'active' : 'standby';
    return {
      output: `Key                      Value
---                      -----
Seal Type                shamir
Initialized              ${state.vault.initialized}
Sealed                   ${node.sealed}
Total Shares             5
Threshold                ${state.vault.unsealThreshold}
Unseal Progress          ${node.unsealProgress}/${state.vault.unsealThreshold}
Unseal Nonce             ${node.sealed ? '9f2a1c4d-8b7e-4a3f-9c1d-2e5f8a7b6c4d' : 'n/a'}
Version                  ${state.vault.version}
Build Date               2024-09-24T14:22:10Z
Storage Type             raft
Cluster Name             ${state.vault.clusterName}
Cluster ID               ${state.vault.clusterId}
HA Enabled               true
HA Cluster               https://${leader || 'vault-0'}.vault-internal:8201
HA Mode                  ${haMode}
Active Node Address      ${leader ? 'https://10.10.0.201:8200' : '<none>'}
Raft Committed Index     ${state.vault.raftIndex}
Raft Applied Index       ${state.vault.raftIndex}`
    };
  }

  if (sub === 'login') {
    const tokenArg = args[1];
    const finishLogin = (tok: string): CommandExecutionResult => {
      const entry = state.vault.tokens[tok.trim()];
      if (!entry || entry.revoked) {
        return { output: 'Error authenticating: error looking up token: Error making API request.\nCode: 403. Errors:\n* permission denied' };
      }
      frame.env.VAULT_TOKEN = entry.token;
      return {
        output: `Success! You are now authenticated. The token information displayed below
is already stored in the token helper. You do NOT need to run "vault login"
again. Future Vault requests will automatically use this token.

Key                  Value
---                  -----
token                ${entry.token}
token_accessor       hmac-sha256:8f2a1c9d4e7b
token_duration       ${entry.expiresAt === 0 ? '∞' : '24h'}
token_renewable      ${entry.renewable}
token_policies       [${entry.policies.join(' ')}]
identity_policies    []
policies             [${entry.policies.join(' ')}]`
      };
    };

    if (!tokenArg) {
      return {
        output: '',
        promptInput: {
          promptText: 'Token (will be hidden): ',
          echo: false,
          onInput: (val: string) => finishLogin(val)
        }
      };
    }
    return finishLogin(tokenArg);
  }

  if (sub === 'operator') {
    const opSub = args[1];

    if (opSub === 'raft' && args[2] === 'list-peers') {
      const n0 = state.vault.nodes['vault-0'];
      const n1 = state.vault.nodes['vault-1'];
      const n2 = state.vault.nodes['vault-2'];
      return {
        output: `Node       Address                        State       Voter
----       -------                        -----       -----
vault-0    ${n0.address}    ${n0.state.padEnd(11)} true
vault-1    ${n1.address}    ${n1.state.padEnd(11)} true
vault-2    ${n2.address}    ${n2.state.padEnd(11)} true`
      };
    }

    if (opSub === 'raft' && args[2] === 'snapshot' && args[3] === 'save') {
      const snapFile = args[4] || 'vault-raft.snap';
      return { output: `Saved and verified Raft snapshot to ${snapFile} (index=${state.vault.raftIndex})` };
    }

    if (opSub === 'step-down') {
      updateState((draft: ClusterState) => {
        draft.vault.nodes['vault-0'].state = 'follower';
        draft.vault.nodes['vault-1'].state = 'leader';
        appendBackendLogToDraft(draft, {
          component: 'vault',
          podOrHost: 'vault/vault-1',
          message: 'Active node stepped down -> vault-1 elected active leader'
        });
      });
      return { output: 'Success! Stepped down: https://10.10.0.201:8200' };
    }

    if (opSub === 'unseal') {
      const keyArg = args[2];
      const applyUnsealKey = (k: string): CommandExecutionResult => {
        const cleanKey = k.trim();
        if (!VAULT_SHAMIR_KEYS.includes(cleanKey)) {
          return { output: 'Error unsealing: Error making API request.\nCode: 400. Errors:\n* invalid key' };
        }
        let updatedNode = state.vault.nodes[targetPod];
        updateState((draft: ClusterState) => {
          const dn = draft.vault.nodes[targetPod];
          if (!dn.unsealKeysProvided.includes(cleanKey)) {
            dn.unsealKeysProvided.push(cleanKey);
            dn.unsealProgress = Math.min(3, dn.unsealKeysProvided.length);
          }
          if (dn.unsealProgress >= 3) {
            dn.sealed = false;
            dn.unsealKeysProvided = [];
            const pod = draft.k8s.pods.find((p: K8sPod) => p.name === targetPod);
            if (pod) pod.ready = '1/1';
            if (!getActiveVaultLeader(draft)) {
              dn.state = 'leader';
            }
            appendBackendLogToDraft(draft, {
              component: 'vault',
              podOrHost: `vault/${targetPod}`,
              message: `${targetPod} unsealed (3/3 Shamir threshold met) and rejoined active Raft cluster`
            });
          } else {
            appendBackendLogToDraft(draft, {
              component: 'vault',
              podOrHost: `vault/${targetPod}`,
              message: `${targetPod} unseal key accepted (${dn.unsealProgress}/3)`
            });
          }
          updatedNode = JSON.parse(JSON.stringify(dn));
        });

        return {
          output: `Key                Value
---                -----
Seal Type          shamir
Initialized        true
Sealed             ${updatedNode.sealed}
Total Shares       5
Threshold          3
Unseal Progress    ${updatedNode.unsealProgress}/3
Unseal Nonce       ${updatedNode.sealed ? '9f2a1c4d-8b7e-4a3f-9c1d-2e5f8a7b6c4d' : 'n/a'}
Version            ${state.vault.version}
Storage Type       raft
HA Enabled         true`
        };
      };

      if (!keyArg) {
        return {
          output: '',
          promptInput: {
            promptText: 'Unseal Key (will be hidden): ',
            echo: false,
            onInput: (val: string) => applyUnsealKey(val)
          }
        };
      }
      return applyUnsealKey(keyArg);
    }
  }

  if (!getActiveVaultLeader(state)) {
    return { output: 'Error making API request.\nCode: 503. Errors:\n* Vault is sealed' };
  }

  const activeTokenStr = frame.env.VAULT_TOKEN || state.vault.rootToken;
  const activeToken = state.vault.tokens[activeTokenStr] || state.vault.tokens[state.vault.rootToken];

  if (sub === 'policy') {
    const polAct = args[1];
    if (polAct === 'list') {
      return { output: Object.keys(state.vault.policies).join('\n') };
    }
    if (polAct === 'read') {
      const polName = args[2] || '';
      const hcl = state.vault.policies[polName];
      if (!hcl) return { output: `No policy named: ${polName}` };
      return { output: hcl };
    }
    if (polAct === 'write') {
      const polName = args[2] || '';
      const fileArg = args[3] || '';
      const fullPath = normalizeLinuxPath(frame.cwd, fileArg);
      const fileNode = readFileNode(state, frame.hostId, fullPath);
      if (!fileNode || fileNode.type !== 'file') {
        return { output: `Error: failed to read policy file ${fileArg}: no such file or directory` };
      }
      updateState((draft: ClusterState) => {
        draft.vault.policies[polName] = fileNode.content || '';
        draft.vault.raftIndex += 1;
        appendBackendLogToDraft(draft, {
          component: 'vault',
          podOrHost: 'vault/vault-0',
          message: `ACL policy "${polName}" updated via raft index ${draft.vault.raftIndex}`
        });
      });
      return { output: `Success! Uploaded policy: ${polName}` };
    }
  }

  if (sub === 'secrets') {
    const secAct = args[1];
    if (secAct === 'list') {
      return {
        output: `Path          Type         Accessor              Description
----          ----         --------              -----------
cubbyhole/    cubbyhole    cubbyhole_8f2a1c4d    per-token private secret storage
database/     database     database_3b9e7d1a     dynamic PostgreSQL credential engine
identity/     identity     identity_4c8f2e9b     identity store
secret/       kv           kv_7d1a9b3e           key/value secret storage (v2)
ssh/          ssh          ssh_2e9b4c8f          SSH OTP dynamic credential engine
sys/          system       system_1a2b3c4d       system endpoints used for control`
      };
    }
    if (secAct === 'enable') {
      return { output: 'Success! Enabled secrets engine!' };
    }
  }

  if (sub === 'auth') {
    const authAct = args[1];
    if (authAct === 'list') {
      return {
        output: `Path           Type          Accessor               Description
----           ----          --------               -----------
kubernetes/    kubernetes    auth_kubernetes_9f2a   Kubernetes ServiceAccount JWT auth
token/         token         auth_token_1a2b3c4d    token based credentials`
      };
    }
    if (authAct === 'enable') {
      return { output: `Success! Enabled ${args[2] || 'kubernetes'} auth method!` };
    }
  }

  if (sub === 'kv') {
    const kvAct = args[1];
    const rawPath = (args[2] || '').replace(/^secret\/(data\/)?/, '');
    const fullCheckPath = `secret/data/${rawPath}`;

    if (kvAct === 'get') {
      if (!checkVaultPolicyCapability(state, activeToken.policies, fullCheckPath, 'read')) {
        return {
          output: `Error making API request.\nURL: GET https://10.10.0.201:8200/v1/${fullCheckPath}\nCode: 403. Errors:\n* 1 error occurred:\n\t* permission denied`
        };
      }
      const item = state.vault.kvStore[rawPath];
      if (!item) return { output: `No value found at secret/data/${rawPath}` };
      const dataRows = Object.entries(item.data)
        .map(([k, v]) => `${k.padEnd(16)}${v}`)
        .join('\n');
      return {
        output: `====== Secret Path ======
secret/data/${rawPath}

======= Metadata =======
Key                Value
---                -----
created_time       ${item.updatedAt}
custom_metadata    <nil>
deletion_time      n/a
destroyed          false
version            ${item.version}

====== Data ======
Key             Value
---             -----
${dataRows}`
      };
    }

    if (kvAct === 'put') {
      if (!checkVaultPolicyCapability(state, activeToken.policies, fullCheckPath, 'create')) {
        return {
          output: `Error making API request.\nURL: PUT https://10.10.0.201:8200/v1/${fullCheckPath}\nCode: 403. Errors:\n* 1 error occurred:\n\t* permission denied`
        };
      }
      const pairs: Record<string, string> = {};
      for (const kv of args.slice(3)) {
        const eq = kv.indexOf('=');
        if (eq !== -1) {
          pairs[kv.slice(0, eq)] = kv.slice(eq + 1).replace(/^["']|["']$/g, '');
        }
      }
      let newVer = 1;
      const nowIso = new Date().toISOString();
      updateState((draft: ClusterState) => {
        const existing = draft.vault.kvStore[rawPath];
        newVer = existing ? existing.version + 1 : 1;
        draft.vault.kvStore[rawPath] = {
          version: newVer,
          data: pairs,
          updatedAt: nowIso
        };
        draft.vault.raftIndex += 1;
      });
      return {
        output: `======= Metadata =======
Key                Value
---                -----
created_time       ${nowIso}
deletion_time      n/a
destroyed          false
version            ${newVer}`
      };
    }
  }

  if (sub === 'read') {
    const pathArg = (args[1] || '').replace(/^\/+/, '');
    if (pathArg === 'database/creds/prod-db-ops') {
      if (ctx.windowRole === 'employee') {
        return { output: 'Error: permission denied' };
      }
      const rand = Math.random().toString(36).slice(2, 10);
      const epoch = Math.floor(Date.now() / 1000);
      const username = `v-token-prod-db-o-${rand}-${epoch}`;
      const password = `Db#${Math.random().toString(36).slice(2, 10)}9Qx!`;
      const leaseId = `database/creds/prod-db-ops/Lz9${rand}`;
      const now = Date.now();

      updateState((draft: ClusterState) => {
        draft.vault.leases[leaseId] = {
          leaseId,
          path: 'database/creds/prod-db-ops',
          issuedAt: now,
          expiresAt: now + 300000,
          maxExpiresAt: now + 900000,
          ttlSeconds: 300,
          maxTtlSeconds: 900,
          renewable: true,
          username,
          secretValue: password,
          targetHost: '10.10.0.32'
        };
        draft.postgresAppDb.activeRoles.push({
          rolname: username,
          rolvaliduntil: new Date(now + 300000).toISOString(),
          memberof: ['app_ops']
        });
        draft.vault.raftIndex += 1;
        appendBackendLogToDraft(draft, {
          component: 'vault',
          podOrHost: 'vault/vault-0',
          message: `admin CLI issued dynamic DB lease ${leaseId} (username=${username}, ttl=5m)`
        });
      });

      return {
        output: `Key                Value
---                -----
lease_id           ${leaseId}
lease_duration     5m
lease_renewable    true
password           ${password}
username           ${username}`
      };
    }
  }

  if (sub === 'write') {
    const pathArg = (args[1] || '').replace(/^\/+/, '');
    if (pathArg === 'ssh/creds/otp-ops') {
      const ipPair = args.find((a: string) => a.startsWith('ip=')) || 'ip=10.10.0.30';
      const targetIp = ipPair.split('=')[1];
      const rand = Math.random().toString(36).slice(2, 10);
      const otp = `${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`;
      const leaseId = `ssh/creds/otp-ops/Otp${rand}`;
      const now = Date.now();

      updateState((draft: ClusterState) => {
        draft.vault.leases[leaseId] = {
          leaseId,
          path: 'ssh/creds/otp-ops',
          issuedAt: now,
          expiresAt: now + 300000,
          maxExpiresAt: now + 900000,
          ttlSeconds: 300,
          maxTtlSeconds: 900,
          renewable: false,
          username: 'ops',
          secretValue: otp,
          targetHost: targetIp
        };
        draft.vault.raftIndex += 1;
      });

      return {
        output: `Key                Value
---                -----
lease_id           ${leaseId}
lease_duration     5m
lease_renewable    false
ip                 ${targetIp}
key                ${otp}
key_type           otp
port               22
username           ops`
      };
    }

    return { output: `Success! Data written to: ${pathArg}` };
  }

  if (sub === 'list') {
    const listPath = (args[1] || '').replace(/^\/+|\/+$/g, '');
    if (listPath.startsWith('sys/leases/lookup')) {
      const prefix = listPath.replace(/^sys\/leases\/lookup\/?/, '');
      const matching = Object.keys(state.vault.leases).filter((id) => id.startsWith(prefix));
      if (matching.length === 0) {
        return { output: `No value found at ${listPath}/` };
      }
      return {
        output: `Keys\n----\n${matching.map((id) => id.split('/').pop()).join('\n')}`
      };
    }
  }

  if (sub === 'lease') {
    const leaseAct = args[1];
    const leaseId = args[2] || '';
    if (leaseAct === 'lookup') {
      const lease = state.vault.leases[leaseId];
      if (!lease) {
        return {
          output: `Error looking up lease id ${leaseId}: Error making API request.\nURL: PUT https://10.10.0.201:8200/v1/sys/leases/lookup\nCode: 400. Errors:\n* invalid lease ID`
        };
      }
      const remSec = Math.max(0, Math.floor((lease.expiresAt - Date.now()) / 1000));
      return {
        output: `Key             Value
---             -----
expire_time     ${new Date(lease.expiresAt).toISOString()}
id              ${lease.leaseId}
issue_time      ${new Date(lease.issuedAt).toISOString()}
last_renewal    <nil>
renewable       ${lease.renewable}
ttl             ${remSec}s`
      };
    }

    if (leaseAct === 'revoke') {
      const lease = state.vault.leases[leaseId];
      if (lease) {
        updateState((draft: ClusterState) => {
          if (lease.path.startsWith('database/')) {
            draft.vault.revokedDbUsers[lease.username] = lease.secretValue;
            draft.postgresAppDb.activeRoles = draft.postgresAppDb.activeRoles.filter(
              (r: { rolname: string }) => r.rolname !== lease.username
            );
          }
          delete draft.vault.leases[leaseId];
          appendBackendLogToDraft(draft, {
            component: 'vault',
            podOrHost: 'vault/vault-0',
            message: `Lease ${leaseId} explicitly revoked via vault lease revoke; role ${lease.username} dropped`
          });
        });
      }
      return { output: 'All revocation operations queued successfully!' };
    }
  }

  if (sub === 'token') {
    const tokAct = args[1];
    if (tokAct === 'create') {
      return {
        output: `Key                  Value
---                  -----
token                ${BOUNDARY_CRED_STORE_TOKEN}
token_accessor       hmac-sha256:boundary-cred-store
token_duration       24h
token_renewable      true
token_policies       ["boundary-controller-policy" "default"]`
      };
    }
    if (tokAct === 'revoke') {
      const tokToRevoke = args[2] || BOUNDARY_CRED_STORE_TOKEN;
      updateState((draft: ClusterState) => {
        if (draft.vault.tokens[tokToRevoke]) {
          draft.vault.tokens[tokToRevoke].revoked = true;
        }
      });
      return { output: 'Success! Revoked token (if it existed)' };
    }
  }

  if (sub === 'audit') {
    if (args[1] === 'list') {
      return {
        output: `Path     Type    Description
----     ----    -----------
file/    file    File audit device (/vault/audit/vault_audit.log)`
      };
    }
    return { output: 'Success! Enabled file audit device at: file/' };
  }

  return { output: 'Usage: vault <command> [args] (status, login, operator, policy, secrets, auth, kv, read, write, list, lease, token, audit)' };
}