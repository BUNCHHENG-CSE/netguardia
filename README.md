# TCT NetGuardia (`tct-netguardia`)

**Network Config Baseline, Topology & Compliance Automator**

**TCT NetGuardia** is an agentless, multi-vendor network configuration backup, noise-filtered diff engine, CIS compliance scanner, and LLDP/CDP topology mapper with a live blast-radius simulator.

---

## Key Capabilities

- **Live Fleet Readiness Verification**: 1-click audit across Cisco IOS/IOS-XE/ASA, Juniper Junos, and Ubiquiti EdgeOS/UniFi hardware.
- **Noise-Filtered LKG Diff Engine**: Strips volatile timestamps and counters prior to SHA-256 hashing to eliminate false-positive drift alerts.
- **Automated Rollback CLI Generator**: Produces vendor-native rollback commands (`configure terminal`, `configure exclusive`, etc.) to restore configurations to the Last-Known-Good (LKG) baseline.
- **Interactive LLDP/CDP Topology & Blast-Radius Simulator**: Visualizes hierarchical network links, detects unmanaged shadow devices, and simulates downstream isolation before maintenance.
- **Encrypted Credential Vault**: AES-128-CBC + HMAC-SHA256 (Fernet) secret storage with 1-click SSH authentication testing.

---

## Getting Started

### Next.js Full-Stack App (Bun / Node)

```bash
# Install dependencies
bun install

# Prepare and seed the database
bun run db:prepare
bun run db:push
bun run db:seed

# Start the development server on http://localhost:3000
bun dev
```

### FastAPI + Vite Appliance Mode

```powershell
# Launch unified FastAPI backend & pre-built web interface on http://localhost:8000
.\start.ps1
```

For full architecture details, database schema, and API reference, see [DOCUMENTATION.md](./DOCUMENTATION.md).
