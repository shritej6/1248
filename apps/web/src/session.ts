const keyFor = (org: string) => `vision.session.${org}`;

function storageProblem(operation: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "unknown";
  console.warn(`session: ${operation} of the stored session failed (${name})`);
}

export function readSession(org: string): string | null {
  try {
    return localStorage.getItem(keyFor(org));
  } catch (error) {
    storageProblem("read", error);
    return null;
  }
}

export function saveSession(org: string, token: string): void {
  try {
    localStorage.setItem(keyFor(org), token);
  } catch (error) {
    storageProblem("save", error);
  }
}

export function clearSession(org: string): void {
  try {
    localStorage.removeItem(keyFor(org));
  } catch (error) {
    storageProblem("clear", error);
  }
}
