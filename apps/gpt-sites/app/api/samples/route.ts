import { listSamples } from "@/src/runtime/samples/catalog";

export async function GET() {
  return Response.json({ samples: listSamples() });
}
