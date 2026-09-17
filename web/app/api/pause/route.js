import { tesbota, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { on } = await request.json();
  return Response.json(await tesbota(["pause", "--json", on ? "on" : "off"], 900000, who(request)));
}
