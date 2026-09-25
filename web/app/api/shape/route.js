import { tesbota, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { id, extent, carry, width, alone } = await request.json();
  const said = ["shape", String(id || ""), JSON.stringify(extent)];
  if (Array.isArray(carry) && carry.length === 6) said.push(`--carry=${carry.join(",")}`);
  if (width !== undefined) said.push(`--width=${width ?? ""}`);
  if (alone) said.push("--alone");
  return Response.json(await tesbota(said, 30000, who(request)));
}
