// D1 migration'larını Worker ilk istekte kendisi uygular.
//
// Kaynak tek: migrations/*.sql. Aynı dosyalar `wrangler d1 migrations apply` ile de uygulanabilir;
// ikisi de wrangler'ın `d1_migrations` tablosunu kullandığı için birbirini tekrar çalıştırmaz.
// Böylece Cloudflare panelinden yayın yapan site sahibinin elle komut çalıştırması gerekmez.

import m0001 from "../../migrations/0001_init.sql";
import m0002 from "../../migrations/0002_user_languages.sql";
import m0003 from "../../migrations/0003_probe_pool.sql";
import m0004 from "../../migrations/0004_onboarding.sql";

export const MIGRATIONS = [
  { name: "0001_init.sql", sql: m0001 },
  { name: "0002_user_languages.sql", sql: m0002 },
  { name: "0003_probe_pool.sql", sql: m0003 },
  { name: "0004_onboarding.sql", sql: m0004 },
];

/**
 * SQL dosyasını ifadelere böler. `--` yorumlarını (satır içi dahil) atar; tek tırnaklı
 * dizelerin içindeki `;` ve `--` karakterlerine dokunmaz.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") current += sql[++i]; // '' kaçışı
        else inString = false;
      }
    } else if (ch === "'") {
      inString = true;
      current += ch;
    } else if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      current += "\n";
    } else if (ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
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
