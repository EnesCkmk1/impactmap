export interface Session {
  userId: string;
}

export function readSession(token: string): Session | null {
  if (!token) return null;
  return { userId: token };
}
