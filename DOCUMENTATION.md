# TCT NetGuardia — Network Config & Topology Automator
### Comprehensive Technical Architecture, Operational Guide & System Documentation

---

## 1. Executive Summary & Purpose

**TCT NetGuardia** is an agentless, multi-vendor network configuration management, automated backup verification, and topology visualization platform purpose-built for **small IT teams (1–10 engineers)** managing **10–200 heterogeneous network devices** (routers, firewalls, core/distribution/access switches, and wireless controllers).

In small-to-medium enterprise (SME) IT environments, network management is frequently hindered by three major operational challenges:
1. **Silent Backup Decay**: Engineers configure scheduled backups, but over months, credentials expire, SSH keys change, IP addresses are renumbered, or disks fill up. Nobody notices that a critical switch has not successfully backed up in 94 days until a power outage causes hardware failure and there is no working configuration to restore.
2. **Alert Fatigue from Volatile Config Noise**: Basic diff tools flag changes whenever `ntp clock-period`, `! Last configuration change at...`, or Juniper commit timestamps update. Engineers learn to ignore automated alerts, causing true unauthorized changes (such as rogue ACL permits or backdoor accounts) to slip through undetected.
3. **Topology Blindness & Blast-Radius Uncertainty**: Network diagrams in Visio or draw.io become stale within weeks of creation. When a core switch or distribution uplink needs emergency patching or suffers a hardware failure, teams cannot instantly predict which downstream access switches, Wi-Fi access points, or departmental subnets will lose connectivity.

TCT NetGuardia eliminates these pain points through **1-click live fleet readiness verification**, **volatile noise-filtered side-by-side diffing**, **automated vendor-specific rollback CLI generation**, and an **agentless LLDP/CDP topology graph with a live blast-radius simulator**.

---

## 2. System Architecture & Technology Stack

TCT NetGuardia is built as a lightweight, production-grade, full-stack application that can run either as a **standalone local appliance** (single-binary / single-script deployment using SQLite WAL mode) or as a **multi-site enterprise SaaS** backed by PostgreSQL.

```
+---------------------------------------------------------------------------------------+
|                                    USER INTERFACE                                     |
|           React 18 + TypeScript + Vite + Tailwind CSS + Lucide Icons + Theme Engine   |
|   (Dashboard | Device Management | Diff Viewer | Topology & Blast-Radius | Vault)     |
+-------------------------------------------+-------------------------------------------+
                                            | REST API / JSON
                                            v
+---------------------------------------------------------------------------------------+
|                                   BACKEND SERVICES                                    |
|                                FastAPI (Python 3.10+)                                 |
+-------------------+-------------------+-------------------+---------------------------+
|  Readiness &      | Multi-Vendor SSH  | Normalization &   | Topology Graph &          |
|  Backup Engine    | Collector / Lab   | Diff Engine       | Blast-Radius Simulator    |
|  - Fleet Audit    |  - Paramiko SSH2  |  - Noise Filter   |  - CDP/LLDP Parsers       |
|  - Stale Checker  |  - Simulated Lab  |  - Risk Classifier|  - Downstream Isolation   |
|  - LKG Baseline   |  - Multi-Platform |  - Rollback CLI   |  - Shadow Peer Discovery  |
+-------------------+-------------------+-------------------+---------------------------+
|                           Encrypted Credential Vault (Fernet)                         |
|                    AES-128-CBC + HMAC-SHA256 with PBKDF2 Key Derivation               |
+-------------------------------------------+-------------------------------------------+
                                            |
                                            v
+---------------------------------------------------------------------------------------+
|                             DATA LAYER & PRISMA ORM                                   |
|               prisma/schema.prisma & PrismaClient (SQLAlchemy 2.0 / psycopg3)         |
|  - Zero-N+1 Joined Loads   - Core Bulk DML (create_many)   - Atomic prisma.tx()       |
+-------------------------------------------+-------------------------------------------+
                     |                                              |
                     v                                              v
      +-----------------------------+                +-----------------------------+
      |      Local Appliance        |                |     Production Multi-Site   |
      |   SQLite 3 with WAL Mode    |                |       PostgreSQL 14–17      |
      |      (Zero Config)          |                |      (QueuePool, High HA)   |
      +-----------------------------+                +-----------------------------+
```

### Technology Breakdown

| Component | Technology | Rationale & Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | React 18, TypeScript, Vite | Single-page application with immediate reactive updates, sub-second HMR development, and typed API models. |
| **Styling & UI Components** | Tailwind CSS, Lucide React | High-density NOC aesthetic with accessible dark/light mode and zero heavy UI runtime overhead. |
| **Backend API** | FastAPI, Pydantic v2, Uvicorn | High-performance asynchronous REST API with automatic OpenAPI documentation (`/docs`) and strict payload validation. |
| **SSH Collector Engine** | Paramiko 3.4+ | Agentless, standards-compliant SSHv2 client supporting username/password, Cisco `enable` privilege escalation, and RSA/OpenSSH key authentication. |
| **Cryptography** | `cryptography` (Fernet) | AES-128-CBC + HMAC-SHA256 authenticated encryption with PBKDF2-HMAC-SHA256 (200,000 iterations) for secrets at rest. |
| **Database ORM** | Prisma Schema + Custom Fluent ORM | Declarative `schema.prisma` definition providing type safety, eager loading (`include`), bulk DML (`create_many`), and transaction scopes (`prisma.tx()`). |
| **Dual Database Support**| SQLite WAL & PostgreSQL | Zero-setup single-appliance deployment out-of-the-box, with seamless one-line switch to PostgreSQL for high-scale enterprise operations. |

---

## 3. How It Works (Core Subsystems)

### 3.1. The Encrypted Credential Vault (`backend/vault.py`)
Network device credentials (SSH passwords, enable secrets, private keys, SNMP communities) must never be stored in plaintext. TCT NetGuardia uses a cryptographic vault:
- **Key Derivation**: If the environment variable `NETGUARDIA_VAULT_SECRET` is set, a 256-bit encryption key is derived using PBKDF2-HMAC-SHA256 with 200,000 iterations. If not set, a local master key file (`.vault_master.key`) is automatically generated and secured on disk.
- **Envelope Encryption**: Secrets are encrypted using Fernet (AES-128 in CBC mode with PKCS7 padding, authenticated using HMAC-SHA256).
- **Masking in API Responses**: Encrypted values are never returned in plaintext to the UI. The API returns masked tokens (e.g., `••••••••01` or `Not configured`).
- **Live Verification**: A 1-click credential test connects to all assigned devices and validates whether the stored credentials successfully authenticate, measuring latency in milliseconds.

---

### 3.2. Multi-Vendor Config Collection & Lab Simulator (`backend/collectors.py`)
TCT NetGuardia operates in dual-mode:
1. **Live Hardware Mode (Agentless Paramiko SSH)**:
   - Disables terminal paging (`terminal length 0` on Cisco/Ubiquiti; `set cli screen-length 0` on Juniper).
   - Executes vendor configuration retrieval commands (`show running-config`, `show configuration | display set`, `show configuration commands`).
   - Retrieves Layer-2/Layer-3 discovery neighbor tables (`show cdp neighbors detail`, `show lldp neighbors detail`, `show lldp neighbors`, `lldpctl`).
2. **Multi-Vendor Lab Simulator Mode**:
   - Includes full virtual configurations and real CLI output for Cisco IOS-XE, Juniper Junos, and Ubiquiti EdgeOS/UniFi.
   - Accurately generates volatile headers (e.g., timestamps and clock rates) upon every poll to test the noise filtering algorithms without requiring physical networking hardware.
   - Includes a **Simulated Drift Injector** allowing operators to simulate rogue ACL openings, backdoor admin accounts, OSPF route leaks, and unauthorized VLAN trunk mutations with a single click.

---

### 3.3. Config Normalization & Volatile Noise Filter (`backend/diff_engine.py`)
Traditional diff tools compare raw text line-by-line. Network hardware regularly outputs lines that change on every poll even when no administrative change was made.

TCT NetGuardia implements regular expression noise strippers for all major platforms:
- **Cisco IOS/IOS-XE/ASA**: Strips `! Last configuration change at...`, `! NVRAM config last updated at...`, `ntp clock-period <number>`, `Current configuration : <bytes>`, and `Building configuration...`.
- **Juniper Junos**: Strips `## Last commit: ...`, `## Last changed: ...`, and `/* Warning: Do not remove... */`.
- **Ubiquiti EdgeOS/UniFi**: Strips `# generated by ... at <timestamp>`.

#### Dual Hash Architecture:
For every snapshot, TCT NetGuardia calculates two SHA-256 hashes:
1. `raw_hash`: Hash of the unaltered raw output from the device.
2. `normalized_hash`: Hash of the configuration with volatile lines stripped, trailing spaces removed, and line endings normalized (`\r\n` -> `\n`).

> **Operational Impact**: If `raw_hash` changes but `normalized_hash` remains identical, TCT NetGuardia knows that only volatile device noise changed. **No false-positive alert is created**, keeping the NOC alert queue clean.

---

### 3.4. Diff Engine, Risk Analyzer & Rollback CLI Generator (`backend/diff_engine.py`)
When a true configuration drift occurs (`normalized_hash` changes), the diff engine performs a deep comparison between the **Last-Known-Good (LKG)** baseline and the current running snapshot:
- **Side-by-Side & Unified Diffs**: Displays exact additions, deletions, and modifications with synchronized line numbers.
- **Real-Time Risk Categorization**: Added and removed lines are parsed against security rules:
  - `CRITICAL`: Firewall/ACL Exposure (e.g., `permit tcp any any eq 22`, `access-list`, `security-zone`).
  - `CRITICAL`: Authentication & Privilege Change (e.g., `username ... privilege 15`, `enable secret`, `aaa new-model`).
  - `HIGH`: Management & Insecure Protocols (e.g., `transport input telnet`, `snmp-server community ... RW`).
  - `HIGH`: Routing Policy Drift (e.g., `router ospf`, `router bgp`, `ip route 0.0.0.0`).
  - `MEDIUM`: Switching / VLAN Trunking (e.g., `switchport trunk allowed vlan`, `vlan 999`).
- **Automated Rollback CLI Generation**: The engine reverses the diff and generates native, syntax-accurate CLI scripts ready to paste into the device terminal:
  - **Cisco IOS/IOS-XE**: Inserts `configure terminal`, prepends `no ` to added lines, re-applies removed lines, and appends `end` and `write memory`.
  - **Juniper Junos**: Uses candidate configuration syntax: `configure exclusive`, converts added `set` statements to `delete`, re-issues removed `set` statements, and runs `commit check` and `commit comment "Rollback to Last-Known-Good via TCT NetGuardia"`.
  - **Ubiquiti EdgeOS**: Generates `configure`, `delete <path>`, restores missing commands, and performs `commit` and `save`.

---

### 3.5. Agentless Topology Discovery & Blast-Radius Engine (`backend/topology_engine.py`)
TCT NetGuardia automatically discovers how devices are interconnected without installing SNMP agents or vendor proprietary software:
- **Multi-Vendor LLDP/CDP CLI Parsers**: Ingests raw terminal output from `show cdp neighbors detail`, `show lldp neighbors detail`, Junos tabular LLDP, and Ubiquiti block-format `lldpctl`.
- **Deduplication & Link Aggregation**: Correlates bidirectional links (e.g., Device A Port 1 <-> Device B Port 2) into single canonical edges.
- **Shadow / Unmanaged Device Detection**: If a neighbor device appears in CDP/LLDP tables that does not exist in TCT NetGuardia's inventory (such as a rogue access point `hq-shadow-ap99`), the engine creates a special unmanaged node in the graph, alerting engineers to unapproved devices on the physical network.
- **Blast-Radius Graph Traversal**:
  - Automatically identifies root WAN gateways and edge firewalls (Tier 0).
  - Uses breadth-first search (BFS) graph reachability to model network paths before failure.
  - When an operator selects a device to test, TCT NetGuardia blocks that node and recomputes reachability from the WAN root gateways.
  - Nodes that lose all connectivity to the WAN are classified as `isolated_downstream` (red alert).
  - Nodes that lose a redundant link but retain an alternate path are classified as `degraded_redundant` (yellow alert).
  - The engine also reports the failed device's **Recovery Readiness** (whether an up-to-date LKG backup exists to immediately restore it).

---

### 3.6. Maintenance Windows & Out-of-Window Drift Alerting (`backend/main.py`)
Small IT teams cannot watch dashboards 24/7. TCT NetGuardia introduces policy-driven change classification:
- **Maintenance Windows**: Defined per site or globally (e.g., `Sunday 02:00–04:00 UTC` for Austin HQ).
- **Auto-Promotion to LKG**: Changes detected **inside** an active maintenance window are treated as planned work and automatically promoted to the new Last-Known-Good baseline.
- **Out-of-Window Drift Alerts**: Changes detected **outside** approved maintenance windows generate high-priority security drift alerts with risk tags, added/removed line metrics, and Webhook/Email notifications.
- **Active Override**: Operators can manually toggle an emergency maintenance window override with one click during ad-hoc change tickets.

---

## 4. What TCT NetGuardia Can Do (Feature Catalog)

### 4.1. NOC Dashboard & Fleet Health
- **Live Fleet Readiness Score (0–100%)**: Instant percentage calculation of devices with clean, verified, non-stale backups.
- **Fleet Verification Trigger**: 1-click audit answering: *"When did you last verify that your backup actually ran and authenticated?"*
- **Issue Queue Filter**: Instantly isolate drifted devices, stale devices (>7 days since backup), and unacknowledged alerts.
- **SaaS ROI Telemetry**: Calculates estimated manual engineer hours saved monthly (1.4 hours/device/month) and estimated downtime cost avoided ($1,250/device).

### 4.2. Multi-Vendor Device Management
- **Fleet Inventory**: Search by hostname, IP address, model, vendor, or site.
- **Multi-Vendor Support**: Out-of-the-box support for Cisco (Catalyst, ISR, ASA, Nexus), Juniper (EX switches, SRX firewalls), and Ubiquiti (UniFi Pro, EdgeSwitch, EdgeRouter).
- **Live On-Demand Backup**: Trigger instant backup on single devices or the entire fleet simultaneously.
- **Drift Simulation Lab**: Test NOC response procedures by injecting realistic drift scenarios:
  - *Unauthorized WAN SSH/Telnet ACL Exposure*
  - *Unapproved Routing / OSPF Metric & Static Route Leak*
  - *Privilege-15 Local Backdoor User & Read-Write SNMP Community*
  - *Core Trunk Allowed VLAN Bypass (VLAN 999)*

### 4.3. Visual Side-by-Side Diff Viewer
- **Multi-Version Snapshot History**: Compare any historical snapshot version against any other.
- **Volatile Noise Stripping Toggle**: Switch between raw diff and noise-filtered diff with real-time counts of suppressed noise lines.
- **Diff Modes**: Side-by-side view, unified diff view, and vendor rollback CLI tab.
- **1-Click Baseline Promotion**: Promote any historical snapshot to be the new Last-Known-Good baseline.
- **Automated Rollback Execution**: 1-click rollback restoring the device configuration back to LKG.

### 4.4. Interactive Topology Map & CLI Parser Sandbox
- **Hierarchical Layout**: Automatic Tier 0 (Gateway/WAN), Tier 1 (Core), Tier 2 (Distribution), and Tier 3 (Access/Edge) positioning.
- **Interactive Blast-Radius Simulator**: Click any router, firewall, or switch to view downstream isolation and degraded links.
- **Shadow AP & Rogue Device Alert**: Discovered CDP/LLDP neighbors that lack inventory records are highlighted with distinct styling.
- **CLI Parser Sandbox**: Paste raw terminal output from any Cisco, Juniper, or Ubiquiti switch into the sandbox to test parsing before connecting live hardware.

### 4.5. Maintenance Windows & Alert Management
- **Recurring Schedule Configuration**: Define scheduled maintenance periods by day-of-week and UTC time ranges.
- **Drift Alert Workflow**: Review affected risk categories, view unified diffs, and acknowledge alerts.
- **Webhook & Slack Notifications**: Configurable Webhook URLs for Slack, Microsoft Teams, or custom NOC monitoring platforms.

### 4.6. Encrypted Credential Vault
- **Centralized Credential Profiles**: Assign one credential profile to hundreds of devices.
- **Protocol Flexibility**: Supports SSH passwords, Cisco enable secrets, RSA/OpenSSH private keys, and SNMPv2c/v3 communities.
- **Automated Verification**: Test authentication against all assigned hardware and view response latency breakdown.

---

## 5. How Useful It Is (Business Value & ROI)

Small IT teams do not have the budget or dedicated headcount to deploy six-figure enterprise suites like Cisco DNA Center, SolarWinds NCM, or NetBrain. TCT NetGuardia provides the high-value 20% of features that prevent 80% of outages:

| Traditional Network Management | With TCT NetGuardia |
| :--- | :--- |
| **"Hope and Pray" Backups**: Cron scripts run silently; failures are discovered only after hardware dies. | **Proactive Fleet Verification**: 1-click fleet audit verifies SSH authentication and flags stale backups. |
| **Alert Fatigue**: Diff alerts fire every 6 hours due to NTP clock periods and uptime counters. | **Noise-Filtered Hashing**: Volatile lines are stripped before SHA-256 calculation; zero false-positive drift alerts. |
| **Manual Rollback Guesswork**: Under high-pressure outages, engineers scramble to write rollback commands from memory. | **Automated Rollback CLI**: Generates copy-paste ready Cisco, Juniper, and Ubiquiti rollback scripts instantly. |
| **Outdated Visio Diagrams**: Network diagrams are weeks or months out of date. | **Self-Healing LLDP/CDP Topology**: Maps are dynamically generated from live neighbor tables every backup cycle. |
| **Unknown Failure Blast-Radius**: Taking down a switch for maintenance unexpectedly disconnects critical departments. | **Blast-Radius Simulator**: Predicts downstream isolated devices before touching physical cables or rebooting gear. |
| **Unapproved Changes Slip By**: Engineers make ad-hoc CLI changes during the week without change tickets. | **Out-of-Window Drift Engine**: Changes outside scheduled maintenance windows trigger high-priority alerts. |

### Quantifiable ROI:
- **Time Savings**: A team managing 50 devices saves ~70 hours per month in manual configuration archiving, compliance verification, and diagram updating.
- **Downtime Prevention**: The average enterprise outage costs \$5,000–\$9,000 per minute. Preventing a single unauthorized configuration error or cutting MTTR (Mean Time to Recovery) from 4 hours to 5 minutes pays for TCT NetGuardia indefinitely.

---

## 6. Multi-Vendor Platform Support

| Vendor & Operating System | Config Collection Method | Neighbor Discovery Protocol | Automated Rollback CLI |
| :--- | :--- | :--- | :--- |
| **Cisco IOS / IOS-XE** | SSH (`show running-config`) | CDP (`show cdp neighbors detail`) & LLDP | `configure terminal` / `no ...` / `write memory` |
| **Cisco ASA** | SSH (`show running-config`) | CDP / LLDP | `configure terminal` / `no ...` |
| **Juniper Junos (EX/SRX)**| SSH (`show configuration \| display set`) | LLDP (`show lldp neighbors`) | `configure exclusive` / `delete ...` / `commit` |
| **Ubiquiti EdgeOS** | SSH (`show configuration commands`) | LLDP (`lldpctl`, `show lldp neighbors`) | `configure` / `delete ...` / `commit` / `save` |
| **Ubiquiti UniFi Pro** | SSH (`terminal length 0` + commands) | LLDP (`lldpctl`) | `configure` / `delete ...` / `commit` / `save` |

---

## 7. Database Models & Schema Reference (`prisma/schema.prisma`)

TCT NetGuardia's schema is declaratively defined in `prisma/schema.prisma` and backed by the custom fluent ORM client in `backend/prisma_client.py`:

```
+--------------------+       +--------------------+       +----------------------+
|    Credential      | 1   * |       Device       | 1   * |    ConfigSnapshot    |
+--------------------+<----->+--------------------+<----->+----------------------+
| id (PK)            |       | id (PK)            |       | id (PK)              |
| name               |       | hostname (UQ)      |       | device_id (FK)       |
| protocol           |       | ip_address         |       | version_number       |
| username           |       | vendor / model     |       | config_text          |
| encrypted_password |       | role / site        |       | raw_hash             |
| encrypted_key      |       | credential_id (FK) |       | normalized_hash      |
| encrypted_snmp     |       | drift_detected     |       | is_lkg (0/1)         |
| last_verified_at   |       | lkg_snapshot_id    |       | in_maintenance_window|
+--------------------+       | last_backup_at     |       | created_at           |
                             +--------------------+       +----------------------+
                                | 1            | 1
                                | *            | *
                                v              v
                     +--------------------+  +----------------------+
                     |    NeighborLink    |  |        Alert         |
                     +--------------------+  +----------------------+
                     | id (PK)            |  | id (PK)              |
                     | device_id (FK)     |  | device_id (FK)       |
                     | local_port         |  | severity             |
                     | remote_hostname    |  | alert_type           |
                     | remote_port        |  | title / message      |
                     | protocol (CDP/LLDP)|  | risk_categories      |
                     | updated_at         |  | acknowledged (0/1)   |
                     +--------------------+  +----------------------+
```

---

## 8. REST API Reference

The backend exposes an interactive OpenAPI Swagger interface at `http://localhost:8000/docs`. Key endpoints include:

### Fleet Overview & Readiness
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/overview` | Returns aggregate metrics (readiness score, drifted counts, stale devices, ROI estimates). |
| `POST` | `/api/verify-fleet-readiness` | Executes a live verification of SSH credentials, snapshot freshness, and LKG status. |
| `GET` | `/api/database-info` | Returns information about the active database engine (SQLite WAL vs. PostgreSQL). |
| `POST` | `/api/database-info/test-postgres`| Tests a live PostgreSQL connection string via `psycopg`. |
| `POST` | `/api/demo/reset` | Resets and re-seeds the entire database with realistic multi-vendor fleet telemetry. |

### Devices & Backups
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/devices` | Lists all network devices (eager-loaded with credential metadata, omitting heavy blobs). |
| `POST` | `/api/devices` | Onboards a new network device. |
| `DELETE`| `/api/devices/{device_id}` | Removes a device and cascades associated snapshots and neighbor links. |
| `POST` | `/api/devices/{device_id}/backup` | Executes an immediate backup and neighbor collection for a single device. |
| `POST` | `/api/backups/run-all` | Runs scheduled fleet-wide backup collection across all devices. |
| `GET` | `/api/devices/{device_id}/snapshots`| Returns metadata history of all backup versions for a device. |

### Diff & Rollback
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/devices/{device_id}/diff` | Computes side-by-side diff, risk analysis, and rollback CLI between LKG and Target. |
| `POST` | `/api/devices/{device_id}/promote-lkg/{snapshot_id}` | Pins a specific snapshot as the new Last-Known-Good baseline. |
| `POST` | `/api/devices/{device_id}/rollback-to-lkg` | Automatically rolls back device configuration to the LKG baseline. |
| `GET` | `/api/drift-scenarios` | Lists available drift simulation presets. |
| `POST` | `/api/devices/{device_id}/simulate-drift` | Injects a selected drift scenario into a device's running config. |

### Topology & Blast Radius
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/topology` | Returns deduplicated nodes and edges for the network graph, including shadow peers. |
| `GET` | `/api/topology/blast-radius/{node_id}` | Simulates node failure and returns downstream isolated and degraded nodes. |
| `POST` | `/api/topology/parse-cli` | Standalone CLI sandbox parser for raw CDP and LLDP terminal outputs. |

### Maintenance Windows, Alerts & Vault
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/maintenance-windows` | Lists all recurring maintenance windows. |
| `POST` | `/api/maintenance-windows` | Creates a new maintenance window. |
| `PATCH`| `/api/maintenance-windows/{id}/toggle` | Toggles the active manual override status for a window. |
| `GET` | `/api/alerts` | Lists all active and historical configuration drift and stale backup alerts. |
| `POST` | `/api/alerts/{id}/acknowledge` | Acknowledges an alert. |
| `POST` | `/api/alerts/acknowledge-all` | Acknowledges all open alerts. |
| `GET` | `/api/credentials` | Lists masked credential profiles stored in the Encrypted Vault. |
| `POST` | `/api/credentials` | Encrypts and stores a new credential profile. |
| `POST` | `/api/credentials/{id}/verify` | Verifies a credential profile against all assigned devices over SSH. |

---

## 9. Quick Start & Operational Verification

### 9.1. Prerequisites
- **Python**: 3.10 or higher
- **Node.js**: 18.0 or higher (for building frontend)
- **PowerShell** (Windows) or **Bash** (Linux/macOS)

### 9.2. Single-Command Launch (FastAPI + Built SPA)
The production React frontend is pre-built into `frontend/dist`. You can launch the full-stack server on port 8000 with a single command:
```powershell
.\start.ps1
```
Open **http://localhost:8000** in your browser.

### 9.3. Development Mode (Hot Module Replacement)
If you are developing frontend components or customizing API endpoints:
```powershell
# Terminal 1: Backend API (Port 8000)
cd backend
python -m uvicorn main:app --reload --port 8000

# Terminal 2: Frontend Vite Dev Server (Port 5173)
cd frontend
npm run dev
```

### 9.4. Running the Automated Test Suite
Verify all vault encryption routines, diff algorithms, noise filters, parsers, and endpoints with `pytest`:
```powershell
python -m pytest backend/tests/test_core.py -v
```

---

## 10. Conclusion

TCT NetGuardia transforms network configuration management for small IT teams from an error-prone, reactive chore into a reliable, automated, and secure operational workflow. By combining **zero-agent SSH collection**, **noise-filtered diffing**, **automated vendor rollbacks**, and **agentless topology mapping with blast-radius simulation**, TCT NetGuardia empowers small teams to maintain enterprise-grade network visibility and resilience with minimal operational overhead.
