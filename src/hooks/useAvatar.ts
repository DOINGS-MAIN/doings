import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { persistAvatarPhoto } from "@/lib/avatarStorage";
import type { AvatarData } from "@/types/avatar";
import { avatarDataFromProfile, DEFAULT_AVATAR_DATA, parseAvatarData } from "@/types/avatar";

export function useAvatar(
  authUserId: string | undefined,
  profileAvatarData: unknown,
  profileAvatarUrl: string | null | undefined,
  onSaved?: () => void,
) {
  const [avatarData, setAvatarData] = useState<AvatarData>(DEFAULT_AVATAR_DATA);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authUserId) {
      setAvatarData(DEFAULT_AVATAR_DATA);
      return;
    }
    setAvatarData(avatarDataFromProfile(profileAvatarData, profileAvatarUrl));
  }, [authUserId, profileAvatarData, profileAvatarUrl]);

  const saveAvatarData = useCallback(
    async (next: AvatarData) => {
      if (!authUserId) {
        setAvatarData(next);
        return;
      }

      setSaving(true);
      try {
        const photoUrl = await persistAvatarPhoto(authUserId, next.photoUrl);
        const payload = parseAvatarData({ ...next, photoUrl });

        const { error } = await supabase
          .from("users")
          .update({
            avatar_data: payload,
            avatar_url: photoUrl,
          })
          .eq("auth_id", authUserId);

        if (error) throw error;

        setAvatarData(payload);
        onSaved?.();
      } finally {
        setSaving(false);
      }
    },
    [authUserId, onSaved],
  );

  return { avatarData, setAvatarData, saveAvatarData, saving };
}
