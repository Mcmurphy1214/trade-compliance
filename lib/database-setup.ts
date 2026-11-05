import statements from "./database-schema.json";

// Only cache completed setup. Concurrent cold requests can safely run the same
// idempotent DDL without sharing request-scoped I/O promises across requests.
const initialized = new WeakSet<D1Database>();

export async function ensureDatabase(db: D1Database): Promise<void> {
  if (initialized.has(db)) return;
  const results = await db.batch(statements.map((sql) => db.prepare(sql)));
  if (results.some((result) => !result.success)) {
    throw new Error("Database table initialization failed");
  }
  initialized.add(db);
}
