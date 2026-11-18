import { ClusterState, HostId, WindowRole } from '../core/types';
import { CommandExecutionResult, ProgramContext, ShellFrame } from '../programs/types';
import { executeWindowsCommand } from '../programs/windowsCmds';
import { executeLinuxUtility } from '../programs/linuxUtils';
import { executeKubectl } from '../programs/kubectl';
import { executeHelm } from '../programs/helm';
import { executeAnsibleAdHoc, executeAnsiblePlaybook } from '../programs/ansible';
import { executeVaultCli } from '../programs/vault';
import { executeBoundaryCli } from '../programs/boundary';
import { executeInteractivePsqlCommand } from '../programs/psql';
import { normalizeLinuxPath, readFileNode, writeFileNode } from '../vfs/vfs';
import { appendBackendLogToDraft, getClusterStore } from '../core/store';
import { assertEmployeeOutputHygiene } from '../core/hygiene';

export function tokenizeCommand(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        result.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}

export class TerminalShellSession {
  public readonly windowRole: WindowRole;
  private stack: ShellFrame[] = [];
  private failedSshAttempts = 0;

  constructor(windowRole: WindowRole) {
    this.windowRole = windowRole;
    this.resetFrames();
  }

  public resetFrames(): void {
    if (this.windowRole === 'admin') {
      this.stack = [
        {
          hostId: 'VAANISHKA-LT',
          user: 'Vaanishka',
          cwd: 'C:\\Users\\Vaanishka',
          env: {
            USERNAME: 'Vaanishka',
            USERPROFILE: 'C:\\Users\\Vaanishka',
            BOUNDARY_ADDR: 'https://boundary.yotta.lab:9200'
          },
          mode: 'cmd'
        }
      ];
    } else {
      this.stack = [
        {
          hostId: 'YOTTA-LT-4471',
          user: 'employee',
          cwd: 'C:\\Users\\employee',
          env: {
            USERNAME: 'employee',
            USERPROFILE: 'C:\\Users\\employee',
            BOUNDARY_ADDR: 'https://boundary.yotta.lab:9200'
          },
          mode: 'cmd'
        }
      ];
    }
  }

  public currentFrame(): ShellFrame {
    return this.stack[this.stack.length - 1];
  }

  public getPrompt(): string {
    const f = this.currentFrame();
    if (f.mode === 'cmd') {
      return `${f.cwd}>`;
    }
    if (f.mode === 'psql') {
      return `${f.psqlDb || 'appdb'}=> `;
    }
    const home = f.user === 'ops' ? '/home/ops' : '/home/admin';
    const shortCwd = f.cwd === home ? '~' : f.cwd.startsWith(home + '/') ? '~' + f.cwd.slice(home.length) : f.cwd;
    return `${f.user}@${f.hostId}:${shortCwd}$ `;
  }

  public checkActiveSessionExpiry(state: ClusterState): string | null {
    const top = this.currentFrame();
    if (!top.boundarySessionId) return null;
    const s = state.boundary.sessions[top.boundarySessionId];
    if (s && s.status === 'terminated') {
      this.stack.pop();
      return `\nConnection to target closed by remote host (Boundary session ${s.id} terminated: ${s.terminationReason || 'session window expired'}).`;
    }
    return null;
  }

  public executeLine(rawLine: string): CommandExecutionResult {
    const store = getClusterStore();
    const state = store.getState();
    const frame = this.currentFrame();
    const trimmed = rawLine.trim();

    if (!trimmed) {
      return { output: '' };
    }

    if (frame.mode === 'psql') {
      const res = executeInteractivePsqlCommand({
        windowRole: this.windowRole,
        frame,
        state,
        updateState: (m) => store.update(m),
        rawLine: trimmed,
        args: tokenizeCommand(trimmed)
      });
      return this.applyFrameChangesAndGuard(res);
    }

    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'logout') {
      if (this.stack.length > 1) {
        const popped = this.stack.pop()!;
        if (popped.boundarySessionId) {
          const now = Date.now();
          store.update((draft: ClusterState) => {
            const ds = draft.boundary.sessions[popped.boundarySessionId!];
            if (ds && ds.status === 'active') {
              ds.status = 'terminated';
              ds.terminatedAt = now;
              ds.terminationReason = 'user closed SSH session';
              const lease = draft.vault.leases[ds.vaultLeaseId];
              if (lease) {
                delete draft.vault.leases[ds.vaultLeaseId];
              }
              appendBackendLogToDraft(draft, {
                component: 'boundary',
                podOrHost: 'boundary-worker',
                banner: '══════════ STEP 5/5 · SESSION TERMINATION & AUTO-REVOCATION ══════════',
                message: `client closed SSH session ${ds.id} -> proxy tunnel torn down; session -> terminated`,
                timestampMs: now
              });
              appendBackendLogToDraft(draft, {
                component: 'vault',
                podOrHost: 'vault/vault-0',
                message: `lease revoked ${ds.vaultLeaseId}  (zero standing privileges)`,
                timestampMs: now + 8
              });
            }
          });
          return { output: 'logout\nConnection closed by Boundary proxy.' };
        }
        const closeAddr = popped.hostId === 'jump-host' ? '10.10.0.30' : popped.hostId;
        return { output: `logout\nConnection to ${closeAddr} closed.` };
      }
      return { output: '' };
    }

    if (trimmed.includes('&&')) {
      const segments = trimmed.split('&&').map((s) => s.trim()).filter(Boolean);
      const outputs: string[] = [];
      for (const seg of segments) {
        const r = this.executeSinglePipeline(seg);
        if (r.output) outputs.push(r.output);
        if (r.promptInput || r.pushFrame || r.popFrame) {
          return { ...r, output: outputs.join('\n') };
        }
      }
      return this.applyFrameChangesAndGuard({ output: outputs.join('\n') });
    }

    const res = this.executeSinglePipeline(trimmed);
    return this.applyFrameChangesAndGuard(res);
  }

  private executeSinglePipeline(line: string): CommandExecutionResult {
    const store = getClusterStore();
    const frame = this.currentFrame();

    if (frame.mode === 'bash' && (line.includes(' > ') || line.includes(' >> '))) {
      const append = line.includes(' >> ');
      const [cmdPart, filePart] = line.split(append ? ' >> ' : ' > ').map((s) => s.trim());
      const subRes = this.executeSingleCommand(cmdPart);
      if (filePart) {
        const fullPath = normalizeLinuxPath(frame.cwd, filePart);
        store.update((draft: ClusterState) => {
          const existing = readFileNode(draft, frame.hostId, fullPath);
          const nextContent = append && existing?.content ? `${existing.content}\n${subRes.output}` : subRes.output;
          writeFileNode(draft, frame.hostId, fullPath, nextContent);
        });
      }
      return { output: '' };
    }

    if (line.includes('|')) {
      const stages = line.split('|').map((s) => s.trim());
      let currentStdin = '';
      let lastRes: CommandExecutionResult = { output: '' };
      for (const stage of stages) {
        lastRes = this.executeSingleCommand(stage, currentStdin);
        currentStdin = lastRes.output;
      }
      return lastRes;
    }

    return this.executeSingleCommand(line);
  }

  private executeSingleCommand(line: string, stdin?: string): CommandExecutionResult {
    const store = getClusterStore();
    const state = store.getState();
    const frame = this.currentFrame();

    const expandedLine =
      frame.mode === 'bash'
        ? line.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_: string, name: string) => frame.env[name] || '')
        : line;

    const tokens = tokenizeCommand(expandedLine);
    if (tokens.length === 0) return { output: '' };

    let cmd = tokens[0];
    let args = tokens.slice(1);

    if (frame.mode === 'bash' && cmd === 'sudo') {
      cmd = args[0] || '';
      args = args.slice(1);
      if (!cmd) return { output: 'usage: sudo command' };
    }

    if (frame.mode === 'bash' && cmd === 'export') {
      const raw = args.join(' ');
      const eq = raw.indexOf('=');
      if (eq !== -1) {
        const k = raw.slice(0, eq).trim();
        const v = raw.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        frame.env[k] = v;
      }
      return { output: '' };
    }

    const ctx: ProgramContext = {
      windowRole: this.windowRole,
      frame,
      state,
      updateState: (m) => store.update(m),
      rawLine: expandedLine,
      args,
      stdin
    };

    if (cmd.toLowerCase() === 'ssh') {
      return this.handleSshCommand(ctx);
    }

    if (cmd.toLowerCase() === 'psql') {
      const hIdx = args.indexOf('-h');
      const hostTarget = hIdx !== -1 ? args[hIdx + 1] : 'localhost';
      if (this.windowRole === 'employee') {
        return {
          delayMs: 200,
          output: 'psql: error: connection to server on port 5432 failed: Connection timed out\n\tIs the server running on that host and accepting TCP/IP connections?'
        };
      }
      return {
        output: `psql: error: connection to server at "${hostTarget}" (port 5432) failed: FATAL: password authentication failed`
      };
    }

    if (cmd.toLowerCase() === 'boundary') {
      return executeBoundaryCli(ctx);
    }

    if (frame.mode === 'cmd') {
      const winRes = executeWindowsCommand(cmd, ctx);
      if (winRes) return winRes;
      return {
        output: `'${tokens[0]}' is not recognized as an internal or external command,\noperable program or batch file.`
      };
    }

    if (cmd === 'kubectl' || cmd === 'k') {
      return executeKubectl(ctx);
    }
    if (cmd === 'helm') {
      return executeHelm(ctx);
    }
    if (cmd === 'ansible') {
      return executeAnsibleAdHoc(ctx);
    }
    if (cmd === 'ansible-playbook') {
      return executeAnsiblePlaybook(ctx);
    }
    if (cmd === 'vault') {
      return executeVaultCli(ctx);
    }

    if (cmd === 'bash' || cmd === 'sh' || cmd.startsWith('./') || cmd.endsWith('.sh')) {
      const scriptArg = cmd === 'bash' || cmd === 'sh' ? args[0] : cmd;
      return this.executeBashScript(scriptArg, ctx);
    }

    const linuxRes = executeLinuxUtility(cmd, ctx);
    if (linuxRes) return linuxRes;

    return { output: `bash: ${cmd}: command not found` };
  }

  private handleSshCommand(ctx: ProgramContext): CommandExecutionResult {
    const { args, state, updateState, frame } = ctx;
    const targetArg = args.find((a: string) => !a.startsWith('-')) || '';
    const trailingCmd = args.slice(args.indexOf(targetArg) + 1).join(' ');

    if (!targetArg) {
      return { output: 'usage: ssh [-p port] [user@]hostname [command]' };
    }

    if (this.windowRole === 'employee') {
      const safeHostDisplay = /10\.10\.0\.3[012]/.test(targetArg)
        ? 'target-subnet-host'
        : targetArg.split('@').pop() || 'host';
      return {
        delayMs: 220,
        output: `ssh: connect to host ${safeHostDisplay} port 22: Connection timed out`
      };
    }

    if (frame.mode === 'cmd' && (targetArg === 'admin@10.10.0.30' || targetArg === '10.10.0.30')) {
      const promptPasswordStep = (prefixBanner = ''): CommandExecutionResult => ({
        output: prefixBanner,
        promptInput: {
          promptText: "admin@10.10.0.30's password: ",
          echo: false,
          onInput: (pw: string) => {
            if (pw === 'Jump@Admin2026') {
              this.failedSshAttempts = 0;
              const jumpFrame: ShellFrame = {
                hostId: 'jump-host',
                user: 'admin',
                cwd: '/home/admin',
                env: {
                  USER: 'admin',
                  HOME: '/home/admin',
                  VAULT_ADDR: 'https://10.10.0.201:8200',
                  VAULT_CACERT: '/etc/ssl/certs/yotta-ca.crt',
                  BOUNDARY_ADDR: 'https://boundary.yotta.lab:9200'
                },
                mode: 'bash'
              };
              return this.applyFrameChangesAndGuard({
                pushFrame: jumpFrame,
                output: `Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-48-generic x86_64)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/pro

 System information as of ${new Date().toUTCString()}

  System load:  0.14               Processes:             142
  Usage of /:   19.8% of 97.87GB   Users logged in:       1
  Memory usage: 21%                IPv4 address for eth0: 10.10.0.30
  Swap usage:   0%

Last login: Tue Nov 17 08:15:42 2026 from 192.168.1.23`
              });
            }

            this.failedSshAttempts += 1;
            if (this.failedSshAttempts >= 3) {
              this.failedSshAttempts = 0;
              return { output: 'admin@10.10.0.30: Permission denied (publickey,password).' };
            }
            return {
              output: 'Permission denied, please try again.',
              promptInput: promptPasswordStep().promptInput
            };
          }
        }
      });

      if (!state.knownHostsAcceptedOnAdminLaptop) {
        return {
          output: `The authenticity of host '10.10.0.30 (10.10.0.30)' can't be established.
ED25519 key fingerprint is SHA256:9fK2pQx8Lz4vN7wR1yT6uI3oP0aS5dF8gH2jK4lZ9x.
This key is not known by any other names.
Are you sure you want to continue connecting (yes/no/[fingerprint])? `,
          promptInput: {
            promptText: '',
            echo: true,
            onInput: (ans: string) => {
              if (ans.trim().toLowerCase() !== 'yes') {
                return { output: 'Host key verification failed.' };
              }
              updateState((draft: ClusterState) => {
                draft.knownHostsAcceptedOnAdminLaptop = true;
              });
              return promptPasswordStep(
                "Warning: Permanently added '10.10.0.30' (ED25519) to the list of known hosts."
              );
            }
          }
        };
      }

      return promptPasswordStep();
    }

    if (frame.mode === 'bash') {
      const hostPart = targetArg.split('@').pop() || '';
      const matchedHost = Object.values(state.hosts).find(
        (h) => h.id === hostPart || h.ip === hostPart
      );
      if (!matchedHost) {
        return { output: `ssh: Could not resolve hostname ${hostPart}: Name or service not known` };
      }
      if (!matchedHost.poweredOn) {
        return { output: `ssh: connect to host ${matchedHost.ip} port 22: Connection timed out` };
      }

      const nodeFrame: ShellFrame = {
        hostId: matchedHost.id as HostId,
        user: 'admin',
        cwd: '/home/admin',
        env: { ...frame.env },
        mode: 'bash'
      };

      if (trailingCmd) {
        this.stack.push(nodeFrame);
        const res = this.executeSinglePipeline(trailingCmd);
        if (!res.popFrame) {
          this.stack.pop();
        }
        return { output: res.output };
      }

      return {
        pushFrame: nodeFrame,
        output: `Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-48-generic x86_64)\nLast login: ${new Date().toUTCString()} from 10.10.0.30`
      };
    }

    return { output: `ssh: connect to host ${targetArg} port 22: Connection timed out` };
  }

  private executeBashScript(scriptArg: string, ctx: ProgramContext): CommandExecutionResult {
    const { state, frame } = ctx;
    const fullPath = normalizeLinuxPath(frame.cwd, scriptArg);
    const node = readFileNode(state, frame.hostId, fullPath);
    if (!node || node.type !== 'file') {
      return { output: `bash: ${scriptArg}: No such file or directory` };
    }

    const lines = (node.content || '')
      .replace(/\\\n/g, ' ')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('set -'));

    const outputs: string[] = [];
    for (const line of lines) {
      const cleanLine = line.replace(/\s*\|\|\s*true$/, '');
      if (cleanLine.startsWith('echo ')) {
        outputs.push(cleanLine.slice(5).replace(/^["']|["']$/g, ''));
      } else {
        const r = this.executeSinglePipeline(cleanLine);
        if (r.output) outputs.push(r.output);
      }
    }

    return { output: outputs.join('\n'), delayMs: 320 };
  }

  private applyFrameChangesAndGuard(res: CommandExecutionResult): CommandExecutionResult {
    if (res.pushFrame) {
      this.stack.push(res.pushFrame);
    } else if (res.popFrame && this.stack.length > 1) {
      this.stack.pop();
    }

    if (this.windowRole === 'employee' && res.output) {
      assertEmployeeOutputHygiene(
        res.output,
        getClusterStore().getState(),
        Boolean(res.allowUnredactedToken)
      );
    }
    return res;
  }
}