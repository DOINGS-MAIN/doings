import { describe, expect, it } from "vitest";
import { answerConfirm, confirmDialog, currentConfirm, subscribeConfirm } from "./confirmDialog";

describe("the admin's own confirm dialog (replaces the browser's confirm box)", () => {
  it("shows the question and resolves true on confirm", async () => {
    const seen: (string | undefined)[] = [];
    const stop = subscribeConfirm(() => seen.push(currentConfirm()?.message));
    const answer = confirmDialog("End this event now?", { confirmLabel: "End event" });
    expect(currentConfirm()).toMatchObject({ message: "End this event now?", confirmLabel: "End event" });
    answerConfirm(true);
    expect(await answer).toBe(true);
    expect(currentConfirm()).toBeNull();
    expect(seen).toEqual(["End this event now?", undefined]);
    stop();
  });

  it("resolves false on cancel", async () => {
    const answer = confirmDialog("Unlock?");
    answerConfirm(false);
    expect(await answer).toBe(false);
  });

  it("a second question while one is open cancels the first", async () => {
    const first = confirmDialog("one");
    const second = confirmDialog("two");
    expect(await first).toBe(false);
    answerConfirm(true);
    expect(await second).toBe(true);
  });
});
