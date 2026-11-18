import { CommandExecutionResult, ProgramContext } from './types';
import {
  BoundaryAccount,
  BoundaryAuthMethod,
  BoundaryCredentialLibrary,
  BoundaryHost,
  BoundaryRole,
  BoundaryScope,
  BoundarySession,
  BoundaryTarget,
  BoundaryUser,
  ClusterState,
  K8sPod
} from '../core/types';
import {
  evaluateBoundarySessionAuthorization,
  getAuthorizedTargetIdsForUser
} from '../policy/boundaryDecision';
import { appendBackendLogToDraft } from '../core/store';

function getFlagValue(args: string[], flagName: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith(`${flagName}=`)) {
      return a.slice(flagName.length + 1).replace(/^["']|["']$/g, '');
    }
    if (a === flagName && args[i + 1]) {
      return args[i + 1].replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

export function executeBoundaryCli(ctx: ProgramContext): CommandExecutionResult {
  const { args, state, updateState, frame, windowRole } = ctx;

  if (state.vipHolder === 'none') {
    return {
      output: 'Error trying to reach Boundary controller: dial tcp 10.10.0.100:9200: i/o timeout',
      delayMs: 220
    };
  }

  const ctrlPod = state.k8s.pods.find((p: K8sPod) => p.namespace === 'boundary' && p.name.startsWith('boundary-controller'));
  if (!ctrlPod || ctrlPod.status !== 'Running') {
    return {
      output: 'Error trying to reach Boundary controller: 502 Bad Gateway (controller unavailable)',
      delayMs: 200
    };
  }

  const sub = args[0] || '';
  const act = args[1] || '';

  if (sub === 'authenticate') {
    if (!act || act.startsWith('-')) {
      return {
        output: `Usage: boundary authenticate [subcommand] [options] [args]

Subcommands:
    ldap        Invoke the LDAP auth method to authenticate with Boundary
    password    Invoke the password auth method to authenticate with Boundary`
      };
    }

    const authMethodId = getFlagValue(args, '-auth-method-id') || (act === 'ldap' ? 'amldap_9fK2pQx7Lz' : 'ampw_1a2b3c4d5e');
    const loginName = (getFlagValue(args, '-login-name') || '').toLowerCase();
    const keyringNone = getFlagValue(args, '-keyring-type') === 'none';

    if (!loginName) {
      return { output: 'Error: -login-name is required when authenticating.' };
    }

    const expectedPasswords: Record<string, string> = {
      admin: 'Adm1n-Boundary#26',
      alice: 'Alice@Yotta26',
      bob: 'Bob@Yotta26',
      mallory: 'Mallory@Yotta26'
    };

    const verifyPasswordAndIssueToken = (enteredPassword: string): CommandExecutionResult => {
      const now = Date.now();
      const validPass = expectedPasswords[loginName];
      const isCorrect =
        Boolean(validPass) &&
        enteredPassword === validPass &&
        ((act === 'ldap' && authMethodId === 'amldap_9fK2pQx7Lz' && loginName !== 'admin') ||
          (act === 'password' && authMethodId === 'ampw_1a2b3c4d5e' && loginName === 'admin'));

      if (!isCorrect) {
        updateState((draft: ClusterState) => {
          appendBackendLogToDraft(draft, {
            component: 'boundary',
            podOrHost: 'boundary-controller',
            banner: '══════════ STEP 1/5 · IDENTITY AUTHENTICATION  (User → Boundary Controller) ══════════',
            message: `POST /v1/auth-methods/${authMethodId}:authenticate login=${loginName} -> 401 Unauthenticated`,
            isError: true,
            timestampMs: now
          });
          if (act === 'ldap') {
            appendBackendLogToDraft(draft, {
              component: 'ldap',
              podOrHost: 'ldap',
              message: `bind uid=${loginName},ou=people,dc=corp,dc=yotta,dc=lab result=invalidCredentials(49)`,
              isError: true,
              timestampMs: now + 4
            });
          }
        });

        return {
          output: `Error from controller when performing authentication

Error information:
  Kind:                Unauthenticated
  Message:             Unable to authenticate.
  Status:              401`
        };
      }

      const acct = state.boundary.accounts.find((a: BoundaryAccount) => a.loginName === loginName)!;
      const user = state.boundary.users.find((u: BoundaryUser) => u.name === loginName)!;
      const randSuffix = Math.random().toString(36).slice(2, 10);
      const tokenId = `at_${loginName}_${randSuffix}`;
      const tokenSecret = `${tokenId}_secret_${Math.random().toString(36).slice(2, 12)}`;
      const expMs = now + 8 * 3600 * 1000;

      updateState((draft: ClusterState) => {
        draft.boundary.authTokens[tokenId] = {
          id: tokenId,
          token: tokenSecret,
          userId: user.id,
          loginName,
          authMethodId,
          accountId: acct.id,
          issuedAt: now,
          expiresAt: expMs
        };
        const roleKey = windowRole === 'employee' ? 'employee' : 'admin';
        draft.boundary.latestTokenByWindow[roleKey] = tokenId;

        const clientIp = windowRole === 'employee' ? '192.168.1.87' : '10.10.0.30';
        const vipNode = draft.vipHolder === 'haproxy-2' ? 'haproxy-2' : 'haproxy-1';

        appendBackendLogToDraft(draft, {
          component: 'haproxy',
          podOrHost: vipNode,
          banner: '══════════ STEP 1/5 · IDENTITY AUTHENTICATION  (User → Boundary Controller) ══════════',
          message: `tcp-in ${clientIp}:51644 -> VIP 10.10.0.100:9200 (fe_boundary_api) backend be_boundary_api/metallb-202 conn=1`,
          timestampMs: now
        });
        appendBackendLogToDraft(draft, {
          component: 'metallb',
          podOrHost: 'metallb/speaker-k8s-worker-1',
          message: 'L2 announce: 10.10.0.202 answered ARP -> forwarded to svc boundary/boundary-controller',
          timestampMs: now + 2
        });
        appendBackendLogToDraft(draft, {
          component: 'boundary',
          podOrHost: 'boundary-controller',
          message: `POST /v1/auth-methods/${authMethodId}:authenticate  user-agent=boundary-cli/0.19.0 remote=${clientIp}`,
          timestampMs: now + 6
        });
        if (act === 'ldap') {
          appendBackendLogToDraft(draft, {
            component: 'ldap',
            podOrHost: 'ldap',
            message: `bind uid=${loginName},ou=people,dc=corp,dc=yotta,dc=lab  result=success(0)`,
            timestampMs: now + 12
          });
          appendBackendLogToDraft(draft, {
            component: 'ldap',
            podOrHost: 'ldap',
            message: `search groups member=uid=${loginName} ... -> cn=${user.ldapGroups[0] || 'none'}`,
            timestampMs: now + 18
          });
        }
        appendBackendLogToDraft(draft, {
          component: 'boundary',
          podOrHost: 'boundary-controller',
          message: `account ${acct.id} (${loginName}) mapped to user ${user.id} (groups=[${user.ldapGroups.join(',')}])`,
          timestampMs: now + 23
        });
        appendBackendLogToDraft(draft, {
          component: 'postgres',
          podOrHost: 'postgres/postgres-0',
          message: `INSERT auth_token (public_id=${tokenId}, expiration=+8h)`,
          timestampMs: now + 29
        });
        appendBackendLogToDraft(draft, {
          component: 'boundary',
          podOrHost: 'boundary-controller',
          message: `auth token issued to user ${user.id} (${loginName}) 200 OK 23ms`,
          timestampMs: now + 34
        });
      });

      const expFormatted = 'Thu, 19 Nov 2026 20:04:11 IST';
      const footer = keyringNone
        ? `  Token:           ${tokenSecret}`
        : '\nThe token was successfully stored in the chosen keyring and is not displayed here.';

      return {
        allowUnredactedToken: keyringNone,
        output: `Authentication information:
  Account ID:      ${acct.id}
  Auth Method ID:  ${authMethodId}
  Expiration Time: ${expFormatted}
  User ID:         ${user.id}
${footer}`
      };
    };

    return {
      output: '',
      promptInput: {
        promptText: 'Please enter the password (it will be hidden): ',
        echo: false,
        onInput: (val: string) => verifyPasswordAndIssueToken(val.trim())
      }
    };
  }

  const roleKey = windowRole === 'employee' ? 'employee' : 'admin';
  const currentTokenId = state.boundary.latestTokenByWindow[roleKey];
  const currentAuthToken = currentTokenId ? state.boundary.authTokens[currentTokenId] || null : null;

  if (sub === 'scopes') {
    if (act === 'list') {
      const items = state.boundary.scopes
        .filter((s: BoundaryScope) => s.id !== 'global')
        .map(
          (s: BoundaryScope) => `  ID:                    ${s.id}
    Scope ID:            ${s.parentId}
    Name:                ${s.name}
    Description:         ${s.description}`
        )
        .join('\n\n');
      return { output: `Scope information:\n${items}` };
    }
    if (act === 'create') {
      const name = getFlagValue(args, '-name') || 'new-scope';
      const parentId = getFlagValue(args, '-scope-id') || 'global';
      const newId = parentId === 'global' ? `o_${name.toLowerCase().slice(0, 8)}` : `p_${name.toLowerCase().slice(0, 8)}`;
      updateState((draft: ClusterState) => {
        draft.boundary.scopes.push({
          id: newId,
          name,
          description: getFlagValue(args, '-description') || name,
          parentId,
          type: parentId === 'global' ? 'org' : 'project'
        });
      });
      return { output: `Scope information:\n  ID: ${newId}\n  Name: ${name}` };
    }
  }

  if (sub === 'auth-methods' && act === 'list') {
    const items = state.boundary.authMethods
      .map(
        (am: BoundaryAuthMethod) => `  ID:                    ${am.id}
    Scope ID:            ${am.scopeId}
    Name:                ${am.name}
    Type:                ${am.type}`
      )
      .join('\n\n');
    return { output: `Auth Method information:\n${items}` };
  }

  if (sub === 'users' && act === 'list') {
    const items = state.boundary.users
      .map((u: BoundaryUser) => `  ID: ${u.id}\n    Name: ${u.name}\n    Description: ${u.description}`)
      .join('\n\n');
    return { output: `User information:\n${items}` };
  }

  if (sub === 'roles' && act === 'list') {
    const items = state.boundary.roles
      .map((r: BoundaryRole) => `  ID: ${r.id}\n    Scope ID: ${r.scopeId}\n    Name: ${r.name}\n    Grant Strings: ${r.grantStrings.join(' | ')}`)
      .join('\n\n');
    return { output: `Role information:\n${items}` };
  }

  if (sub === 'host-catalogs' && act === 'list') {
    return {
      output: `Host Catalog information:
  ID:                    hcst_prodcat01
    Scope ID:            p_prodaccess
    Type:                static
    Name:                production-hosts`
    };
  }

  if (sub === 'hosts' && act === 'list') {
    if (windowRole === 'employee') {
      return {
        output: `Error from controller when performing list on hosts

Error information:
  Kind:                PermissionDenied
  Message:             Forbidden.
  Status:              403`
      };
    }
    const items = state.boundary.hosts
      .map(
        (h: BoundaryHost) => `  ID:                    ${h.id}
    Name:                ${h.name}
    Description:         ${h.description}
    Address:             ${h.address}
    Type:                static`
      )
      .join('\n\n');
    return { output: `Host information:\n${items}` };
  }

  if (sub === 'credential-stores' && act === 'list') {
    const cs = state.boundary.credentialStores[0];
    return {
      output: `Credential Store information:
  ID:                    ${cs.id}
    Scope ID:            ${cs.scopeId}
    Name:                ${cs.name}
    Type:                vault`
    };
  }

  if (sub === 'credential-libraries' && act === 'list') {
    const items = state.boundary.credentialLibraries
      .map(
        (cl: BoundaryCredentialLibrary) => `  ID:                    ${cl.id}
    Credential Store ID: ${cl.storeId}
    Name:                ${cl.name}
    Vault Path:          ${cl.vaultPath}
    Credential Type:     ${cl.credentialType}`
      )
      .join('\n\n');
    return { output: `Credential Library information:\n${items}` };
  }

  if (sub === 'targets') {
    if (act === 'list') {
      const recursive = args.includes('-recursive');
      const scopeId = getFlagValue(args, '-scope-id') || 'global';
      if (!recursive && scopeId !== 'p_prodaccess') {
        return { output: 'No targets found' };
      }

      if (!currentAuthToken || currentAuthToken.expiresAt <= Date.now()) {
        return {
          output: 'Error from controller when performing list on targets\n\nError information:\n  Kind:                Unauthenticated\n  Message:             Unauthenticated.\n  Status:              401'
        };
      }

      const allowedIds = getAuthorizedTargetIdsForUser(state, currentAuthToken.userId);
      const visibleTargets = state.boundary.targets.filter((t: BoundaryTarget) => allowedIds.has(t.id));

      if (visibleTargets.length === 0) {
        return { output: 'No targets found' };
      }

      const blocks = visibleTargets
        .map(
          (t: BoundaryTarget) => `  ID:                    ${t.id}
    Scope ID:            ${t.scopeId}
    Version:             2
    Type:                ${t.type}
    Name:                ${t.name}
    Description:         ${t.description}
    Authorized Actions:
      read
      authorize-session`
        )
        .join('\n\n');

      return { output: `Target information:\n${blocks}` };
    }

    if (act === 'create') {
      const name = getFlagValue(args, '-name') || 'custom-target';
      const scopeId = getFlagValue(args, '-scope-id') || 'p_prodaccess';
      const port = parseInt(getFlagValue(args, '-default-port') || '22', 10);
      const newId = `ttcp_${Math.random().toString(36).slice(2, 10)}`;
      updateState((draft: ClusterState) => {
        draft.boundary.targets.push({
          id: newId,
          scopeId,
          name,
          description: getFlagValue(args, '-description') || name,
          type: 'tcp',
          defaultPort: port,
          sessionMaxSeconds: 600,
          hostSetIds: ['hsst_appserver1'],
          brokeredCredentialSourceIds: ['clvlt_sshotplib1']
        });
        const engRole = draft.boundary.roles.find((r: BoundaryRole) => r.name === 'engineers');
        if (engRole) {
          engRole.grantStrings[0] = engRole.grantStrings[0].replace(
            'ids=',
            `ids=${newId},`
          );
        }
        appendBackendLogToDraft(draft, {
          component: 'boundary',
          podOrHost: 'boundary-controller',
          message: `Created TCP target ${newId} (${name}, default_port=${port}) in scope ${scopeId}`
        });
      });
      return {
        output: `Target information:\n  ID:                    ${newId}\n  Name:                  ${name}\n  Default Port:          ${port}`
      };
    }

    if (act === 'authorize-session') {
      const targetId = getFlagValue(args, '-id');
      const targetName = getFlagValue(args, '-name') || getFlagValue(args, '-target-name');
      const target = state.boundary.targets.find((t: BoundaryTarget) => t.id === targetId || t.name === targetName);
      if (!target) {
        return { output: 'Error: target not found' };
      }
      const decision = evaluateBoundarySessionAuthorization(state, currentAuthToken, target);
      if (!decision.allowed) {
        return {
          output: `Error from controller when performing authorize-session on target

Error information:
  Kind:                ${decision.kind}
  Message:             ${decision.message}
  Status:              ${decision.status}`
        };
      }

      if (args.includes('-format') && args.includes('json')) {
        return {
          output: JSON.stringify({
            status_code: 200,
            item: {
              session_id: 's_redacted_preview',
              target_id: target.id,
              credentials: [
                {
                  credential_source: {
                    id: target.brokeredCredentialSourceIds[0],
                    name: target.name === 'production-db' ? 'prod-db-library' : 'ssh-otp-library'
                  },
                  secret: {
                    decoded: {
                      password: '[REDACTED]',
                      username: '[REDACTED]'
                    }
                  }
                }
              ]
            }
          })
        };
      }
      return { output: `Session authorized for target ${target.name} (${target.id}).` };
    }
  }

  if (sub === 'sessions') {
    if (act === 'list') {
      const allSessions = Object.values(state.boundary.sessions).filter(
        (s: BoundarySession) => windowRole === 'admin' || s.userId === currentAuthToken?.userId
      );
      if (allSessions.length === 0) {
        return { output: 'No sessions found' };
      }
      const blocks = allSessions
        .map(
          (s: BoundarySession) => `  ID:                    ${s.id}
    Target ID:           ${s.targetId}
    Scope ID:            ${s.scopeId}
    Auth Token ID:       ${currentTokenId}
    User ID:             ${s.userId}
    Status:              ${s.status}
    Created Time:        ${new Date(s.createdAt).toUTCString()}
    Expiration Time:     ${new Date(s.expiresAt).toUTCString()}`
        )
        .join('\n\n');
      return { output: `Session information:\n${blocks}` };
    }

    if (act === 'read') {
      const sid = getFlagValue(args, '-id') || '';
      const s = state.boundary.sessions[sid];
      if (!s) return { output: `Error: session ${sid} not found` };
      return {
        output: `Session information:
  ID:                    ${s.id}
  Target ID:             ${s.targetId}
  User ID:               ${s.userId}
  Status:                ${s.status}
  Termination Reason:    ${s.terminationReason || 'n/a'}
  Expiration Time:       ${new Date(s.expiresAt).toUTCString()}`
      };
    }

    if (act === 'cancel') {
      const sid = getFlagValue(args, '-id') || '';
      const s = state.boundary.sessions[sid];
      if (!s) return { output: `Error: session ${sid} not found` };
      const now = Date.now();
      updateState((draft: ClusterState) => {
        const ds = draft.boundary.sessions[sid];
        if (ds) {
          ds.status = 'terminated';
          ds.terminatedAt = now;
          ds.terminationReason = 'canceled by user/administrator';
          const lease = draft.vault.leases[ds.vaultLeaseId];
          if (lease) {
            if (lease.path.startsWith('database/')) {
              draft.vault.revokedDbUsers[lease.username] = lease.secretValue;
              draft.postgresAppDb.activeRoles = draft.postgresAppDb.activeRoles.filter(
                (r: { rolname: string }) => r.rolname !== lease.username
              );
            }
            delete draft.vault.leases[ds.vaultLeaseId];
          }
          appendBackendLogToDraft(draft, {
            component: 'boundary',
            podOrHost: 'boundary-controller',
            banner: '══════════ STEP 5/5 · SESSION TERMINATION & AUTO-REVOCATION ══════════',
            message: `Session ${sid} canceled via API -> revoking Vault lease ${ds.vaultLeaseId}`,
            timestampMs: now
          });
          appendBackendLogToDraft(draft, {
            component: 'vault',
            podOrHost: 'vault/vault-0',
            message: `lease revoked ${ds.vaultLeaseId} (zero standing privileges)`,
            timestampMs: now + 8
          });
        }
      });
      return {
        output: `Session information:\n  ID:                ${sid}\n  Status:            canceling`
      };
    }
  }

  if (sub === 'connect') {
    const proto = act;
    const targetName = getFlagValue(args, '-target-name');
    const targetId = getFlagValue(args, '-target-id');
    const target = state.boundary.targets.find((t: BoundaryTarget) => t.name === targetName || t.id === targetId);

    if (!target) {
      return { output: `Error: target "${targetName || targetId}" not found in scope Production-Access.` };
    }

    const now = Date.now();
    const decision = evaluateBoundarySessionAuthorization(state, currentAuthToken, target, now);

    if (!decision.allowed) {
      updateState((draft: ClusterState) => {
        appendBackendLogToDraft(draft, {
          component: 'boundary',
          podOrHost: 'boundary-controller',
          banner: '══════════ STEP 2/5 · TARGET SELECTION & CREDENTIAL REQUEST  (Boundary → Vault) ══════════',
          message: `POST /v1/targets/${target.id}:authorize-session user=${currentAuthToken?.loginName || 'anonymous'} target=${target.name} => DENIED (${decision.ruleTriggered}: ${decision.message})`,
          isError: true,
          timestampMs: now
        });
      });

      return {
        output: `Error from controller when performing authorize-session on target

Error information:
  Kind:                ${decision.kind}
  Message:             ${decision.message}
  Status:              ${decision.status}`
      };
    }

    const rand = Math.random().toString(36).slice(2, 10);
    const epoch = Math.floor(now / 1000);
    const sessionId = `s_${rand}9x`;
    const isDb = proto === 'postgres' || target.defaultPort === 5432;
    const brokeredUser = isDb ? `v-token-prod-db-o-${rand}-${epoch}` : 'ops';
    const brokeredSecret = isDb
      ? `DbDyn#${Math.random().toString(36).slice(2, 10)}!`
      : `${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`;
    const leaseId = isDb
      ? `database/creds/prod-db-ops/Pz3${rand}`
      : `ssh/creds/otp-ops/Otp${rand}`;
    const targetIp =
      target.name === 'production-db'
        ? '10.10.0.32'
        : target.name === 'app-server-01'
          ? '10.10.0.31'
          : '10.10.0.30';

    updateState((draft: ClusterState) => {
      draft.vault.leases[leaseId] = {
        leaseId,
        path: isDb ? 'database/creds/prod-db-ops' : 'ssh/creds/otp-ops',
        issuedAt: now,
        expiresAt: now + 300000,
        maxExpiresAt: now + 900000,
        ttlSeconds: 300,
        maxTtlSeconds: 900,
        renewable: isDb,
        username: brokeredUser,
        secretValue: brokeredSecret,
        targetHost: targetIp,
        boundarySessionId: sessionId
      };

      if (isDb) {
        draft.postgresAppDb.activeRoles.push({
          rolname: brokeredUser,
          rolvaliduntil: new Date(now + 300000).toISOString(),
          memberof: ['app_ops']
        });
      }

      draft.boundary.sessions[sessionId] = {
        id: sessionId,
        targetId: target.id,
        targetName: target.name,
        scopeId: target.scopeId,
        userId: currentAuthToken!.userId,
        loginName: currentAuthToken!.loginName,
        status: 'active',
        createdAt: now,
        expiresAt: now + target.sessionMaxSeconds * 1000,
        vaultLeaseId: leaseId,
        brokeredUsername: brokeredUser,
        brokeredSecret,
        targetAddress: targetIp,
        targetPort: target.defaultPort,
        workerNode: 'boundary-worker'
      };
      draft.vault.raftIndex += 1;

      const vipNode = draft.vipHolder === 'haproxy-2' ? 'haproxy-2' : 'haproxy-1';
      const clientIp = windowRole === 'employee' ? '192.168.1.87' : '10.10.0.30';

      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-controller',
        banner: '══════════ STEP 2/5 · TARGET SELECTION & CREDENTIAL REQUEST  (Boundary → Vault) ══════════',
        message: `POST /v1/targets/${target.id}:authorize-session user=${currentAuthToken!.loginName} target=${target.name}`,
        timestampMs: now
      });
      appendBackendLogToDraft(draft, {
        component: 'postgres',
        podOrHost: 'postgres/postgres-0',
        message: `SELECT grants for ${currentAuthToken!.userId} -> ids=${target.id};actions=read,authorize-session  => ALLOWED`,
        timestampMs: now + 4
      });
      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-controller',
        message: 'credential-store csvlt_vaultstore1 token valid (periodic, renewable, ttl 23h 41m), policy boundary-controller-policy',
        timestampMs: now + 9
      });
      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-controller',
        message: `-> Vault ${isDb ? 'GET' : 'POST'} https://10.10.0.201:8200/v1/${isDb ? 'database/creds/prod-db-ops' : 'ssh/creds/otp-ops'}  (X-Vault-Token=hvs.CAES…[redacted])`,
        timestampMs: now + 13
      });

      appendBackendLogToDraft(draft, {
        component: 'vault',
        podOrHost: 'vault/vault-1',
        banner: '══════════ STEP 3/5 · DYNAMIC SECRET GENERATION  (Vault) ══════════',
        message: 'request forwarded to active node vault-0 (standby -> leader, cluster addr :8201)',
        timestampMs: now + 21
      });
      appendBackendLogToDraft(draft, {
        component: 'vault',
        podOrHost: 'vault/vault-0',
        message: `policy check boundary-controller-policy: ${isDb ? 'database/creds/prod-db-ops [read]' : 'ssh/creds/otp-ops [update]'} => allowed`,
        timestampMs: now + 26
      });
      if (isDb) {
        appendBackendLogToDraft(draft, {
          component: 'vault',
          podOrHost: 'vault/vault-0',
          message: 'database: connecting prod-db-01:5432 as vault_admin ... OK',
          timestampMs: now + 31
        });
        appendBackendLogToDraft(draft, {
          component: 'vault',
          podOrHost: 'vault/vault-0',
          message: `database: CREATE ROLE "${brokeredUser}" WITH LOGIN PASSWORD '********' VALID UNTIL '…'; GRANT app_ops …`,
          timestampMs: now + 58
        });
      } else {
        appendBackendLogToDraft(draft, {
          component: 'vault',
          podOrHost: 'vault/vault-0',
          message: `ssh: generated one-time password (OTP) for user=ops cidr=${targetIp}/32`,
          timestampMs: now + 45
        });
      }
      appendBackendLogToDraft(draft, {
        component: 'vault',
        podOrHost: 'vault/vault-0',
        message: `lease issued ${leaseId}  ttl=5m max_ttl=15m renewable=${isDb}`,
        timestampMs: now + 72
      });
      appendBackendLogToDraft(draft, {
        component: 'vault',
        podOrHost: 'vault/vault-0',
        message: `raft: committed index ${draft.vault.raftIndex} -> replicated to vault-1 (ack 2ms), vault-2 (ack 3ms)  [storage: Longhorn pvc data-vault-0..2]`,
        timestampMs: now + 74
      });
      appendBackendLogToDraft(draft, {
        component: 'vault',
        podOrHost: 'vault/vault-0',
        message: `audit: type=response path=${isDb ? 'database/creds/prod-db-ops' : 'ssh/creds/otp-ops'} lease_id=${leaseId} (secret fields hmac-sha256:…)`,
        timestampMs: now + 78
      });
      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-controller',
        message: `credential received over TLS (cert-manager CA, TLS1.3); attached as brokered credential cred_${rand} (username_password)`,
        timestampMs: now + 83
      });

      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-controller',
        banner: '══════════ STEP 4/5 · ENCRYPTED SESSION BROKERING  (Boundary Worker → Target) ══════════',
        message: `session ${sessionId} authorized (status=pending), worker=boundary-worker, ttl ${target.sessionMaxSeconds}s`,
        timestampMs: now + 90
      });
      appendBackendLogToDraft(draft, {
        component: 'haproxy',
        podOrHost: vipNode,
        message: `tcp-in ${clientIp} -> VIP 10.10.0.100:9202 (fe_boundary_worker) backend be_boundary_worker/metallb-203`,
        timestampMs: now + 162
      });
      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-worker',
        message: `proxy connection accepted ${sessionId} (TLS 1.3, ALPN boundary-proxy)  session -> active`,
        timestampMs: now + 169
      });
      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-worker',
        message: `dial tcp ${targetIp}:${target.defaultPort} (target ${target.name}) ... connected`,
        timestampMs: now + 176
      });
      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-worker',
        message: `auth to target with brokered credential (user ${brokeredUser}) -> success`,
        timestampMs: now + 202
      });
      appendBackendLogToDraft(draft, {
        component: 'boundary',
        podOrHost: 'boundary-worker',
        message: 'relaying bytes  client<->target  (user never received target address or password)',
        timestampMs: now + 205
      });
      appendBackendLogToDraft(draft, {
        component: 'vault',
        podOrHost: 'vault/vault-0',
        message: `lease renew ${leaseId} requested by boundary credential store (increment 5m)`,
        timestampMs: now + 260
      });
    });

    if (isDb) {
      const dbName = getFlagValue(args, '-dbname') || 'appdb';
      return {
        delayMs: 180,
        output: 'psql (16.4 (Ubuntu 16.4-1.pgdg24.04+1))\nSSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)\nType "help" for help.\n',
        pushFrame: {
          hostId: 'prod-db-01',
          user: brokeredUser,
          cwd: '/home/ops',
          env: { ...frame.env },
          mode: 'psql',
          boundarySessionId: sessionId,
          psqlUser: brokeredUser,
          psqlDb: dbName
        }
      };
    }

    const remoteHostId = target.name === 'app-server-01' ? 'app-server-01' : 'jump-host';
    return {
      delayMs: 180,
      output: `Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-48-generic x86_64)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/pro

Last login: ${new Date().toUTCString()} from 10.244.2.18 (via boundary-worker OTP proxy)`,
      pushFrame: {
        hostId: remoteHostId,
        user: 'ops',
        cwd: remoteHostId === 'jump-host' ? '/home/admin' : '/home/ops',
        env: { ...frame.env, USER: 'ops' },
        mode: 'bash',
        boundarySessionId: sessionId
      }
    };
  }

  return {
    output: 'Usage: boundary <subcommand> [options] (authenticate, scopes, auth-methods, users, roles, host-catalogs, hosts, credential-stores, credential-libraries, targets, sessions, connect)'
  };
}