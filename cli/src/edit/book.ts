import type { Ctx } from "./index.ts";

export default function book(_con: any, _id: string, _value: unknown, _ctx: Ctx) {
  throw new Error("book cannot be edited yet");
}
