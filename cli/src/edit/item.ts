import type { Ctx } from "./index.ts";

export default function item(_con: any, _id: string, _value: unknown, _ctx: Ctx) {
  throw new Error("item cannot be edited yet");
}
