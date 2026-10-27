import { requireUser } from "../middleware/auth.js";

export function accountRoute(token: string) {
  return requireUser(token);
}
