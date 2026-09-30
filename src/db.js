// MongoDB connection tuned for high availability and zero data loss.
const { MongoClient, ReadPreference } = require("mongodb");

const URI = process.env.MONGO_URI || "mongodb://localhost:27017/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "healthcare";

const client = new MongoClient(URI, {
  retryWrites: true,                               // transparently retry once after a primary election
  retryReads: true,
  writeConcern: { w: "majority", j: true },        // acknowledged only after a majority has journaled -> survives failover
  readConcern: { level: "majority" },              // never read data that could be rolled back
  readPreference: ReadPreference.PRIMARY_PREFERRED,// fall back to secondaries while a new primary is elected
  serverSelectionTimeoutMS: 15000,
  heartbeatFrequencyMS: 1000,
  maxPoolSize: 100,
});

async function connect() {
  await client.connect();
  const db = client.db(DB_NAME);
  const records = db.collection("records");
  const audit = db.collection("audit");

  // Compound indexes for the hot query paths.
  await records.createIndex({ patientId: 1, createdAt: -1 }, { name: "patient_time" });
  await records.createIndex({ createdBy: 1, createdAt: -1 }, { name: "author_time" });
  await records.createIndex({ patientId: 1, version: -1 }, { unique: true, name: "patient_version_unique" });
  await audit.createIndex({ at: -1 });
  return { db, records, audit, client };
}

module.exports = { connect };
