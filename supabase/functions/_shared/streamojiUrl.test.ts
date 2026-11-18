import { assertEquals } from "jsr:@std/assert";
import { isStreamojiUrl } from "./streamojiUrl.ts";

Deno.test("isStreamojiUrl: https addresses on streamoji.com and its subdomains", () => {
  assertEquals(isStreamojiUrl("https://glb.streamoji.com/api/avatars/a.png"), true);
  assertEquals(isStreamojiUrl("https://streamoji.com/x.png?token=1"), true);
  assertEquals(isStreamojiUrl("https://cdn.eu.streamoji.com/x.png"), true);
});

Deno.test("isStreamojiUrl: other hosts are refused, including look-alikes", () => {
  assertEquals(isStreamojiUrl("https://example.com/x.png"), false);
  assertEquals(isStreamojiUrl("https://streamoji.com.evil.io/x.png"), false);
  assertEquals(isStreamojiUrl("https://evilstreamoji.com/x.png"), false);
  assertEquals(isStreamojiUrl("https://glb.streamoji.com@169.254.169.254/latest/meta-data"), false);
  assertEquals(isStreamojiUrl("https://169.254.169.254/"), false);
  assertEquals(isStreamojiUrl("https://localhost/"), false);
});

Deno.test("isStreamojiUrl: only plain https on the standard port, no sign-in part", () => {
  assertEquals(isStreamojiUrl("http://glb.streamoji.com/x.png"), false);
  assertEquals(isStreamojiUrl("https://glb.streamoji.com:8443/x.png"), false);
  assertEquals(isStreamojiUrl("https://user:pw@glb.streamoji.com/x.png"), false);
  assertEquals(isStreamojiUrl("ftp://glb.streamoji.com/x.png"), false);
});

Deno.test("isStreamojiUrl: anything that is not an address is refused", () => {
  assertEquals(isStreamojiUrl(""), false);
  assertEquals(isStreamojiUrl("not a url"), false);
  assertEquals(isStreamojiUrl(undefined), false);
  assertEquals(isStreamojiUrl(42), false);
});

Deno.test("isStreamojiUrl: Google's public file hosts are allowed, other Google hosts are not", () => {
  assertEquals(isStreamojiUrl("https://firebasestorage.googleapis.com/v0/b/streamoji-265f4.appspot.com/o/a.png?alt=media"), true);
  assertEquals(isStreamojiUrl("https://storage.googleapis.com/streamoji/a.png"), true);
  assertEquals(isStreamojiUrl("https://metadata.google.internal/computeMetadata/v1/"), false);
  assertEquals(isStreamojiUrl("https://www.googleapis.com/x"), false);
  assertEquals(isStreamojiUrl("https://us-central1-streamoji-265f4.cloudfunctions.net/x"), false);
});
