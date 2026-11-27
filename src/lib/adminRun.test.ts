import { describe, expect, it } from "vitest";
import { exportFileName, runThenRefresh, withinTime } from "./adminRun";

describe("admin actions refresh the page whatever the server answered", () => {
  it("waits for the refresh after a success and returns the answer", async () => {
    const log: string[] = [];
    const out = await runThenRefresh(
      async () => { log.push("call"); return { ok: true }; },
      async () => { log.push("refresh"); },
    );
    expect(out).toEqual({ ok: true });
    expect(log).toEqual(["call", "refresh"]);
  });

  it("still refreshes when the call fails (the server may have done part of it), and passes the error on", async () => {
    const log: string[] = [];
    await expect(runThenRefresh(
      async () => { throw new Error("Admin API error"); },
      async () => { log.push("refresh"); },
    )).rejects.toThrow("Admin API error");
    expect(log).toEqual(["refresh"]);
  });

  it("a refresh that fails does not turn a done action into an error", async () => {
    const out = await runThenRefresh(async () => "done", async () => { throw new Error("offline"); });
    expect(out).toBe("done");
  });
});

describe("sign-out is never held up by its audit record", () => {
  it("gives up waiting after the time allowed", async () => {
    const started = Date.now();
    await withinTime(new Promise(() => undefined), 20);
    expect(Date.now() - started).toBeLessThan(500);
  });
  it("swallows a failure", async () => {
    await expect(withinTime(Promise.reject(new Error("no network")), 1000)).resolves.toBeUndefined();
  });
});

describe("export file names carry the day (UTC, like the times inside)", () => {
  it("names the file after the list and the date", () => {
    expect(exportFileName("transactions", new Date("2026-11-28T23:30:00Z"))).toBe("transactions-2026-11-28.csv");
    expect(exportFileName("psp-events", new Date("2026-01-02T00:00:00Z"))).toBe("psp-events-2026-01-02.csv");
  });
});
