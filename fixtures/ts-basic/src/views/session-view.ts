import type { Session } from "../auth/session.js";

export function label(session: Session): string {
  return session.userId;
}
