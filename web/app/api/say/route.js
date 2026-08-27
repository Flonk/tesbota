import { tesbota } from "../../../lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request) {
  const { text } = await request.json();
  if (!text || !text.trim()) return Response.json({ error: "empty" }, { status: 400 });
  return Response.json(await tesbota(["say", text]));
}
