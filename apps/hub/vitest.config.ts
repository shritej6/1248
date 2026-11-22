import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.json" },
      remoteBindings: false,
      miniflare: {
        bindings: {
          BOOTSTRAP_CODE: "test-bootstrap-code",
          DOOR_SECRET: "test-door-secret",
          GOOGLE_URL: "",
          GOOGLE_SECRET: "",
          SORTER_MODEL: "",
          VOICE_MODEL: "",
          LINK_MODEL: "",
          TRANSLATE_MODEL: "",
        },
      },
    }),
  ],
});
