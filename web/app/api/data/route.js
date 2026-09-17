import { tesbota, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return Response.json(await tesbota(["data", "--json"], 60000, who(request)));
}
