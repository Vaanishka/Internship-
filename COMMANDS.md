//ART A: Admin Connects to Jump Host & Verifies HA Platform (Window 1: /)
ssh admin@10.10.0.30
admin@10.10.0.30's password:
Jump@Admin2026

//Verify HashiCorp Vault 3-Node Raft HA Status:
kubectl exec -n vault vault-0 -- vault status
kubectl exec -n vault vault-0 -- vault operator raft list-peers

// Prove Ansible Playbook Idempotency (changed=0 across all 8 hosts):
cd secure-access-platform
ansible all -i ansible/inventory/hosts.ini -m ping
ansible-playbook -i ansible/inventory/hosts.ini ansible/site.yml

//Step A5 — Authenticate as Boundary Admin & Show Private Host Addresses (Admin-Only Visibility):
boundary authenticate password -auth-method-id=ampw_1a2b3c4d5e -login-name=admin
Password: Adm1n-Boundary#26
boundary host-catalogs list -scope-id=p_prodaccess
boundary hosts list -host-catalog-id=hcst_prodcat01


IDENTIFICATION:
 Identity Authentication via OpenLDAP]

set BOUNDARY_ADDR=https://boundary.yotta.lab:9200
boundary authenticate ldap -auth-method-id=amldap_9fK2pQx7Lz -login-name=alice
When prompted for password, enter:
Text
Alice@Yotta26

//Target Discovery (Zero IP Exposure)
boundary targets list -recursive