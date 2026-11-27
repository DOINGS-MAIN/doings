import { describe, expect, it } from "vitest";
import { answerConfirm, confirmDialog, confirmWithReason, currentConfirm, subscribeConfirm } from "./confirmDialog";

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

  it("a confirm with a reason box gives back the reason, or null on cancel", async () => {
    const asked = confirmWithReason("Remove the flag?", { confirmLabel: "Remove flag" });
    expect(currentConfirm()).toMatchObject({ message: "Remove the flag?", reason: { required: false } });
    answerConfirm(true, "  checked with the host  ");
    expect(await asked).toBe("checked with the host");

    const noReason = confirmWithReason("Unban?");
    answerConfirm(true);
    expect(await noReason).toBe("");

    const cancelled = confirmWithReason("Unban?");
    answerConfirm(false, "typed but cancelled");
    expect(await cancelled).toBeNull();
  });

  it("a required reason cannot be confirmed empty", async () => {
    const asked = confirmWithReason("Flag this?", { reasonRequired: true });
    answerConfirm(true, "   ");
    expect(currentConfirm()).not.toBeNull();
    answerConfirm(true, "Looks like a test payment");
    expect(await asked).toBe("Looks like a test payment");
  });

  it("a plain confirm has no reason box", () => {
    void confirmDialog("Sure?");
    expect(currentConfirm()?.reason).toBeNull();
    answerConfirm(false);
  });
});
