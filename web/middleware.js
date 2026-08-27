import { NextResponse } from "next/server";

export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };

export function middleware(request) {
  const expected = process.env.TESBOTA_KEY;
  if (!expected) return NextResponse.next();

  const supplied = request.nextUrl.searchParams.get("k");
  const cookie = request.cookies.get("tesbota_k")?.value;

  if (cookie === expected) return NextResponse.next();

  if (supplied === expected) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("k");
    const response = NextResponse.redirect(url);
    response.cookies.set("tesbota_k", expected, { httpOnly: true, sameSite: "lax", path: "/" });
    return response;
  }

  return new NextResponse("not found", { status: 404 });
}
