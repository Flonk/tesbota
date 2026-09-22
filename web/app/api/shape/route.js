import { tesbota, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { id, extent, carry } = await request.json();
  const said = extent === null ? ["shape", String(id || ""), "--clear"]
                               : ["shape", String(id || ""), JSON.stringify(extent)];
  if (carry && (carry.lon || carry.lat)) said.push(`--carry=${carry.lon},${carry.lat}`);
  return Response.json(await tesbota(said, 30000, who(request)));
}
