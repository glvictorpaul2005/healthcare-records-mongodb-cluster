// Tamper demo: modify a record directly in Mongo, then call /verify and watch it fail.
//   node scripts/verify_chain.js P1001
const { MongoClient } = require("mongodb");
(async () => {
  const pid = process.argv[2] || "P1001";
  const c = await new MongoClient(process.env.MONGO_URI || "mongodb://localhost:27017/?replicaSet=rs0").connect();
  const r = await c.db(process.env.DB_NAME || "healthcare").collection("records")
    .updateOne({ patientId: pid, version: 1 }, { $set: { "data.tampered": true } });
  console.log(`Tampered with ${r.modifiedCount} record(s). Now GET /records/${pid}/verify -> valid:false expected.`);
  await c.close();
})();
