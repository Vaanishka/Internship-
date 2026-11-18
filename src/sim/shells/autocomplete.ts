import { ClusterState } from '../core/types';
import { ShellFrame } from '../programs/types';
import { listDirEntries } from '../vfs/vfs';

export function completeCommandLine(
  line: string,
  frame: ShellFrame,
  state: ClusterState
): string {
  const tokens = line.split(/\s+/);
  const lastToken = tokens[tokens.length - 1] || '';

  if (tokens.length <= 1) {
    const cmds =
      frame.mode === 'cmd'
        ? ['boundary', 'ssh', 'psql', 'ping', 'tracert', 'ipconfig', 'nslookup', 'dir', 'type', 'cd', 'set', 'cls', 'ver', 'whoami', 'hostname', 'guide', 'help']
        : ['kubectl', 'helm', 'ansible', 'ansible-playbook', 'vault', 'boundary', 'ssh', 'systemctl', 'journalctl', 'ip', 'crictl', 'ls', 'cat', 'cd', 'grep', 'sed', 'jq', 'curl', 'sudo', 'guide', 'help', 'exit'];
    const match = cmds.find((c) => c.startsWith(lastToken.toLowerCase()));
    return match ? match + ' ' : line;
  }

  const first = tokens[0].toLowerCase();
  if ((first === 'kubectl' || first === 'k') && tokens.length === 2) {
    const subs = ['get', 'describe', 'logs', 'exec', 'apply', 'delete', 'rollout'];
    const m = subs.find((s) => s.startsWith(lastToken));
    if (m) return [...tokens.slice(0, -1), m].join(' ') + ' ';
  }

  if (first === 'boundary' && tokens.length === 2) {
    const subs = ['authenticate', 'targets', 'sessions', 'connect', 'scopes', 'auth-methods', 'users', 'roles', 'host-catalogs', 'hosts', 'credential-stores', 'credential-libraries'];
    const m = subs.find((s) => s.startsWith(lastToken));
    if (m) return [...tokens.slice(0, -1), m].join(' ') + ' ';
  }

  if (first === 'vault' && tokens.length === 2) {
    const subs = ['status', 'login', 'operator', 'policy', 'secrets', 'auth', 'kv', 'read', 'write', 'list', 'lease', 'token', 'audit'];
    const m = subs.find((s) => s.startsWith(lastToken));
    if (m) return [...tokens.slice(0, -1), m].join(' ') + ' ';
  }

  const entries = listDirEntries(state, frame.hostId, frame.cwd);
  const fileMatch = entries.find((e) => e.name.toLowerCase().startsWith(lastToken.toLowerCase()));
  if (fileMatch) {
    const sep = frame.mode === 'cmd' ? '\\' : '/';
    const suffix = fileMatch.node.type === 'dir' ? sep : ' ';
    return [...tokens.slice(0, -1), fileMatch.name + suffix].join(' ');
  }

  return line;
}