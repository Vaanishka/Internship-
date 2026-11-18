// src/sim/core/types.ts

export type WindowRole = 'admin' | 'employee' | 'backend';

export type HostId =
  | 'VAANISHKA-LT'
  | 'YOTTA-LT-4471'
  | 'jump-host'
  | 'k8s-master-1'
  | 'k8s-master-2'
  | 'k8s-master-3'
  | 'k8s-worker-1'
  | 'k8s-worker-2'
  | 'haproxy-1'
  | 'haproxy-2'
  | 'app-server-01'
  | 'prod-db-01'
  | 'ldap.corp.yotta.lab';

export type BackendComponent =
  | 'vault'
  | 'boundary'
  | 'haproxy'
  | 'k8s'
  | 'postgres'
  | 'longhorn'
  | 'metallb'
  | 'cert-manager'
  | 'ldap';

export type FlowStepBanner =
  | '══════════ STEP 1/5 · IDENTITY AUTHENTICATION  (User → Boundary Controller) ══════════'
  | '══════════ STEP 2/5 · TARGET SELECTION & CREDENTIAL REQUEST  (Boundary → Vault) ══════════'
  | '══════════ STEP 3/5 · DYNAMIC SECRET GENERATION  (Vault) ══════════'
  | '══════════ STEP 4/5 · ENCRYPTED SESSION BROKERING  (Boundary Worker → Target) ══════════'
  | '══════════ STEP 5/5 · SESSION TERMINATION & AUTO-REVOCATION ══════════';

export interface BackendLogEntry {
  id: string;
  timestampMs: number;
  timeFormatted: string; // HH:MM:SS.mmm
  component: BackendComponent;
  podOrHost: string;     // e.g. "vault/vault-0", "boundary-controller", "haproxy-1"
  message: string;
  banner?: FlowStepBanner;
  isError?: boolean;
}

export interface VfsNode {
  type: 'file' | 'dir';
  content?: string;
  mode?: string;         // e.g. '0600', '0755'
  owner?: string;
  modifiedAt: number;
}

export interface HostMachineState {
  id: HostId;
  hostname: string;
  os: 'windows' | 'ubuntu' | 'openldap';
  ip: string;
  poweredOn: boolean;
  poweredOffAt?: number;
  services: Record<string, 'active' | 'inactive' | 'failed'>;
  sysctl: Record<string, string>;
  swapEnabled: boolean;
  modulesLoaded: string[];
  files: Record<string, VfsNode>; // Full path -> VfsNode
  journal: Record<string, string[]>;
}

export interface K8sNode {
  name: string;
  status: 'Ready' | 'NotReady';
  roles: string;
  ageDays: number;
  version: string;
  internalIp: string;
  osImage: string;
  kernelVersion: string;
  containerRuntime: string;
  notReadySince?: number;
}

export interface K8sPod {
  name: string;
  namespace: string;
  ready: string;          // e.g. "1/1", "0/1"
  status: 'Running' | 'Completed' | 'Pending' | 'CrashLoopBackOff' | 'Terminating';
  restarts: number;
  ageSeconds: number;
  ip: string;
  node: string;
  labels: Record<string, string>;
  logs: string[];
  deletedAt?: number;
}

export interface K8sService {
  name: string;
  namespace: string;
  type: 'ClusterIP' | 'LoadBalancer';
  clusterIp: string;
  externalIp: string;     // e.g. "10.10.0.201" or "<none>" or "<pending>"
  ports: string;
  ageDays: number;
}

export interface K8sPVC {
  name: string;
  namespace: string;
  status: 'Bound' | 'Pending' | 'Lost';
  volume: string;
  capacity: string;
  accessModes: string;
  storageClass: string;
  ageDays: number;
  replicaHealth?: 'healthy' | 'degraded';
}

export interface K8sCertificate {
  name: string;
  namespace: string;
  ready: 'True' | 'False';
  secretName: string;
  issuer: string;
  ageDays: number;
  dnsNames: string[];
  ipAddresses: string[];
  notAfter: string;
  statusMessage: string;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: number;
  updated: string;
  status: 'deployed' | 'failed';
  chart: string;
  appVersion: string;
  valuesYaml: string;
}

export interface VaultRaftNode {
  nodeId: 'vault-0' | 'vault-1' | 'vault-2';
  address: string;
  state: 'leader' | 'follower';
  voter: boolean;
  sealed: boolean;
  unsealProgress: number; // 0..3
  unsealKeysProvided: string[];
}

export interface VaultLease {
  leaseId: string;
  path: string;            // "database/creds/prod-db-ops" | "ssh/creds/otp-ops"
  issuedAt: number;
  expiresAt: number;
  maxExpiresAt: number;
  ttlSeconds: number;
  maxTtlSeconds: number;
  renewable: boolean;
  username: string;
  secretValue: string;     // password or OTP
  targetHost: string;
  boundarySessionId?: string;
}

export interface VaultTokenEntry {
  token: string;
  displayName: string;
  policies: string[];
  issuedAt: number;
  expiresAt: number;       // 0 = never (root)
  periodSeconds?: number;
  orphan: boolean;
  renewable: boolean;
  revoked?: boolean;
}

export interface VaultState {
  initialized: boolean;
  clusterId: string;
  clusterName: string;
  version: string;
  raftIndex: number;
  unsealKeys: string[];    // 5 keys
  unsealThreshold: number; // 3
  rootToken: string;
  nodes: Record<'vault-0' | 'vault-1' | 'vault-2', VaultRaftNode>;
  policies: Record<string, string>; // policyName -> HCL content
  kvStore: Record<string, { version: number; data: Record<string, string>; updatedAt: string }>;
  leases: Record<string, VaultLease>;
  tokens: Record<string, VaultTokenEntry>;
  k8sAuthEnabled: boolean;
  k8sAuthRoles: Record<string, {
    boundServiceAccountNames: string[];
    boundServiceAccountNamespaces: string[];
    policies: string[];
    ttl: string;
  }>;
  auditEnabled: boolean;
  auditLogPath: string;
  revokedDbUsers: Record<string, string>; // username -> old password (to detect replay)
}

export interface BoundaryScope {
  id: string;
  name: string;
  description: string;
  parentId: string;
  type: 'global' | 'org' | 'project';
}

export interface BoundaryAuthMethod {
  id: string;
  scopeId: string;
  name: string;
  type: 'password' | 'ldap';
  state?: 'active-public' | 'inactive';
  urls?: string[];
  userDn?: string;
  groupDn?: string;
}

export interface BoundaryAccount {
  id: string;
  authMethodId: string;
  loginName: string;
  type: 'password' | 'ldap';
}

export interface BoundaryUser {
  id: string;
  scopeId: string;
  name: string;
  description: string;
  accountIds: string[];
  ldapGroups: string[];
}

export interface BoundaryManagedGroup {
  id: string;
  authMethodId: string;
  name: string;
  groupNames: string[];
}

export interface BoundaryRole {
  id: string;
  scopeId: string;
  name: string;
  description: string;
  principalIds: string[]; // user IDs or managed group IDs
  grantStrings: string[]; // e.g. "ids=ttcp_...;type=target;actions=read,authorize-session"
}

export interface BoundaryHostCatalog {
  id: string;
  scopeId: string;
  name: string;
  type: 'static';
}

export interface BoundaryHost {
  id: string;
  catalogId: string;
  name: string;
  description: string;
  address: string; // 10.10.0.30, .31, .32
}

export interface BoundaryHostSet {
  id: string;
  catalogId: string;
  name: string;
  hostIds: string[];
}

export interface BoundaryCredentialStore {
  id: string;
  scopeId: string;
  name: string;
  vaultAddress: string;
  vaultToken: string;
  caCertValid: boolean;
}

export interface BoundaryCredentialLibrary {
  id: string;
  storeId: string;
  name: string;
  vaultPath: string;
  credentialType: 'username_password';
  httpMethod: 'GET' | 'POST';
}

export interface BoundaryTarget {
  id: string;
  scopeId: string;
  name: string;
  description: string;
  type: 'tcp';
  defaultPort: number;
  sessionMaxSeconds: number;
  hostSetIds: string[];
  brokeredCredentialSourceIds: string[];
  directAddress?: string;
}

export interface BoundaryAuthToken {
  id: string;
  token: string;
  userId: string;
  loginName: string;
  authMethodId: string;
  accountId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface BoundarySession {
  id: string;
  targetId: string;
  targetName: string;
  scopeId: string;
  userId: string;
  loginName: string;
  status: 'pending' | 'active' | 'canceling' | 'terminated';
  createdAt: number;
  expiresAt: number;
  terminatedAt?: number;
  terminationReason?: string;
  vaultLeaseId: string;
  brokeredUsername: string;
  brokeredSecret: string;
  targetAddress: string;
  targetPort: number;
  workerNode: string;
}

export interface PostgresTableData {
  customersCount: number;
  ordersCount: number;
  sampleCustomers: Array<{ id: number; name: string; email: string; tier: string; created_at: string }>;
  sampleOrders: Array<{ order_id: number; customer_id: number; amount_usd: string; status: string; ordered_at: string }>;
  activeRoles: Array<{ rolname: string; rolvaliduntil: string; memberof: string[] }>;
}

export interface ClusterState {
  version: number;
  initializedAt: number;
  knownHostsAcceptedOnAdminLaptop: boolean;
  vipHolder: 'haproxy-1' | 'haproxy-2' | 'none';
  metallbPoolRange: string;
  metallbL2AdvertisementPresent: boolean;
  hosts: Record<HostId, HostMachineState>;
  k8s: {
    nodes: K8sNode[];
    pods: K8sPod[];
    services: K8sService[];
    pvcs: K8sPVC[];
    certificates: K8sCertificate[];
    configMaps: Record<string, Record<string, string>>; // "ns/name" -> data
    secrets: Record<string, Record<string, string>>;
    events: Array<{ timestamp: number; namespace: string; object: string; reason: string; message: string }>;
    helmReleases: HelmRelease[];
  };
  vault: VaultState;
  boundary: {
    scopes: BoundaryScope[];
    authMethods: BoundaryAuthMethod[];
    accounts: BoundaryAccount[];
    users: BoundaryUser[];
    managedGroups: BoundaryManagedGroup[];
    roles: BoundaryRole[];
    hostCatalogs: BoundaryHostCatalog[];
    hosts: BoundaryHost[];
    hostSets: BoundaryHostSet[];
    credentialStores: BoundaryCredentialStore[];
    credentialLibraries: BoundaryCredentialLibrary[];
    targets: BoundaryTarget[];
    authTokens: Record<string, BoundaryAuthToken>; // keyed by login context or token id
    latestTokenByWindow: Record<'admin' | 'employee', string>;
    sessions: Record<string, BoundarySession>;
  };
  postgresAppDb: PostgresTableData;
  backendLogs: BackendLogEntry[];
}