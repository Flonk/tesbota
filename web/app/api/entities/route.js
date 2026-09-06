import { entities } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const kind = request.nextUrl.searchParams.get("kind");
  return Response.json(entities(kind));
}
