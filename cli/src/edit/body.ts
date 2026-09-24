import type { Ctx } from "./index.ts";

export default function body(_con: any, _id: string, _value: unknown, _ctx: Ctx) {
  throw new Error("body cannot be edited yet");
}
