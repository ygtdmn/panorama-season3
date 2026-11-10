import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import { workersCacheCdnAdapter } from "@vinext/cloudflare/cache/workers-cache-cdn-adapter";

// No image optimizer: the only optimized images were the hero's CDN tableaus, and vinext's
// /_next/image takes local sources only, so those are served straight from the CDN.
export default defineConfig({
  plugins: [
    vinext({
      cache: { data: kvDataAdapter(), cdn: workersCacheCdnAdapter() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
