import { tesbota } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await tesbota(["data", "--json"], 60000));
}
