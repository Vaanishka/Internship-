import { CommandExecutionResult, ProgramContext } from './types';
import { ClusterState } from '../core/types';
import { appendBackendLogToDraft } from '../core/store';

export function executeInteractivePsqlCommand(ctx: ProgramContext): CommandExecutionResult {
  const { rawLine, frame, state, updateState } = ctx;
  const trimmed = rawLine.trim();

  if (!trimmed) return { output: '' };

  if (trimmed === '\\q' || trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
    const sid = frame.boundarySessionId;
    if (sid && state.boundary.sessions[sid]) {
      const now = Date.now();
      updateState((draft: ClusterState) => {
        const ds = draft.boundary.sessions[sid];
        if (ds && ds.status === 'active') {
          ds.status = 'terminated';
          ds.terminatedAt = now;
          ds.terminationReason = 'user closed connection';
          const lease = draft.vault.leases[ds.vaultLeaseId];
          if (lease) {
            draft.vault.revokedDbUsers[lease.username] = lease.secretValue;
            draft.postgresAppDb.activeRoles = draft.postgresAppDb.activeRoles.filter(
              (r: { rolname: string }) => r.rolname !== lease.username
            );
            delete draft.vault.leases[ds.vaultLeaseId];
          }

          appendBackendLogToDraft(draft, {
            component: 'boundary',
            podOrHost: 'boundary-worker',
            banner: '══════════ STEP 5/5 · SESSION TERMINATION & AUTO-REVOCATION ══════════',
            message: `client closed connection ${sid} (reason=user closed) bytes_up=3.1KiB bytes_down=11.8KiB`,
            timestampMs: now
          });
          appendBackendLogToDraft(draft, {
            component: 'boundary',
            podOrHost: 'boundary-worker',
            message: 'proxy tunnel torn down; session -> terminated',
            timestampMs: now + 3
          });
          appendBackendLogToDraft(draft, {
            component: 'postgres',
            podOrHost: 'postgres/postgres-0',
            message: 'UPDATE session SET status=terminated, termination_reason=user_closed ; INSERT session_connection …',
            timestampMs: now + 9
          });
          appendBackendLogToDraft(draft, {
            component: 'boundary',
            podOrHost: 'boundary-controller',
            message: `audit: session ${sid} ${ds.loginName} -> ${ds.targetName} (encrypted audit trail, data key: kms 'audit')`,
            timestampMs: now + 13
          });
          appendBackendLogToDraft(draft, {
            component: 'boundary',
            podOrHost: 'boundary-controller',
            message: `-> Vault PUT /v1/sys/leases/revoke lease_id=${ds.vaultLeaseId}`,
            timestampMs: now + 18
          });
          appendBackendLogToDraft(draft, {
            component: 'vault',
            podOrHost: 'vault/vault-0',
            message: `database: DROP ROLE "${ds.brokeredUsername}" on prod-db-01 ... OK`,
            timestampMs: now + 26
          });
          appendBackendLogToDraft(draft, {
            component: 'vault',
            podOrHost: 'vault/vault-0',
            message: `lease revoked ${ds.vaultLeaseId}  (zero standing privileges)`,
            timestampMs: now + 31
          });
        }
      });
    }
    return { output: '', popFrame: true };
  }

  if (trimmed === '\\conninfo') {
    return {
      output: `You are connected to database "${frame.psqlDb || 'appdb'}" as user "${frame.psqlUser}" on host "127.0.0.1" (via Boundary proxy tunnel) at port "52941".\nSSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)`
    };
  }

  if (trimmed === '\\dt') {
    return {
      output: `           List of relations
 Schema |   Name    | Type  |   Owner   
--------+-----------+-------+-----------
 public | customers | table | app_ops
 public | orders    | table | app_ops
(2 rows)`
    };
  }

  if (trimmed === '\\l') {
    return {
      output: `                                                List of databases
   Name    |  Owner   | Encoding | Locale Provider |   Collate   |    Ctype    | Locate | Access privileges 
-----------+----------+----------+-----------------+-------------+-------------+--------+-------------------
 appdb     | postgres | UTF8     | libc            | en_US.UTF-8 | en_US.UTF-8 |        | =Tc/postgres
 postgres  | postgres | UTF8     | libc            | en_US.UTF-8 | en_US.UTF-8 |        | 
(2 rows)`
    };
  }

  if (trimmed === '\\du') {
    const rows = state.postgresAppDb.activeRoles.map((r: { rolname: string; rolvaliduntil: string; memberof: string[] }) => {
      const attr = r.rolname === 'postgres' || r.rolname === 'vault_admin'
        ? 'Superuser, Create role, Create DB'
        : r.rolname === 'app_ops'
          ? 'Cannot login'
          : `Password valid until ${r.rolvaliduntil}`;
      const mem = `{${r.memberof.join(',')}}`;
      return ` ${r.rolname.padEnd(36)} | ${attr.padEnd(42)} | ${mem}`;
    });
    return {
      output: `                                              List of roles
              Role name               |                   Attributes               | Member of 
--------------------------------------+--------------------------------------------+-----------
${rows.join('\n')}`
    };
  }

  const normalizedSql = trimmed.replace(/;$/, '').trim().toLowerCase();

  if (normalizedSql === 'select current_user' || normalizedSql === 'select user' || normalizedSql === 'select session_user') {
    const u = frame.psqlUser || 'postgres';
    return {
      output: `       current_user       
--------------------------
 ${u}
(1 row)`
    };
  }

  if (normalizedSql === 'select count(*) from customers') {
    return {
      output: ` count 
-------
   ${state.postgresAppDb.customersCount}
(1 row)`
    };
  }

  if (normalizedSql === 'select count(*) from orders') {
    return {
      output: ` count 
-------
  ${state.postgresAppDb.ordersCount}
(1 row)`
    };
  }

  if (normalizedSql.startsWith('select * from customers')) {
    const rows = state.postgresAppDb.sampleCustomers.map(
      (c) => `  ${String(c.id).padEnd(2)} | ${c.name.padEnd(16)} | ${c.email.padEnd(28)} | ${c.tier.padEnd(10)} | ${c.created_at}`
    );
    return {
      output: ` id  |       name       |            email             |    tier    |       created_at       
-----+------------------+------------------------------+------------+------------------------
${rows.join('\n')}
(5 rows)`
    };
  }

  if (normalizedSql.startsWith('select * from orders')) {
    const rows = state.postgresAppDb.sampleOrders.map(
      (o) => `     ${o.order_id} |           ${o.customer_id} |    ${o.amount_usd.padStart(7)} | ${o.status.padEnd(10)} | ${o.ordered_at}`
    );
    return {
      output: ` order_id | customer_id | amount_usd |   status   |       ordered_at       
----------+-------------+------------+------------+------------------------
${rows.join('\n')}
(5 rows)`
    };
  }

  return {
    output: `ERROR:  syntax error or unsupported lab query near "${trimmed}"\nHINT:   Try SELECT current_user; | SELECT count(*) FROM customers; | SELECT * FROM orders LIMIT 5; | \\du | \\dt | \\q`
  };
}