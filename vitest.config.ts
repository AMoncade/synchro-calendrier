import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        // Le moteur de Plan ton bacc (vendor/*.tgz) est compilé pour un bundler :
        // imports relatifs sans extension et import JSON. Node seul ne sait pas le
        // charger ; Vite, si — comme dans `vite build`.
        inline: ["@clientside-labs/moteur"],
      },
    },
  },
});
