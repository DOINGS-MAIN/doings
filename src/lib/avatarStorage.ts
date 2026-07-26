import { supabase } from "@/lib/supabase";

const BUCKET = "avatars";

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Upload a data-URL photo to Supabase Storage. Returns the public URL, or the
 * original data URL if storage is unavailable (local dev without bucket).
 */
export async function persistAvatarPhoto(authUserId: string, photoUrl: string | null): Promise<string | null> {
  if (!photoUrl) return null;
  if (!photoUrl.startsWith("data:")) return photoUrl;

  const ext = photoUrl.includes("image/png") ? "png" : "jpg";
  const path = `${authUserId}/avatar.${ext}`;
  const blob = dataUrlToBlob(photoUrl);

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type,
    cacheControl: "3600",
  });

  if (error) {
    console.warn("avatarStorage: upload failed, keeping inline photo", error.message);
    return photoUrl;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
