import { launch } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(await launch(["reborn", "--json"], "a new life"));
}
