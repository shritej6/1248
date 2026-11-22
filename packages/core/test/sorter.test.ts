import { expect, it } from "vitest";
import { createSorter, type SorterTools } from "../src/sorter.js";

const goodPass = {
  id: "c_1",
  service: "Free services for elderly, disabled, pregnant (lawn care, snow removal)",
  division: "No clear home",
  urgency: "low",
  words: "",
  reason: "A request to clear snow.",
};
const logged: Record<string, string>[] = [];
const tools: SorterTools = {
  wait: () => Promise.resolve(),
  log: (fields) => {
    logged.push(fields);
  },
};
const replying = (reply: unknown) => (): Promise<unknown> => Promise.resolve(reply);

it("a model reply that is not JSON three times is ai_down", async () => {
  const sort = createSorter(replying({ response: "I cannot help with that" }), "@cf/test/model", tools);
  expect(await sort({ id: "c_1", text: "x" })).toEqual({ error: "ai_down" });
});

it("two passes are two separate calls with the tested prompt", async () => {
  const calls: unknown[] = [];
  const sort = createSorter(
    (_m, input) => {
      calls.push(input);
      return Promise.resolve({ response: JSON.stringify(goodPass) });
    },
    "@cf/test/model",
    tools,
  );
  await sort({ id: "c_1", text: "Snow on my walk" });
  expect(calls).toHaveLength(2);
  expect(JSON.stringify(calls[0])).toContain("Sorter instructions (test version 1)");
});

it("each call sends the message as data with 300 tokens and no temperature", async () => {
  const calls: { model: string; input: unknown }[] = [];
  const sort = createSorter(
    (model, input) => {
      calls.push({ model, input });
      return Promise.resolve({ response: JSON.stringify(goodPass) });
    },
    "@cf/test/model",
    tools,
  );
  await sort({ id: "c_1", text: "Snow on my walk" });
  const [first] = calls;
  expect(first?.model).toBe("@cf/test/model");
  expect(first?.input).toMatchObject({ max_tokens: 300 });
  expect(first?.input).not.toHaveProperty("temperature");
  const messages = (first?.input as { messages: { role: string; content: string }[] }).messages;
  expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
  expect(messages[1]?.content).toBe(JSON.stringify({ id: "c_1", text: "Snow on my walk" }));
});

it("each call switches hidden reasoning off, so the answer fits in the 300 tokens", async () => {
  const inputs: unknown[] = [];
  const sort = createSorter(
    (_model, input) => {
      inputs.push(input);
      return Promise.resolve({ response: JSON.stringify(goodPass) });
    },
    "@cf/test/model",
    tools,
  );
  await sort({ id: "c_1", text: "Snow on my walk" });
  expect(inputs).toHaveLength(2);
  for (const input of inputs)
    expect(input).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
});

it("text around the JSON object is ignored and the id is dropped", async () => {
  const reply = `Here you go:\n${JSON.stringify({ ...goodPass, urgency: "HIGH" })}\nDone.`;
  const sort = createSorter(replying({ response: reply }), "@cf/test/model", tools);
  const result = await sort({ id: "c_1", text: "Snow on my walk" });
  expect(result).toEqual({
    passes: [0, 1].map(() => ({
      service: goodPass.service,
      division: goodPass.division,
      urgency: "high",
      words: "",
      reason: goodPass.reason,
    })),
  });
});

it("a reply that is already an object is read as the pass", async () => {
  const sort = createSorter(replying({ response: goodPass }), "@cf/test/model", tools);
  const result = await sort({ id: "c_1", text: "Snow on my walk" });
  expect("passes" in result && result.passes).toHaveLength(2);
});

it("a failed call is tried again with a longer wait and at most 3 times", async () => {
  const waits: number[] = [];
  let tries = 0;
  const sort = createSorter(
    () => {
      tries += 1;
      if (tries < 3) return Promise.reject(new Error("network down"));
      return Promise.resolve({ response: JSON.stringify(goodPass) });
    },
    "@cf/test/model",
    {
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      log: () => undefined,
    },
  );
  const result = await sort({ id: "c_1", text: "Snow on my walk" });
  expect("passes" in result).toBe(true);
  expect(waits).toHaveLength(2);
  expect(waits[1]).toBeGreaterThan(waits[0] ?? 0);
});

it("a pass with a missing field is not accepted", async () => {
  const partial = { ...goodPass, reason: undefined };
  const sort = createSorter(replying({ response: JSON.stringify(partial) }), "@cf/test/model", tools);
  expect(await sort({ id: "c_1", text: "x" })).toEqual({ error: "ai_down" });
});

it("a call that throws is logged by model and error name, never by message text", async () => {
  logged.length = 0;
  const sort = createSorter(() => Promise.reject(new TypeError("Snow on my walk")), "@cf/test/model", tools);
  expect(await sort({ id: "c_1", text: "Snow on my walk" })).toEqual({ error: "ai_down" });
  expect(logged).toHaveLength(3);
  expect(logged[0]).toEqual({
    op: "sorter",
    model: "@cf/test/model",
    status: "call_failed",
    error: "TypeError",
  });
  expect(JSON.stringify(logged)).not.toContain("Snow on my walk");
});
