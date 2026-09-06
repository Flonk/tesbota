import { entity } from "../../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const found = entity(id);
  if (!found) return Response.json({ error: "no such thing" }, { status: 404 });
  return Response.json(found);
}
