import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;
async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the React evidence-first IFC review workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(
    html,
    /<title>BIM Review Agent — Evidence-first IFC review<\/title>/i,
  );
  assert.match(html, /Start a review/);
  assert.match(html, /Model file/);
  assert.match(html, /one or more IFC models/);
  assert.match(html, /multiple/);
  assert.match(html, /Rule profile/);
  assert.match(html, /Review setup/);
  assert.match(html, /Next/);
  assert.match(html, /IFC 4\.0\.2\.1/);
  assert.match(html, /No IFC\? Run a sample/);
  assert.match(
    html,
    /property="og:image" content="(?:https?:\/\/[^"]+)?\/og\.png"/,
  );
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});
