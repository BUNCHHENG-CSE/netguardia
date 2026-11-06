import { PrismaClient } from '@prisma/client';
import { encryptSecret } from './vault';
import { computeConfigHashes } from './diffEngine';
import { parseNeighborCliOutput } from './topologyEngine';
import { BUILTIN_COMPLIANCE_RULES } from './complianceEngine';

export async function resetDatabase(prisma: PrismaClient) {
  // Clear tables in reverse dependency order
  await prisma.alert.deleteMany();
  await prisma.neighborLink.deleteMany();
  await prisma.configSnapshot.deleteMany();
  await prisma.device.deleteMany();
  await prisma.credential.deleteMany();
  await prisma.maintenanceWindow.deleteMany();
  await prisma.complianceRule.deleteMany();
  await prisma.backupSettings.deleteMany();
  await prisma.auditLog.deleteMany();

  await seedDatabase(prisma);
}

export async function seedDatabase(prisma: PrismaClient) {
  const count = await prisma.device.count();
  if (count > 0) {
    return; // Already seeded
  }

  const now = new Date();
  const isoNow = now.toISOString();
  const iso2hAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
  const iso6hAgo = new Date(now.getTime() - 6 * 3600 * 1000).toISOString();
  const iso2dAgo = new Date(now.getTime() - 2 * 86400 * 1000).toISOString();
  const iso94dAgo = new Date(now.getTime() - 94 * 86400 * 1000).toISOString();

  // 1. Seed Backup Settings
  await prisma.backupSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      scheduleEnabled: 1,
      intervalMinutes: 360,
      cronExpression: '0 */6 * * *',
      noiseFilterEnabled: 1,
      alertOnOutOfWindow: 1,
      staleBackupThresholdDays: 7,
      webhookUrl: 'https://hooks.slack.com/services/T000/B000/NETGUARDIA-OPS',
      notificationEmail: 'netops-alerts@smallteam.io',
      lastGlobalRunAt: iso2hAgo,
      lastReadinessAuditAt: iso6hAgo,
    },
  });

  // 2. Seed Credentials
  const credCisco = await prisma.credential.create({
    data: {
      name: 'Cisco TACACS+ NetOps',
      protocol: 'SSH',
      username: 'netops_admin',
      encryptedPassword: encryptSecret('C1sco!Tacacs#2026'),
      encryptedEnableSecret: encryptSecret('En4ble$Secret99'),
      encryptedSshKey: null,
      encryptedSnmpCommunity: encryptSecret('NetGuard_RO_v2c'),
      description: 'Primary SSH + Enable secret for Cisco IOS-XE / ASA fleet',
      lastVerifiedAt: iso2hAgo,
      createdAt: iso2dAgo,
    },
  });

  const credJuniper = await prisma.credential.create({
    data: {
      name: 'Juniper Junos Automation Key',
      protocol: 'SSH / NETCONF',
      username: 'junos_auto',
      encryptedPassword: encryptSecret('Jun0s#Netconf2026'),
      encryptedEnableSecret: null,
      encryptedSshKey: encryptSecret(
        '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----'
      ),
      encryptedSnmpCommunity: encryptSecret('Junos_SNMP_RO'),
      description: 'SSH RSA key + NETCONF credentials for Juniper EX/SRX switches & firewalls',
      lastVerifiedAt: iso2hAgo,
      createdAt: iso2dAgo,
    },
  });

  const credUbiquiti = await prisma.credential.create({
    data: {
      name: 'Ubiquiti EdgeOS / UniFi Admin',
      protocol: 'SSH / SNMP',
      username: 'ubnt_ops',
      encryptedPassword: encryptSecret('Ubnt$EdgePro!88'),
      encryptedEnableSecret: null,
      encryptedSshKey: null,
      encryptedSnmpCommunity: encryptSecret('Ubnt_RO_Community'),
      description: 'Site credentials for Ubiquiti EdgeRouter and UniFi Pro PoE switches',
      lastVerifiedAt: iso2hAgo,
      createdAt: iso2dAgo,
    },
  });

  // 3. Maintenance Windows
  await prisma.maintenanceWindow.createMany({
    data: [
      {
        name: 'Weekly Core Maintenance Window',
        site: 'HQ-Campus (Austin)',
        dayOfWeek: 'Sunday',
        startTimeUtc: '02:00',
        endTimeUtc: '04:00',
        isActiveOverride: 0,
        autoPromoteLkg: 1,
        createdAt: iso2dAgo,
      },
      {
        name: 'Branch EU Overnight Patch Window',
        site: 'Branch-DC (Frankfurt)',
        dayOfWeek: 'Wednesday',
        startTimeUtc: '01:00',
        endTimeUtc: '03:00',
        isActiveOverride: 0,
        autoPromoteLkg: 1,
        createdAt: iso2dAgo,
      },
    ],
  });

  // 4. Seed Devices
  const devicesSeed = [
    {
      hostname: 'hq-edge-fw01',
      ip_address: '10.10.0.1',
      vendor: 'Cisco',
      model: 'Secure Firewall 3110 / ISR4451',
      os_type: 'Cisco IOS-XE 17.9',
      role: 'Firewall / WAN Gateway',
      site: 'HQ-Campus (Austin)',
      credential_id: credCisco.id,
      lkg_config: `! Last configuration change at 02:15:00 UTC Sun Oct 11 2026 by netops_admin
! NVRAM config last updated at 02:15:04 UTC Sun Oct 11 2026 by netops_admin
version 17.9
service timestamps debug datetime msec
service timestamps log datetime msec
service password-encryption
!
hostname hq-edge-fw01
!
aaa new-model
username netops_admin privilege 15 secret 9 $9$encryptedHash01
!
interface GigabitEthernet0/0/0
 description WAN-PRIMARY-FIBER-ISP1
 ip address 203.0.113.2 255.255.255.252
 ip access-group WAN-INBOUND-ACL in
 no shutdown
!
interface GigabitEthernet0/0/1
 description DOWNLINK-TO-HQ-CORE-SW01
 ip address 10.10.0.1 255.255.255.252
 no shutdown
!
interface GigabitEthernet0/0/2
 description DOWNLINK-TO-HQ-CORE-SW02
 ip address 10.10.0.5 255.255.255.252
 no shutdown
!
router ospf 10
 router-id 10.10.0.1
 network 10.10.0.0 0.0.255.255 area 0
 default-information originate always
!
ip access-list extended WAN-INBOUND-ACL
 remark Allow IPSec & HTTPS VPN Portal only
 permit udp any any eq isakmp
 permit esp any any
 permit tcp any host 203.0.113.2 eq 443
 deny ip any any log
!
snmp-server community NetGuard_RO_v2c RO
ntp server 10.10.0.250
ntp clock-period 36028797
line vty 0 4
 transport input ssh
end`,
      current_config: `! Last configuration change at 10:42:11 UTC Sat Oct 17 2026 by unknown_vty
! NVRAM config last updated at 10:42:15 UTC Sat Oct 17 2026 by unknown_vty
version 17.9
service timestamps debug datetime msec
service timestamps log datetime msec
service password-encryption
!
hostname hq-edge-fw01
!
aaa new-model
username netops_admin privilege 15 secret 9 $9$encryptedHash01
!
interface GigabitEthernet0/0/0
 description WAN-PRIMARY-FIBER-ISP1
 ip address 203.0.113.2 255.255.255.252
 ip access-group WAN-INBOUND-ACL in
 no shutdown
!
interface GigabitEthernet0/0/1
 description DOWNLINK-TO-HQ-CORE-SW01
 ip address 10.10.0.1 255.255.255.252
 no shutdown
!
interface GigabitEthernet0/0/2
 description DOWNLINK-TO-HQ-CORE-SW02
 ip address 10.10.0.5 255.255.255.252
 no shutdown
!
router ospf 10
 router-id 10.10.0.1
 network 10.10.0.0 0.0.255.255 area 0
 default-information originate always
!
ip access-list extended WAN-INBOUND-ACL
 remark Allow IPSec & HTTPS VPN Portal only
 permit udp any any eq isakmp
 permit esp any any
 permit tcp any host 203.0.113.2 eq 443
 permit tcp any any eq 22 log
 permit tcp any any eq 23
 deny ip any any log
!
snmp-server community NetGuard_RO_v2c RO
ntp server 10.10.0.250
ntp clock-period 36029112
line vty 0 4
 transport input telnet ssh
end`,
      neighbor_raw: `-------------------------
Device ID: hq-core-sw01.corp.local
Entry address(es):
  IP address: 10.10.1.1
Platform: cisco C9300-48P,  Capabilities: Router Switch IGMP
Interface: GigabitEthernet0/0/1,  Port ID (outgoing port): TenGigabitEthernet1/1/1
-------------------------
Device ID: hq-core-sw02.corp.local
Entry address(es):
  IP address: 10.10.1.2
Platform: Juniper EX4300-48P,  Capabilities: Router Switch
Interface: GigabitEthernet0/0/2,  Port ID (outgoing port): xe-0/0/0
-------------------------
Device ID: br-edge-srx01.corp.local
Entry address(es):
  IP address: 10.20.0.1
Platform: Juniper SRX345,  Capabilities: Router
Interface: Tunnel10,  Port ID (outgoing port): st0.0`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'hq-core-sw01',
      ip_address: '10.10.1.1',
      vendor: 'Cisco',
      model: 'Catalyst C9300-48P',
      os_type: 'Cisco IOS-XE 17.6',
      role: 'Core Switch',
      site: 'HQ-Campus (Austin)',
      credential_id: credCisco.id,
      lkg_config: `! Last configuration change at 02:20:00 UTC Sun Oct 11 2026 by netops_admin
version 17.6
service password-encryption
hostname hq-core-sw01
!
spanning-tree mode rapid-pvst
spanning-tree vlan 1-100 priority 4096
!
vlan 10
 name CORP_WORKSTATIONS
vlan 20
 name VOICE_VOIP
vlan 30
 name PROD_SERVERS
!
interface TenGigabitEthernet1/1/1
 description UPLINK-TO-HQ-EDGE-FW01
 ip address 10.10.0.2 255.255.255.252
!
interface TenGigabitEthernet1/1/2
 description PEER-LINK-HQ-CORE-SW02
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
interface GigabitEthernet1/0/1
 description DOWNLINK-HQ-DIST-SW01
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
interface GigabitEthernet1/0/2
 description DOWNLINK-HQ-DIST-SW02
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
router ospf 10
 router-id 10.10.1.1
 network 10.10.0.0 0.0.255.255 area 0
!
snmp-server community NetGuard_RO_v2c RO
ntp clock-period 36028100
line vty 0 15
 transport input ssh
end`,
      current_config: null,
      neighbor_raw: `-------------------------
Device ID: hq-edge-fw01.corp.local
Entry address(es):
  IP address: 10.10.0.1
Platform: cisco ISR4451,  Capabilities: Router
Interface: TenGigabitEthernet1/1/1,  Port ID (outgoing port): GigabitEthernet0/0/1
-------------------------
Device ID: hq-core-sw02.corp.local
Entry address(es):
  IP address: 10.10.1.2
Platform: Juniper EX4300-48P,  Capabilities: Router Switch
Interface: TenGigabitEthernet1/1/2,  Port ID (outgoing port): xe-0/0/1
-------------------------
Device ID: hq-dist-sw01.corp.local
Entry address(es):
  IP address: 10.10.2.1
Platform: cisco C9200L-24P,  Capabilities: Switch IGMP
Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): GigabitEthernet1/0/24
-------------------------
Device ID: hq-dist-sw02.corp.local
Entry address(es):
  IP address: 10.10.2.2
Platform: Juniper EX2300-24P,  Capabilities: Switch
Interface: GigabitEthernet1/0/2,  Port ID (outgoing port): ge-0/1/0`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'hq-core-sw02',
      ip_address: '10.10.1.2',
      vendor: 'Juniper',
      model: 'EX4300-48P',
      os_type: 'Junos 22.4R3',
      role: 'Core Switch',
      site: 'HQ-Campus (Austin)',
      credential_id: credJuniper.id,
      lkg_config: `## Last commit: 2026-10-11 02:25:12 UTC by junos_auto
set version 22.4R3
set system host-name hq-core-sw02
set system services ssh root-login deny
set system services netconf ssh
set system login user junos_auto class super-user
set interfaces xe-0/0/0 description "UPLINK-TO-HQ-EDGE-FW01"
set interfaces xe-0/0/0 unit 0 family inet address 10.10.0.6/30
set interfaces xe-0/0/1 description "PEER-LINK-HQ-CORE-SW01"
set interfaces xe-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces xe-0/0/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set interfaces ge-0/0/1 description "DOWNLINK-HQ-DIST-SW02"
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set protocols lldp interface all
set protocols ospf area 0.0.0.0 interface xe-0/0/0.0
set vlans CORP_WORKSTATIONS vlan-id 10
set vlans VOICE_VOIP vlan-id 20
set vlans PROD_SERVERS vlan-id 30`,
      current_config: null,
      neighbor_raw: `Local Interface    Parent Interface    Chassis Id          Port info          System Name
xe-0/0/0           -                   00:1c:73:11:22:01   GigabitEthernet0/0/2 hq-edge-fw01
xe-0/0/1           -                   00:1c:73:11:22:02   TenGigabitEthernet1/1/2 hq-core-sw01
ge-0/0/1           -                   00:1c:73:11:22:04   ge-0/1/1           hq-dist-sw02`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'hq-dist-sw01',
      ip_address: '10.10.2.1',
      vendor: 'Cisco',
      model: 'Catalyst C9200L-24P',
      os_type: 'Cisco IOS-XE 17.6',
      role: 'Distribution Switch',
      site: 'HQ-Campus (Austin)',
      credential_id: credCisco.id,
      lkg_config: `! Last configuration change at 02:30:00 UTC Sun Oct 11 2026 by netops_admin
version 17.6
service password-encryption
hostname hq-dist-sw01
!
vlan 10
 name CORP_WORKSTATIONS
vlan 20
 name VOICE_VOIP
!
interface GigabitEthernet1/0/24
 description UPLINK-HQ-CORE-SW01
 switchport mode trunk
 switchport trunk allowed vlan 10,20,30
!
interface GigabitEthernet1/0/1
 description DOWNLINK-HQ-ACCESS-SW01
 switchport mode trunk
 switchport trunk allowed vlan 10,20
!
interface GigabitEthernet1/0/2
 description DOWNLINK-HQ-ACCESS-SW02
 switchport mode trunk
 switchport trunk allowed vlan 10,20
!
snmp-server community NetGuard_RO_v2c RO
line vty 0 15
 transport input ssh
end`,
      current_config: null,
      neighbor_raw: `-------------------------
Device ID: hq-core-sw01.corp.local
Entry address(es):
  IP address: 10.10.1.1
Platform: cisco C9300-48P,  Capabilities: Router Switch
Interface: GigabitEthernet1/0/24,  Port ID (outgoing port): GigabitEthernet1/0/1
-------------------------
Device ID: hq-access-sw01.corp.local
Entry address(es):
  IP address: 10.10.3.1
Platform: Ubiquiti USW-Pro-48-PoE,  Capabilities: Switch
Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): eth49
-------------------------
Device ID: hq-access-sw02.corp.local
Entry address(es):
  IP address: 10.10.3.2
Platform: Ubiquiti USW-Pro-24-PoE,  Capabilities: Switch
Interface: GigabitEthernet1/0/2,  Port ID (outgoing port): eth25`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'hq-dist-sw02',
      ip_address: '10.10.2.2',
      vendor: 'Juniper',
      model: 'EX2300-24P',
      os_type: 'Junos 21.4R3',
      role: 'Distribution Switch',
      site: 'HQ-Campus (Austin)',
      credential_id: credJuniper.id,
      lkg_config: `## Last commit: 2026-10-11 02:35:00 UTC by junos_auto
set version 21.4R3
set system host-name hq-dist-sw02
set system services ssh root-login deny
set interfaces ge-0/1/0 description "UPLINK-HQ-CORE-SW01"
set interfaces ge-0/1/0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/1/0 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set interfaces ge-0/1/1 description "UPLINK-HQ-CORE-SW02"
set interfaces ge-0/1/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/1/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set interfaces ge-0/0/1 description "DOWNLINK-HQ-WLC01"
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP ]
set protocols lldp interface all
set vlans CORP_WORKSTATIONS vlan-id 10
set vlans VOICE_VOIP vlan-id 20
set vlans PROD_SERVERS vlan-id 30`,
      current_config: `## Last commit: 2026-10-17 09:14:22 UTC by contractor_temp
set version 21.4R3
set system host-name hq-dist-sw02
set system services ssh root-login deny
set interfaces ge-0/1/0 description "UPLINK-HQ-CORE-SW01"
set interfaces ge-0/1/0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/1/0 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS UNMANAGED_IOT_BYPASS ]
set interfaces ge-0/1/1 description "UPLINK-HQ-CORE-SW02"
set interfaces ge-0/1/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/1/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP PROD_SERVERS ]
set interfaces ge-0/0/1 description "DOWNLINK-HQ-WLC01"
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members [ CORP_WORKSTATIONS VOICE_VOIP UNMANAGED_IOT_BYPASS ]
set protocols lldp interface all
set vlans CORP_WORKSTATIONS vlan-id 10
set vlans VOICE_VOIP vlan-id 20
set vlans PROD_SERVERS vlan-id 30
set vlans UNMANAGED_IOT_BYPASS vlan-id 999`,
      neighbor_raw: `Local Interface    Parent Interface    Chassis Id          Port info          System Name
ge-0/1/0           -                   00:1c:73:11:22:02   GigabitEthernet1/0/2 hq-core-sw01
ge-0/1/1           -                   00:1c:73:11:22:03   ge-0/0/1           hq-core-sw02
ge-0/0/1           -                   00:1c:73:11:22:09   eth0               hq-wlc-unifi01
ge-0/0/12          -                   00:1c:73:99:99:99   eth0               hq-shadow-ap99`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'hq-access-sw01',
      ip_address: '10.10.3.1',
      vendor: 'Ubiquiti',
      model: 'UniFi USW-Pro-48-PoE',
      os_type: 'Ubiquiti UniFi OS 7.0',
      role: 'Access Switch',
      site: 'HQ-Campus (Austin)',
      credential_id: credUbiquiti.id,
      lkg_config: `# generated by EdgeOS v2.0.9-hotfix.7 at 2026-10-11 02:40:00 UTC
set system host-name hq-access-sw01
set system login user ubnt_ops level admin
set interfaces switch switch0 description 'Floor-1 PoE Access Switch'
set interfaces switch switch0 switch-port interface eth49 vlan pvid 1
set interfaces switch switch0 switch-port interface eth49 vlan vid 10,20
set service lldp interface all
set service snmp community Ubnt_RO_Community authorization ro
set service ssh port 22`,
      current_config: null,
      neighbor_raw: `-------------------------------------------------------------------------------
Interface:    eth49, via: LLDP, RID: 1, Time: 14 days, 06:11:22
  Chassis:
    ChassisID:    mac 00:1c:73:11:22:05
    SysName:      hq-dist-sw01.corp.local
    SysDescr:     Cisco IOS Software, C9200L
    MgmtIP:       10.10.2.1
  Port:
    PortID:       ifname GigabitEthernet1/0/1`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'hq-access-sw02',
      ip_address: '10.10.3.2',
      vendor: 'Ubiquiti',
      model: 'UniFi USW-Pro-24-PoE',
      os_type: 'Ubiquiti UniFi OS 7.0',
      role: 'Access Switch',
      site: 'HQ-Campus (Austin)',
      credential_id: credUbiquiti.id,
      lkg_config: `# generated by EdgeOS v2.0.9-hotfix.7 at 2026-10-11 02:42:00 UTC
set system host-name hq-access-sw02
set system login user ubnt_ops level admin
set interfaces switch switch0 description 'Floor-2 Engineering PoE Switch'
set interfaces switch switch0 switch-port interface eth25 vlan pvid 1
set interfaces switch switch0 switch-port interface eth25 vlan vid 10,20
set service lldp interface all
set service snmp community Ubnt_RO_Community authorization ro
set service ssh port 22`,
      current_config: null,
      neighbor_raw: `-------------------------------------------------------------------------------
Interface:    eth25, via: LLDP, RID: 1, Time: 14 days, 06:11:22
  Chassis:
    ChassisID:    mac 00:1c:73:11:22:05
    SysName:      hq-dist-sw01.corp.local
    SysDescr:     Cisco IOS Software, C9200L
    MgmtIP:       10.10.2.1
  Port:
    PortID:       ifname GigabitEthernet1/0/2`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'hq-wlc-unifi01',
      ip_address: '10.10.3.10',
      vendor: 'Ubiquiti',
      model: 'UniFi CloudKey Enterprise / UDM-Pro',
      os_type: 'Ubiquiti EdgeOS/UniFi 4.0',
      role: 'Wireless Controller',
      site: 'HQ-Campus (Austin)',
      credential_id: credUbiquiti.id,
      lkg_config: `# generated by EdgeOS v2.0.9-hotfix.7 at 2026-10-11 02:45:00 UTC
set system host-name hq-wlc-unifi01
set system login user ubnt_ops level admin
set interfaces ethernet eth0 address 10.10.3.10/24
set interfaces ethernet eth0 description 'UPLINK-HQ-DIST-SW02'
set service lldp interface all
set service snmp community Ubnt_RO_Community authorization ro
set service ssh port 22`,
      current_config: null,
      neighbor_raw: `-------------------------------------------------------------------------------
Interface:    eth0, via: LLDP, RID: 1, Time: 21 days, 02:18:10
  Chassis:
    ChassisID:    mac 00:1c:73:11:22:04
    SysName:      hq-dist-sw02.corp.local
    SysDescr:     Juniper Networks, Inc. ex2300-24p
    MgmtIP:       10.10.2.2
  Port:
    PortID:       ifname ge-0/0/1`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'br-edge-srx01',
      ip_address: '10.20.0.1',
      vendor: 'Juniper',
      model: 'SRX345 Services Gateway',
      os_type: 'Junos 22.4R3',
      role: 'Firewall / WAN Gateway',
      site: 'Branch-DC (Frankfurt)',
      credential_id: credJuniper.id,
      lkg_config: `## Last commit: 2026-10-11 03:00:00 UTC by junos_auto
set version 22.4R3
set system host-name br-edge-srx01
set system services ssh root-login deny
set system services netconf ssh
set interfaces ge-0/0/0 description "WAN-EU-DECIX-UPLINK"
set interfaces ge-0/0/0 unit 0 family inet address 198.51.100.10/30
set interfaces ge-0/0/1 description "DOWNLINK-BR-CORE-SW01"
set interfaces ge-0/0/1 unit 0 family inet address 10.20.0.1/30
set interfaces st0 unit 0 description "IPSEC-VPN-TO-HQ-EDGE-FW01"
set interfaces st0 unit 0 family inet address 172.16.254.2/30
set protocols lldp interface all
set protocols ospf area 0.0.0.0 interface ge-0/0/1.0
set protocols ospf area 0.0.0.0 interface st0.0`,
      current_config: null,
      neighbor_raw: `Local Interface    Parent Interface    Chassis Id          Port info          System Name
st0.0              -                   00:1c:73:11:22:01   Tunnel10           hq-edge-fw01
ge-0/0/1           -                   00:1c:73:22:33:01   GigabitEthernet1/0/24 br-core-sw01`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'br-core-sw01',
      ip_address: '10.20.1.1',
      vendor: 'Cisco',
      model: 'Catalyst C9300L-24T',
      os_type: 'Cisco IOS-XE 17.6',
      role: 'Core Switch',
      site: 'Branch-DC (Frankfurt)',
      credential_id: credCisco.id,
      lkg_config: `! Last configuration change at 03:05:00 UTC Sun Oct 11 2026 by netops_admin
version 17.6
service password-encryption
hostname br-core-sw01
!
vlan 100
 name EU_BRANCH_STAFF
vlan 200
 name EU_BRANCH_VOICE
!
interface GigabitEthernet1/0/24
 description UPLINK-BR-EDGE-SRX01
 ip address 10.20.0.2 255.255.255.252
!
interface GigabitEthernet1/0/1
 description DOWNLINK-BR-ACCESS-SW01
 switchport mode trunk
 switchport trunk allowed vlan 100,200
!
router ospf 10
 router-id 10.20.1.1
 network 10.20.0.0 0.0.255.255 area 0
!
snmp-server community NetGuard_RO_v2c RO
line vty 0 15
 transport input ssh
end`,
      current_config: null,
      neighbor_raw: `-------------------------
Device ID: br-edge-srx01.corp.local
Entry address(es):
  IP address: 10.20.0.1
Platform: Juniper SRX345,  Capabilities: Router
Interface: GigabitEthernet1/0/24,  Port ID (outgoing port): ge-0/0/1
-------------------------
Device ID: br-access-sw01.corp.local
Entry address(es):
  IP address: 10.20.2.1
Platform: Ubiquiti ES-24-250W,  Capabilities: Switch
Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): 0/25`,
      backup_time: iso2hAgo,
    },
    {
      hostname: 'br-access-sw01',
      ip_address: '10.20.2.1',
      vendor: 'Ubiquiti',
      model: 'EdgeSwitch ES-24-250W',
      os_type: 'Ubiquiti EdgeOS 1.9.3',
      role: 'Access Switch',
      site: 'Branch-DC (Frankfurt)',
      credential_id: credUbiquiti.id,
      lkg_config: `# generated by EdgeOS v1.9.3 at 2026-07-15 01:10:00 UTC
set system host-name br-access-sw01
set system login user ubnt_ops level admin
set interfaces switch switch0 description 'Frankfurt Branch Floor Access'
set interfaces switch switch0 switch-port interface 0/25 vlan pvid 1
set interfaces switch switch0 switch-port interface 0/25 vlan vid 100,200
set service lldp interface all
set service snmp community Ubnt_RO_Community authorization ro
set service ssh port 22`,
      current_config: null,
      neighbor_raw: `-------------------------------------------------------------------------------
Interface:    0/25, via: LLDP, RID: 1, Time: 94 days, 04:12:00
  Chassis:
    ChassisID:    mac 00:1c:73:22:33:01
    SysName:      br-core-sw01.corp.local
    SysDescr:     Cisco IOS Software, C9300L
    MgmtIP:       10.20.1.1
  Port:
    PortID:       ifname GigabitEthernet1/0/1`,
      backup_time: iso94dAgo,
    },
  ];

  const allNeighborRows: any[] = [];

  for (const d of devicesSeed) {
    const lkgText = d.lkg_config;
    const currText = d.current_config ? d.current_config : d.lkg_config;
    const [lkgRawH, lkgNormH] = computeConfigHashes(lkgText);
    const [currRawH, currNormH] = computeConfigHashes(currText);
    const hasDrift = lkgNormH !== currNormH ? 1 : 0;

    const createdDev = await prisma.device.create({
      data: {
        hostname: d.hostname,
        ipAddress: d.ip_address,
        sshPort: 22,
        vendor: d.vendor,
        model: d.model,
        osType: d.os_type,
        role: d.role,
        site: d.site,
        credentialId: d.credential_id,
        isSimulated: 1,
        status: 'online',
        driftDetected: hasDrift,
        lastBackupAt: d.backup_time,
        lastVerifiedAt: iso2hAgo,
        simulatedRunningConfig: currText,
        simulatedNeighborRaw: d.neighbor_raw,
        createdAt: iso94dAgo,
      },
    });
    const deviceId = createdDev.id;

    // Snapshot 1 (LKG)
    const lkgSnap = await prisma.configSnapshot.create({
      data: {
        deviceId,
        versionNumber: 1,
        configText: lkgText,
        rawHash: lkgRawH,
        normalizedHash: lkgNormH,
        sizeBytes: Buffer.byteLength(lkgText, 'utf-8'),
        collectedBy: 'Scheduled Collector (Maintenance Window)',
        inMaintenanceWindow: 1,
        isLkg: 1,
        notes: 'Baseline Last-Known-Good (LKG) config',
        createdAt: !hasDrift ? d.backup_time : iso2dAgo,
      },
    });
    const lkgSnapId = lkgSnap.id;
    let latestSnapId = lkgSnapId;

    if (hasDrift) {
      const curSnap = await prisma.configSnapshot.create({
        data: {
          deviceId,
          versionNumber: 2,
          configText: currText,
          rawHash: currRawH,
          normalizedHash: currNormH,
          sizeBytes: Buffer.byteLength(currText, 'utf-8'),
          collectedBy: 'Scheduled Collector',
          inMaintenanceWindow: 0,
          isLkg: 0,
          notes: 'Unapproved change detected outside maintenance window',
          createdAt: d.backup_time,
        },
      });
      latestSnapId = curSnap.id;
    }

    await prisma.device.update({
      where: { id: deviceId },
      data: {
        lkgSnapshotId: lkgSnapId,
        latestSnapshotId: latestSnapId,
      },
    });

    const parsedNeighbors = parseNeighborCliOutput(d.neighbor_raw, d.vendor);
    for (const n of parsedNeighbors) {
      allNeighborRows.push({
        deviceId,
        localPort: n.local_port,
        remoteHostname: n.remote_hostname,
        remotePort: n.remote_port,
        remoteIp: n.remote_ip || '',
        remotePlatform: n.remote_platform || '',
        protocol: n.protocol,
        updatedAt: isoNow,
      });
    }

    // Seed alert
    if (d.hostname === 'hq-edge-fw01') {
      await prisma.alert.create({
        data: {
          deviceId,
          snapshotId: latestSnapId,
          severity: 'CRITICAL',
          alertType: 'OUT_OF_WINDOW_DRIFT',
          title: 'Unauthorized WAN ACL & Telnet Change Outside Maintenance Window',
          message:
            'hq-edge-fw01 (10.10.0.1) configuration changed outside Sunday 02:00–04:00 UTC maintenance window: permit tcp any any eq 22/23 added to WAN-INBOUND-ACL and VTY telnet enabled.',
          outsideMaintenanceWindow: 1,
          addedLines: 3,
          removedLines: 1,
          riskCategories: JSON.stringify([
            'Firewall / ACL Exposure',
            'Management / Insecure Protocol',
          ]),
          acknowledged: 0,
          createdAt: iso2hAgo,
        },
      });
    } else if (d.hostname === 'hq-dist-sw02') {
      await prisma.alert.create({
        data: {
          deviceId,
          snapshotId: latestSnapId,
          severity: 'HIGH',
          alertType: 'OUT_OF_WINDOW_DRIFT',
          title: 'Unapproved VLAN 999 Trunked on Distribution Uplink Outside Window',
          message:
            'hq-dist-sw02 (10.10.2.2) modified outside maintenance window: VLAN 999 (UNMANAGED_IOT_BYPASS) added to trunk interfaces ge-0/1/0 and ge-0/0/1.',
          outsideMaintenanceWindow: 1,
          addedLines: 3,
          removedLines: 2,
          riskCategories: JSON.stringify(['VLAN / Switching / Trunking']),
          acknowledged: 0,
          createdAt: iso2hAgo,
        },
      });
    } else if (d.hostname === 'br-access-sw01') {
      await prisma.alert.create({
        data: {
          deviceId,
          snapshotId: latestSnapId,
          severity: 'WARNING',
          alertType: 'STALE_BACKUP',
          title: 'Stale Backup Risk: Last Known-Good Config is 94 Days Old',
          message:
            'br-access-sw01 (10.20.2.1) in Branch-DC (Frankfurt) has not completed a scheduled config backup in 94 days. Run a live backup verification immediately.',
          outsideMaintenanceWindow: 0,
          addedLines: 0,
          removedLines: 0,
          riskCategories: JSON.stringify(['Backup Freshness / Recovery Readiness']),
          acknowledged: 0,
          createdAt: iso6hAgo,
        },
      });
    }
  }

  // Bulk create neighbor links
  if (allNeighborRows.length > 0) {
    await prisma.neighborLink.createMany({ data: allNeighborRows });
  }

  // 5. Compliance Rules
  await prisma.complianceRule.createMany({
    data: BUILTIN_COMPLIANCE_RULES.map((r) => ({
      ruleId: r.rule_id,
      name: r.name,
      description: r.description,
      severity: r.severity,
      vendor: r.vendor,
      patternType: r.pattern_type,
      pattern: r.pattern,
      remediationCli: r.remediation_cli,
      enabled: 1,
      createdAt: iso2dAgo,
    })),
  });

  // 6. Audit Logs
  await prisma.auditLog.createMany({
    data: [
      {
        timestamp: isoNow,
        action: 'SYSTEM_STARTUP',
        severity: 'INFO',
        actor: 'NetGuardia Daemon',
        target: 'Fleet Core',
        details: 'NetGuardia platform online: 11 multi-vendor devices monitored across 2 sites.',
        metadataJson: JSON.stringify({ devices_count: 11, sites: 2 }),
      },
      {
        timestamp: iso2hAgo,
        action: 'DRIFT_DETECTED',
        severity: 'CRITICAL',
        actor: 'Automated Drift Engine',
        target: 'hq-edge-fw01',
        details:
          'Out-of-window drift: unauthorized Telnet enable and WAN ACL bypass detected on hq-edge-fw01.',
        metadataJson: JSON.stringify({ risk: 'CRITICAL', added_lines: 3 }),
      },
      {
        timestamp: iso6hAgo,
        action: 'BACKUP_RUN',
        severity: 'SUCCESS',
        actor: 'Scheduled Collector',
        target: 'Fleet (11 devices)',
        details:
          'Scheduled fleet backup cycle completed; 10 devices verified, 1 device flagged stale.',
        metadataJson: JSON.stringify({ clean: 10, stale: 1 }),
      },
    ],
  });
}
