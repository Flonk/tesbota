import { entity, skyLayout, who } from "../../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const found = entity(id);
  if (!found) return Response.json({ error: "no such thing" }, { status: 404 });

  // A world carries numbers nothing else does, and every one of them is worked
  // out rather than stored — so the entry asks whoever does the working out.
  if (found.place?.type === "celestial-body" || found.place?.type === "celestial-system") {
    const sky = await skyLayout(who(request));
    found.sky = sky?.bodies?.[id] ?? null;
  }
  return Response.json(found);
}
