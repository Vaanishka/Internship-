import { CommandExecutionResult, ProgramContext } from './types';
import { ClusterState, HostId, K8sNode, K8sPod } from '../core/types';
import { listDirEntries, normalizeLinuxPath, readFileNode, writeFileNode } from '../vfs/vfs';
import { getGuideOutput, getHelpOutput } from './guide';
import { getClusterStore } from '../core/store';

export function executeLinuxUtility(
  cmd: string,
  ctx: ProgramContext
): CommandExecutionResult | null {
  const { args, frame, state, updateState } = ctx;

  if (cmd === 'clear') {
    return { output: '', clearScreen: true };
  }

  if (cmd === 'guide') {
    return { output: getGuideOutput() };
  }

  if (cmd === 'help') {
    return { output: getHelpOutput(ctx.windowRole, 'bash') };
  }

  if (cmd === 'sim-reset') {
    getClusterStore().reset();
    return { output: 'Simulator cluster state reset to initial converged baseline.' };
  }

  if (cmd === 'pwd') {
    return { output: frame.cwd };
  }

  if (cmd === 'whoami') {
    return { output: frame.user };
  }

  if (cmd === 'hostname') {
    return { output: frame.hostId };
  }

  if (cmd === 'hostnamectl') {
    const h = state.hosts[frame.hostId];
    return {
      output: ` Static hostname: ${h.hostname}
       Icon name: computer-vm
         Chassis: vm
      Machine ID: 8f3a1c2d4e5b6a7c8d9e0f1a2b3c4d5e
         Boot ID: 3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f
  Virtualization: kvm
Operating System: Ubuntu 24.04.1 LTS
          Kernel: Linux 6.8.0-48-generic
    Architecture: x86-64`
    };
  }

  if (cmd === 'uptime') {
    return { output: ' 12:14:08 up 6 days,  4:14,  1 user,  load average: 0.18, 0.22, 0.19' };
  }

  if (cmd === 'free') {
    return {
      output: `               total        used        free      shared  buff/cache   available
Mem:           15.6Gi       3.4Gi       9.8Gi        48Mi       2.4Gi      11.9Gi
Swap:             0B          0B          0B`
    };
  }

  if (cmd === 'df') {
    return {
      output: `Filesystem                        Size  Used Avail Use% Mounted on
tmpfs                             1.6G  1.8M  1.6G   1% /run
/dev/mapper/ubuntu--vg-ubuntu--lv  98G   19G   75G  20% /
tmpfs                             7.8G     0  7.8G   0% /dev/shm`
    };
  }

  if (cmd === 'cd') {
    const targetArg = args[0] || '~';
    const target = normalizeLinuxPath(frame.cwd, targetArg);
    const node = readFileNode(state, frame.hostId, target);
    if (!node || node.type !== 'dir') {
      return { output: `bash: cd: ${targetArg}: No such file or directory` };
    }
    frame.cwd = target;
    return { output: '' };
  }

  if (cmd === 'ls') {
    const flags = args.filter((a: string) => a.startsWith('-')).join('');
    const pathArg = args.find((a: string) => !a.startsWith('-')) || frame.cwd;
    const target = normalizeLinuxPath(frame.cwd, pathArg);
    const node = readFileNode(state, frame.hostId, target);
    if (node && node.type === 'file') {
      return { output: pathArg };
    }
    const entries = listDirEntries(state, frame.hostId, target);
    if (flags.includes('l')) {
      const lines = [`total ${entries.length * 4}`];
      for (const e of entries) {
        const perm = e.node.type === 'dir' ? 'drwxr-xr-x' : e.node.mode === '0755' ? '-rwxr-xr-x' : e.node.mode === '0600' ? '-rw-------' : '-rw-r--r--';
        const size = e.node.type === 'dir' ? 4096 : (e.node.content || '').length;
        lines.push(`${perm} 1 ${e.node.owner || 'admin'} ${e.node.owner || 'admin'} ${String(size).padStart(5, ' ')} Nov 17 09:00 ${e.name}`);
      }
      return { output: lines.join('\n') };
    }
    return { output: entries.map((e) => e.name).join('  ') };
  }

  if (cmd === 'cat' || cmd === 'less') {
    if (!args[0]) return { output: ctx.stdin || '' };
    const out: string[] = [];
    for (const arg of args) {
      if (arg.startsWith('-')) continue;
      const fullPath = normalizeLinuxPath(frame.cwd, arg);
      const node = readFileNode(state, frame.hostId, fullPath);
      if (!node) {
        return { output: `cat: ${arg}: No such file or directory` };
      }
      if (node.type === 'dir') {
        return { output: `cat: ${arg}: Is a directory` };
      }
      out.push(node.content || '');
    }
    return { output: out.join('\n') };
  }

  if (cmd === 'head' || cmd === 'tail') {
    let n = 10;
    const nIdx = args.indexOf('-n');
    if (nIdx !== -1 && args[nIdx + 1]) {
      n = parseInt(args[nIdx + 1], 10) || 10;
    }
    const fileArg = args.find((a: string, i: number) => !a.startsWith('-') && (nIdx === -1 || i !== nIdx + 1));
    let content = ctx.stdin || '';
    if (fileArg) {
      const fullPath = normalizeLinuxPath(frame.cwd, fileArg);
      const node = readFileNode(state, frame.hostId, fullPath);
      if (!node || node.type !== 'file') return { output: `${cmd}: cannot open '${fileArg}' for reading: No such file or directory` };
      content = node.content || '';
    }
    const lines = content.split('\n');
    return {
      output: cmd === 'head' ? lines.slice(0, n).join('\n') : lines.slice(-n).join('\n')
    };
  }

  if (cmd === 'wc') {
    const content = ctx.stdin || '';
    const lines = content ? content.split('\n').length : 0;
    if (args.includes('-l')) return { output: String(lines) };
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    return { output: `      ${lines}      ${words}     ${content.length}` };
  }

  if (cmd === 'grep') {
    const ignoreCase = args.includes('-i');
    const nonFlags = args.filter((a: string) => !a.startsWith('-'));
    const pattern = (nonFlags[0] || '').replace(/^["']|["']$/g, '');
    const fileArg = nonFlags[1];
    let text = ctx.stdin || '';
    if (fileArg) {
      const fullPath = normalizeLinuxPath(frame.cwd, fileArg);
      const node = readFileNode(state, frame.hostId, fullPath);
      if (!node || node.type !== 'file') return { output: `grep: ${fileArg}: No such file or directory` };
      text = node.content || '';
    }
    const re = new RegExp(pattern, ignoreCase ? 'i' : '');
    const matched = text.split('\n').filter((l: string) => re.test(l));
    return { output: matched.join('\n') };
  }

  if (cmd === 'sed') {
    const isInPlace = args.includes('-i');
    const nonFlags = args.filter((a: string) => !a.startsWith('-'));
    const expr = (nonFlags[0] || '').replace(/^["']|["']$/g, '');
    const fileArg = nonFlags[1];

    const m = expr.match(/^s\/([^/]*)\/([^/]*)\/(g?)$/);
    const slashAlt = expr.match(/^s\|([^|]*)\|([^|]*)\|(g?)$/);
    const parsed = m || slashAlt;

    if (fileArg) {
      const fullPath = normalizeLinuxPath(frame.cwd, fileArg);
      const node = readFileNode(state, frame.hostId, fullPath);
      if (!node || node.type !== 'file') return { output: `sed: can't read ${fileArg}: No such file or directory` };
      let content = node.content || '';
      if (parsed) {
        const re = new RegExp(parsed[1], parsed[3].includes('g') ? 'g' : '');
        content = content.replace(re, parsed[2]);
      } else if (expr.endsWith('d')) {
        const delPat = expr.replace(/^\/|\/d$/g, '');
        content = content
          .split('\n')
          .filter((l: string) => !l.includes(delPat))
          .join('\n');
      }
      if (isInPlace) {
        updateState((draft: ClusterState) => {
          writeFileNode(draft, frame.hostId, fullPath, content, node.mode);
        });
        return { output: '' };
      }
      return { output: content };
    }
    return { output: ctx.stdin || '' };
  }

  if (cmd === 'tee') {
    const fileArg = args.find((a: string) => !a.startsWith('-'));
    const content = ctx.stdin || '';
    if (fileArg) {
      const fullPath = normalizeLinuxPath(frame.cwd, fileArg);
      updateState((draft: ClusterState) => {
        writeFileNode(draft, frame.hostId, fullPath, content);
      });
    }
    return { output: content };
  }

  if (cmd === 'jq') {
    const expr = (args.find((a: string) => !a.startsWith('-')) || '.').replace(/^["']|["']$/g, '');
    const raw = (ctx.stdin || '').trim();
    if (!raw) return { output: '' };
    try {
      const obj = JSON.parse(raw);
      if (expr === '.') return { output: JSON.stringify(obj, null, 2) };
      const keys = expr.replace(/^\./, '').split('.');
      let cur: unknown = obj;
      for (const k of keys) {
        if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[k];
        } else {
          cur = null;
        }
      }
      if (typeof cur === 'string' && args.includes('-r')) return { output: cur };
      return { output: JSON.stringify(cur, null, 2) };
    } catch {
      return { output: 'parse error: Invalid numeric literal at line 1' };
    }
  }

  if (cmd === 'ip') {
    const host = state.hosts[frame.hostId];
    const hasVip =
      (frame.hostId === 'haproxy-1' && state.vipHolder === 'haproxy-1') ||
      (frame.hostId === 'haproxy-2' && state.vipHolder === 'haproxy-2');
    const vipLine = hasVip
      ? '\n    inet 10.10.0.100/24 scope global secondary eth0\n       valid_lft forever preferred_lft forever'
      : '';
    return {
      output: `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 52:54:00:4a:19:c1 brd ff:ff:ff:ff:ff:ff
    inet ${host.ip}/24 brd 10.10.0.255 scope global eth0
       valid_lft forever preferred_lft forever${vipLine}`
    };
  }

  if (cmd === 'systemctl') {
    const action = args[0];
    const svc = (args[1] || '').replace(/\.service$/, '');
    const host = state.hosts[frame.hostId];

    if (action === 'status') {
      const st = host.services[svc] || 'active';
      const activeLine =
        st === 'active'
          ? 'Active: active (running) since Tue 2026-11-17 08:00:12 IST; 4h 12min ago'
          : 'Active: inactive (dead)';
      const dot = st === 'active' ? '●' : '○';
      const extra =
        svc === 'keepalived' &&
        ((frame.hostId === 'haproxy-1' && state.vipHolder === 'haproxy-1') ||
          (frame.hostId === 'haproxy-2' && state.vipHolder === 'haproxy-2'))
          ? '\n   Status: "VRRP Instance VI_1: MASTER (VIP 10.10.0.100/24)"'
          : svc === 'keepalived'
            ? '\n   Status: "VRRP Instance VI_1: BACKUP"'
            : '';
      return {
        output: `${dot} ${svc}.service - ${svc.toUpperCase()} Daemon
     Loaded: loaded (/lib/systemd/system/${svc}.service; enabled; preset: enabled)
     ${activeLine}${extra}
   Main PID: 910 (${svc})`
      };
    }

    if (action === 'stop' || action === 'start' || action === 'restart') {
      updateState((draft: ClusterState) => {
        const h = draft.hosts[frame.hostId];
        h.services[svc] = action === 'stop' ? 'inactive' : 'active';
        if (!h.journal[svc]) h.journal[svc] = [];
        h.journal[svc].push(
          `Nov 17 ${new Date().toTimeString().slice(0, 8)} ${frame.hostId} systemd[1]: ${
            action === 'stop' ? 'Stopped' : 'Started'
          } ${svc}.service.`
        );
      });
      getClusterStore().update((draft: ClusterState) => {
        const h1 = draft.hosts['haproxy-1'];
        const h2 = draft.hosts['haproxy-2'];
        const h1Ok = h1.poweredOn && h1.services.keepalived === 'active' && h1.services.haproxy === 'active';
        const h2Ok = h2.poweredOn && h2.services.keepalived === 'active' && h2.services.haproxy === 'active';
        draft.vipHolder = h1Ok ? 'haproxy-1' : h2Ok ? 'haproxy-2' : 'none';
      });
      return { output: '' };
    }
  }

  if (cmd === 'journalctl') {
    const uIdx = args.indexOf('-u');
    const unit = uIdx !== -1 && args[uIdx + 1] ? args[uIdx + 1].replace(/\.service$/, '') : 'keepalived';
    const host = state.hosts[frame.hostId];
    const logs = host.journal[unit] || [
      `Nov 17 08:00:01 ${frame.hostId} systemd[1]: Started ${unit}.service.`
    ];
    return { output: logs.slice(-20).join('\n') };
  }

  if (cmd === 'poweroff' || cmd === 'shutdown') {
    if (frame.hostId === 'jump-host') {
      return { output: 'Refusing to power off jump-host control workstation during active lab.' };
    }
    updateState((draft: ClusterState) => {
      const h = draft.hosts[frame.hostId as HostId];
      h.poweredOn = false;
      h.poweredOffAt = Date.now();
      for (const n of draft.k8s.nodes) {
        if ((n as K8sNode).name === frame.hostId) {
          (n as K8sNode).status = 'NotReady';
        }
      }
    });
    return {
      output: `Connection to ${frame.hostId} closed by remote host.\nConnection to ${frame.hostId} closed.`,
      popFrame: true
    };
  }

  if (cmd === 'crictl') {
    if (args[0] === 'ps') {
      const pods = state.k8s.pods.filter((p: K8sPod) => p.node === frame.hostId && p.status === 'Running');
      const lines = ['CONTAINER           IMAGE               CREATED             STATE               NAME                      POD ID              POD'];
      for (const p of pods) {
        lines.push(
          `${p.name.slice(0, 12).padEnd(19)} a8f9c2d1e4b3        6 days ago          Running             ${p.name.slice(0, 25).padEnd(25)} 7b4e1c9a2d3f        ${p.name}`
        );
      }
      return { output: lines.join('\n') };
    }
  }

  if (cmd === 'curl') {
    const url = args.find((a: string) => a.startsWith('http')) || '';
    if (url.includes('10.10.0.201:8200/v1/sys/health')) {
      return {
        output: JSON.stringify({
          initialized: true,
          sealed: state.vault.nodes['vault-0'].sealed,
          standby: false,
          version: '1.17.6',
          cluster_name: state.vault.clusterName,
          cluster_id: state.vault.clusterId
        })
      };
    }
    if (url.includes('9200')) {
      return { output: '{"status":"ok","controller":"kubernetes-controller","version":"0.19.0"}' };
    }
    return { output: '{"status":"ok"}' };
  }

  return null;
}