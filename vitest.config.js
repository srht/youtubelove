import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Testler gerçek Workers çalışma zamanında (Miniflare) ve yerel bir D1 ile koşar.
// Workers AI gibi uzak bağlantılar kapalı; testler kendi sahte AI/fetch'lerini verir.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        remoteBindings: false,
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: { include: ["test/**/*.test.js"] },
  };
});
