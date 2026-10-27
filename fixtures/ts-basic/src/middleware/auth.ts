import { readSession } from "../auth/session.js";

export function requireUser(token: string) {
  return readSession(token);
}
