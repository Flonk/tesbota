import { tesbota, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { factor } = await request.json();
  return Response.json(await tesbota(["speed", "--json", String(factor)], 900000, who(request)));
}
