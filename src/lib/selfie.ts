/** Selfie for level-2 KYC: JPEG, longest side ≤ 1024px, ≤ 1.5 MB, plain base64 (kyc-dojah-verify contract). */

const MAX_SIDE = 1024;
const MAX_BYTES = 1_500_000;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

export class SelfieError extends Error {}

function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length * 3) / 4 - pad;
}

export async function selfieFromFile(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new SelfieError("We couldn't read that photo. Take a new selfie.");
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new SelfieError("Couldn't process the photo. Try again.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const q of QUALITIES) {
      const dataUrl = canvas.toDataURL("image/jpeg", q);
      const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (base64Bytes(b64) <= MAX_BYTES) return b64;
    }
    throw new SelfieError("That photo is too large. Take a new selfie.");
  } finally {
    bitmap.close();
  }
}
