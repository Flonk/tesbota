import { tesbota, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const { text } = await request.json();
  return Response.json(await tesbota(["note", text ?? ""], 900000, who(request)));
}
