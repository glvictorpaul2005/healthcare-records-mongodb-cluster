#!/bin/bash
# Initiates the replica set once. Safe to re-run.
set -e
mongosh --host mongo1:27017 --quiet <<'JS'
try {
  rs.status();
  print("Replica set already initiated");
} catch (e) {
  rs.initiate({
    _id: "rs0",
    settings: { electionTimeoutMillis: 5000, heartbeatIntervalMillis: 1000 },
    members: [
      { _id: 0, host: "mongo1:27017", priority: 2 },
      { _id: 1, host: "mongo2:27017", priority: 1 },
      { _id: 2, host: "mongo3:27017", priority: 1 }
    ]
  });
  print("Replica set initiated");
}
JS
