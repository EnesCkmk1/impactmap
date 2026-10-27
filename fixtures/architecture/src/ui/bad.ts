import { save } from "../infra/db.js";

export function leak(): string {
  return save("x");
}
