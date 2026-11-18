import { WindowRole } from '../core/types';

export function getGuideOutput(): string {
  return `================================================================================
  SECURE ACCESS PLATFORM — 10-MINUTE PROFESSOR PRESENTATION GUIDE
================================================================================

1. ARCHITECTURE & PLATFORM HEALTH (Run in '/' Admin Window)
   C:\\Users\\Vaanishka> ssh admin@10.10.0.30          (Password: Jump@Admin2026)
   admin@jump-host:~$ kubectl get nodes -o wide
   admin@jump-host:~$ kubectl get pods -A
   admin@jump-host:~$ kubectl exec -n vault vault-0 -- vault status
   admin@jump-host:~$ kubectl exec -n vault vault-0 -- vault operator raft list-peers
   admin@jump-host:~$ cd secure-access-platform && ansible-playbook -i ansible/inventory/hosts.ini ansible/site.yml

2. ZERO NETWORK EXPOSURE PROOF (Run in '/employee' Window)
   C:\\Users\\employee> ping 10.10.0.30                (4x Request timed out)
   C:\\Users\\employee> ssh ops@10.10.0.30             (Connection timed out)
   C:\\Users\\employee> nslookup boundary.yotta.lab    (Resolves to VIP 10.10.0.100)

3. 5-STEP IDENTITY & DYNAMIC SECRET FLOW (Run in '/employee', watch '/backend')
   C:\\Users\\employee> set BOUNDARY_ADDR=https://boundary.yotta.lab:9200
   C:\\Users\\employee> boundary authenticate ldap -auth-method-id=amldap_9fK2pQx7Lz -login-name=alice
      (Password: Alice@Yotta26 -> Triggers STEP 1/5 in Backend Console)
   C:\\Users\\employee> boundary targets list -recursive
      (Shows jump-host-ssh, app-server-01, production-db WITHOUT private IPs)
   C:\\Users\\employee> boundary connect postgres -dbname=appdb -target-name=production-db -target-scope-name=Production-Access
      (Triggers STEPS 2/5, 3/5, 4/5 -> Drops straight into appdb=> with NO password prompt!)
   appdb=> SELECT current_user;
      (Displays ephemeral Vault role: v-token-prod-db-o-...)
   appdb=> SELECT * FROM customers LIMIT 5;
   appdb=> \\q
      (Triggers STEP 5/5 -> Boundary immediately revokes the Vault lease & drops DB role)

4. NEGATIVE RBAC TESTS (Run in '/employee')
   - Bob (Developers group):
     boundary authenticate ldap -auth-method-id=amldap_9fK2pQx7Lz -login-name=bob   (Pass: Bob@Yotta26)
     boundary connect postgres -dbname=appdb -target-name=production-db -target-scope-name=Production-Access
     -> Denied with 403 Forbidden (R2).
   - Mallory (HR - no group):
     boundary authenticate ldap -auth-method-id=amldap_9fK2pQx7Lz -login-name=mallory (Pass: Mallory@Yotta26)
     boundary targets list -recursive -> No targets found.

5. HA FAILOVER DEMOS (Run in '/' Admin Window on jump-host)
   - Keepalived VIP Failover:  ssh haproxy-1 sudo systemctl stop keepalived
   - Vault Leader Failover:    kubectl delete pod vault-0 -n vault
================================================================================`;
}

export function getHelpOutput(role: WindowRole, mode: 'cmd' | 'bash' | 'psql'): string {
  if (mode === 'psql') {
    return `Supported PostgreSQL interactive commands:
  SELECT current_user;
  SELECT count(*) FROM customers;
  SELECT count(*) FROM orders;
  SELECT * FROM customers LIMIT 5;
  SELECT * FROM orders LIMIT 5;
  \\conninfo    Display current connection & ephemeral role info
  \\du          List database roles (including active Vault dynamic roles)
  \\dt          List tables in public schema
  \\l           List databases
  \\q           Quit psql and terminate brokered Boundary session`;
  }

  if (mode === 'cmd') {
    const base = `Supported Windows Command Prompt commands:
  boundary     HashiCorp Boundary CLI (authenticate, targets, sessions, connect, ...)
  ssh          OpenSSH client (e.g. ssh admin@10.10.0.30)
  psql         PostgreSQL client
  ping         Send ICMP Echo requests
  tracert      Trace network route to host
  ipconfig     Show Windows IP configuration
  nslookup     Query DNS name server
  curl         Transfer data from or to a server
  dir / type   List directory contents / display file contents
  cd / pwd     Change or display current directory
  set / echo   View or set environment variables
  ver / cls    Display Windows version / clear screen
  whoami       Display current Windows user
  hostname     Display computer hostname
  findstr      Search for strings in files or piped input
  guide        Print the 10-minute presentation script`;
    return role === 'admin' ? base + '\n  sim-reset    Restore simulator to initial healthy state' : base;
  }

  return `Supported Ubuntu Linux (jump-host / node) commands:
  kubectl (k)        Kubernetes CLI (get, describe, logs, apply, delete, exec, rollout)
  helm               Helm 3 CLI (list, status, history, lint, template, install, upgrade, rollback)
  ansible            Ansible ad-hoc CLI (-m ping, -m shell)
  ansible-playbook   Ansible playbook runner (--syntax-check, --check, --diff, --limit, --tags)
  vault              HashiCorp Vault CLI (status, login, operator, kv, read, write, policy, lease, token, audit)
  boundary           HashiCorp Boundary CLI (authenticate, scopes, auth-methods, roles, targets, hosts, sessions, ...)
  ssh                SSH into cluster/target nodes (k8s-master-1..3, k8s-worker-1..2, haproxy-1..2, app-server-01, prod-db-01)
  systemctl / sudo   Inspect or start/stop/restart systemd services (keepalived, haproxy, kubelet, containerd)
  journalctl         Query systemd journal logs (-u keepalived, -u haproxy, -u kubelet)
  ip / crictl        Inspect network interfaces & VIP (ip a) or container runtime pods (crictl ps)
  ls, cat, grep, sed, awk, jq, head, tail, wc, tee, df, free, uptime, hostnamectl
  guide              Print the 10-minute presentation script
  exit               Close current SSH session`;
}