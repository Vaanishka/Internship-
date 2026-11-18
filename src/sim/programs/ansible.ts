import yaml from 'js-yaml';
import { CommandExecutionResult, ProgramContext } from './types';
import { ClusterState } from '../core/types';
import { normalizeLinuxPath, readFileNode } from '../vfs/vfs';
import { REPO_BASE_PATH, REPO_FILES } from '../vfs/repoFiles';
import { appendBackendLogToDraft } from '../core/store';

export function executeAnsibleAdHoc(ctx: ProgramContext): CommandExecutionResult {
  const { args, state } = ctx;
  const allHosts = [
    'k8s-master-1',
    'k8s-master-2',
    'k8s-master-3',
    'k8s-worker-1',
    'k8s-worker-2',
    'haproxy-1',
    'haproxy-2',
    'jump-host'
  ];

  if (args.includes('ping')) {
    const lines = allHosts.map((h) => {
      const powered = state.hosts[h as keyof typeof state.hosts]?.poweredOn;
      if (!powered) {
        return `${h} | UNREACHABLE! => {\n    "changed": false,\n    "msg": "Failed to connect to the host via ssh: ssh: connect to host ${state.hosts[h as keyof typeof state.hosts].ip} port 22: Connection timed out",\n    "unreachable": true\n}`;
      }
      return `${h} | SUCCESS => {\n    "changed": false,\n    "ping": "pong"\n}`;
    });
    return { output: lines.join('\n'), delayMs: 220 };
  }

  return {
    output: allHosts.map((h) => `${h} | CHANGED | rc=0 >>\nLinux ${h} 6.8.0-48-generic x86_64`).join('\n')
  };
}

export function executeAnsiblePlaybook(ctx: ProgramContext): CommandExecutionResult {
  const { args, state, updateState, frame } = ctx;
  const syntaxCheck = args.includes('--syntax-check');
  const playbookArg = args.find((a: string) => a.endsWith('.yml') || a.endsWith('.yaml')) || 'ansible/site.yml';
  const fullPath = normalizeLinuxPath(frame.cwd, playbookArg);
  const pbNode = readFileNode(state, frame.hostId, fullPath);

  if (!pbNode) {
    return { output: `ERROR! the playbook: ${playbookArg} could not be found` };
  }

  try {
    yaml.load(pbNode.content || '');
  } catch (e) {
    return { output: `ERROR! We were unable to read either as JSON nor YAML, these are the errors we got from each:\nYAML: ${(e as Error).message}` };
  }

  if (syntaxCheck) {
    return { output: `\nplaybook: ${playbookArg}` };
  }

  const allVarsNode = readFileNode(state, frame.hostId, `${REPO_BASE_PATH}/ansible/group_vars/all.yml`);
  const commonTasksNode = readFileNode(state, frame.hostId, `${REPO_BASE_PATH}/ansible/roles/common/tasks/main.yml`);

  const varsModified = allVarsNode && allVarsNode.content !== REPO_FILES['ansible/group_vars/all.yml'];
  const hasRawSwapoff =
    commonTasksNode &&
    commonTasksNode.content &&
    commonTasksNode.content.includes('shell: swapoff -a') &&
    !commonTasksNode.content.includes('changed_when: false');

  const allHosts = [
    'k8s-master-1',
    'k8s-master-2',
    'k8s-master-3',
    'k8s-worker-1',
    'k8s-worker-2',
    'haproxy-1',
    'haproxy-2',
    'jump-host'
  ];
  const k8sHosts = ['k8s-master-1', 'k8s-master-2', 'k8s-master-3', 'k8s-worker-1', 'k8s-worker-2'];
  const haproxyHosts = ['haproxy-1', 'haproxy-2'];

  const statusLabel = (changed: boolean) => (changed ? 'changed' : 'ok');

  const lines: string[] = [
    '',
    'PLAY [Apply baseline user and OS configuration across all infrastructure nodes] ****************************************************',
    '',
    'TASK [Gathering Facts] *************************************************************************************************************',
    ...allHosts.map((h) => `ok: [${h}]`),
    '',
    'TASK [users : Ensure admin group exists] *******************************************************************************************',
    ...allHosts.map((h) => `ok: [${h}]`),
    '',
    'TASK [users : Ensure administrative users are present with passwordless sudo] ******************************************************',
    ...allHosts.map((h) => `${statusLabel(Boolean(varsModified))}: [${h}]`),
    '',
    'TASK [common : Remove swapfile from /etc/fstab declaratively] **********************************************************************',
    ...allHosts.map((h) => `${statusLabel(Boolean(hasRawSwapoff))}: [${h}]`),
    '',
    'TASK [common : Load overlay and br_netfilter kernel modules] ***********************************************************************',
    ...allHosts.map((h) => `ok: [${h}]`),
    '',
    'TASK [common : Configure Kubernetes networking sysctl parameters] ******************************************************************',
    ...allHosts.map((h) => `ok: [${h}]`),
    '',
    'TASK [common : Install required baseline OS and Longhorn prerequisite packages] ****************************************************',
    ...allHosts.map((h) => `ok: [${h}]`),
    '',
    'PLAY [Configure containerd and Kubernetes packages on cluster nodes] ***************************************************************',
    '',
    'TASK [containerd : Deploy containerd configuration with SystemdCgroup enabled] *****************************************************',
    ...k8sHosts.map((h) => `ok: [${h}]`),
    '',
    'TASK [kubernetes : Install pinned kubelet, kubeadm, and kubectl packages] **********************************************************',
    ...k8sHosts.map((h) => `ok: [${h}]`),
    '',
    'TASK [kubernetes : Hold kubelet, kubeadm, and kubectl versions] ********************************************************************',
    ...k8sHosts.map((h) => `ok: [${h}]`),
    '',
    'PLAY [Configure HAProxy and Keepalived load balancers] *****************************************************************************',
    '',
    'TASK [haproxy_keepalived : Render /etc/keepalived/keepalived.conf] *****************************************************************',
    ...haproxyHosts.map((h) => `ok: [${h}]`),
    '',
    'TASK [haproxy_keepalived : Render /etc/haproxy/haproxy.cfg] ************************************************************************',
    ...haproxyHosts.map((h) => `ok: [${h}]`),
    '',
    'PLAY RECAP *************************************************************************************************************************'
  ];

  const changedCount = varsModified || hasRawSwapoff ? 1 : 0;
  for (const h of allHosts) {
    const okCount = k8sHosts.includes(h) ? 9 : haproxyHosts.includes(h) ? 8 : 6;
    lines.push(
      `${h.padEnd(26)} : ok=${okCount}    changed=${changedCount}    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0`
    );
  }

  updateState((draft: ClusterState) => {
    appendBackendLogToDraft(draft, {
      component: 'k8s',
      podOrHost: 'jump-host/ansible',
      message: `ansible-playbook ${playbookArg} completed across 8 hosts (changed=${changedCount})`
    });
  });

  return { output: lines.join('\n'), delayMs: 400 };
}