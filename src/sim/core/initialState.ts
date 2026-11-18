// src/sim/core/initialState.ts
import { ClusterState, HostId, HostMachineState, VfsNode } from './types';
import { REPO_BASE_PATH, REPO_FILES } from '../vfs/repoFiles';
import { formatTimeMs } from './store';

export const VAULT_SHAMIR_KEYS = [
  'f8K2pL9xQ4mN7vR1zW6cE3yT5bH8jU0dA2sG4kM9nP1=',
  'a3M9vB2nC7xZ4lK8jH1gF6dS5pO0iU9yT2rE4wQ7mN3=',
  'q7W1eR9tY3uI5oP2aS6dF8gH0jK4lZ7xC9vB1nM5pQ8=',
  'z4X8cV2bN6mM0lK3jH7gF9dS1aP5oI2uY6tR8eW4qL0=',
  'm2N7bV4cX9zL1kJ5hG3fD8sA0pO6iU4yT7rE2wQ9kP5='
];

export const VAULT_ROOT_TOKEN = 'hvs.CAESIJ9mK2pQx8Lz4vN7wR1yT6uI3oP0aS5dF8gH2jK4lZ9x';
export const BOUNDARY_CRED_STORE_TOKEN = 'hvs.CAESIL4xP9wR2mN8vK1zQ7cE5yT3bH6jU0dA9sG2kM4nP7w';

export const VAULT_INIT_TXT_CONTENT = `Unseal Key 1: ${VAULT_SHAMIR_KEYS[0]}
Unseal Key 2: ${VAULT_SHAMIR_KEYS[1]}
Unseal Key 3: ${VAULT_SHAMIR_KEYS[2]}
Unseal Key 4: ${VAULT_SHAMIR_KEYS[3]}
Unseal Key 5: ${VAULT_SHAMIR_KEYS[4]}

Initial Root Token: ${VAULT_ROOT_TOKEN}

Vault initialized with 5 key shares and a key threshold of 3. Please securely
distribute the key shares printed above. When the Vault is re-sealed,
restarted, or stopped, you must supply at least 3 of these keys to unseal it
before it can start servicing requests.
`;

function buildJumpHostFiles(now: number): Record<string, VfsNode> {
  const files: Record<string, VfsNode> = {
    '/home/admin': { type: 'dir', mode: '0755', owner: 'admin', modifiedAt: now },
    '/home/admin/vault-init.txt': {
      type: 'file',
      content: VAULT_INIT_TXT_CONTENT,
      mode: '0600',
      owner: 'admin',
      modifiedAt: now
    },
    '/home/admin/.kube': { type: 'dir', mode: '0700', owner: 'admin', modifiedAt: now },
    '/home/admin/.kube/config': {
      type: 'file',
      content: `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t
    server: https://10.10.0.100:6443
  name: kubernetes
contexts:
- context:
    cluster: kubernetes
    user: kubernetes-admin
  name: kubernetes-admin@kubernetes
current-context: kubernetes-admin@kubernetes
kind: Config
users:
- name: kubernetes-admin
  user:
    client-certificate-data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t
    client-key-data: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQ==
`,
      mode: '0600',
      owner: 'admin',
      modifiedAt: now
    },
    [REPO_BASE_PATH]: { type: 'dir', mode: '0755', owner: 'admin', modifiedAt: now }
  };

  for (const [relPath, content] of Object.entries(REPO_FILES)) {
    const parts = relPath.split('/');
    let currentDir = REPO_BASE_PATH;
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = `${currentDir}/${parts[i]}`;
      if (!files[currentDir]) {
        files[currentDir] = { type: 'dir', mode: '0755', owner: 'admin', modifiedAt: now };
      }
    }
    const fullPath = `${REPO_BASE_PATH}/${relPath}`;
    files[fullPath] = {
      type: 'file',
      content,
      mode: relPath.endsWith('.sh') ? '0755' : '0644',
      owner: 'admin',
      modifiedAt: now
    };
  }

  return files;
}

export function createInitialClusterState(now = Date.now()): ClusterState {
  const hosts: Record<HostId, HostMachineState> = {
    'VAANISHKA-LT': {
      id: 'VAANISHKA-LT',
      hostname: 'VAANISHKA-LT',
      os: 'windows',
      ip: '192.168.1.23',
      poweredOn: true,
      services: {},
      sysctl: {},
      swapEnabled: false,
      modulesLoaded: [],
      files: {
        'C:\\Users\\Vaanishka': { type: 'dir', modifiedAt: now },
        'C:\\Users\\Vaanishka\\Documents': { type: 'dir', modifiedAt: now },
        'C:\\Users\\Vaanishka\\Documents\\notes.txt': {
          type: 'file',
          content: 'Jump host SSH: ssh admin@10.10.0.30\r\nBoundary API: https://boundary.yotta.lab:9200\r\n',
          modifiedAt: now
        }
      },
      journal: {}
    },
    'YOTTA-LT-4471': {
      id: 'YOTTA-LT-4471',
      hostname: 'YOTTA-LT-4471',
      os: 'windows',
      ip: '192.168.1.87',
      poweredOn: true,
      services: {},
      sysctl: {},
      swapEnabled: false,
      modulesLoaded: [],
      files: {
        'C:\\Users\\employee': { type: 'dir', modifiedAt: now },
        'C:\\Users\\employee\\Documents': { type: 'dir', modifiedAt: now },
        'C:\\Users\\employee\\README.txt': {
          type: 'file',
          content: 'Corporate Zero-Trust Access Portal\r\nBoundary Controller: https://boundary.yotta.lab:9200\r\nAuth Method (LDAP): amldap_9fK2pQx7Lz\r\n',
          modifiedAt: now
        }
      },
      journal: {}
    },
    'jump-host': {
      id: 'jump-host',
      hostname: 'jump-host',
      os: 'ubuntu',
      ip: '10.10.0.30',
      poweredOn: true,
      services: { ssh: 'active', iscsid: 'active' },
      sysctl: {
        'net.ipv4.ip_forward': '1',
        'net.bridge.bridge-nf-call-iptables': '1',
        'net.bridge.bridge-nf-call-ip6tables': '1'
      },
      swapEnabled: false,
      modulesLoaded: ['overlay', 'br_netfilter'],
      files: buildJumpHostFiles(now),
      journal: {
        ssh: [
          'Nov 17 08:00:01 jump-host sshd[812]: Server listening on 0.0.0.0 port 22.',
          'Nov 17 08:00:01 jump-host vault-ssh-helper[815]: Verified PAM OTP configuration for role otp-ops'
        ]
      }
    },
    'k8s-master-1': {
      id: 'k8s-master-1',
      hostname: 'k8s-master-1',
      os: 'ubuntu',
      ip: '10.10.0.11',
      poweredOn: true,
      services: { kubelet: 'active', containerd: 'active', iscsid: 'active' },
      sysctl: { 'net.ipv4.ip_forward': '1', 'net.bridge.bridge-nf-call-iptables': '1' },
      swapEnabled: false,
      modulesLoaded: ['overlay', 'br_netfilter'],
      files: {},
      journal: {
        kubelet: ['Nov 17 08:01:10 k8s-master-1 kubelet[1120]: Node k8s-master-1 status is now: NodeReady']
      }
    },
    'k8s-master-2': {
      id: 'k8s-master-2',
      hostname: 'k8s-master-2',
      os: 'ubuntu',
      ip: '10.10.0.12',
      poweredOn: true,
      services: { kubelet: 'active', containerd: 'active', iscsid: 'active' },
      sysctl: { 'net.ipv4.ip_forward': '1', 'net.bridge.bridge-nf-call-iptables': '1' },
      swapEnabled: false,
      modulesLoaded: ['overlay', 'br_netfilter'],
      files: {},
      journal: {
        kubelet: ['Nov 17 08:01:14 k8s-master-2 kubelet[1104]: Node k8s-master-2 status is now: NodeReady']
      }
    },
    'k8s-master-3': {
      id: 'k8s-master-3',
      hostname: 'k8s-master-3',
      os: 'ubuntu',
      ip: '10.10.0.13',
      poweredOn: true,
      services: { kubelet: 'active', containerd: 'active', iscsid: 'active' },
      sysctl: { 'net.ipv4.ip_forward': '1', 'net.bridge.bridge-nf-call-iptables': '1' },
      swapEnabled: false,
      modulesLoaded: ['overlay', 'br_netfilter'],
      files: {},
      journal: {
        kubelet: ['Nov 17 08:01:19 k8s-master-3 kubelet[1098]: Node k8s-master-3 status is now: NodeReady']
      }
    },
    'k8s-worker-1': {
      id: 'k8s-worker-1',
      hostname: 'k8s-worker-1',
      os: 'ubuntu',
      ip: '10.10.0.21',
      poweredOn: true,
      services: { kubelet: 'active', containerd: 'active', iscsid: 'active' },
      sysctl: { 'net.ipv4.ip_forward': '1', 'net.bridge.bridge-nf-call-iptables': '1' },
      swapEnabled: false,
      modulesLoaded: ['overlay', 'br_netfilter'],
      files: {},
      journal: {
        kubelet: ['Nov 17 08:02:04 k8s-worker-1 kubelet[1210]: Node k8s-worker-1 status is now: NodeReady']
      }
    },
    'k8s-worker-2': {
      id: 'k8s-worker-2',
      hostname: 'k8s-worker-2',
      os: 'ubuntu',
      ip: '10.10.0.22',
      poweredOn: true,
      services: { kubelet: 'active', containerd: 'active', iscsid: 'active' },
      sysctl: { 'net.ipv4.ip_forward': '1', 'net.bridge.bridge-nf-call-iptables': '1' },
      swapEnabled: false,
      modulesLoaded: ['overlay', 'br_netfilter'],
      files: {},
      journal: {
        kubelet: ['Nov 17 08:02:09 k8s-worker-2 kubelet[1215]: Node k8s-worker-2 status is now: NodeReady']
      }
    },
    'haproxy-1': {
      id: 'haproxy-1',
      hostname: 'haproxy-1',
      os: 'ubuntu',
      ip: '10.10.0.5',
      poweredOn: true,
      services: { haproxy: 'active', keepalived: 'active' },
      sysctl: { 'net.ipv4.ip_nonlocal_bind': '1', 'net.ipv4.ip_forward': '1' },
      swapEnabled: false,
      modulesLoaded: ['overlay', 'br_netfilter'],
      files: {},
      journal: {
        keepalived: [
          'Nov 17 08:00:12 haproxy-1 Keepalived_vrrp[910]: (VI_1) Entering BACKUP STATE (init)',
          'Nov 17 08:00:15 haproxy-1 Keepalived_vrrp[910]: (VI_1) Entering MASTER STATE',
          'Nov 17 08:00:15 haproxy-1 Keepalived_vrrp[910]: (VI_1) setting VIPs: 10.10.0.100/24 dev eth0'
        ],
        haproxy: [
          'Nov 17 08:00:14 haproxy-1 haproxy[902]: Proxy fe_k8s_api started.',
          'Nov 17 08:00:14 haproxy-1 haproxy[902]: Proxy fe_boundary_api started.',
          'Nov 17 08:00:14 haproxy-1 haproxy[902]: Proxy fe_boundary_worker started.'
        ]
      }
    },
    'haproxy-2': {
      id: 'haproxy-2',
      hostname: 'haproxy-2',
      os: 'ubuntu',
      ip: '10.10.0.6',
      poweredOn: true,
      services: { haproxy: 'active', keepalived: 'active' },
      sysctl: { 'net.ipv4.ip_nonlocal_bind': '1', 'net.ipv4.ip_forward': '1' },
      swapEnabled: false,
      modulesLoaded: ['overlay', 'br_netfilter'],
      files: {},
      journal: {
        keepalived: [
          'Nov 17 08:00:13 haproxy-2 Keepalived_vrrp[895]: (VI_1) Entering BACKUP STATE',
          'Nov 17 08:00:15 haproxy-2 Keepalived_vrrp[895]: (VI_1) Master advertisement received from 10.10.0.5 prio 101'
        ],
        haproxy: [
          'Nov 17 08:00:14 haproxy-2 haproxy[888]: Proxy fe_k8s_api started.',
          'Nov 17 08:00:14 haproxy-2 haproxy[888]: Proxy fe_boundary_api started.',
          'Nov 17 08:00:14 haproxy-2 haproxy[888]: Proxy fe_boundary_worker started.'
        ]
      }
    },
    'app-server-01': {
      id: 'app-server-01',
      hostname: 'app-server-01',
      os: 'ubuntu',
      ip: '10.10.0.31',
      poweredOn: true,
      services: { ssh: 'active', 'yotta-OrderService': 'active' },
      sysctl: { 'net.ipv4.ip_forward': '1' },
      swapEnabled: false,
      modulesLoaded: [],
      files: {
        '/home/ops': { type: 'dir', mode: '0755', owner: 'ops', modifiedAt: now },
        '/home/ops/service-status.txt': {
          type: 'file',
          content: 'OrderService v4.2.1 running on :8080 (upstream DB: prod-db-01:5432)\nSession managed via Boundary Zero-Trust SSH OTP (120s window)\n',
          mode: '0644',
          owner: 'ops',
          modifiedAt: now
        }
      },
      journal: {
        ssh: ['Nov 17 08:00:05 app-server-01 sshd[744]: PAM vault-ssh-helper active for role otp-ops']
      }
    },
    'prod-db-01': {
      id: 'prod-db-01',
      hostname: 'prod-db-01',
      os: 'ubuntu',
      ip: '10.10.0.32',
      poweredOn: true,
      services: { postgresql: 'active', ssh: 'active' },
      sysctl: { 'net.ipv4.ip_forward': '1' },
      swapEnabled: false,
      modulesLoaded: [],
      files: {},
      journal: {
        postgresql: ['Nov 17 08:00:03 prod-db-01 postgres[920]: database system is ready to accept connections on 10.10.0.32:5432']
      }
    },
    'ldap.corp.yotta.lab': {
      id: 'ldap.corp.yotta.lab',
      hostname: 'ldap.corp.yotta.lab',
      os: 'openldap',
      ip: '192.168.1.10',
      poweredOn: true,
      services: { slapd: 'active' },
      sysctl: {},
      swapEnabled: false,
      modulesLoaded: [],
      files: {},
      journal: {}
    }
  };

  return {
    version: 1,
    initializedAt: now,
    knownHostsAcceptedOnAdminLaptop: false,
    vipHolder: 'haproxy-1',
    metallbPoolRange: '10.10.0.200-10.10.0.220',
    metallbL2AdvertisementPresent: true,
    hosts,
    k8s: {
      nodes: [
        {
          name: 'k8s-master-1',
          status: 'Ready',
          roles: 'control-plane',
          ageDays: 6,
          version: 'v1.34.1',
          internalIp: '10.10.0.11',
          osImage: 'Ubuntu 24.04.1 LTS',
          kernelVersion: '6.8.0-48-generic',
          containerRuntime: 'containerd://1.7.22'
        },
        {
          name: 'k8s-master-2',
          status: 'Ready',
          roles: 'control-plane',
          ageDays: 6,
          version: 'v1.34.1',
          internalIp: '10.10.0.12',
          osImage: 'Ubuntu 24.04.1 LTS',
          kernelVersion: '6.8.0-48-generic',
          containerRuntime: 'containerd://1.7.22'
        },
        {
          name: 'k8s-master-3',
          status: 'Ready',
          roles: 'control-plane',
          ageDays: 6,
          version: 'v1.34.1',
          internalIp: '10.10.0.13',
          osImage: 'Ubuntu 24.04.1 LTS',
          kernelVersion: '6.8.0-48-generic',
          containerRuntime: 'containerd://1.7.22'
        },
        {
          name: 'k8s-worker-1',
          status: 'Ready',
          roles: '<none>',
          ageDays: 6,
          version: 'v1.34.1',
          internalIp: '10.10.0.21',
          osImage: 'Ubuntu 24.04.1 LTS',
          kernelVersion: '6.8.0-48-generic',
          containerRuntime: 'containerd://1.7.22'
        },
        {
          name: 'k8s-worker-2',
          status: 'Ready',
          roles: '<none>',
          ageDays: 6,
          version: 'v1.34.1',
          internalIp: '10.10.0.22',
          osImage: 'Ubuntu 24.04.1 LTS',
          kernelVersion: '6.8.0-48-generic',
          containerRuntime: 'containerd://1.7.22'
        }
      ],
      pods: [
        // kube-system
        { name: 'etcd-k8s-master-1', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.11', node: 'k8s-master-1', labels: { component: 'etcd' }, logs: ['etcdmain: etcd Version: 3.5.15', 'raft: became leader at term 4'] },
        { name: 'etcd-k8s-master-2', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.12', node: 'k8s-master-2', labels: { component: 'etcd' }, logs: ['etcdmain: etcd Version: 3.5.15', 'raft: became follower at term 4'] },
        { name: 'etcd-k8s-master-3', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.13', node: 'k8s-master-3', labels: { component: 'etcd' }, logs: ['etcdmain: etcd Version: 3.5.15', 'raft: became follower at term 4'] },
        { name: 'kube-apiserver-k8s-master-1', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.11', node: 'k8s-master-1', labels: { component: 'kube-apiserver' }, logs: ['Serving securely on [::]:6443'] },
        { name: 'kube-apiserver-k8s-master-2', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.12', node: 'k8s-master-2', labels: { component: 'kube-apiserver' }, logs: ['Serving securely on [::]:6443'] },
        { name: 'kube-apiserver-k8s-master-3', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.13', node: 'k8s-master-3', labels: { component: 'kube-apiserver' }, logs: ['Serving securely on [::]:6443'] },
        { name: 'kube-controller-manager-k8s-master-1', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.11', node: 'k8s-master-1', labels: { component: 'kube-controller-manager' }, logs: ['leaderelection: successfully acquired lease kube-system/kube-controller-manager'] },
        { name: 'kube-controller-manager-k8s-master-2', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.12', node: 'k8s-master-2', labels: { component: 'kube-controller-manager' }, logs: [] },
        { name: 'kube-controller-manager-k8s-master-3', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.13', node: 'k8s-master-3', labels: { component: 'kube-controller-manager' }, logs: [] },
        { name: 'kube-scheduler-k8s-master-1', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.11', node: 'k8s-master-1', labels: { component: 'kube-scheduler' }, logs: [] },
        { name: 'kube-scheduler-k8s-master-2', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.12', node: 'k8s-master-2', labels: { component: 'kube-scheduler' }, logs: [] },
        { name: 'kube-scheduler-k8s-master-3', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.13', node: 'k8s-master-3', labels: { component: 'kube-scheduler' }, logs: [] },
        { name: 'kube-proxy-4k9x2', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.11', node: 'k8s-master-1', labels: { 'k8s-app': 'kube-proxy' }, logs: [] },
        { name: 'kube-proxy-7m2p1', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.12', node: 'k8s-master-2', labels: { 'k8s-app': 'kube-proxy' }, logs: [] },
        { name: 'kube-proxy-9v4l8', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.13', node: 'k8s-master-3', labels: { 'k8s-app': 'kube-proxy' }, logs: [] },
        { name: 'kube-proxy-2w8q5', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.21', node: 'k8s-worker-1', labels: { 'k8s-app': 'kube-proxy' }, logs: [] },
        { name: 'kube-proxy-6n1c9', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.22', node: 'k8s-worker-2', labels: { 'k8s-app': 'kube-proxy' }, logs: [] },
        { name: 'coredns-7db6d8ff4d-9x2k4', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.244.1.2', node: 'k8s-worker-1', labels: { 'k8s-app': 'kube-dns' }, logs: ['CoreDNS-1.11.3', 'linux/amd64, go1.22.5'] },
        { name: 'coredns-7db6d8ff4d-m4p8q', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.244.2.2', node: 'k8s-worker-2', labels: { 'k8s-app': 'kube-dns' }, logs: ['CoreDNS-1.11.3', 'linux/amd64, go1.22.5'] },
        { name: 'calico-node-8x2l1', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.11', node: 'k8s-master-1', labels: { 'k8s-app': 'calico-node' }, logs: ['Calico node started successfully'] },
        { name: 'calico-node-3p9k4', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.12', node: 'k8s-master-2', labels: { 'k8s-app': 'calico-node' }, logs: ['Calico node started successfully'] },
        { name: 'calico-node-5m1v7', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.13', node: 'k8s-master-3', labels: { 'k8s-app': 'calico-node' }, logs: ['Calico node started successfully'] },
        { name: 'calico-node-7w4z2', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.21', node: 'k8s-worker-1', labels: { 'k8s-app': 'calico-node' }, logs: ['Calico node started successfully'] },
        { name: 'calico-node-9c6b8', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.10.0.22', node: 'k8s-worker-2', labels: { 'k8s-app': 'calico-node' }, logs: ['Calico node started successfully'] },
        { name: 'calico-kube-controllers-6d48795585-x7k2p', namespace: 'kube-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 518400, ip: '10.244.1.3', node: 'k8s-worker-1', labels: { 'k8s-app': 'calico-kube-controllers' }, logs: [] },

        // metallb-system
        { name: 'controller-6789c6f89-v2p9m', namespace: 'metallb-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 500000, ip: '10.244.1.4', node: 'k8s-worker-1', labels: { app: 'metallb', component: 'controller' }, logs: ['MetalLB controller reconciled IPAddressPool yotta-l2-pool (10.10.0.200-10.10.0.220)'] },
        { name: 'speaker-k8s-worker-1', namespace: 'metallb-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 500000, ip: '10.10.0.21', node: 'k8s-worker-1', labels: { app: 'metallb', component: 'speaker' }, logs: ['announcing 10.10.0.201, 10.10.0.202, 10.10.0.203 via L2 ARP'] },
        { name: 'speaker-k8s-worker-2', namespace: 'metallb-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 500000, ip: '10.10.0.22', node: 'k8s-worker-2', labels: { app: 'metallb', component: 'speaker' }, logs: ['standby L2 speaker ready'] },

        // longhorn-system
        { name: 'longhorn-manager-w1x8k', namespace: 'longhorn-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 490000, ip: '10.244.1.5', node: 'k8s-worker-1', labels: { app: 'longhorn-manager' }, logs: ['Longhorn volume replicas healthy (2 replicas across worker-1, worker-2)'] },
        { name: 'longhorn-manager-w2p4m', namespace: 'longhorn-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 490000, ip: '10.244.2.5', node: 'k8s-worker-2', labels: { app: 'longhorn-manager' }, logs: ['Longhorn volume replicas healthy'] },
        { name: 'longhorn-driver-deployer-5c78f9d4-k2l9x', namespace: 'longhorn-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 490000, ip: '10.244.1.6', node: 'k8s-worker-1', labels: { app: 'longhorn-driver-deployer' }, logs: [] },
        { name: 'longhorn-ui-7f89d4c2-q8m3v', namespace: 'longhorn-system', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 490000, ip: '10.244.2.6', node: 'k8s-worker-2', labels: { app: 'longhorn-ui' }, logs: [] },

        // cert-manager
        { name: 'cert-manager-789dc4b59-r4k8p', namespace: 'cert-manager', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 480000, ip: '10.244.1.7', node: 'k8s-worker-1', labels: { app: 'cert-manager' }, logs: ['Issued certificate vault/vault-tls and boundary/boundary-tls via ClusterIssuer ca-issuer'] },
        { name: 'cert-manager-cainjector-56c789d4-m2n9x', namespace: 'cert-manager', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 480000, ip: '10.244.2.7', node: 'k8s-worker-2', labels: { app: 'cainjector' }, logs: [] },
        { name: 'cert-manager-webhook-64b89f7c-p9v2l', namespace: 'cert-manager', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 480000, ip: '10.244.1.8', node: 'k8s-worker-1', labels: { app: 'webhook' }, logs: [] },

        // vault
        { name: 'vault-0', namespace: 'vault', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 432000, ip: '10.244.1.12', node: 'k8s-worker-1', labels: { 'app.kubernetes.io/name': 'vault', 'vault-active': 'true' }, logs: ['Vault v1.17.6 started', 'raft: node vault-0 elected leader (term 3)', 'core: vault is unsealed'] },
        { name: 'vault-1', namespace: 'vault', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 432000, ip: '10.244.2.12', node: 'k8s-worker-2', labels: { 'app.kubernetes.io/name': 'vault', 'vault-active': 'false' }, logs: ['Vault v1.17.6 started', 'raft: following leader vault-0', 'core: vault is unsealed (standby)'] },
        { name: 'vault-2', namespace: 'vault', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 432000, ip: '10.244.1.13', node: 'k8s-worker-1', labels: { 'app.kubernetes.io/name': 'vault', 'vault-active': 'false' }, logs: ['Vault v1.17.6 started', 'raft: following leader vault-0', 'core: vault is unsealed (standby)'] },
        { name: 'k8s-auth-test', namespace: 'vault', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 360000, ip: '10.244.2.19', node: 'k8s-worker-2', labels: { app: 'k8s-auth-test' }, logs: ['ServiceAccount test-sa mounted at /var/run/secrets/kubernetes.io/serviceaccount/token'] },

        // boundary
        { name: 'postgres-0', namespace: 'boundary', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 410000, ip: '10.244.2.15', node: 'k8s-worker-2', labels: { app: 'postgres' }, logs: ['PostgreSQL 16.4 listening on 0.0.0.0:5432, database boundary ready'] },
        { name: 'boundary-db-init-8k2px', namespace: 'boundary', ready: '0/1', status: 'Completed', restarts: 0, ageSeconds: 409900, ip: '10.244.1.16', node: 'k8s-worker-1', labels: { app: 'boundary-db-init' }, logs: ['Migrations successfully run. Initial password auth method ampw_1a2b3c4d5e and admin user created.'] },
        { name: 'boundary-controller-7d9f8b6c5-x4k9p', namespace: 'boundary', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 409800, ip: '10.244.1.17', node: 'k8s-worker-1', labels: { app: 'boundary-controller' }, logs: ['Boundary controller 0.19.0 started', 'API listener bound on 0.0.0.0:9200 (TLS cert /tls/tls.crt)', 'Cluster listener bound on 0.0.0.0:9201', 'Connected to Vault credential store csvlt_vaultstore1 at https://10.10.0.201:8200'] },
        { name: 'boundary-worker-5c8d7f6b4-m9v2l', namespace: 'boundary', ready: '1/1', status: 'Running', restarts: 0, ageSeconds: 409700, ip: '10.244.2.18', node: 'k8s-worker-2', labels: { app: 'boundary-worker' }, logs: ['Boundary worker 0.19.0 started', 'Proxy listener bound on 0.0.0.0:9202', 'Authenticated to upstream controller boundary-controller.boundary.svc:9201 via KMS worker-auth'] }
      ],
      services: [
        { name: 'kubernetes', namespace: 'default', type: 'ClusterIP', clusterIp: '10.96.0.1', externalIp: '<none>', ports: '443/TCP', ageDays: 6 },
        { name: 'kube-dns', namespace: 'kube-system', type: 'ClusterIP', clusterIp: '10.96.0.10', externalIp: '<none>', ports: '53/UDP,53/TCP,9153/TCP', ageDays: 6 },
        { name: 'longhorn-backend', namespace: 'longhorn-system', type: 'ClusterIP', clusterIp: '10.96.44.12', externalIp: '<none>', ports: '9500/TCP', ageDays: 5 },
        { name: 'longhorn-frontend', namespace: 'longhorn-system', type: 'ClusterIP', clusterIp: '10.96.44.18', externalIp: '<none>', ports: '80/TCP', ageDays: 5 },
        { name: 'cert-manager', namespace: 'cert-manager', type: 'ClusterIP', clusterIp: '10.96.88.10', externalIp: '<none>', ports: '9402/TCP', ageDays: 5 },
        { name: 'vault', namespace: 'vault', type: 'LoadBalancer', clusterIp: '10.96.120.45', externalIp: '10.10.0.201', ports: '8200:31820/TCP,8201:31821/TCP', ageDays: 5 },
        { name: 'vault-internal', namespace: 'vault', type: 'ClusterIP', clusterIp: 'None', externalIp: '<none>', ports: '8200/TCP,8201/TCP', ageDays: 5 },
        { name: 'postgres', namespace: 'boundary', type: 'ClusterIP', clusterIp: '10.96.185.10', externalIp: '<none>', ports: '5432/TCP', ageDays: 4 },
        { name: 'boundary-controller', namespace: 'boundary', type: 'LoadBalancer', clusterIp: '10.96.185.20', externalIp: '10.10.0.202', ports: '9200:31920/TCP,9201:31921/TCP', ageDays: 4 },
        { name: 'boundary-worker', namespace: 'boundary', type: 'LoadBalancer', clusterIp: '10.96.185.21', externalIp: '10.10.0.203', ports: '9202:31922/TCP', ageDays: 4 }
      ],
      pvcs: [
        { name: 'data-vault-0', namespace: 'vault', status: 'Bound', volume: 'pvc-8f2a1c4d-0000', capacity: '10Gi', accessModes: 'RWO', storageClass: 'longhorn', ageDays: 5, replicaHealth: 'healthy' },
        { name: 'data-vault-1', namespace: 'vault', status: 'Bound', volume: 'pvc-8f2a1c4d-0001', capacity: '10Gi', accessModes: 'RWO', storageClass: 'longhorn', ageDays: 5, replicaHealth: 'healthy' },
        { name: 'data-vault-2', namespace: 'vault', status: 'Bound', volume: 'pvc-8f2a1c4d-0002', capacity: '10Gi', accessModes: 'RWO', storageClass: 'longhorn', ageDays: 5, replicaHealth: 'healthy' },
        { name: 'postgres-data-postgres-0', namespace: 'boundary', status: 'Bound', volume: 'pvc-9b3e7d1a-0003', capacity: '5Gi', accessModes: 'RWO', storageClass: 'longhorn', ageDays: 4, replicaHealth: 'healthy' }
      ],
      certificates: [
        {
          name: 'vault-tls',
          namespace: 'vault',
          ready: 'True',
          secretName: 'vault-tls',
          issuer: 'ca-issuer',
          ageDays: 5,
          dnsNames: ['vault', 'vault.vault', 'vault.vault.svc', 'vault.vault.svc.cluster.local', 'vault.yotta.lab', 'localhost'],
          ipAddresses: ['10.10.0.201', '127.0.0.1'],
          notAfter: '2027-02-15T08:00:00Z',
          statusMessage: 'Certificate is up to date and has not expired'
        },
        {
          name: 'boundary-tls',
          namespace: 'boundary',
          ready: 'True',
          secretName: 'boundary-tls',
          issuer: 'ca-issuer',
          ageDays: 4,
          dnsNames: ['boundary.yotta.lab', 'boundary-controller', 'boundary-controller.boundary.svc', 'boundary-controller.boundary.svc.cluster.local', 'boundary-worker', 'boundary-worker.boundary.svc'],
          ipAddresses: ['10.10.0.100', '10.10.0.202', '10.10.0.203'],
          notAfter: '2027-02-15T08:00:00Z',
          statusMessage: 'Certificate is up to date and has not expired'
        }
      ],
      configMaps: {
        'boundary/boundary-config': {
          'controller.hcl': `disable_mlock = true
controller {
  name = "kubernetes-controller"
  description = "Boundary controller in K8s"
  database { url = "env://BOUNDARY_PG_URL" }
  public_cluster_addr = "boundary-controller.boundary.svc:9201"
}
listener "tcp" { address="0.0.0.0" purpose="api"     tls_cert_file="/tls/tls.crt" tls_key_file="/tls/tls.key" }
listener "tcp" { address="0.0.0.0" purpose="cluster" tls_cert_file="/tls/tls.crt" tls_key_file="/tls/tls.key" }
kms "aead" { purpose="root"        aead_type="aes-gcm" key="…" key_id="global_root" }
kms "aead" { purpose="worker-auth" aead_type="aes-gcm" key="…" key_id="global_worker-auth" }
kms "aead" { purpose="recovery"    aead_type="aes-gcm" key="…" key_id="global_recovery" }`,
          'worker.hcl': `worker {
  name = "kubernetes-worker"
  public_addr = "boundary.yotta.lab:9202"
  initial_upstreams = ["boundary-controller.boundary.svc:9201"]
}
listener "tcp" { address="0.0.0.0:9202" purpose="proxy" }
kms "aead" { purpose="worker-auth" aead_type="aes-gcm" key="…" key_id="global_worker-auth" }`
        }
      },
      secrets: {
        'vault/vault-tls': { 'tls.crt': 'LS0tLS1CRUdJTi...', 'tls.key': 'LS0tLS1CRUdJTi...', 'ca.crt': 'LS0tLS1CRUdJTi...' },
        'boundary/boundary-tls': { 'tls.crt': 'LS0tLS1CRUdJTi...', 'tls.key': 'LS0tLS1CRUdJTi...', 'ca.crt': 'LS0tLS1CRUdJTi...' },
        'boundary/boundary-secrets': {
          POSTGRES_PASSWORD: 'Ym91bmRhcnktZGItcGFzc3dvcmQtMjAyNg==',
          BOUNDARY_PG_URL: 'cG9zdGdyZXNxbDovL2JvdW5kYXJ5OmJvdW5kYXJ5LWRiLXBhc3N3b3JkLTIwMjZAcG9zdGdyZXMuYm91bmRhcnkuc3ZjOjU0MzIvYm91bmRhcnk/c3NsbW9kZT1kaXNhYmxl'
        }
      },
      events: [
        { timestamp: now - 3600000, namespace: 'vault', object: 'Pod/vault-0', reason: 'Started', message: 'Started container vault (active leader)' },
        { timestamp: now - 3500000, namespace: 'boundary', object: 'Deployment/boundary-controller', reason: 'ScalingReplicaSet', message: 'Scaled up replica set boundary-controller-7d9f8b6c5 to 1' },
        { timestamp: now - 3400000, namespace: 'metallb-system', object: 'Service/vault', reason: 'IPAllocated', message: 'Assigned IP ["10.10.0.201"] from pool yotta-l2-pool' }
      ],
      helmReleases: [
        {
          name: 'vault',
          namespace: 'vault',
          revision: 1,
          updated: '2026-11-12 09:14:22.104912 +0530 IST',
          status: 'deployed',
          chart: 'vault-0.28.1',
          appVersion: '1.17.6',
          valuesYaml: REPO_FILES['security/vault/values.yaml']
        },
        {
          name: 'longhorn',
          namespace: 'longhorn-system',
          revision: 1,
          updated: '2026-11-12 08:42:10.441209 +0530 IST',
          status: 'deployed',
          chart: 'longhorn-1.7.1',
          appVersion: 'v1.7.1',
          valuesYaml: REPO_FILES['platform/longhorn/values.yaml']
        }
      ]
    },
    vault: {
      initialized: true,
      clusterId: '9f4a2c8e-1b7d-4e3a-8c5f-2d6e9a1b4c7d',
      clusterName: 'vault-cluster-e8a1b4c7',
      version: '1.17.6',
      raftIndex: 48210,
      unsealKeys: VAULT_SHAMIR_KEYS,
      unsealThreshold: 3,
      rootToken: VAULT_ROOT_TOKEN,
      nodes: {
        'vault-0': {
          nodeId: 'vault-0',
          address: 'vault-0.vault-internal:8201',
          state: 'leader',
          voter: true,
          sealed: false,
          unsealProgress: 3,
          unsealKeysProvided: []
        },
        'vault-1': {
          nodeId: 'vault-1',
          address: 'vault-1.vault-internal:8201',
          state: 'follower',
          voter: true,
          sealed: false,
          unsealProgress: 3,
          unsealKeysProvided: []
        },
        'vault-2': {
          nodeId: 'vault-2',
          address: 'vault-2.vault-internal:8201',
          state: 'follower',
          voter: true,
          sealed: false,
          unsealProgress: 3,
          unsealKeysProvided: []
        }
      },
      policies: {
        root: REPO_FILES['security/vault/policies/admin-policy.hcl'],
        default: 'path "auth/token/lookup-self" { capabilities = ["read"] }\npath "auth/token/renew-self" { capabilities = ["update"] }',
        'admin-policy': REPO_FILES['security/vault/policies/admin-policy.hcl'],
        'kv-read-policy': REPO_FILES['security/vault/policies/kv-read-policy.hcl'],
        'kv-write-policy': REPO_FILES['security/vault/policies/kv-write-policy.hcl'],


    // Continuation of src/sim/core/initialState.ts
        'boundary-controller-policy': REPO_FILES['security/vault/policies/boundary-controller-policy.hcl']
      },
      kvStore: {
        'test/demo': {
          version: 1,
          data: {
            username: 'workload-demo',
            api_key: 'k8s-jwt-verified-secret'
          },
          updatedAt: new Date(now - 3600000).toISOString()
        }
      },
      leases: {},
      tokens: {
        [VAULT_ROOT_TOKEN]: {
          token: VAULT_ROOT_TOKEN,
          displayName: 'root',
          policies: ['root'],
          issuedAt: now - 432000000,
          expiresAt: 0,
          orphan: true,
          renewable: false
        },
        [BOUNDARY_CRED_STORE_TOKEN]: {
          token: BOUNDARY_CRED_STORE_TOKEN,
          displayName: 'token-boundary-controller',
          policies: ['default', 'boundary-controller-policy'],
          issuedAt: now - 3600000,
          expiresAt: now + 82800000,
          periodSeconds: 86400,
          orphan: true,
          renewable: true
        }
      },
      k8sAuthEnabled: true,
      k8sAuthRoles: {
        'test-workload': {
          boundServiceAccountNames: ['test-sa'],
          boundServiceAccountNamespaces: ['vault'],
          policies: ['kv-read-policy'],
          ttl: '1h'
        }
      },
      auditEnabled: true,
      auditLogPath: '/vault/audit/vault_audit.log',
      revokedDbUsers: {}
    },
    boundary: {
      scopes: [
        { id: 'global', name: 'global', description: 'Global Scope', parentId: '', type: 'global' },
        { id: 'o_yottaorg01', name: 'Yotta-Org', description: 'Yotta Corporate Organization Scope', parentId: 'global', type: 'org' },
        { id: 'p_prodaccess', name: 'Production-Access', description: 'Production Infrastructure Targets', parentId: 'o_yottaorg01', type: 'project' }
      ],
      authMethods: [
        {
          id: 'ampw_1a2b3c4d5e',
          scopeId: 'global',
          name: 'Generated global scope initial password auth method',
          type: 'password'
        },
        {
          id: 'amldap_9fK2pQx7Lz',
          scopeId: 'o_yottaorg01',
          name: 'corporate-ldap',
          type: 'ldap',
          state: 'active-public',
          urls: ['ldaps://ldap.corp.yotta.lab:636'],
          userDn: 'ou=people,dc=corp,dc=yotta,dc=lab',
          groupDn: 'ou=groups,dc=corp,dc=yotta,dc=lab'
        }
      ],
      accounts: [
        { id: 'acctpw_admin00001', authMethodId: 'ampw_1a2b3c4d5e', loginName: 'admin', type: 'password' },
        { id: 'acctldap_alice0001', authMethodId: 'amldap_9fK2pQx7Lz', loginName: 'alice', type: 'ldap' },
        { id: 'acctldap_bob000002', authMethodId: 'amldap_9fK2pQx7Lz', loginName: 'bob', type: 'ldap' },
        { id: 'acctldap_mallory03', authMethodId: 'amldap_9fK2pQx7Lz', loginName: 'mallory', type: 'ldap' }
      ],
      users: [
        {
          id: 'u_admin00001',
          scopeId: 'global',
          name: 'admin',
          description: 'Initial administrative user',
          accountIds: ['acctpw_admin00001'],
          ldapGroups: []
        },
        {
          id: 'u_alice00001',
          scopeId: 'o_yottaorg01',
          name: 'alice',
          description: 'Alice Sharma (Engineering)',
          accountIds: ['acctldap_alice0001'],
          ldapGroups: ['eng-prod-access']
        },
        {
          id: 'u_bob0000002',
          scopeId: 'o_yottaorg01',
          name: 'bob',
          description: 'Bob Verma (Development)',
          accountIds: ['acctldap_bob000002'],
          ldapGroups: ['dev-access']
        },
        {
          id: 'u_mallory003',
          scopeId: 'o_yottaorg01',
          name: 'mallory',
          description: 'Mallory (HR - No Infrastructure Groups)',
          accountIds: ['acctldap_mallory03'],
          ldapGroups: []
        }
      ],
      managedGroups: [
        {
          id: 'mg_engprod01',
          authMethodId: 'amldap_9fK2pQx7Lz',
          name: 'mg-eng-prod',
          groupNames: ['eng-prod-access']
        },
        {
          id: 'mg_devaccess1',
          authMethodId: 'amldap_9fK2pQx7Lz',
          name: 'mg-dev',
          groupNames: ['dev-access']
        }
      ],
      roles: [
        {
          id: 'r_globaladmin',
          scopeId: 'global',
          name: 'Administration',
          description: 'Global administrator role',
          principalIds: ['u_admin00001'],
          grantStrings: ['ids=*;type=*;actions=*']
        },
        {
          id: 'r_engineers01',
          scopeId: 'p_prodaccess',
          name: 'engineers',
          description: 'Production Engineering Access (Jump Host, App Server, Prod DB)',
          principalIds: ['mg_engprod01'],
          grantStrings: [
            'ids=ttcp_jumphost01,ttcp_appserver1,ttcp_proddb0001;type=target;actions=read,authorize-session',
            'ids=*;type=target;actions=list',
            'ids=*;type=session;actions=list,read:self,cancel:self'
          ]
        },
        {
          id: 'r_developers1',
          scopeId: 'p_prodaccess',
          name: 'developers',
          description: 'Development Access (App Server Only)',
          principalIds: ['mg_devaccess1'],
          grantStrings: [
            'ids=ttcp_appserver1;type=target;actions=read,authorize-session',
            'ids=*;type=target;actions=list',
            'ids=*;type=session;actions=list,read:self,cancel:self'
          ]
        }
      ],
      hostCatalogs: [
        {
          id: 'hcst_prodcat01',
          scopeId: 'p_prodaccess',
          name: 'production-hosts',
          type: 'static'
        }
      ],
      hosts: [
        {
          id: 'hst_jumphost01',
          catalogId: 'hcst_prodcat01',
          name: 'jump-host',
          description: 'Jump Host Control Node',
          address: '10.10.0.30'
        },
        {
          id: 'hst_appserver1',
          catalogId: 'hcst_prodcat01',
          name: 'app-server-01',
          description: 'Production Application Server 01',
          address: '10.10.0.31'
        },
        {
          id: 'hst_proddb0001',
          catalogId: 'hcst_prodcat01',
          name: 'prod-db-01',
          description: 'Production PostgreSQL 16 Database Server',
          address: '10.10.0.32'
        }
      ],
      hostSets: [
        { id: 'hsst_jumphost01', catalogId: 'hcst_prodcat01', name: 'jump-host-set', hostIds: ['hst_jumphost01'] },
        { id: 'hsst_appserver1', catalogId: 'hcst_prodcat01', name: 'app-server-set', hostIds: ['hst_appserver1'] },
        { id: 'hsst_proddb0001', catalogId: 'hcst_prodcat01', name: 'prod-db-set', hostIds: ['hst_proddb0001'] }
      ],
      credentialStores: [
        {
          id: 'csvlt_vaultstore1',
          scopeId: 'p_prodaccess',
          name: 'vault-prod-store',
          vaultAddress: 'https://10.10.0.201:8200',
          vaultToken: BOUNDARY_CRED_STORE_TOKEN,
          caCertValid: true
        }
      ],
      credentialLibraries: [
        {
          id: 'clvlt_proddblib1',
          storeId: 'csvlt_vaultstore1',
          name: 'prod-db-library',
          vaultPath: 'database/creds/prod-db-ops',
          credentialType: 'username_password',
          httpMethod: 'GET'
        },
        {
          id: 'clvlt_sshotplib1',
          storeId: 'csvlt_vaultstore1',
          name: 'ssh-otp-library',
          vaultPath: 'ssh/creds/otp-ops',
          credentialType: 'username_password',
          httpMethod: 'POST'
        }
      ],
      targets: [
        {
          id: 'ttcp_jumphost01',
          scopeId: 'p_prodaccess',
          name: 'jump-host-ssh',
          description: 'Jump host (SSH)',
          type: 'tcp',
          defaultPort: 22,
          sessionMaxSeconds: 900,
          hostSetIds: ['hsst_jumphost01'],
          brokeredCredentialSourceIds: ['clvlt_sshotplib1']
        },
        {
          id: 'ttcp_appserver1',
          scopeId: 'p_prodaccess',
          name: 'app-server-01',
          description: 'Application Server 01 (SSH - 120s Window)',
          type: 'tcp',
          defaultPort: 22,
          sessionMaxSeconds: 120,
          hostSetIds: ['hsst_appserver1'],
          brokeredCredentialSourceIds: ['clvlt_sshotplib1']
        },
        {
          id: 'ttcp_proddb0001',
          scopeId: 'p_prodaccess',
          name: 'production-db',
          description: 'Production PostgreSQL Database (TCP 5432)',
          type: 'tcp',
          defaultPort: 5432,
          sessionMaxSeconds: 600,
          hostSetIds: ['hsst_proddb0001'],
          brokeredCredentialSourceIds: ['clvlt_proddblib1']
        }
      ],
      authTokens: {},
      latestTokenByWindow: {
        admin: '',
        employee: ''
      },
      sessions: {}
    },
    postgresAppDb: {
      customersCount: 200,
      ordersCount: 1000,
      sampleCustomers: [
        { id: 1, name: 'Aarav Mehta', email: 'aarav.mehta@enterprise.in', tier: 'ENTERPRISE', created_at: '2026-01-14 09:21:10+05:30' },
        { id: 2, name: 'Diya Nair', email: 'diya.nair@fintech.io', tier: 'PLATINUM', created_at: '2026-02-03 14:11:45+05:30' },
        { id: 3, name: 'Rohan Kulkarni', email: 'rkulkarni@cloudops.org', tier: 'GOLD', created_at: '2026-03-19 11:05:32+05:30' },
        { id: 4, name: 'Ananya Iyer', email: 'ananya@neuralworks.ai', tier: 'ENTERPRISE', created_at: '2026-04-28 17:49:02+05:30' },
        { id: 5, name: 'Kabir Singhania', email: 'kabir@retailcore.co.in', tier: 'SILVER', created_at: '2026-05-11 08:30:19+05:30' }
      ],
      sampleOrders: [
        { order_id: 1001, customer_id: 1, amount_usd: '4850.00', status: 'SETTLED', ordered_at: '2026-11-15 10:12:04+05:30' },
        { order_id: 1002, customer_id: 2, amount_usd: '1290.50', status: 'SETTLED', ordered_at: '2026-11-15 11:44:21+05:30' },
        { order_id: 1003, customer_id: 4, amount_usd: '9400.00', status: 'PROCESSING', ordered_at: '2026-11-16 09:05:18+05:30' },
        { order_id: 1004, customer_id: 3, amount_usd: '620.00', status: 'SETTLED', ordered_at: '2026-11-16 15:32:50+05:30' },
        { order_id: 1005, customer_id: 1, amount_usd: '3100.75', status: 'SETTLED', ordered_at: '2026-11-17 08:19:11+05:30' }
      ],
      activeRoles: [
        { rolname: 'postgres', rolvaliduntil: 'infinity', memberof: [] },
        { rolname: 'vault_admin', rolvaliduntil: 'infinity', memberof: [] },
        { rolname: 'app_ops', rolvaliduntil: 'infinity', memberof: [] }
      ]
    },
    backendLogs: [
      {
        id: 'log_init_1',
        timestampMs: now - 3000,
        timeFormatted: formatTimeMs(now - 3000),
        component: 'k8s',
        podOrHost: 'kube-apiserver-k8s-master-1',
        message: 'HA control plane healthy on VIP 10.10.0.100:6443 (3/3 masters Ready, 2/2 workers Ready)'
      },
      {
        id: 'log_init_2',
        timestampMs: now - 2000,
        timeFormatted: formatTimeMs(now - 2000),
        component: 'vault',
        podOrHost: 'vault/vault-0',
        message: 'Raft cluster active leader=vault-0, followers=[vault-1, vault-2], index=48210, unsealed=true'
      },
      {
        id: 'log_init_3',
        timestampMs: now - 1000,
        timeFormatted: formatTimeMs(now - 1000),
        component: 'boundary',
        podOrHost: 'boundary-controller',
        message: 'Controller & Worker ready (VIP 10.10.0.100:9200/:9202 -> MetalLB .202/.203); Vault credential store csvlt_vaultstore1 active'
      }
    ]
  };
}
