import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatementSchema } from "@vision/contracts";
import { rehearse, type RehearsalResult } from "@vision/core";
import { Rehearsal } from "../src/components/Rehearsal/Rehearsal.js";
import { rehearsalInput } from "../src/components/Rehearsal/rehearsalInput.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const real = (seed: number): RehearsalResult => rehearse(rehearsalInput(seed));

const clock = (...times: number[]) => {
  const queue = [...times];
  return () => queue.shift() ?? 0;
};

describe("rehearsal input", () => {
  it("runs 100 requests from the saved sorter answers in under 5 seconds and balances", () => {
    const started = performance.now();
    const r = real(7);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(r.requests).toBe(100);
    expect(StatementSchema.parse(r.statement).balanced).toBe(true);
    expect(r.source).toBe("Sorter test of 2026-11-21, small model, run 1");
  });
});

describe("Rehearsal panel", () => {
  it("shows the statement, the weak points and the source", async () => {
    const result = real(7);
    const run = vi.fn(() => Promise.resolve(result));
    render(<Rehearsal run={run} now={clock(1000, 2400)} />);
    fireEvent.click(screen.getByRole("button", { name: "Run rehearsal" }));
    expect(await screen.findByText("BALANCES")).toBeTruthy();
    expect(run).toHaveBeenCalledWith(7);
    const s = result.statement;
    expect(
      screen.getByText(new RegExp(`^Open at start 0 \\+ New ${String(s.new)} = Helped ${String(s.helped)}`)),
    ).toBeTruthy();
    expect(screen.getByText(/seed 7, ran in 1\.4 s/)).toBeTruthy();
    const weak = within(screen.getByRole("region", { name: "Weak points" }));
    expect(weak.getByText("Waves that reached the desk").nextElementSibling?.textContent).toBe(
      String(result.weak.wavesToDesk),
    );
    expect(weak.getByText("Late promises").nextElementSibling?.textContent).toBe(
      String(result.weak.latePromises),
    );
    expect(within(screen.getByRole("region", { name: "Source" })).getByText(result.source)).toBeTruthy();
  });

  it("shows every assumption, with each chance", async () => {
    const result = real(7);
    render(<Rehearsal run={() => Promise.resolve(result)} />);
    fireEvent.click(screen.getByRole("button", { name: "Run rehearsal" }));
    expect(await screen.findByText("BALANCES")).toBeTruthy();
    const listed = within(screen.getByRole("region", { name: "Assumptions" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(listed).toEqual(result.assumptions);
    expect(listed).toContain("16 percent of volunteers say yes to an offer");
    expect(listed).toContain("60 percent of partners say yes to an ask");
    expect(listed).toContain("90 percent of partners who say yes confirm the hand-over in time");
    expect(listed.some((line) => line.includes("80 percent say helped"))).toBe(true);
  });
});

describe("Rehearsal panel states", () => {
  it("a statement that does not balance says by how much", async () => {
    const result = real(7);
    const off = {
      ...result,
      statement: { ...result.statement, helped: result.statement.helped + 2, balanced: false },
    };
    render(<Rehearsal run={() => Promise.resolve(off)} />);
    fireEvent.click(screen.getByRole("button", { name: "Run rehearsal" }));
    expect(await screen.findByText("DOES NOT BALANCE by 2")).toBeTruthy();
  });

  it("the run button waits while the rehearsal runs, and a failure says so", async () => {
    let fail: (error: Error) => void = () => undefined;
    const run = () =>
      new Promise<RehearsalResult>((_, reject) => {
        fail = reject;
      });
    render(<Rehearsal run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Run rehearsal" }));
    expect(await screen.findByText("Running seed 7")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run rehearsal" }).hasAttribute("disabled")).toBe(true);
    fail(new Error("The rehearsal worker failed: out of memory"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Not run. The rehearsal worker failed: out of memory. Try again.",
    );
  });
});

describe("rehearsal worker", () => {
  it("answers a seed with the same result as the core rehearsal", async () => {
    const posted: unknown[] = [];
    const scope: {
      onmessage: ((event: { data: { seed: number } }) => void) | null;
      postMessage: (m: unknown) => void;
    } = { onmessage: null, postMessage: (m) => posted.push(m) };
    vi.stubGlobal("self", scope);
    await import("../src/components/Rehearsal/rehearsal.worker.js");
    scope.onmessage?.({ data: { seed: 42 } });
    expect(posted).toEqual([real(42)]);
  });

  it("runInWorker resolves with the worker answer and stops the worker", async () => {
    const result = real(3);
    const made: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: { message: string }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      constructor() {
        made.push(this);
      }
      postMessage(message: { seed: number }) {
        if (message.seed === 3) this.onmessage?.({ data: result });
        else this.onerror?.({ message: "boom" });
      }
      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const { runInWorker } = await import("../src/components/Rehearsal/runInWorker.js");
    await expect(runInWorker(3)).resolves.toEqual(result);
    await expect(runInWorker(4)).rejects.toThrow("The rehearsal worker failed: boom");
    expect(made.map((w) => w.terminated)).toEqual([true, true]);
  });
});
