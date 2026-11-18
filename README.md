# Secure Access Platform Simulator

A browser-based simulator of a **zero-trust privileged access platform**. It reproduces, entirely in the browser, how an employee reaches a production database without ever seeing a network address or a password: identity is verified through LDAP, access is authorised by **HashiCorp Boundary**, credentials are minted on demand by **HashiCorp Vault**, and everything is revoked the moment the session ends.

Nothing here talks to real infrastructure. The whole platform (Kubernetes cluster, HAProxy/Keepalived, Vault Raft, Boundary, OpenLDAP, PostgreSQL, Ansible) is a deterministic in-browser simulation, so it can be demoed anywhere with no setup.

> **Note:** every hostname, IP, token and password in this project is fictional and exists only inside the simulator.

---

## Table of contents

- [What it demonstrates](#what-it-demonstrates)
- [Pages](#pages)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Available scripts](#available-scripts)
- [Demo walkthrough](#demo-walkthrough)
- [Supported commands](#supported-commands)
- [How it works](#how-it-works)
- [Testing](#testing)
- [Deploying to Vercel](#deploying-to-vercel)
- [Troubleshooting](#troubleshooting)

---

## What it demonstrates

| Capability | What you can show |
| --- | --- |
| **5-step identity & dynamic-secret flow** | LDAP login → target authorisation → Vault issues a one-off DB user → encrypted session brokered by a Boundary worker → session ends and the lease is revoked. Each step is narrated live in the backend console. |
| **Zero network exposure** | From the employee laptop, `ping` and `ssh` to the private hosts time out. Targets are listed by name only, never by IP. |
| **Role-based access control** | Alice (prod access) connects; Bob (dev only) gets `403 Forbidden` on production; Mallory (no group) sees no targets. |
| **Secrets hygiene guard** | Every byte printed to the employee terminal is scanned for private IPs, Vault secrets, tokens and backend narration. A leak throws an error. |
| **High availability** | Stop Keepalived and watch the VIP move from `haproxy-1` to `haproxy-2`. Delete `vault-0` and watch `vault-1` take leadership, then unseal with 3 of 5 Shamir keys. |
| **Self-healing cluster** | A reconciler ticks every second: node NotReady transitions, pod rescheduling, Longhorn replica health, session expiry and lease revocation. |
| **Infrastructure-as-code** | Browse and run a virtual Ansible repo (`ansible-playbook` is idempotent, `changed=0`), Helm releases, cert-manager and MetalLB manifests, and Vault/Boundary config scripts. |

---

## Pages

| Route | Window | Description |
| --- | --- | --- |
| `/` | Admin laptop (`VAANISHKA-LT`) | Windows `cmd.exe` look-alike. SSH into the jump host, then run `kubectl`, `helm`, `vault`, `ansible`, etc. |
| `/employee` | Employee laptop (`YOTTA-LT-4471`) | Restricted laptop that can only reach the platform through the Boundary CLI. |
| `/backend` | Backend console | Read-only, colour-coded event stream from every component. Filter with `?component=vault` (also `boundary`, `haproxy`, `postgres`, `ldap`, `k8s`, `metallb`, `longhorn`). |
| `/all` | Tiled view | Admin, employee and backend side by side on one screen. |

For a live demo, either open `/all`, or open `/`, `/employee` and `/backend` in separate tabs **of the same browser** (see [How it works](#how-it-works)).

---

## Tech stack

- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript** (strict)
- **Tailwind CSS 3** for the Windows-terminal chrome
- **xterm.js** (`@xterm/xterm` + `@xterm/addon-fit`) for the terminals
- **js-yaml** for parsing manifests in the simulated Helm/kubectl layer
- **Vitest** for the acceptance suite

No backend, database, API routes or environment variables are required. It builds to fully static pages.

---

## Project structure

```
.
├── public/
│   └── cmd-icon.svg              # favicon
├── src/
│   ├── app/                      # Next.js routes
│   │   ├── page.tsx              #   /          admin laptop
│   │   ├── employee/page.tsx     #   /employee  employee laptop
│   │   ├── backend/page.tsx      #   /backend   event stream (?component= filter)
│   │   ├── all/page.tsx          #   /all       3-pane tiled view
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── ui/                       # React components
│   │   ├── TerminalView.tsx      #   interactive xterm terminal (history, Tab-complete)
│   │   ├── BackendConsoleView.tsx#   read-only log stream
│   │   └── CmdWindowFrame.tsx    #   Windows title-bar frame
│   └── sim/                      # The simulator (no UI code)
│       ├── core/                 #   types, initial cluster state, store, hygiene guard
│       ├── controllers/          #   reconciler (1 s control loop)
│       ├── policy/               #   Boundary authorisation + Vault policy decisions
│       ├── programs/             #   CLIs: kubectl, helm, vault, boundary, ansible, psql, ...
│       ├── shells/               #   shell engine (SSH frame stack) + autocomplete
│       └── vfs/                  #   virtual filesystem + the simulated infra repo
├── tests/
│   └── simulator.test.ts         # acceptance suite
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
└── vitest.config.ts
```

---

## Getting started

### Prerequisites

- **Node.js 20.9 or newer** (developed and verified on Node 22) and npm
- A modern desktop browser (Chrome, Edge, Firefox or Safari)

### Install and run

```bash
# 1. Clone
git clone https://github.com/Vaanishka/Internship-.git
cd Internship-

# 2. Install dependencies (uses the committed package-lock.json)
npm ci

# 3. Start the dev server
npm run dev
```

Open <http://localhost:3000> (admin), <http://localhost:3000/employee>, <http://localhost:3000/backend> or <http://localhost:3000/all>.

### Production build

```bash
npm run build
npm start
```

---

## Available scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Create the optimised production build |
| `npm start` | Serve the production build |
| `npm test` | Run the Vitest acceptance suite once |

> `npm run lint` is defined in `package.json` but **does not currently work**: Next.js 16 removed the `next lint` command. To enable linting, install ESLint and `eslint-config-next` and call `eslint` directly.

---

## Demo walkthrough

You can also print this script inside the simulator by typing `guide`.

### 1. Platform health (admin window, `/`)

```text
C:\Users\Vaanishka> ssh admin@10.10.0.30
admin@jump-host:~$ kubectl get nodes -o wide
admin@jump-host:~$ kubectl get pods -A
admin@jump-host:~$ kubectl exec -n vault vault-0 -- vault status
admin@jump-host:~$ kubectl exec -n vault vault-0 -- vault operator raft list-peers
admin@jump-host:~$ cd secure-access-platform
admin@jump-host:~$ ansible-playbook -i ansible/inventory/hosts.ini ansible/site.yml
```

### 2. Zero network exposure (employee window, `/employee`)

```text
C:\Users\employee> ping 10.10.0.30            # Request timed out x4
C:\Users\employee> ssh ops@10.10.0.30         # Connection timed out
C:\Users\employee> nslookup boundary.yotta.lab
```

### 3. The 5-step flow (employee window, watch `/backend`)

```text
C:\Users\employee> boundary authenticate ldap -auth-method-id=amldap_9fK2pQx7Lz -login-name=alice
C:\Users\employee> boundary targets list -recursive
C:\Users\employee> boundary connect postgres -dbname=appdb -target-name=production-db -target-scope-name=Production-Access
appdb=> SELECT current_user;          # an ephemeral Vault role: v-token-prod-db-o-...
appdb=> SELECT * FROM customers LIMIT 5;
appdb=> \q                            # session ends, Vault lease revoked, DB role dropped
```

### 4. Negative RBAC tests (employee window)

Re-run `boundary authenticate` as `bob`, then try the `connect` command above: **403 Forbidden**. Authenticate as `mallory` and run `boundary targets list -recursive`: **No targets found**.

### 5. High-availability failovers (admin window, on the jump host)

```text
ssh haproxy-1 sudo systemctl stop keepalived      # VIP moves to haproxy-2
kubectl delete pod vault-0 -n vault               # vault-1 becomes leader, vault-0 re-seals
```

### Simulated accounts

| Where | Login | Password | Access |
| --- | --- | --- | --- |
| Jump host (SSH) | `admin` | `Jump@Admin2026` | Cluster administration |
| Boundary (LDAP) | `alice` | `Alice@Yotta26` | `eng-prod-access`: jump host, app server, production DB |
| Boundary (LDAP) | `bob` | `Bob@Yotta26` | `dev-access`: app server only |
| Boundary (LDAP) | `mallory` | `Mallory@Yotta26` | No group, no targets |

These credentials are fictional and only work inside the simulator.

### Boundary targets

| Target | Port | Session limit | Credential brokered |
| --- | --- | --- | --- |
| `jump-host-ssh` | 22 | 15 min | Vault SSH one-time password |
| `app-server-01` | 22 | 2 min | Vault SSH one-time password |
| `production-db` | 5432 | 10 min | Vault dynamic PostgreSQL user (5 min lease, 15 min max) |

---

## Supported commands

Type `help` in any window for the full list for that context.

**Windows `cmd` (both laptops):** `boundary`, `ssh`, `psql`, `ping`, `tracert`, `ipconfig`, `nslookup`, `curl`, `dir`, `type`, `cd`, `pwd`, `set`, `echo`, `ver`, `cls`, `whoami`, `hostname`, `findstr`, `guide`. The admin window also has `sim-reset`.

**Linux (after SSH to the jump host or a node):** `kubectl` (alias `k`), `helm`, `ansible`, `ansible-playbook`, `vault`, `boundary`, `ssh`, `systemctl`, `sudo`, `journalctl`, `ip`, `crictl`, `ls`, `cat`, `grep`, `sed`, `awk`, `jq`, `head`, `tail`, `wc`, `tee`, `df`, `free`, `uptime`, `hostnamectl`, `guide`, `exit`.

**psql (inside a brokered session):** `SELECT current_user;`, `SELECT count(*) FROM customers;`, `SELECT * FROM customers LIMIT 5;`, `\conninfo`, `\du`, `\dt`, `\l`, `\q`.

**Terminal keys:** `Tab` autocomplete, `↑` / `↓` history, `←` / `→` / `Home` / `End` cursor movement, `Ctrl+C` cancel, `Ctrl+D` exit.

### Resetting the simulation

Run `sim-reset` in the admin window (`/`) to restore the initial healthy state in every open tab.

---

## How it works

- **Single shared state.** The entire cluster is one `ClusterState` object (hosts, Kubernetes objects, Vault, Boundary, Postgres, backend logs). Commands never mutate it directly; they go through `store.update()`, which bumps a version number.
- **Cross-window sync.** State is persisted in `localStorage` and broadcast with a `BroadcastChannel`, so the admin, employee and backend windows stay consistent. **This works between tabs and windows of the same browser on the same origin.** Different browsers, incognito windows or different devices each get their own independent simulation.
- **Reconciler loop.** A 1-second tick drives time-based behaviour: VRRP failover, node readiness, pod rescheduling, Longhorn replica health, session expiry and Vault lease revocation.
- **Hygiene guard.** Output destined for the employee terminal is checked against a deny-list (target IPs, live and revoked secrets, tokens, backend step banners) before it is shown.
- **Client-only.** Terminals are loaded with `ssr: false`; all five routes are prerendered as static pages and all logic runs in the browser.

---

## Testing

```bash
npm test
```

The acceptance suite (`tests/simulator.test.ts`) covers:

1. SSH to the jump host, cluster inspection and an idempotent Ansible run (`changed=0`).
2. Alice's full 5-step flow, with the dynamic DB user created then revoked on `\q`, plus Bob's `403` and Mallory's empty target list.
3. The secrets-hygiene guard (no private IPs leak from the employee window).
4. Keepalived VIP failover and Vault leader failover with 3-key Shamir unseal.

---

## Deploying to Vercel

The app is a standard Next.js project with no environment variables, no database and no server-side secrets, so it deploys to Vercel with zero configuration.

### Option A: Deploy from GitHub (recommended)

**1. Make sure the repo is clean and pushed**

The `.gitignore` in this repo keeps `node_modules/` and `.next/` out of git. If you ever committed them by mistake, untrack them first:

```bash
git rm -r --cached node_modules .next 2>/dev/null
```

Then commit and push:

```bash
git add .
git status            # confirm node_modules/ and .next/ are NOT listed
git commit -m "Add README and .gitignore"
git push origin main
```

**2. Create a Vercel account**

Go to <https://vercel.com/signup> and sign up with **Continue with GitHub**.

**3. Import the project**

1. In the Vercel dashboard click **Add New… → Project**.
2. Find your repository (`Internship-`) in the list. If it is missing, click **Adjust GitHub App Permissions** and grant Vercel access to it.
3. Click **Import**.

**4. Confirm the settings**

Vercel auto-detects everything. Just verify:

| Setting | Value |
| --- | --- |
| Framework Preset | **Next.js** |
| Root Directory | `./` |
| Build Command | `next build` (default) |
| Output Directory | default (leave blank) |
| Install Command | default (`npm install`) |
| Environment Variables | none needed |

Under **Settings → General → Node.js Version**, choose **20.x or 22.x** (Next.js 16 needs Node 20.9+).

**5. Deploy**

Click **Deploy**. The build takes roughly a minute. When it finishes you get a URL like `https://internship-xxxx.vercel.app`.

**6. Verify**

Open these on the live URL:

- `/` admin terminal shows `C:\Users\Vaanishka>`
- `/employee` employee terminal shows `C:\Users\employee>`
- `/backend` event stream
- `/all` tiled view

Run `guide` in a terminal, then try the Alice flow from the [demo walkthrough](#demo-walkthrough).

**7. Updates are automatic**

Every `git push` to `main` triggers a new production deployment. Pushes to other branches and pull requests get their own preview URLs.

### Option B: Deploy with the Vercel CLI

```bash
npm i -g vercel
vercel login
vercel            # first run: answer the prompts, creates a preview deployment
vercel --prod     # promote to production
```

### Optional: custom domain

In the Vercel dashboard open **Project → Settings → Domains → Add**, enter your domain and add the DNS record Vercel shows you.

### Presenting from the deployed site

- Use the **production** URL (`*.vercel.app` or your custom domain). Preview deployments may sit behind Vercel's deployment-protection login, which your audience would hit.
- Open `/all`, **or** open `/`, `/employee` and `/backend` as tabs in the **same browser**. The windows only sync within one browser (see [How it works](#how-it-works)).
- Before presenting, run `sim-reset` in the admin window to start from a clean state.
- The terminal font is *Cascadia Mono* (included with Windows 11) and falls back to Consolas or system monospace elsewhere.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Employee and backend windows don't update together | They must be in the same browser profile on the same origin. Don't mix `localhost` and `127.0.0.1`, and avoid incognito vs normal windows. |
| Simulation is stuck in a strange state | Run `sim-reset` in the admin window, or clear the site's `localStorage` and reload. |
| `npm run lint` fails with "Invalid project directory" | Known issue: `next lint` was removed in Next.js 16. See [Available scripts](#available-scripts). |
| Vercel build fails on Node version | Set Node.js Version to 20.x or 22.x in **Settings → General**. |
| `next-env.d.ts` is missing | It is generated automatically (and git-ignored). Run `npm run dev` or `npm run build` to recreate it. |
| Terminal looks blank right after load | Hard-refresh the page; the terminal initialises client-side after hydration. |

---

## Author

Vaanishka Trivedi, internship project.