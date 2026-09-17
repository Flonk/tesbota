import { launch, who } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  return Response.json(await launch(["step", "--json"], "step", who(request)));
}
