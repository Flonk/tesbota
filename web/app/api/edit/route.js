import { tesbota, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { id, patch } = await request.json();
  return Response.json(await tesbota(["edit", String(id || ""), JSON.stringify(patch ?? null)], 30000, who(request)));
}
