import { tesbota, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { name, type, on } = await request.json();
  const said = ["place", `--type=${type || "region"}`, `--on=${on || ""}`, String(name || "")];
  return Response.json(await tesbota(said, 30000, who(request)));
}

export async function DELETE(request) {
  const { id, deep } = await request.json();
  const said = ["unplace", String(id || "")];
  if (deep) said.push("--deep");
  return Response.json(await tesbota(said, 30000, who(request)));
}
