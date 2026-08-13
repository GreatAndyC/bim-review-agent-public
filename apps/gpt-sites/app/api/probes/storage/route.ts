import { getD1 } from "@/db";
import { ensureRuntimeSchema } from "@/db/runtime-schema";

export const dynamic = "force-dynamic";

export async function POST() {
  const probeId = `probe-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    await ensureRuntimeSchema();
    const d1 = getD1();
    await d1
      .prepare(
        `INSERT INTO review_runs (
          run_id, access_token_hash, state, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(probeId, "probe-token-hash", "PROBE", now, now + 60)
      .run();

    const selected = await d1
      .prepare("SELECT run_id, state FROM review_runs WHERE run_id = ?")
      .bind(probeId)
      .first<{ run_id: string; state: string }>();

    await d1.prepare("DELETE FROM review_runs WHERE run_id = ?").bind(probeId).run();
    const deleted = await d1
      .prepare("SELECT run_id FROM review_runs WHERE run_id = ?")
      .bind(probeId)
      .first();

    if (selected?.run_id !== probeId || selected.state !== "PROBE" || deleted) {
      throw new Error("D1 probe did not preserve create/read/delete semantics.");
    }

    return Response.json({
      status: "available",
      d1: {
        create: true,
        read: true,
        delete: true,
      },
      r2: {
        configured: false,
        required: false,
        policy: "memory-first",
      },
    });
  } catch {
    return Response.json(
      {
        status: "unavailable",
        detail: {
          code: "storage_probe_failed",
          message: "The bounded D1 run store is not available.",
        },
      },
      { status: 503 },
    );
  }
}
