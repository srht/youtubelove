// D1 migration'larını Worker ilk istekte kendisi uygular.
//
// Kaynak tek: migrations/*.sql. Aynı dosyalar `wrangler d1 migrations apply` ile de uygulanabilir;
// ikisi de wrangler'ın `d1_migrations` tablosunu kullandığı için birbirini tekrar çalıştırmaz.
// Böylece Cloudflare panelinden yayın yapan site sahibinin elle komut çalıştırması gerekmez.

import m0001 from "../../migrations/0001_init.sql";

export const MIGRATIONS = [{ name: "0001_init.sql", sql: m0001 }];

/** SQL dosyasını tek tek ifadelere böler (yorum satırlarını atar). */
export function splitStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applyPending(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS d1_migrations(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`
    )
    .run();
  const { results } = await db.prepare("SELECT name FROM d1_migrations").all();
  const applied = new Set(results.map((r) => r.name));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    const statements = splitStatements(migration.sql).map((s) => db.prepare(s));
    statements.push(db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(migration.name));
    await db.batch(statements); // batch tek işlem: yarım uygulanmış migration kalmaz
  }
}

const done = new WeakMap();

/** İzolasyon başına bir kez çalışır; hata olursa bir sonraki istekte yeniden dener. */
export function ensureMigrated(db) {
  if (!db) return Promise.resolve();
  let promise = done.get(db);
  if (!promise) {
    promise = applyPending(db).catch((err) => {
      done.delete(db);
      throw err;
    });
    done.set(db, promise);
  }
  return promise;
}
