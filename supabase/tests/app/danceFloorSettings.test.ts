import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_FLOOR_SETTINGS, floorSettingsError, floorTimeFor, parseFloorSettings,
} from "../../../src/lib/danceFloorSettings.ts";

Deno.test("parseFloorSettings reads the server shape and falls back to defaults", () => {
  assertEquals(parseFloorSettings(null), DEFAULT_FLOOR_SETTINGS);
  const s = parseFloorSettings({ bands: [{ from_ngn: 0, seconds: 90 }], busy_threshold: 5, busy_shrink_pct: 20, min_seconds: 30, max_wait_seconds: 600 });
  assertEquals(s.bands, [{ from_ngn: 0, seconds: 90 }]);
  assertEquals(s.max_wait_seconds, 600);
});

Deno.test("floorSettingsError mirrors the database rules", () => {
  const d = DEFAULT_FLOOR_SETTINGS;
  assertEquals(floorSettingsError(d), null);
  assertEquals(floorSettingsError({ ...d, bands: [] }), "Use 1 to 6 bands");
  assertEquals(floorSettingsError({ ...d, bands: [{ from_ngn: 100, seconds: 60 }] }), "The first band must start at ₦0");
  assertEquals(floorSettingsError({ ...d, bands: [{ from_ngn: 0, seconds: 60 }, { from_ngn: 0, seconds: 90 }] }), "Band amounts must be whole naira and go up");
  assertEquals(floorSettingsError({ ...d, bands: [{ from_ngn: 0, seconds: 60000 }] }), "Band times must be whole seconds from 15 to 900");
  assertEquals(floorSettingsError({ ...d, busy_shrink_pct: 71 }), "busy_shrink_pct must be 0 to 70");
  assertEquals(floorSettingsError({ ...d, min_seconds: 61 }), "min_seconds must be from 15 to the shortest band");
  assertEquals(floorSettingsError({ ...d, max_wait_seconds: 120 }), "max_wait_seconds must be 300 to 7200");
});

Deno.test("floorTimeFor shows what an amount buys", () => {
  const d = DEFAULT_FLOOR_SETTINGS;
  assertEquals(floorTimeFor(d, 4800), 60);
  assertEquals(floorTimeFor(d, 50000), 240);
  assertEquals(floorTimeFor(d, 1000000), 360);
});
