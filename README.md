# Fault-Tolerant Distributed Healthcare Record Architecture

A healthcare record store built on a **3-node MongoDB replica set** with automatic failover, **tamper-evident records** (SHA-256 hash chain + RSA digital signatures) and **Role-Based Access Control**.

```
            ┌──────────┐    JWT + RBAC    ┌──────────────────────────┐
 client ───►│ Node API │─────────────────►│ MongoDB replica set rs0  │
            └──────────┘  w:majority j:1  │  mongo1 (primary)        │
                 │ signs each record      │  mongo2 (secondary)      │
                 ▼                        │  mongo3 (secondary)      │
        RSA-3072 private key              └──────────────────────────┘
```

## Features
- **High availability** – replica set with 1s heartbeats and a 5s election timeout; if the primary dies a secondary is elected automatically. The driver uses `retryWrites`, `w: "majority"`, `j: true` and `readConcern: majority`, so acknowledged writes survive failover.
- **Tamper evidence** – every record is append-only and versioned. `hash = SHA256(canonical(record) + prevHash)` chains versions together and the hash is signed with RSA (`sha256WithRSAEncryption`). `GET /records/:id/verify` recomputes everything and reports altered or broken records.
- **RBAC** – roles `admin`, `doctor`, `nurse`, `patient` with per-permission checks; patients can read only their own record. Every read/write is written to an `audit` collection.
- **Query performance** – compound indexes (`patientId+createdAt`, `createdBy+createdAt`), a unique `patientId+version` index for concurrent-write safety, and an aggregation pipeline (`/stats/by-author`). `scripts/benchmark.js` measures the effect.

## Quick start
```bash
docker compose up --build -d          # 3 mongo nodes + init + API on :3000
curl localhost:3000/health            # shows the current primary
```

```bash
# login as a doctor
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"username":"drsmith","password":"doctor123"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')

# create a record
curl -X POST localhost:3000/records -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"patientId":"P1001","data":{"diagnosis":"hypertension","bp":"150/95"}}'

# read + verify integrity
curl localhost:3000/records/P1001 -H "authorization: Bearer $TOKEN"
curl localhost:3000/records/P1001/verify -H "authorization: Bearer $TOKEN"
```

Demo users (`rbac.js`, **demo only**): `drsmith/doctor123`, `nurse1/nurse123`, `admin1/admin123`, `p1001/patient123`.

## Demonstrate failover
```bash
docker compose exec mongo1 mongosh --quiet --eval 'rs.status().members.map(m=>[m.name,m.stateStr])'
docker compose stop mongo1                 # kill the primary
sleep 8
curl localhost:3000/health                 # a different node is now primary
# keep POSTing records while you stop mongo1: retryWrites + majority keeps them safe
docker compose start mongo1                # it rejoins as a secondary
```

## Demonstrate tamper detection
```bash
docker compose exec api node scripts/verify_chain.js P1001   # edits a record directly in the DB
curl localhost:3000/records/P1001/verify -H "authorization: Bearer $TOKEN"   # valid:false
```

## Benchmark (measure your own numbers)
```bash
# from your host, add to /etc/hosts:  127.0.0.1 mongo1 mongo2 mongo3
npm install
MONGO_URI="mongodb://mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0" npm run benchmark
```
Prints mean / p50 / p95 latency for 500 concurrent patient-history queries with and without the compound index. Record your results here:

| Scenario | mean (ms) | p95 (ms) |
|---|---|---|
| No index | | |
| Compound index | | |

## Production notes
Replace the demo user table with a real identity store and hashed passwords, keep the RSA key in a KMS/HSM, enable TLS + auth between Mongo nodes, and add field-level encryption for PHI. This is a learning project and is not HIPAA-certified.
