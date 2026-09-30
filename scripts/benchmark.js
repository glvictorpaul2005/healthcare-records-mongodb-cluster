// Measures patient-history query latency under 500 concurrent requests,
// with and without the compound index. Numbers are printed, not assumed.
//   MONGO_URI=... node scripts/benchmark.js [totalDocs=100000]
const { MongoClient } = require("mongodb");
const URI = process.env.MONGO_URI || "mongodb://localhost:27017/?replicaSet=rs0";
const TOTAL = Number(process.argv[2]) || 100000, PATIENTS = 5000, CONCURRENCY = 500;

async function timeQueries(coll, hint) {
  const lat = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    const pid = "P" + (1000 + Math.floor(Math.random() * PATIENTS));
    const s = process.hrtime.bigint();
    let cur = coll.find({ patientId: pid }).sort({ createdAt: -1 }).limit(20);
    if (hint) cur = cur.hint(hint);
    await cur.toArray();
    lat.push(Number(process.hrtime.bigint() - s) / 1e6);
  }));
  lat.sort((a, b) => a - b);
  const pct = (p) => lat[Math.floor(lat.length * p)].toFixed(1);
  return { mean_ms: (lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(1), p50_ms: pct(0.5), p95_ms: pct(0.95), wall_ms: Date.now() - t0 };
}

(async () => {
  const client = await new MongoClient(URI).connect();
  const coll = client.db("healthcare_bench").collection("records");
  await coll.drop().catch(() => {});
  console.log(`Seeding ${TOTAL} docs...`);
  for (let i = 0; i < TOTAL; i += 10000) {
    await coll.insertMany(Array.from({ length: Math.min(10000, TOTAL - i) }, (_, k) => ({
      patientId: "P" + (1000 + ((i + k) % PATIENTS)), createdBy: "drsmith",
      createdAt: new Date(Date.now() - Math.random() * 3e10).toISOString(), data: { note: "x".repeat(200) },
    })));
  }
  console.log("No index (collection scan):", await timeQueries(coll, { $natural: 1 }));
  await coll.createIndex({ patientId: 1, createdAt: -1 });
  console.log("Compound index           :", await timeQueries(coll, { patientId: 1, createdAt: -1 }));
  await coll.drop(); await client.close();
})();
