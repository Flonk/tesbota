import { skyLayout, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return Response.json(await skyLayout(who(request)));
}
