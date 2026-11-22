import { sha256Hex } from "../seal.js";
import { allow, type CommandOf, type Handler, type Handlers } from "./result.js";

const draftAsk: Handler<CommandOf<"draft.ask">> = (_state, c, actor) =>
  allow({
    events: [
      {
        card: null,
        job: null,
        actor,
        type: "draft.asked",
        data: { draft: c.draft, kind: c.kind, month: c.month, resource: c.resource, by: c.by },
      },
    ],
    effects: [{ kind: "draft", draft: c.draft }],
  });

const draftResult: Handler<CommandOf<"draft.result">> = (_state, c, actor) => {
  const textHash = sha256Hex(c.text);
  return allow({
    events: [
      {
        card: null,
        job: null,
        actor,
        type: "draft.done",
        data: { draft: c.draft, source: c.source, flag: c.flag, textHash },
      },
    ],
    effects: [
      {
        kind: "draft.text",
        draft: c.draft,
        text: c.text,
        textHash,
        source: c.source,
        flag: c.flag,
        reasons: [...c.reasons],
      },
    ],
  });
};

const draftApprove: Handler<CommandOf<"draft.approve">> = (_state, c, actor) =>
  allow({
    events: [
      {
        card: null,
        job: null,
        actor,
        type: "draft.approved",
        data: { draft: c.draft, textHash: c.textHash, by: c.by },
      },
    ],
    effects: [],
  });

export const resourceHandlers: Handlers = {
  "draft.ask": draftAsk,
  "draft.result": draftResult,
  "draft.approve": draftApprove,
};
