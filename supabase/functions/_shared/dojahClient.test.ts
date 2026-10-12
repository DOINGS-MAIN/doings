import { assertEquals } from "jsr:@std/assert";
import { dojahPostJson } from "./dojahClient.ts";

function withFetch(impl: () => Promise<Response>) {
  (globalThis as { fetch: unknown }).fetch = impl;
}

Deno.test("dojahPostJson: 2xx JSON is ok", async () => {
  withFetch(async () => new Response(JSON.stringify({ entity: { a: 1 } }), { status: 200 }));
  assertEquals(await dojahPostJson("/x", {}, {}), { kind: "ok", json: { entity: { a: 1 } } });
});

Deno.test("dojahPostJson: a definite 4xx is rejected", async () => {
  withFetch(async () => new Response(JSON.stringify({ error: "Face not detected" }), { status: 400 }));
  assertEquals(await dojahPostJson("/x", {}, {}), { kind: "rejected", status: 400, json: { error: "Face not detected" } });
});

Deno.test("dojahPostJson: 408, 429, 5xx, HTML bodies and network errors are unavailable", async () => {
  for (const status of [408, 429, 500, 502]) {
    withFetch(async () => new Response(JSON.stringify({ error: "x" }), { status }));
    assertEquals(await dojahPostJson("/x", {}, {}), { kind: "unavailable" });
  }
  withFetch(async () => new Response("<html>bad gateway</html>", { status: 200 }));
  assertEquals(await dojahPostJson("/x", {}, {}), { kind: "unavailable" });
  withFetch(async () => { throw new TypeError("network"); });
  assertEquals(await dojahPostJson("/x", {}, {}), { kind: "unavailable" });
});

Deno.test("dojahPostJson: 401/402/403/413 are our account's or request's fault, so unavailable", async () => {
  for (const status of [401, 402, 403, 413]) {
    withFetch(async () => new Response(JSON.stringify({ error: "Insufficient wallet balance" }), { status }));
    assertEquals(await dojahPostJson("/x", {}, {}), { kind: "unavailable" });
  }
});
