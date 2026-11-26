import { assertEquals } from "jsr:@std/assert";
import { countByUser } from "./adminUserCounts.ts";

Deno.test("countByUser: how many events each listed person hosts or joined", () => {
  const hosted = [{ host_id: "a" }, { host_id: "a" }, { host_id: "b" }];
  assertEquals(countByUser(hosted, "host_id"), new Map([["a", 2], ["b", 1]]));
  const joined = [{ user_id: "a" }, { user_id: "c" }];
  assertEquals(countByUser(joined, "user_id").get("c"), 1);
});

Deno.test("countByUser: nothing in, empty map; rows without the key are ignored", () => {
  assertEquals(countByUser(null, "host_id").size, 0);
  assertEquals(countByUser([{ other: "x" }, { host_id: null }], "host_id").size, 0);
});
