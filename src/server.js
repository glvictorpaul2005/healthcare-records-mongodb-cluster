const express = require("express");
const { connect } = require("./db");
const { login, authenticate, authorize } = require("./rbac");
const C = require("./crypto");

const keys = C.loadOrCreateKeys();
const app = express();
app.use(express.json({ limit: "256kb" }));

let store;
const log = (req, action, detail = {}) =>
  store.audit.insertOne({ at: new Date(), user: req.user?.sub, role: req.user?.role, action, ...detail }).catch(() => {});

app.get("/health", async (_req, res) => {
  const hello = await store.db.admin().command({ hello: 1 });
  res.json({ ok: true, primary: hello.primary, hosts: hello.hosts, setName: hello.setName });
});

app.post("/auth/login", (req, res) => {
  const token = login(req.body.username, req.body.password);
  token ? res.json({ token }) : res.status(401).json({ error: "bad credentials" });
});

// Append-only: each write creates a new signed version chained to the previous one.
app.post("/records", authenticate, authorize("records:write"), async (req, res) => {
  const { patientId, data } = req.body;
  if (!patientId || typeof data !== "object") return res.status(400).json({ error: "patientId and data required" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const prev = await store.records.find({ patientId }).sort({ version: -1 }).limit(1).next();
    const rec = { patientId, data, createdBy: req.user.sub, createdAt: new Date().toISOString(), version: (prev?.version || 0) + 1 };
    rec.prevHash = prev?.hash || C.GENESIS;
    rec.hash = C.hashRecord(C.payloadOf(rec), rec.prevHash);
    rec.signature = C.sign(rec.hash, keys.privateKey);
    try {
      await store.records.insertOne(rec);
      await log(req, "record:create", { patientId, version: rec.version });
      return res.status(201).json({ patientId, version: rec.version, hash: rec.hash });
    } catch (e) {
      if (e.code !== 11000) throw e; // duplicate version -> concurrent writer, retry
    }
  }
  res.status(409).json({ error: "concurrent write conflict, retry" });
});

app.get("/records/:patientId", authenticate, authorize("records:read"), async (req, res) => {
  const docs = await store.records.find({ patientId: req.params.patientId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 }).limit(100).toArray();
  await log(req, "record:read", { patientId: req.params.patientId });
  res.json(docs);
});

// Re-computes every hash and checks every signature + the chain links.
app.get("/records/:patientId/verify", authenticate, authorize("records:verify"), async (req, res) => {
  const docs = await store.records.find({ patientId: req.params.patientId }).sort({ version: 1 }).toArray();
  let prevHash = C.GENESIS; const problems = [];
  for (const r of docs) {
    if (r.prevHash !== prevHash) problems.push({ version: r.version, issue: "chain broken" });
    if (C.hashRecord(C.payloadOf(r), r.prevHash) !== r.hash) problems.push({ version: r.version, issue: "content altered" });
    if (!C.verify(r.hash, r.signature, keys.publicKey)) problems.push({ version: r.version, issue: "bad signature" });
    prevHash = r.hash;
  }
  res.json({ patientId: req.params.patientId, versions: docs.length, valid: problems.length === 0, problems });
});

// Aggregation pipeline: records per author over the last N days.
app.get("/stats/by-author", authenticate, authorize("stats:read"), async (req, res) => {
  const since = new Date(Date.now() - (Number(req.query.days) || 30) * 864e5).toISOString();
  res.json(await store.records.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: "$createdBy", records: { $sum: 1 }, patients: { $addToSet: "$patientId" } } },
    { $project: { author: "$_id", _id: 0, records: 1, uniquePatients: { $size: "$patients" } } },
    { $sort: { records: -1 } },
  ]).toArray());
});

app.get("/audit", authenticate, authorize("audit:read"), async (_req, res) =>
  res.json(await store.audit.find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(200).toArray()));

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: "internal error" }); });

connect().then((s) => {
  store = s;
  app.listen(process.env.PORT || 3000, () => console.log("API listening on", process.env.PORT || 3000));
}).catch((e) => { console.error("Mongo connection failed:", e.message); process.exit(1); });
