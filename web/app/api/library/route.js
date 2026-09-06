import { library, look } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const q = request.nextUrl.searchParams.get("q");
  if (q) return Response.json(await look(q));
  return Response.json(await library());
}
