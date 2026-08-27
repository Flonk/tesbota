import { tesbota } from "../../../lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST() {
  return Response.json(await tesbota(["step", "--json"]));
}
