export type StaffPage = "ask" | "desk" | "org" | "join";
export type LinkPage = "track" | "partner";

export type Route =
  { page: StaffPage; org: string } | { page: LinkPage; org: string; token: string } | { page: "not_found" };

export type Theme = "graphite" | "paper";

const ORG = /^[a-z0-9-]{3,32}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const PAGES = new Map<string, StaffPage>([
  ["ask", "ask"],
  ["desk", "desk"],
  ["org", "org"],
  ["join", "join"],
]);
const LINKS = new Map<string, LinkPage>([
  ["t", "track"],
  ["p", "partner"],
]);
const NOT_FOUND: Route = { page: "not_found" };

export function matchRoute(path: string): Route {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const [lead, org, kind, token, ...rest] = trimmed.split("/");
  if (lead !== "" || org === undefined || !ORG.test(org) || kind === undefined || rest.length > 0) {
    return NOT_FOUND;
  }
  const page = PAGES.get(kind);
  if (page !== undefined) return token === undefined ? { page, org } : NOT_FOUND;
  const link = LINKS.get(kind);
  if (link !== undefined && token !== undefined && TOKEN.test(token)) return { page: link, org, token };
  return NOT_FOUND;
}

export function themeFor(route: Route): Theme {
  return route.page === "desk" || route.page === "org" || route.page === "join" ? "graphite" : "paper";
}
