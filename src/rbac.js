// Role-Based Access Control with JWT.
const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET || "dev-secret";

const PERMISSIONS = {
  admin:   ["audit:read", "records:verify", "stats:read"],
  doctor:  ["records:write", "records:read", "records:verify"],
  nurse:   ["records:read"],
  patient: ["records:read:own"],
};

// DEMO USERS ONLY. Replace with a real user store + hashed passwords.
const USERS = {
  drsmith: { password: "doctor123", role: "doctor" },
  nurse1:  { password: "nurse123",  role: "nurse" },
  admin1:  { password: "admin123",  role: "admin" },
  p1001:   { password: "patient123", role: "patient", patientId: "P1001" },
};

function login(username, password) {
  const u = USERS[username];
  if (!u || u.password !== password) return null;
  return jwt.sign({ sub: username, role: u.role, patientId: u.patientId }, SECRET, { expiresIn: "1h" });
}

function authenticate(req, res, next) {
  const h = req.headers.authorization || "";
  try {
    req.user = jwt.verify(h.replace(/^Bearer /, ""), SECRET);
    next();
  } catch {
    res.status(401).json({ error: "invalid or missing token" });
  }
}

// require("records:read") or, for patients, ownership of :patientId
function authorize(permission) {
  return (req, res, next) => {
    const perms = PERMISSIONS[req.user.role] || [];
    if (perms.includes(permission)) return next();
    if (permission === "records:read" && perms.includes("records:read:own") &&
        req.user.patientId === req.params.patientId) return next();
    res.status(403).json({ error: `role '${req.user.role}' lacks '${permission}'` });
  };
}

module.exports = { login, authenticate, authorize };
