import { apiPath, fail } from "./http.js";
import type { Env } from "./orghub.js";

export { OrgHub, type Env } from "./orghub.js";

export default {
  async fetch(request, env) {
    const path = apiPath(new URL(request.url));
    if (path === null) return fail("not_found", "There is no such page.");
    return env.ORG.getByName(path.org).fetch(request);
  },
} satisfies ExportedHandler<Env>;
