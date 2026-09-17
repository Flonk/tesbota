import { snapshot, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return Response.json(await snapshot(who(request)));
}
