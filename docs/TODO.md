# Product & engineering backlog

Items deferred for a later pass. Not scheduled.

---

## Spray flow — payment integrity & bail-out

**Context:** The spray animation counter is client-side only. Money is recorded (and the host projector updates) only when the guest taps **Stop Spray** / **X** or completes the full amount. Pause + close app = ₦0 charged, nothing on screen — so “fake projector fame without paying” is not possible today.

**Gap:** A guest can still bail by closing the app without stopping, after the counter looks high on their phone. They pay nothing; the host sees nothing. Upfront validation checks balance for the planned amount but does not lock funds.

### Options (pick one or combine)

- [ ] **Hold upfront** — When spray starts, reserve the full planned amount in the wallet. On Stop, charge the partial sprayed amount and release the remainder. On full complete, capture full hold. On bail (close with no settle), define policy: release hold vs auto-charge partial.
- [ ] **Auto-settle on leave** — On `beforeunload` / page hide / app background: if `sprayedAmount > 0`, call spray API for that amount before teardown. Pair with UX warning (“Leaving will record ₦X”).
- [ ] **Live projector preview (future)** — If we ever show sprayers on the projector *while* the animation runs, must pair with hold-upfront or auto-settle. Never show on screen without a server-confirmed payment.

### UX polish (optional, same pass)

- [ ] Rename counter copy from “Sprayed” to “Pending” until API confirms.
- [ ] Confirm dialog when closing mid-spray with pending amount &gt; ₦0.

### Reference

- Client: `src/components/SprayAnimation.tsx`, `src/layouts/DashboardLayout.tsx` (`recordSpray`, `handleSprayCancel`)
- Server: `supabase/functions/spray/index.ts`, `record_event_spray` RPC
- Projector: only `spray_records` INSERT (via `useEventSprayFeed` / `useSprayStage`)

---

## Avatar / event screen (done or in progress — verify on return)

- [x] Dancing avatars, 3-slot stage, visible queue, denomination on bills
- [x] Host projector link (`EventProjectorLink`, migration 052)
- [ ] Deploy frontend for avatar + stage changes (if not already on prod)

---

## 3D Bitmoji-style spray avatars

**Goal:** Replace (or augment) the current photo + 2D layered avatar (`SprayAvatarCharacter`) with a **3D character from a selfie** — Snapchat Bitmoji-style — that guests can customize and that **dances on the projector** during sprays.

**Today:** Photo upload + outfit/accessory/background JSON in `users.avatar_data`; CSS/Framer Motion “dancing” character. Good enough for v1, not true 3D.

### Provider options (evaluate before build)

- [ ] **Ready Player Me** — Web avatar creator from photo; GLB export; React Three Fiber / `@readyplayerme/visage` or similar. Strong fit for web + projector.
- [ ] **Snap Bitmoji Kit** — Only if partnership / SDK access is realistic for Doings; often mobile-native, may not fit web projector.
- [ ] **Other** — Avaturn, Meta Avatars SDK, etc. Compare: cost, Nigeria latency, customization depth, dance/animation support, commercial license.

### Integration tasks (after provider pick)

- [ ] Avatar creator flow in `AvatarCustomization` — replace or sit beside photo upload; persist provider avatar ID + GLB URL in `avatar_data` (and/or Supabase Storage).
- [ ] **3D renderer component** — e.g. React Three Fiber canvas: idle + dance clips (spray, celebrate, sway) for phone spray mode + projector stage slots.
- [ ] **Fallback** — Keep current `SprayAvatarCharacter` when no 3D asset or WebGL unavailable (low-end TVs/phones).
- [ ] **Projector performance** — 3 simultaneous 3D avatars on event screen: LOD, shared rig, or pre-rendered loops if needed.
- [ ] **Backend** — Extend `sprayer_avatar_data` / feed RPCs if new fields (e.g. `rpm_avatar_url`, `avatar_provider`).

### Reference (current)

- `src/components/SprayAvatarCharacter.tsx`, `src/components/AvatarCustomization.tsx`
- `src/hooks/useAvatar.ts`, `src/lib/avatarStorage.ts`
- `src/components/EventScreenSprayStage.tsx`, `src/components/SprayAnimation.tsx`
