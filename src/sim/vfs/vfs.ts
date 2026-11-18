import { ClusterState, HostId, VfsNode } from '../core/types';

export function normalizeLinuxPath(cwd: string, targetPath: string): string {
  let raw = targetPath.trim();
  if (raw === '~' || raw.startsWith('~/')) {
    const home = cwd.startsWith('/home/ops') ? '/home/ops' : '/home/admin';
    raw = home + raw.slice(1);
  } else if (!raw.startsWith('/')) {
    raw = `${cwd === '/' ? '' : cwd}/${raw}`;
  }
  const parts = raw.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return '/' + stack.join('/');
}

export function normalizeWindowsPath(cwd: string, targetPath: string): string {
  let raw = targetPath.trim().replace(/\//g, '\\');
  if (!/^[A-Za-z]:\\/.test(raw)) {
    if (raw.startsWith('\\')) {
      raw = 'C:' + raw;
    } else {
      raw = `${cwd.endsWith('\\') ? cwd.slice(0, -1) : cwd}\\${raw}`;
    }
  }
  const drive = raw.slice(0, 2).toUpperCase();
  const rest = raw.slice(2).split('\\');
  const stack: string[] = [];
  for (const part of rest) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.length === 0 ? `${drive}\\` : `${drive}\\${stack.join('\\')}`;
}

export function readFileNode(state: ClusterState, hostId: HostId, fullPath: string): VfsNode | null {
  const host = state.hosts[hostId];
  if (!host) return null;
  if (host.os === 'windows') {
    const lowerTarget = fullPath.toLowerCase();
    for (const [k, v] of Object.entries(host.files)) {
      if (k.toLowerCase() === lowerTarget) return v;
    }
    return null;
  }
  return host.files[fullPath] || null;
}

export function writeFileNode(
  state: ClusterState,
  hostId: HostId,
  fullPath: string,
  content: string,
  mode = '0644'
): void {
  const host = state.hosts[hostId];
  if (!host) return;
  const sep = host.os === 'windows' ? '\\' : '/';
  const idx = fullPath.lastIndexOf(sep);
  if (idx > 0) {
    const parent = fullPath.slice(0, idx);
    if (!host.files[parent]) {
      host.files[parent] = { type: 'dir', mode: '0755', modifiedAt: Date.now() };
    }
  }
  host.files[fullPath] = {
    type: 'file',
    content,
    mode,
    owner: 'admin',
    modifiedAt: Date.now()
  };
}

export function listDirEntries(
  state: ClusterState,
  hostId: HostId,
  dirPath: string
): Array<{ name: string; node: VfsNode }> {
  const host = state.hosts[hostId];
  if (!host) return [];
  const sep = host.os === 'windows' ? '\\' : '/';
  const prefix = dirPath.endsWith(sep) ? dirPath : dirPath + sep;
  const entries = new Map<string, VfsNode>();

  for (const [fullPath, node] of Object.entries(host.files)) {
    const match =
      host.os === 'windows'
        ? fullPath.toLowerCase().startsWith(prefix.toLowerCase())
        : fullPath.startsWith(prefix);
    if (!match) continue;
    const remainder = fullPath.slice(prefix.length);
    if (!remainder) continue;
    const slashIdx = remainder.indexOf(sep);
    if (slashIdx === -1) {
      entries.set(remainder, node);
    } else {
      const childDir = remainder.slice(0, slashIdx);
      if (!entries.has(childDir)) {
        entries.set(childDir, { type: 'dir', mode: '0755', modifiedAt: node.modifiedAt });
      }
    }
  }

  return Array.from(entries.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, node]) => ({ name, node }));
}