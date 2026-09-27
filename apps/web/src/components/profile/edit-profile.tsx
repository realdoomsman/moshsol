"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { ImageUp } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Identicon } from "@/components/ui/identicon";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  PROFILE_BIO_MAX,
  PROFILE_NAME_RE,
  userQuery,
  usersApi,
  type ProfileInput,
  type UserProfile,
} from "@/lib/users";

/** The indexer's upload limit (API.md: images ≤ 4 MB). */
const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const AVATAR_TYPES = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";

type Stage = "idle" | "uploading" | "signing" | "saving";

const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  uploading: "Uploading image",
  signing: "Confirm in wallet",
  saving: "Saving",
};

/**
 * Edit profile (§4.8): name, bio and avatar, saved with a signed message (`PUT /api/users/:wallet`).
 * Signing is free — no transaction, no SOL. The profile is replaced as a whole, so every field
 * currently set is sent again.
 */
export function EditProfileDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { publicKey, signMessage } = useWallet();
  const qc = useQueryClient();
  const [name, setName] = useState(user.name ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatar, setAvatar] = useState<string | null>(user.avatar);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<{ field: "name" | "bio" | "avatar" | "form"; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();
  const trimmedBio = bio.trim().replace(/\s+/g, " ");
  const nameError =
    trimmedName && !PROFILE_NAME_RE.test(trimmedName) ? "2–24 characters: letters, numbers, _ . and -" : null;
  const bioError = trimmedBio.length > PROFILE_BIO_MAX ? `At most ${PROFILE_BIO_MAX} characters` : null;
  const busy = stage !== "idle";
  const own = publicKey?.toBase58() === user.wallet;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > AVATAR_MAX_BYTES) {
      setError({ field: "avatar", message: "Images must be 4 MB or smaller." });
      return;
    }
    setError(null);
    setStage("uploading");
    try {
      setAvatar((await usersApi.uploadImage(file)).image);
    } catch (e) {
      setError({ field: "avatar", message: e instanceof Error ? e.message : "Upload failed. Try another image." });
    } finally {
      setStage("idle");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (nameError || bioError || !own) return;
    if (!signMessage) {
      setError({ field: "form", message: "This wallet can't sign messages. Connect another wallet to edit your profile." });
      return;
    }
    const input: ProfileInput = {};
    if (trimmedName) input.name = trimmedName;
    if (trimmedBio) input.bio = trimmedBio;
    if (avatar) input.avatar = avatar;
    setError(null);
    setStage("signing");
    try {
      const saved = await usersApi.saveProfile(user.wallet, input, async (message) => {
        const signature = await signMessage(message);
        setStage("saving");
        return signature;
      });
      qc.setQueryData<UserProfile>(userQuery(user.wallet).queryKey, (old) =>
        old ? { ...old, name: saved.name, bio: saved.bio, avatar: saved.avatar, profileUpdatedAt: saved.updatedAt } : old,
      );
      void qc.invalidateQueries({ queryKey: ["user", user.wallet] });
      toast.success("Profile saved", { description: "Signed with your wallet. No SOL was spent." });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save your profile.";
      if (err instanceof ApiError && err.status === 409 && /name/.test(message)) setError({ field: "name", message: "That name is taken." });
      else if (/rejected|declined|denied/i.test(message)) setError({ field: "form", message: "Signature declined. Nothing was saved." });
      else setError({ field: "form", message });
    } finally {
      setStage("idle");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Edit profile"
      description="Saved with a signed message from your wallet. Free — no transaction."
      width={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="edit-profile" variant="primary" busy={stage === "signing" || stage === "saving"} disabled={stage === "uploading" || !!nameError || !!bioError || !own}>
            {stage === "signing" || stage === "saving" ? STAGE_LABEL[stage] : "Save profile"}
          </Button>
        </div>
      }
    >
      <form id="edit-profile" onSubmit={onSubmit} className="flex flex-col gap-5 px-5 pt-3 pb-5">
        <div className="flex items-center gap-4">
          <Identicon address={user.wallet} src={avatar} size={64} />
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<ImageUp className="size-4" strokeWidth={1.5} />}
                busy={stage === "uploading"}
                disabled={busy && stage !== "uploading"}
                onClick={() => fileRef.current?.click()}
              >
                {stage === "uploading" ? STAGE_LABEL.uploading : avatar ? "Change image" : "Upload image"}
              </Button>
              {avatar ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAvatar(null)}>
                  Remove
                </Button>
              ) : null}
            </div>
            <p className={error?.field === "avatar" ? "small text-down" : "small text-ink-3"} role={error?.field === "avatar" ? "alert" : undefined}>
              {error?.field === "avatar" ? error.message : "PNG, JPEG, GIF, WebP or SVG, up to 4 MB."}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_TYPES}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
        </div>

        <Field
          label="Name"
          hint="Unique. Letters, numbers, _ . and -"
          error={nameError ?? (error?.field === "name" ? error.message : undefined)}
        >
          {(id) => (
            <Input
              id={id}
              value={name}
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              placeholder="Leave empty to show your address"
              invalid={!!nameError || error?.field === "name"}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>

        <Field label="Bio" aside={`${trimmedBio.length}/${PROFILE_BIO_MAX}`} error={bioError ?? undefined}>
          {(id) => (
            <Textarea
              id={id}
              value={bio}
              rows={3}
              maxLength={PROFILE_BIO_MAX + 40}
              placeholder="One line about you"
              invalid={!!bioError}
              onChange={(e) => setBio(e.target.value)}
            />
          )}
        </Field>

        {error?.field === "form" ? (
          <p role="alert" className="small border-l-2 border-warn bg-warn-wash/40 py-2 pr-3 pl-3 text-ink">
            {error.message}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
