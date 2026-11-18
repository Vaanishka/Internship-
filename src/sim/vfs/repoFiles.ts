// src/sim/vfs/repoFiles.ts

export const REPO_BASE_PATH = '/home/admin/secure-access-platform';

export const REPO_FILES: Record<string, string> = {
  'README.md': `# Secure Access Platform (HA Kubernetes + HashiCorp Vault + HashiCorp Boundary)

Production-grade identity-aware zero-trust access platform with dynamic ephemeral credentials.

## Architecture Summary
- **Control Plane VIP**: \`10.10.0.100\` (HAProxy + Keepalived across \`haproxy-1\` \`10.10.0.5\` & \`haproxy-2\` \`10.10.0.6\`)
- **Kubernetes Nodes**: 3 Masters (\`10.10.0.11..13\`), 2 Workers (\`10.10.0.21..22\`), v1.34.1 + Calico CNI
- **MetalLB L2 Pool**: \`10.10.0.200-10.10.0.220\`
  - Vault HA (3-pod Raft + Longhorn PVCs + cert-manager TLS): \`10.10.0.201:8200\`
  - Boundary Controller Service: \`10.10.0.202:9200\` (proxied via VIP \`boundary.yotta.lab:9200\`)
  - Boundary Worker Service: \`10.10.0.203:9202\` (proxied via VIP \`boundary.yotta.lab:9202\`)
- **Protected Targets**:
  - \`jump-host-ssh\` (\`10.10.0.30:22\`) — Vault SSH OTP (\`ssh/creds/otp-ops\`)
  - \`app-server-01\` (\`10.10.0.31:22\`) — Vault SSH OTP (\`ssh/creds/otp-ops\`, 120s session window)
  - \`production-db\` (\`10.10.0.32:5432\`) — Vault Dynamic PostgreSQL (\`database/creds/prod-db-ops\`)
`,

  'ansible/ansible.cfg': `[defaults]
inventory = inventory/hosts.ini
remote_user = admin
host_key_checking = False
retry_files_enabled = False
gathering = smart
forks = 10
stdout_callback = default

[privilege_escalation]
become = True
become_method = sudo
become_user = root
become_ask_pass = False
`,

  'ansible/inventory/hosts.ini': `[masters]
k8s-master-1 ansible_host=10.10.0.11
k8s-master-2 ansible_host=10.10.0.12
k8s-master-3 ansible_host=10.10.0.13

[workers]
k8s-worker-1 ansible_host=10.10.0.21
k8s-worker-2 ansible_host=10.10.0.22

[k8s_cluster:children]
masters
workers

[haproxy]
haproxy-1 ansible_host=10.10.0.5
haproxy-2 ansible_host=10.10.0.6

[jump]
jump-host ansible_host=10.10.0.30

[all:vars]
ansible_python_interpreter=/usr/bin/python3
`,

  'ansible/group_vars/all.yml': `---
admin_users:
  - name: admin
    groups: sudo
    shell: /bin/bash

common_packages:
  - apt-transport-https
  - ca-certificates
  - curl
  - gnupg
  - lsb-release
  - socat
  - conntrack
  - ipset
  - open-iscsi
  - nfs-common

kube_version: "1.34.1-1.1"
pod_cidr: "10.244.0.0/16"
service_cidr: "10.96.0.0/12"
control_plane_vip: "10.10.0.100"
control_plane_port: 6443
metallb_pool_range: "10.10.0.200-10.10.0.220"

containerd_systemd_cgroup: true
`,

  'ansible/host_vars/haproxy-1.yml': `---
keepalived_state: MASTER
keepalived_priority: 101
keepalived_interface: eth0
`,

  'ansible/host_vars/haproxy-2.yml': `---
keepalived_state: BACKUP
keepalived_priority: 100
keepalived_interface: eth0
`,

  'ansible/site.yml': `---
- name: Apply baseline user and OS configuration across all infrastructure nodes
  hosts: all
  become: true
  roles:
    - role: users
      tags: [users]
    - role: common
      tags: [common]

- name: Configure containerd and Kubernetes packages on cluster nodes
  hosts: k8s_cluster
  become: true
  roles:
    - role: containerd
      tags: [containerd]
    - role: kubernetes
      tags: [kubernetes]

- name: Configure HAProxy and Keepalived load balancers
  hosts: haproxy
  become: true
  roles:
    - role: haproxy_keepalived
      tags: [haproxy, keepalived]
`,

  'ansible/roles/users/tasks/main.yml': `---
- name: Ensure admin group exists
  ansible.builtin.group:
    name: admin
    state: present

- name: Ensure administrative users are present with passwordless sudo
  ansible.builtin.user:
    name: "{{ item.name }}"
    groups: "{{ item.groups }}"
    shell: "{{ item.shell }}"
    append: true
    create_home: true
    state: present
  loop: "{{ admin_users }}"

- name: Configure passwordless sudo for admin users
  ansible.builtin.copy:
    dest: /etc/sudoers.d/90-admin-users
    content: "%sudo ALL=(ALL) NOPASSWD:ALL\\n"
    mode: "0440"
    validate: "visudo -cf %s"
`,

  'ansible/roles/common/tasks/main.yml': `---
- name: Remove swapfile from /etc/fstab declaratively
  ansible.builtin.lineinfile:
    path: /etc/fstab
    regexp: '^.*\\sswap\\s+.*$'
    state: absent
  notify: Disable active swap

- name: Ensure required kernel modules configuration file exists
  ansible.builtin.copy:
    dest: /etc/modules-load.d/k8s.conf
    content: |
      overlay
      br_netfilter
    mode: "0644"

- name: Load overlay and br_netfilter kernel modules
  community.general.modprobe:
    name: "{{ item }}"
    state: present
  loop:
    - overlay
    - br_netfilter

- name: Configure Kubernetes networking sysctl parameters
  ansible.posix.sysctl:
    name: "{{ item.key }}"
    value: "{{ item.value }}"
    sysctl_file: /etc/sysctl.d/k8s.conf
    state: present
    reload: true
  loop:
    - { key: "net.bridge.bridge-nf-call-iptables", value: "1" }
    - { key: "net.bridge.bridge-nf-call-ip6tables", value: "1" }
    - { key: "net.ipv4.ip_forward", value: "1" }

- name: Install required baseline OS and Longhorn prerequisite packages
  ansible.builtin.apt:
    name: "{{ common_packages }}"
    state: present
    update_cache: true

- name: Ensure iscsid service is enabled and running for Longhorn
  ansible.builtin.systemd:
    name: iscsid
    enabled: true
    state: started
`,

  'ansible/roles/common/handlers/main.yml': `---
- name: Disable active swap
  ansible.builtin.command: swapoff -a
  changed_when: true
`,

  'ansible/roles/containerd/tasks/main.yml': `---
- name: Install containerd runtime package
  ansible.builtin.apt:
    name: containerd.io
    state: present

- name: Ensure /etc/containerd directory exists
  ansible.builtin.file:
    path: /etc/containerd
    state: directory
    mode: "0755"

- name: Deploy containerd configuration with SystemdCgroup enabled
  ansible.builtin.template:
    src: config.toml.j2
    dest: /etc/containerd/config.toml
    mode: "0644"
  notify: Restart containerd

- name: Ensure containerd service is enabled and started
  ansible.builtin.systemd:
    name: containerd
    enabled: true
    state: started
`,

  'ansible/roles/containerd/handlers/main.yml': `---
- name: Restart containerd
  ansible.builtin.systemd:
    name: containerd
    state: restarted
    daemon_reload: true
`,

  'ansible/roles/containerd/templates/config.toml.j2': `version = 2
[plugins]
  [plugins."io.containerd.grpc.v1.cri"]
    sandbox_image = "registry.k8s.io/pause:3.10"
    [plugins."io.containerd.grpc.v1.cri".containerd]
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes]
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
          runtime_type = "io.containerd.runc.v2"
          [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
            SystemdCgroup = {{ containerd_systemd_cgroup | lower }}
`,

  'ansible/roles/kubernetes/tasks/main.yml': `---
- name: Add Kubernetes apt repository keyring
  ansible.builtin.apt_key:
    url: https://pkgs.k8s.io/core:/stable:/v1.34/deb/Release.key
    keyring: /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    state: present

- name: Add Kubernetes v1.34 apt repository
  ansible.builtin.apt_repository:
    repo: "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.34/deb/ /"
    filename: kubernetes
    state: present

- name: Install pinned kubelet, kubeadm, and kubectl packages
  ansible.builtin.apt:
    name:
      - "kubelet={{ kube_version }}"
      - "kubeadm={{ kube_version }}"
      - "kubectl={{ kube_version }}"
    state: present
    update_cache: true

- name: Hold kubelet, kubeadm, and kubectl versions
  ansible.builtin.dpkg_selections:
    name: "{{ item }}"
    selection: hold
  loop:
    - kubelet
    - kubeadm
    - kubectl

- name: Enable kubelet service
  ansible.builtin.systemd:
    name: kubelet
    enabled: true
`,

  'ansible/roles/kubernetes/handlers/main.yml': `---
- name: Restart kubelet
  ansible.builtin.systemd:
    name: kubelet
    state: restarted
    daemon_reload: true
`,

  'ansible/roles/haproxy_keepalived/tasks/main.yml': `---
- name: Enable net.ipv4.ip_nonlocal_bind for VIP binding
  ansible.posix.sysctl:
    name: net.ipv4.ip_nonlocal_bind
    value: "1"
    state: present
    reload: true

- name: Install haproxy and keepalived packages
  ansible.builtin.apt:
    name:
      - haproxy
      - keepalived
    state: present

- name: Render /etc/keepalived/keepalived.conf
  ansible.builtin.template:
    src: keepalived.conf.j2
    dest: /etc/keepalived/keepalived.conf
    mode: "0644"
  notify: Restart keepalived

- name: Render /etc/haproxy/haproxy.cfg
  ansible.builtin.template:
    src: haproxy.cfg.j2
    dest: /etc/haproxy/haproxy.cfg
    mode: "0644"
    validate: "haproxy -c -f %s"
  notify: Reload haproxy

- name: Ensure keepalived and haproxy are enabled and running
  ansible.builtin.systemd:
    name: "{{ item }}"
    enabled: true
    state: started
  loop:
    - keepalived
    - haproxy
`,

  'ansible/roles/haproxy_keepalived/handlers/main.yml': `---
- name: Restart keepalived
  ansible.builtin.systemd:
    name: keepalived
    state: restarted

- name: Reload haproxy
  ansible.builtin.systemd:
    name: haproxy
    state: reloaded
`,

  'ansible/roles/haproxy_keepalived/templates/haproxy.cfg.j2': `global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

defaults
    log     global
    mode    tcp
    option  tcplog
    option  dontlognull
    retries 3
    timeout connect 5000ms
    timeout client  50000ms
    timeout server  50000ms

frontend fe_k8s_api
    bind {{ control_plane_vip }}:{{ control_plane_port }}
    mode tcp
    default_backend be_k8s_api

backend be_k8s_api
    mode tcp
    balance roundrobin
    option tcp-check
    server k8s-master-1 10.10.0.11:6443 check fall 3 rise 2
    server k8s-master-2 10.10.0.12:6443 check fall 3 rise 2
    server k8s-master-3 10.10.0.13:6443 check fall 3 rise 2

frontend fe_boundary_api
    bind {{ control_plane_vip }}:9200
    mode tcp
    default_backend be_boundary_api

backend be_boundary_api
    mode tcp
    balance roundrobin
    server metallb-202 10.10.0.202:9200 check fall 3 rise 2

frontend fe_boundary_worker
    bind {{ control_plane_vip }}:9202
    mode tcp
    default_backend be_boundary_worker

backend be_boundary_worker
    mode tcp
    balance roundrobin
    server metallb-203 10.10.0.203:9202 check fall 3 rise 2
`,

  'ansible/roles/haproxy_keepalived/templates/keepalived.conf.j2': `global_defs {
    router_id LVS_K8S_VIP
    enable_script_security
}

vrrp_script chk_haproxy {
    script "/usr/bin/killall -0 haproxy"
    interval 2
    weight 2
}

vrrp_instance VI_1 {
    state {{ keepalived_state }}
    interface {{ keepalived_interface }}
    virtual_router_id 51
    priority {{ keepalived_priority }}
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass YottaVrrp2026
    }
    virtual_ipaddress {
        {{ control_plane_vip }}/24
    }
    track_script {
        chk_haproxy
    }
}
`,

  'platform/kubeadm/kubeadm-config.yaml': `apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: v1.34.1
controlPlaneEndpoint: "10.10.0.100:6443"
networking:
  podSubnet: "10.244.0.0/16"
  serviceSubnet: "10.96.0.0/12"
  dnsDomain: "cluster.local"
apiServer:
  certSANs:
    - "10.10.0.100"
    - "10.10.0.11"
    - "10.10.0.12"
    - "10.10.0.13"
    - "k8s-api.yotta.lab"
etcd:
  local:
    dataDir: /var/lib/etcd
---
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cgroupDriver: systemd
`,

  'platform/kubeadm/join-notes.md': `# Kubeadm Control-Plane & Worker Join Procedure (§4.4.2)

1. Initialize first control-plane node (\`k8s-master-1\`):
   \`\`\`bash
   sudo kubeadm init --config=platform/kubeadm/kubeadm-config.yaml --upload-certs
   \`\`\`
`,

  'platform/calico/custom-resources.yaml': `apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    ipPools:
      - blockSize: 26
        cidr: 10.244.0.0/16
        encapsulation: VXLANCrossSubnet
        natOutgoing: Enabled
        nodeSelector: all()
---
apiVersion: operator.tigera.io/v1
kind: APIServer
metadata:
  name: default
spec: {}
`,

  'platform/metallb/namespace.yaml': `apiVersion: v1
kind: Namespace
metadata:
  name: metallb-system
`,

  'platform/metallb/ip-address-pool.yaml': `apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: yotta-l2-pool
  namespace: metallb-system
spec:
  addresses:
    - 10.10.0.200-10.10.0.220
`,

  'platform/metallb/l2-advertisement.yaml': `apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: yotta-l2-adv
  namespace: metallb-system
spec:
  ipAddressPools:
    - yotta-l2-pool
`,

  'platform/longhorn/values.yaml': `persistence:
  defaultClass: true
  defaultClassReplicaCount: 2
  reclaimPolicy: Delete
defaultSettings:
  defaultDataPath: "/var/lib/longhorn"
  defaultReplicaCount: 2
`,

  'platform/longhorn/storageclass.yaml': `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: longhorn
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: driver.longhorn.io
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: Immediate
parameters:
  numberOfReplicas: "2"
`,

  'platform/cert-manager/ca-secret-notes.md': `# Internal Platform Root CA Secret Setup
The platform internal Root CA keypair is stored in \`cert-manager/ca-key-pair\` and referenced by \`ClusterIssuer/ca-issuer\`.
`,

  'platform/cert-manager/cluster-issuer.yaml': `apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: ca-issuer
spec:
  ca:
    secretName: ca-key-pair
`,

  'platform/cert-manager/vault-certificate.yaml': `apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: vault-tls
  namespace: vault
spec:
  secretName: vault-tls
  duration: 2160h
  renewBefore: 360h
  commonName: vault.yotta.lab
  dnsNames:
    - vault
    - vault.vault
    - vault.vault.svc
    - vault.vault.svc.cluster.local
    - vault.yotta.lab
    - localhost
  ipAddresses:
    - 10.10.0.201
    - 127.0.0.1
  issuerRef:
    name: ca-issuer
    kind: ClusterIssuer
`,

  'platform/cert-manager/boundary-certificate.yaml': `apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: boundary-tls
  namespace: boundary
spec:
  secretName: boundary-tls
  duration: 2160h
  renewBefore: 360h
  commonName: boundary.yotta.lab
  dnsNames:
    - boundary.yotta.lab
    - boundary-controller
    - boundary-controller.boundary.svc
    - boundary-controller.boundary.svc.cluster.local
    - boundary-worker
    - boundary-worker.boundary.svc
  ipAddresses:
    - 10.10.0.100
    - 10.10.0.202
    - 10.10.0.203
  issuerRef:
    name: ca-issuer
    kind: ClusterIssuer
`,

  'security/vault/values.yaml': `global:
  enabled: true
  tlsDisable: false
injector:
  enabled: false
server:
  dataStorage:
    enabled: true
    size: 10Gi
    storageClass: longhorn
  ha:
    enabled: true
    replicas: 3
    raft:
      enabled: true
      setNodeId: true
  service:
    enabled: true
    type: LoadBalancer
    loadBalancerIP: 10.10.0.201
ui:
  enabled: true
`,

  'security/vault/policies/admin-policy.hcl': `path "*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}
`,

  'security/vault/policies/kv-read-policy.hcl': `path "secret/data/test/*" {
  capabilities = ["read", "list"]
}
path "secret/metadata/test/*" {
  capabilities = ["read", "list"]
}
`,

  'security/vault/policies/kv-write-policy.hcl': `path "secret/data/test/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "secret/metadata/test/*" {
  capabilities = ["read", "list", "delete"]
}
`,

  'security/vault/policies/boundary-controller-policy.hcl': `path "auth/token/lookup-self"  { capabilities = ["read"] }
path "auth/token/renew-self"   { capabilities = ["update"] }
path "auth/token/revoke-self"  { capabilities = ["update"] }
path "sys/leases/renew"        { capabilities = ["update"] }
path "sys/leases/revoke"       { capabilities = ["update"] }
path "sys/capabilities-self"   { capabilities = ["update"] }
path "database/creds/prod-db-ops" { capabilities = ["read"] }
path "ssh/creds/otp-ops"          { capabilities = ["update"] }
`,

  'security/vault/configure-vault.sh': `#!/usr/bin/env bash
set -euo pipefail
vault policy write admin-policy security/vault/policies/admin-policy.hcl
vault policy write kv-read-policy security/vault/policies/kv-read-policy.hcl
vault policy write kv-write-policy security/vault/policies/kv-write-policy.hcl
vault policy write boundary-controller-policy security/vault/policies/boundary-controller-policy.hcl
vault kv put secret/test/demo username="workload-demo" api_key="k8s-jwt-verified-secret"
echo "Success! Vault dynamic secrets & policies configured."
`,

  'security/vault/k8s-test-workload.yaml': `apiVersion: v1
kind: ServiceAccount
metadata:
  name: test-sa
  namespace: vault
---
apiVersion: v1
kind: Pod
metadata:
  name: k8s-auth-test
  namespace: vault
spec:
  serviceAccountName: test-sa
  containers:
    - name: tester
      image: curlimages/curl:8.10.1
      command: ["sleep", "3600"]
`,

  'security/boundary/00-namespace.yaml': `apiVersion: v1
kind: Namespace
metadata:
  name: boundary
`,

  'security/boundary/01-secret.yaml': `apiVersion: v1
kind: Secret
metadata:
  name: boundary-secrets
  namespace: boundary
type: Opaque
data:
  POSTGRES_PASSWORD: Ym91bmRhcnktZGItcGFzc3dvcmQtMjAyNg==
`,

  'security/boundary/02-configmap.yaml': `apiVersion: v1
kind: ConfigMap
metadata:
  name: boundary-config
  namespace: boundary
data:
  controller.hcl: |
    disable_mlock = true
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
    kms "aead" { purpose="recovery"    aead_type="aes-gcm" key="…" key_id="global_recovery" }
  worker.hcl: |
    worker {
      name = "kubernetes-worker"
      public_addr = "boundary.yotta.lab:9202"
      initial_upstreams = ["boundary-controller.boundary.svc:9201"]
    }
    listener "tcp" { address="0.0.0.0:9202" purpose="proxy" }
    kms "aead" { purpose="worker-auth" aead_type="aes-gcm" key="…" key_id="global_worker-auth" }
`,

  'security/boundary/03-postgres.yaml': `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: boundary
spec:
  serviceName: postgres
  replicas: 1
`,

  'security/boundary/04-db-init-job.yaml': `apiVersion: batch/v1
kind: Job
metadata:
  name: boundary-db-init
  namespace: boundary
`,

  'security/boundary/05-controller.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: boundary-controller
  namespace: boundary
spec:
  replicas: 1
`,

  'security/boundary/06-worker.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: boundary-worker
  namespace: boundary
spec:
  replicas: 1
`,

  'security/boundary/07-certificate.yaml': `apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: boundary-tls
  namespace: boundary
spec:
  secretName: boundary-tls
  ipAddresses:
    - 10.10.0.100
    - 10.10.0.202
    - 10.10.0.203
`,

  'security/boundary/configure-boundary.sh': `#!/usr/bin/env bash
set -euo pipefail
boundary scopes list -scope-id=global
boundary auth-methods list -scope-id=o_yottaorg01
boundary roles list -scope-id=p_prodaccess
boundary host-catalogs list -scope-id=p_prodaccess
boundary credential-stores list -scope-id=p_prodaccess
boundary credential-libraries list -credential-store-id=csvlt_vaultstore1
boundary targets list -scope-id=p_prodaccess
echo "Success! Boundary zero-trust targets and Vault credential brokering configured."
`,

  'targets/prod-db-01/vault-db-setup.sql': `CREATE ROLE vault_admin WITH LOGIN SUPERUSER CREATEDB CREATEROLE PASSWORD 'VaultDbAdmin#2026';
CREATE ROLE app_ops NOLOGIN;
`,

  'targets/ssh-targets/sshd-otp-pam.md': `# Vault SSH OTP PAM Configuration on Target Hosts
auth requisite pam_exec.so quiet expose_authtok log=/var/log/vault-ssh.log /usr/local/bin/vault-ssh-helper -config=/etc/vault-ssh-helper.d/config.hcl
`,

  'targets/ssh-targets/vault-ssh-helper.hcl': `vault_addr = "https://10.10.0.201:8200"
ssh_mount_point = "ssh"
ca_cert = "/etc/ssl/certs/yotta-ca.crt"
tls_skip_verify = false
allowed_roles = "otp-ops"
allowed_cidr_list = "10.10.0.30/32,10.10.0.31/32"
`,

  'scripts/bootstrap-cluster.sh': `#!/usr/bin/env bash
set -euo pipefail
ansible-playbook -i ansible/inventory/hosts.ini ansible/site.yml
kubectl get nodes -o wide
kubectl get pods -A
echo "Cluster bootstrap verification complete."
`,

  'scripts/health-check.sh': `#!/usr/bin/env bash
set -euo pipefail
echo "=================================================================="
echo " SECURE ACCESS PLATFORM - AUTOMATED HEALTH & ACCEPTANCE CHECK"
echo "=================================================================="
kubectl get nodes -o wide
kubectl get pods -A
kubectl get pvc -A
kubectl get svc -A
kubectl get certificate -A
kubectl exec -n vault vault-0 -- vault status
kubectl exec -n vault vault-0 -- vault operator raft list-peers
echo "=================================================================="
echo " RESULT: ALL PLATFORM HEALTH CHECKS PASSED [OK]"
echo "=================================================================="
`,

  'scripts/failover-tests.sh': `#!/usr/bin/env bash
echo "Failover test reference procedures listed. Run commands individually to demonstrate HA."
`
};