import { launch, tesbota } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { cause } = await request.json().catch(() => ({}));
  const recorded = await tesbota(["kill", "--json", ...(cause ? [cause] : [])]);
  if (recorded?.error) return Response.json(recorded);
  return Response.json(await launch(["step", "--json"], "a new life"));
}
