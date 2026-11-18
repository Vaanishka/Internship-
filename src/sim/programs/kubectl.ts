import yaml from 'js-yaml';
import { CommandExecutionResult, ProgramContext } from './types';
import { ClusterState, K8sCertificate, K8sNode, K8sPVC, K8sPod, K8sService } from '../core/types';
import { normalizeLinuxPath, readFileNode } from '../vfs/vfs';
import { appendBackendLogToDraft } from '../core/store';
import { executeVaultCli } from './vault';

export function executeKubectl(ctx: ProgramContext): CommandExecutionResult {
  const { args, state, updateState, frame } = ctx;

  const poweredMasters = ['k8s-master-1', 'k8s-master-2', 'k8s-master-3'].filter(
    (m) => state.hosts[m as keyof typeof state.hosts]?.poweredOn
  );
  if (poweredMasters.length < 2 || state.vipHolder === 'none') {
    return {
      output: 'Unable to connect to the server: dial tcp 10.10.0.100:6443: i/o timeout',
      delayMs: 250
    };
  }

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    return {
      output: `kubectl controls the Kubernetes cluster manager.

Basic Commands:
  get           Display one or many resources
  describe      Show details of a specific resource or group of resources
  logs          Print the logs for a container in a pod
  exec          Execute a command in a container
  apply         Apply a configuration to a resource by file name or stdin
  delete        Delete resources by file names, stdin, resources and names
  rollout       Manage the rollout of a resource`
    };
  }

  const sub = args[0];
  const allNamespaces = args.includes('-A') || args.includes('--all-namespaces');
  const wide = args.includes('-o') && args[args.indexOf('-o') + 1] === 'wide';
  const yamlOut = args.includes('-o') && args[args.indexOf('-o') + 1] === 'yaml';
  let ns = 'default';
  const nIdx = args.findIndex((a: string) => a === '-n' || a === '--namespace');
  if (nIdx !== -1 && args[nIdx + 1]) {
    ns = args[nIdx + 1];
  }

  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '-n' || a === '--namespace' || a === '-o' || a === '-f' || a === '-l' || a === '--dry-run') {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }

  if (sub === 'get') {
    const resource = (positional[0] || '').toLowerCase();
    const nameFilter = positional[1];

    if (resource === 'nodes' || resource === 'node' || resource === 'no') {
      const header = wide
        ? 'NAME           STATUS     ROLES           AGE   VERSION   INTERNAL-IP   EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION     CONTAINER-RUNTIME'
        : 'NAME           STATUS     ROLES           AGE   VERSION';
      const rows = state.k8s.nodes
        .filter((n: K8sNode) => !nameFilter || n.name === nameFilter)
        .map((n: K8sNode) =>
          wide
            ? `${n.name.padEnd(14)} ${n.status.padEnd(10)} ${n.roles.padEnd(15)} ${String(n.ageDays + 'd').padEnd(5)} ${n.version.padEnd(9)} ${n.internalIp.padEnd(13)} <none>        ${n.osImage.padEnd(20)} ${n.kernelVersion.padEnd(18)} ${n.containerRuntime}`
            : `${n.name.padEnd(14)} ${n.status.padEnd(10)} ${n.roles.padEnd(15)} ${n.ageDays}d    ${n.version}`
        );
      return { output: [header, ...rows].join('\n') };
    }

    if (resource === 'pods' || resource === 'pod' || resource === 'po') {
      const pods = state.k8s.pods.filter(
        (p: K8sPod) => (allNamespaces || p.namespace === ns) && (!nameFilter || p.name === nameFilter)
      );
      if (pods.length === 0) {
        return { output: `No resources found in ${ns} namespace.` };
      }
      const header = allNamespaces
        ? wide
          ? 'NAMESPACE         NAME                                       READY   STATUS    RESTARTS   AGE   IP            NODE           NOMINATED NODE'
          : 'NAMESPACE         NAME                                       READY   STATUS    RESTARTS   AGE'
        : wide
          ? 'NAME                                       READY   STATUS    RESTARTS   AGE   IP            NODE           NOMINATED NODE'
          : 'NAME                                       READY   STATUS    RESTARTS   AGE';

      const rows = pods.map((p: K8sPod) => {
        const ageStr = p.ageSeconds < 120 ? `${p.ageSeconds}s` : `${Math.floor(p.ageSeconds / 86400) || 1}d`;
        const base = `${p.name.padEnd(42)} ${p.ready.padEnd(7)} ${p.status.padEnd(9)} ${String(p.restarts).padEnd(10)} ${ageStr.padEnd(5)}`;
        const withWide = wide ? `${base} ${p.ip.padEnd(13)} ${p.node.padEnd(14)} <none>` : base;
        return allNamespaces ? `${p.namespace.padEnd(17)} ${withWide}` : withWide;
      });
      return { output: [header, ...rows].join('\n') };
    }

    if (resource === 'svc' || resource === 'services' || resource === 'service') {
      const svcs = state.k8s.services.filter(
        (s: K8sService) => (allNamespaces || s.namespace === ns) && (!nameFilter || s.name === nameFilter)
      );
      const header = allNamespaces
        ? 'NAMESPACE         NAME                  TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)                         AGE'
        : 'NAME                  TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)                         AGE';
      const rows = svcs.map((s: K8sService) => {
        const line = `${s.name.padEnd(21)} ${s.type.padEnd(14)} ${s.clusterIp.padEnd(15)} ${s.externalIp.padEnd(13)} ${s.ports.padEnd(31)} ${s.ageDays}d`;
        return allNamespaces ? `${s.namespace.padEnd(17)} ${line}` : line;
      });
      return { output: [header, ...rows].join('\n') };
    }

    if (resource === 'pvc' || resource === 'persistentvolumeclaims') {
      const pvcs = state.k8s.pvcs.filter(
        (p: K8sPVC) => (allNamespaces || p.namespace === ns) && (!nameFilter || p.name === nameFilter)
      );
      const header = allNamespaces
        ? 'NAMESPACE   NAME                       STATUS   VOLUME                 CAPACITY   ACCESS MODES   STORAGECLASS   AGE'
        : 'NAME                       STATUS   VOLUME                 CAPACITY   ACCESS MODES   STORAGECLASS   AGE';
      const rows = pvcs.map((p: K8sPVC) => {
        const line = `${p.name.padEnd(26)} ${p.status.padEnd(8)} ${p.volume.padEnd(22)} ${p.capacity.padEnd(10)} ${p.accessModes.padEnd(14)} ${p.storageClass.padEnd(14)} ${p.ageDays}d`;
        return allNamespaces ? `${p.namespace.padEnd(11)} ${line}` : line;
      });
      return { output: [header, ...rows].join('\n') };
    }

    if (resource === 'certificate' || resource === 'certificates' || resource === 'cert') {
      const certs = state.k8s.certificates.filter(
        (c: K8sCertificate) => (allNamespaces || c.namespace === ns) && (!nameFilter || c.name === nameFilter)
      );
      const header = allNamespaces
        ? 'NAMESPACE   NAME           READY   SECRET         AGE'
        : 'NAME           READY   SECRET         AGE';
      const rows = certs.map((c: K8sCertificate) => {
        const line = `${c.name.padEnd(14)} ${c.ready.padEnd(7)} ${c.secretName.padEnd(14)} ${c.ageDays}d`;
        return allNamespaces ? `${c.namespace.padEnd(11)} ${line}` : line;
      });
      return { output: [header, ...rows].join('\n') };
    }

    if (resource === 'cm' || resource === 'configmap' || resource === 'configmaps') {
      const key = `${ns}/${nameFilter || 'boundary-config'}`;
      const cm = state.k8s.configMaps[key];
      if (yamlOut && cm) {
        return {
          output: yaml.dump({
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: nameFilter || 'boundary-config', namespace: ns },
            data: cm
          })
        };
      }
      return { output: 'NAME              DATA   AGE\nboundary-config   2      4d' };
    }

    if (resource === 'events' || resource === 'ev') {
      const header = 'LAST SEEN   TYPE     REASON              OBJECT                           MESSAGE';
      const rows = state.k8s.events.map(
        (e) => `2m          Normal   ${e.reason.padEnd(19)} ${e.object.padEnd(32)} ${e.message}`
      );
      return { output: [header, ...rows].join('\n') };
    }
  }

  if (sub === 'describe') {
    const resource = (positional[0] || '').toLowerCase();
    const name = positional[1] || '';

    if (resource.startsWith('cert')) {
      const cert = state.k8s.certificates.find((c: K8sCertificate) => c.name === name || c.namespace === ns);
      if (!cert) return { output: `Error from server (NotFound): certificates.cert-manager.io "${name}" not found` };
      return {
        output: `Name:         ${cert.name}
Namespace:    ${cert.namespace}
API Version:  cert-manager.io/v1
Kind:         Certificate
Spec:
  Common Name:  ${cert.dnsNames[0] || cert.name}
  DNS Names:
${cert.dnsNames.map((d: string) => `    - ${d}`).join('\n')}
  IP Addresses:
${cert.ipAddresses.map((ip: string) => `    - ${ip}`).join('\n')}
  Issuer Ref:
    Kind:       ClusterIssuer
    Name:       ${cert.issuer}
  Secret Name:  ${cert.secretName}
Status:
  Conditions:
    Type:     Ready
    Status:   ${cert.ready}
    Message:  ${cert.statusMessage}
  Not After:  ${cert.notAfter}`
      };
    }

    if (resource.startsWith('svc') || resource.startsWith('service')) {
      const svc = state.k8s.services.find((s: K8sService) => s.name === name && (allNamespaces || s.namespace === ns));
      if (!svc) return { output: `Error from server (NotFound): services "${name}" not found` };
      return {
        output: `Name:                     ${svc.name}
Namespace:                ${svc.namespace}
Type:                     ${svc.type}
IP:                       ${svc.clusterIp}
LoadBalancer Ingress:     ${svc.externalIp}
Port:                     ${svc.ports}
Events:
  Type     Reason        Age   From                Message
  ----     ------        ----  ----                -------
  Normal   IPAllocated   4d    metallb-controller  ${
    svc.externalIp === '<pending>'
      ? 'AllocationFailed: Pool overlaps node subnet or L2Advertisement missing'
      : `Assigned IP ["${svc.externalIp}"] from pool yotta-l2-pool`
  }`
      };
    }

    if (resource.startsWith('po')) {
      const pod = state.k8s.pods.find((p: K8sPod) => p.name.startsWith(name));
      if (!pod) return { output: `Error from server (NotFound): pods "${name}" not found` };
      return {
        output: `Name:             ${pod.name}
Namespace:        ${pod.namespace}
Node:             ${pod.node}
Status:           ${pod.status}
IP:               ${pod.ip}
Containers:
  main:
    Ready:          ${pod.ready === '1/1'}
    Restart Count:  ${pod.restarts}`
      };
    }
  }

  if (sub === 'logs') {
    const podName = positional[0] || '';
    const pod = state.k8s.pods.find(
      (p: K8sPod) => (p.name === podName || p.name.startsWith(podName)) && (allNamespaces || p.namespace === ns || ns === 'default')
    );
    if (!pod) return { output: `Error from server (NotFound): pods "${podName}" not found` };
    return { output: pod.logs.join('\n') };
  }

  if (sub === 'delete') {
    const resource = (positional[0] || '').toLowerCase();
    const targetName = positional[1] || '';

    if (resource === 'pod' || resource === 'po') {
      const pod = state.k8s.pods.find((p: K8sPod) => p.name === targetName || p.name.startsWith(targetName));
      if (!pod) return { output: `Error from server (NotFound): pods "${targetName}" not found` };

      updateState((draft: ClusterState) => {
        const dp = draft.k8s.pods.find((p: K8sPod) => p.name === pod.name)!;
        dp.restarts += 1;
        dp.ageSeconds = 5;

        if (dp.name === 'vault-0') {
          dp.ready = '0/1';
          dp.labels['vault-active'] = 'false';
          dp.logs.push('Vault restarted -> core is sealed (0/3 Shamir keys provided)');
          draft.vault.nodes['vault-0'].state = 'follower';
          draft.vault.nodes['vault-0'].sealed = true;
          draft.vault.nodes['vault-0'].unsealProgress = 0;
          draft.vault.nodes['vault-0'].unsealKeysProvided = [];

          if (!draft.vault.nodes['vault-1'].sealed) {
            draft.vault.nodes['vault-1'].state = 'leader';
            const v1Pod = draft.k8s.pods.find((p: K8sPod) => p.name === 'vault-1');
            if (v1Pod) v1Pod.labels['vault-active'] = 'true';
            appendBackendLogToDraft(draft, {
              component: 'vault',
              podOrHost: 'vault/vault-1',
              message: 'vault-0 leader lost -> Raft term incremented; standby vault-1 elected new active leader in 6.2s; vault-0 respawned 0/1 Running (sealed)'
            });
          } else {
            appendBackendLogToDraft(draft, {
              component: 'vault',
              podOrHost: 'vault/vault-0',
              message: 'vault-0 pod deleted and respawned sealed (0/1 Running); no unsealed standby available',
              isError: true
            });
          }
        } else if (dp.name === 'postgres-0') {
          appendBackendLogToDraft(draft, {
            component: 'postgres',
            podOrHost: 'postgres/postgres-0',
            message: 'StatefulSet pod postgres-0 recreated and re-attached Longhorn PVC postgres-data-postgres-0'
          });
        } else {
          appendBackendLogToDraft(draft, {
            component: 'k8s',
            podOrHost: 'kube-controller-manager',
            message: `Pod ${dp.namespace}/${dp.name} deleted -> replacement pod scheduled and Running`
          });
        }
      });

      return { output: `pod "${pod.name}" deleted`, delayMs: 250 };
    }
  }

  if (sub === 'apply') {
    const fIdx = args.indexOf('-f');
    const fileArg = fIdx !== -1 ? args[fIdx + 1] : '';
    if (!fileArg) return { output: 'error: must specify -f FILENAME' };
    const fullPath = normalizeLinuxPath(frame.cwd, fileArg);
    const node = readFileNode(state, frame.hostId, fullPath);
    if (!node) {
      return { output: `error: the path "${fileArg}" does not exist` };
    }

    const docs: unknown[] = [];
    try {
      yaml.loadAll(node.content || '', (doc) => {
        if (doc) docs.push(doc);
      });
    } catch (err) {
      return {
        output: `error: error parsing ${fileArg}: ${(err as Error).message}`
      };
    }

    const outputLines: string[] = [];
    for (const rawDoc of docs) {
      const doc = rawDoc as Record<string, any>;
      if (!doc || typeof doc !== 'object' || !doc.apiVersion || !doc.kind || !doc.metadata?.name) {
        return {
          output: `error: error validating "${fileArg}": error validating data: missing required field "apiVersion", "kind", or "metadata.name"`
        };
      }

      const kind = String(doc.kind);
      const name = String(doc.metadata.name);
      const docNs = String(doc.metadata.namespace || ns);

      if (kind === 'IPAddressPool') {
        const range = String(doc.spec?.addresses?.[0] || '');
        updateState((draft: ClusterState) => {
          draft.metallbPoolRange = range;
          const overlapsNodes = range.includes('10.10.0.10') || range.includes('10.10.0.1-');
          for (const svc of draft.k8s.services) {
            if (svc.type === 'LoadBalancer') {
              if (overlapsNodes || !draft.metallbL2AdvertisementPresent) {
                svc.externalIp = '<pending>';
              } else if (svc.name === 'vault') svc.externalIp = '10.10.0.201';
              else if (svc.name === 'boundary-controller') svc.externalIp = '10.10.0.202';
              else if (svc.name === 'boundary-worker') svc.externalIp = '10.10.0.203';
            }
          }
          appendBackendLogToDraft(draft, {
            component: 'metallb',
            podOrHost: 'metallb/controller',
            message: `Reconciled IPAddressPool/${name} with range ${range}`
          });
        });
        outputLines.push(`ipaddresspool.metallb.io/${name} configured`);
        continue;
      }

      if (kind === 'Certificate') {
        const ipAddrs: string[] = Array.isArray(doc.spec?.ipAddresses) ? doc.spec.ipAddresses.map(String) : [];
        const dnsNames: string[] = Array.isArray(doc.spec?.dnsNames) ? doc.spec.dnsNames.map(String) : [];
        const requiredIp = name === 'vault-tls' ? '10.10.0.201' : '10.10.0.202';
        const hasRequiredIp = ipAddrs.includes(requiredIp);

        updateState((draft: ClusterState) => {
          const cert = draft.k8s.certificates.find((c: K8sCertificate) => c.name === name);
          if (cert) {
            cert.ipAddresses = ipAddrs;
            cert.dnsNames = dnsNames;
            cert.ready = hasRequiredIp ? 'True' : 'False';
            cert.statusMessage = hasRequiredIp
              ? 'Certificate is up to date and has not expired'
              : `TLS handshake error: x509: cannot validate certificate for ${requiredIp} because it doesn't contain any IP SANs`;
          }
          if (name === 'vault-tls' && draft.boundary.credentialStores[0]) {
            draft.boundary.credentialStores[0].caCertValid = hasRequiredIp;
          }
          appendBackendLogToDraft(draft, {
            component: 'cert-manager',
            podOrHost: 'cert-manager',
            message: `Reconciled Certificate/${docNs}/${name} (ipAddresses=[${ipAddrs.join(',')}], Ready=${hasRequiredIp})`
          });
        });
        outputLines.push(`certificate.cert-manager.io/${name} configured`);
        continue;
      }

      if (kind === 'ConfigMap' && name === 'boundary-config') {
        const ctrlHcl = String(doc.data?.['controller.hcl'] || '');
        const isValidHcl = ctrlHcl.includes('controller {') && ctrlHcl.includes('listener "tcp"');
        updateState((draft: ClusterState) => {
          draft.k8s.configMaps['boundary/boundary-config'] = {
            'controller.hcl': ctrlHcl,
            'worker.hcl': String(doc.data?.['worker.hcl'] || '')
          };
          const ctrlPod = draft.k8s.pods.find((p: K8sPod) => p.name.startsWith('boundary-controller'));
          if (ctrlPod) {
            ctrlPod.status = isValidHcl ? 'Running' : 'CrashLoopBackOff';
            ctrlPod.ready = isValidHcl ? '1/1' : '0/1';
            if (!isValidHcl) {
              ctrlPod.logs.push('Error parsing controller configuration: missing required controller or listener block');
            }
          }
        });
        outputLines.push(`configmap/${name} configured`);
        continue;
      }

      outputLines.push(`${kind.toLowerCase()}/${name} unchanged`);
    }

    return { output: outputLines.join('\n'), delayMs: 140 };
  }

  if (sub === 'exec') {
    const dashDashIdx = args.indexOf('--');
    const podName = positional[0] || '';
    const cmdTokens = dashDashIdx !== -1 ? args.slice(dashDashIdx + 1) : positional.slice(1);
    const execCmd = cmdTokens[0];

    if (execCmd === 'vault') {
      return executeVaultCli({
        ...ctx,
        args: cmdTokens.slice(1)
      }, podName as 'vault-0' | 'vault-1' | 'vault-2');
    }

    if (execCmd === 'etcdctl') {
      const m1On = state.hosts['k8s-master-1'].poweredOn;
      const m2On = state.hosts['k8s-master-2'].poweredOn;
      const m3On = state.hosts['k8s-master-3'].poweredOn;
      if (cmdTokens.includes('member') && cmdTokens.includes('list')) {
        return {
          output: `8e9e05c52164694d, started, k8s-master-1, https://10.10.0.11:2380, https://10.10.0.11:2379, false
91bc3c398fb3c146, ${m2On ? 'started' : 'unhealthy'}, k8s-master-2, https://10.10.0.12:2380, https://10.10.0.12:2379, false
fd422379fda50e48, ${m3On ? 'started' : 'unhealthy'}, k8s-master-3, https://10.10.0.13:2380, https://10.10.0.13:2379, false`
        };
      }
      if (cmdTokens.includes('endpoint') && cmdTokens.includes('health')) {
        return {
          output: `https://10.10.0.11:2379 is ${m1On ? 'healthy: successfully committed proposal: took = 2.14ms' : 'unhealthy: dial tcp 10.10.0.11:2379: i/o timeout'}
https://10.10.0.12:2379 is ${m2On ? 'healthy: successfully committed proposal: took = 2.48ms' : 'unhealthy: dial tcp 10.10.0.12:2379: i/o timeout'}
https://10.10.0.13:2379 is ${m3On ? 'healthy: successfully committed proposal: took = 2.31ms' : 'unhealthy: dial tcp 10.10.0.13:2379: i/o timeout'}`
        };
      }
    }

    if (podName === 'k8s-auth-test') {
      return {
        output: JSON.stringify(
          {
            request_id: '7f4e2a1c-9b8d-4e3f-a1b2-c3d4e5f6a7b8',
            auth: {
              client_token: 'hvs.CAESIK8mN2pQx9Lz4vR1wY6tU3iO0pA5sD8fG2hJ4kL9zX1c',
              accessor: 'hmac-sha256:k8s-workload-accessor',
              policies: ['default', 'kv-read-policy'],
              metadata: {
                role: 'test-workload',
                service_account_name: 'test-sa',
                service_account_namespace: 'vault'
              },
              lease_duration: 3600,
              renewable: true
            }
          },
          null,
          2
        )
      };
    }

    return { output: '' };
  }

  if (sub === 'rollout') {
    const action = positional[0];
    const target = positional[1] || 'deployment/boundary-controller';
    if (action === 'status') {
      return { output: `deployment "${target.split('/').pop()}" successfully rolled out` };
    }
    if (action === 'restart') {
      return { output: `${target} restarted` };
    }
  }

  return { output: `Error: unknown command "${sub}" for "kubectl"` };
}