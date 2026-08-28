import { launch } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { text } = await request.json();
  if (!text || !text.trim()) return Response.json({ error: "empty" }, { status: 400 });
  return Response.json(await launch(["say", text], "say"));
}
