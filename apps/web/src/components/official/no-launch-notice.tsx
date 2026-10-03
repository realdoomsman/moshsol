"use client";

import { usePlatform, useOfficialMint } from "@/lib/queries";
import { X_URL } from "../brand/x-link";

/**
 * Site-wide notice while the official Holdfast token isn't set on-chain (`params.buybackMint` unset): impersonators
 * launch "HoldFast" / $HOLD coins, so say plainly that none is ours. Disappears once the official mint is set.
 */
export function NoLaunchNotice() {
  const platform = usePlatform();
  const official = useOfficialMint();
  if (!platform.data || official) return null;
  return (
    <div role="note" className="border-b border-warn/40 bg-warn/10">
      <p className="frame-app small py-2 text-center text-ink">
        <strong className="text-warn">The official Holdfast token has not launched yet.</strong> Any “HoldFast” or $HOLD coin trading now is
        not ours. The real one will be pinned here and announced on{" "}
        <a href={X_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-warn">
          X
        </a>
        .
      </p>
    </div>
  );
}
