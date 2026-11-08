#!/usr/bin/env node
/**
 * PRIMEMET — local development MongoDB (in-memory, single-node replica set).
 *
 * Phase 1 code uses transactions for multi-collection writes (user + organisation + profile, and the
 * listing approval that touches two collections). Transactions require a replica set, so a plain
 * standalone `mongod` is not enough for local work — this script starts one and prints the URI.
 *
 * It is for LOCAL DEVELOPMENT AND TESTS ONLY. It binds to the loopback interface, is destroyed when
 * the process exits, and never reads or writes a real cluster. That is the point: the directive is
 * explicit that a production database is never used for local tests, and `src/lib/env.ts` refuses a
 * production database name outside `PRIMEMET_ENV=production` in any case.
 *
 *   node scripts/dev-mongo.mjs            # start, print "MONGODB_URI=..." and stay in the foreground
 *   node scripts/dev-mongo.mjs --port 27027
 *
 * The binary is the one already cached by mongodb-memory-server; no download happens when it is present.
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";

const argv = process.argv.slice(2);
const portFlag = argv.indexOf("--port");
const port = portFlag === -1 ? 27027 : Number(argv[portFlag + 1]);

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("dev-mongo: --port must be an integer between 1024 and 65535");
  process.exit(1);
}

const server = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: "wiredTiger" },
  instanceOpts: [{ port, ip: "127.0.0.1" }],
  binary: { version: "7.0.14" },
});

const uri = server.getUri();
console.log(`MONGODB_URI=${uri}`);
console.log(`MONGODB_DB=primemet_dev`);
console.log(`PRIMEMET_ENV=development`);
console.log("dev-mongo: ready (Ctrl+C to stop; all data is discarded)");

async function stop() {
  await server.stop();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);