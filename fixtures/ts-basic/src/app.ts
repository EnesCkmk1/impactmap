import { readSession } from "./index.js";

export function preview(token: string) {
  return readSession(token);
}
