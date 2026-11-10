import { bindings, defineConfig, defineWorker } from "cf/config";
import { createWorkersCacheConfig } from "@vinext/cloudflare/cache/config";

const cache = await createWorkersCacheConfig();

export default defineConfig({
  worker: defineWorker({
    ...cache,
    name: "panorama-season3",
    // workers.dev only for now: season3.panorama.garden still points at Vercel. Deploys
    // enforce these, so a toggle flipped in the dashboard comes back on the next push
    // unless it is set here.
    domains: ["season3.panorama.garden"],
    workersDev: false,
    previewUrls: false,
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    observability: { enabled: true },
    env: {
      ...cache.env,
      RPC_URL: bindings.secret(),
      ASSETS: bindings.assets(),
      // The ISR data cache (kvDataAdapter in vite.config.ts). Created by the first deploy;
      // pinned so CI deploys (strict mode) match it.
      VINEXT_KV_CACHE: bindings.kv({ id: "56489c5ecd344e22abaf002c66445cc7" }),
    },
  }),
});
