import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { ensureMigrated, splitStatements, MIGRATIONS } from "../worker/lib/migrate.js";

describe("migration'lar", () => {
  it("SQL'i yorumları atarak ifadelere böler", () => {
    expect(splitStatements("-- yorum\nCREATE TABLE a (x);\n\nCREATE INDEX i ON a(x);\n")).toEqual([
      "CREATE TABLE a (x)",
      "CREATE INDEX i ON a(x)",
    ]);
  });

  it("satır içi yorumdaki ve dizedeki ; ile -- karakterlerini doğru işler", () => {
    expect(splitStatements("CREATE TABLE a (x TEXT, -- not; yorum\n y TEXT);\nINSERT INTO a VALUES ('a;b--c', 'it''s');")).toEqual([
      "CREATE TABLE a (x TEXT, \n y TEXT)",
      "INSERT INTO a VALUES ('a;b--c', 'it''s')",
    ]);
  });

  it("boş veritabanına hepsini uygular ve wrangler tablosuna yazar", async () => {
    await ensureMigrated(env.DB);
    const { results } = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all();
    expect(results.map((r) => r.name)).toEqual(MIGRATIONS.map((m) => m.name));
    const users = await env.DB.prepare("SELECT count(*) AS n FROM users").first();
    expect(users.n).toBe(0);
  });

  it("migrations/ klasöründeki her dosya Worker'a gömülü", () => {
    expect(env.TEST_MIGRATIONS.map((m) => m.name)).toEqual(MIGRATIONS.map((m) => m.name));
  });
});
