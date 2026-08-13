import vinext from "vinext";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
const WEB_IFC_BROWSER_ENTRY = fileURLToPath(
  new URL("./node_modules/web-ifc/web-ifc-api.js", import.meta.url),
);
const WORKSPACE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WEB_IFC_NODE_GUARD =
  'var currentNodeVersion = typeof process !== "undefined" && process.versions?.node ? humanReadableVersionToPacked(process.versions.node) : TARGET_NOT_SUPPORTED;';
const WEB_IFC_INIT_MARKER =
  "locateFile: customLocateFileHandler || locateFileHandler\n      });";

function webIfcWorkerdCompatibility() {
  return {
    name: "web-ifc-workerd-compatibility",
    enforce: "pre" as const,
    transform(source: string, id: string) {
      if (id.split("?")[0] !== WEB_IFC_BROWSER_ENTRY) return null;
      if (
        !source.includes(WEB_IFC_NODE_GUARD) ||
        !source.includes(WEB_IFC_INIT_MARKER)
      ) {
        throw new Error(
          "web-ifc changed its Emscripten bootstrap; review the Workerd compatibility transform before upgrading.",
        );
      }

      // Cloudflare's nodejs_compat exposes `process`, but this is deliberately
      // the browser/WASM build. Prevent Emscripten from rejecting Workerd as a
      // mismatched Node runtime while leaving process available to the app.
      return source
        .replace(
          WEB_IFC_NODE_GUARD,
          "var currentNodeVersion = TARGET_NOT_SUPPORTED;",
        )
        .replace(
          WEB_IFC_INIT_MARKER,
          'locateFile: customLocateFileHandler || locateFileHandler,\n        ...globalThis[Symbol.for("bim-review-agent.web-ifc-options")]\n      });',
        );
    },
  };
}

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    optimizeDeps: {
      // Keep the browser entry in Vite's normal transform pipeline so the
      // Workerd compatibility guard above is applied in development too.
      exclude: ["web-ifc"],
    },
    resolve: {
      // The Worker runtime exposes Node compatibility globals, which otherwise
      // makes conditional exports select web-ifc's filesystem-backed Node build.
      alias: [{ find: /^web-ifc$/, replacement: WEB_IFC_BROWSER_ENTRY }],
    },
    server: {
      fs: { allow: [WORKSPACE_ROOT] },
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      webIfcWorkerdCompatibility(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
