// Tamper-evident records: SHA-256 hash chain + RSA digital signatures.
//  hash      = SHA256(canonical(record) + prevHash)   -> any edit breaks the chain
//  signature = RSA-SHA256(hash, privateKey)           -> non-repudiation (only key holder can sign)
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY_DIR = path.join(__dirname, "..", "keys");
const PRIV = path.join(KEY_DIR, "private.pem");
const PUB = path.join(KEY_DIR, "public.pem");

function loadOrCreateKeys() {
  if (!fs.existsSync(PRIV)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 3072,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    fs.writeFileSync(PRIV, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUB, publicKey);
  }
  return { privateKey: fs.readFileSync(PRIV, "utf8"), publicKey: fs.readFileSync(PUB, "utf8") };
}

// Deterministic JSON (sorted keys) so the same record always hashes the same.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const GENESIS = "0".repeat(64);

function hashRecord(payload, prevHash = GENESIS) {
  return crypto.createHash("sha256").update(canonical(payload) + prevHash).digest("hex");
}

function sign(hash, privateKey) {
  return crypto.sign("sha256", Buffer.from(hash, "hex"), privateKey).toString("base64");
}

function verify(hash, signature, publicKey) {
  return crypto.verify("sha256", Buffer.from(hash, "hex"), publicKey, Buffer.from(signature, "base64"));
}

// The fields covered by the hash. Keep in sync between create and verify.
function payloadOf(r) {
  return { patientId: r.patientId, data: r.data, createdBy: r.createdBy, createdAt: r.createdAt, version: r.version };
}

module.exports = { loadOrCreateKeys, hashRecord, sign, verify, payloadOf, GENESIS };
