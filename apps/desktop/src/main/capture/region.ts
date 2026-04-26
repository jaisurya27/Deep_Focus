// Implementation in Phase 3. This stub lets Phase 2 compile cleanly and
// lets us bind the hotkey eagerly so users can't hit a "not implemented"
// silent failure.

import type { WindowContext } from "../../shared/ipc";

let started = false;

export async function startRegionCapture(_opts?: {
  windowContext?: WindowContext | null;
}): Promise<void> {
  if (started) return;
  started = true;
  try {
    const mod = await import("./region.impl");
    await mod.startRegionCapture(_opts);
  } finally {
    started = false;
  }
}
