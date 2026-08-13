import assert from "node:assert/strict";
import test from "node:test";

const { MAX_UPLOAD_BYTES } = await import("../src/contracts/upload.ts");
const { classifyBatchUploads } = await import("../src/runtime/upload/batch.ts");

test("the shared upload contract exposes a 50 MiB per-file bound", () => {
  assert.equal(MAX_UPLOAD_BYTES, 50 * 1024 * 1024);
});

test("batch upload classification skips only oversized files", () => {
  const classified = classifyBatchUploads(
    [
      { name: "small.ifc", size: 2 * 1024 * 1024 },
      { name: "exactly-50-mib.ifc", size: MAX_UPLOAD_BYTES },
      { name: "too-large.ifc", size: MAX_UPLOAD_BYTES + 1 },
      { name: "another-small.ifc", size: 1 },
    ],
    "Over 50 MiB; skipped in this batch.",
  );

  assert.deepEqual(
    classified.map(({ file, skipped }) => ({ name: file.name, skipped: skipped?.status ?? null })),
    [
      { name: "small.ifc", skipped: null },
      { name: "exactly-50-mib.ifc", skipped: null },
      { name: "too-large.ifc", skipped: "SKIPPED" },
      { name: "another-small.ifc", skipped: null },
    ],
  );
  assert.equal(classified[2].skipped?.code, "file_too_large");
});
