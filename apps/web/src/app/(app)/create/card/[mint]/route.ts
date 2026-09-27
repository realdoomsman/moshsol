import LaunchCard from "../../../launch/[mint]/opengraph-image";

/**
 * The launch's share card at a stable URL for the create success screen. Next serves metadata
 * images under a content-hashed path (`/launch/<mint>/opengraph-image-<hash>`), so this renders
 * the very same image the launch page advertises as its `og:image`.
 */
export function GET(_req: Request, ctx: { params: Promise<{ mint: string }> }) {
  return LaunchCard({ params: ctx.params });
}
