import yaml from 'js-yaml';
import { CommandExecutionResult, ProgramContext } from './types';
import { ClusterState, HelmRelease } from '../core/types';
import { normalizeLinuxPath, readFileNode } from '../vfs/vfs';

export function executeHelm(ctx: ProgramContext): CommandExecutionResult {
  const { args, state, updateState, frame } = ctx;
  const sub = args[0] || 'help';

  if (sub === 'list' || sub === 'ls') {
    const lines = [
      'NAME    \tNAMESPACE      \tREVISION\tUPDATED                                \tSTATUS  \tCHART          \tAPP VERSION'
    ];
    for (const r of state.k8s.helmReleases) {
      lines.push(
        `${r.name.padEnd(8)}\t${r.namespace.padEnd(15)}\t${String(r.revision).padEnd(8)}\t${r.updated}\t${r.status}\t${r.chart.padEnd(15)}\t${r.appVersion}`
      );
    }
    return { output: lines.join('\n') };
  }

  if (sub === 'status') {
    const relName = args[1] || 'vault';
    const rel = state.k8s.helmReleases.find((r: HelmRelease) => r.name === relName) || state.k8s.helmReleases[0];
    return {
      output: `NAME: ${rel.name}
LAST DEPLOYED: ${rel.updated}
NAMESPACE: ${rel.namespace}
STATUS: ${rel.status}
REVISION: ${rel.revision}
TEST SUITE: None
NOTES:
Thank you for installing HashiCorp Vault!
Vault HA Raft cluster (3 replicas) is running with TLS secret vault-tls and LoadBalancer IP 10.10.0.201.`
    };
  }

  if (sub === 'history') {
    const relName = args[1] || 'vault';
    const rel = state.k8s.helmReleases.find((r: HelmRelease) => r.name === relName) || state.k8s.helmReleases[0];
    return {
      output: `REVISION\tUPDATED                 \tSTATUS  \tCHART       \tAPP VERSION\tDESCRIPTION     
1       \t${rel.updated.slice(0, 24)}\tdeployed\t${rel.chart}\t${rel.appVersion}     \tInstall complete`
    };
  }

  if (sub === 'lint') {
    const fIdx = args.indexOf('-f');
    if (fIdx !== -1 && args[fIdx + 1]) {
      const fullPath = normalizeLinuxPath(frame.cwd, args[fIdx + 1]);
      const node = readFileNode(state, frame.hostId, fullPath);
      if (!node) return { output: `Error: open ${args[fIdx + 1]}: no such file or directory` };
      try {
        yaml.load(node.content || '');
      } catch (e) {
        return { output: `[ERROR] values.yaml: ${(e as Error).message}\nError: 1 chart(s) linted, 1 chart(s) failed` };
      }
    }
    return {
      output: `==> Linting security/vault
[INFO] Chart.yaml: icon is recommended

1 chart(s) linted, 0 chart(s) failed`
    };
  }

  if (sub === 'template') {
    return {
      output: `---
# Source: vault/templates/server-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: vault
  namespace: vault
spec:
  replicas: 3
  serviceName: vault-internal`
    };
  }

  if (sub === 'upgrade' || sub === 'install') {
    const relName = args[1] || 'vault';
    updateState((draft: ClusterState) => {
      const rel = draft.k8s.helmReleases.find((r: HelmRelease) => r.name === relName);
      if (rel) {
        rel.revision += 1;
        rel.updated = new Date().toISOString();
      }
    });
    return {
      delayMs: 250,
      output: `Release "${relName}" has been upgraded. Happy Helming!\nSTATUS: deployed`
    };
  }

  if (sub === 'rollback') {
    const relName = args[1] || 'vault';
    return { output: `Rollback was a success! Happy Helming! (${relName})` };
  }

  if (sub === 'repo') {
    if (args[1] === 'list') {
      return {
        output: `NAME     \tURL                                      
hashicorp\thttps://helm.releases.hashicorp.com      
longhorn \thttps://charts.longhorn.io               
jetstack \thttps://charts.jetstack.io               `
      };
    }
    return { output: 'Hang tight while we grab the latest from your chart repositories...\n...Successfully got an update from the "hashicorp" chart repository\nUpdate Complete. Happy Helming!' };
  }

  return { output: 'Usage: helm [command] (list, status, history, lint, template, install, upgrade, rollback, repo)' };
}