import { save } from "../infra/db.js";

export function placeOrder(id: string): string {
  return save(id);
}
