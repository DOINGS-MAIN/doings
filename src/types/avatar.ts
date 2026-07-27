export interface AvatarData {
  photoUrl: string | null;
  outfit: string;
  accessory: string;
  background: string;
}

export const DEFAULT_AVATAR_DATA: AvatarData = {
  photoUrl: null,
  outfit: "agbada",
  accessory: "none",
  background: "gold-gradient",
};

export function parseAvatarData(raw: unknown): AvatarData {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AVATAR_DATA };
  const row = raw as Record<string, unknown>;
  return {
    photoUrl: typeof row.photoUrl === "string" && row.photoUrl.trim() ? row.photoUrl : null,
    outfit: typeof row.outfit === "string" ? row.outfit : DEFAULT_AVATAR_DATA.outfit,
    accessory: typeof row.accessory === "string" ? row.accessory : DEFAULT_AVATAR_DATA.accessory,
    background: typeof row.background === "string" ? row.background : DEFAULT_AVATAR_DATA.background,
  };
}

export function avatarDataFromProfile(
  avatarData: unknown,
  avatarUrl: string | null | undefined,
): AvatarData {
  const parsed = parseAvatarData(avatarData);
  if (!parsed.photoUrl && avatarUrl?.trim()) {
    return { ...parsed, photoUrl: avatarUrl.trim() };
  }
  return parsed;
}
