import type { Ctx } from "./index.ts";

export default function person(_con: any, _id: string, _value: unknown, _ctx: Ctx) {
  throw new Error("person cannot be edited yet");
}
