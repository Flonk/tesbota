import type { Ctx } from "./index.ts";

export default function granted(_con: any, _id: string, _value: unknown, _ctx: Ctx) {
  throw new Error("granted cannot be edited yet");
}
