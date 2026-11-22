import {
  afterEach, expect, test, vi,
} from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { publishDragRegions } from "./drag";
import type { DragRegion } from "./drag";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

test("publishes drag hit regions only on the supported desktop", async () => {
  const regions: DragRegion[] = [["player", 0, 0, 32, 32]];
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
  await publishDragRegions(regions);
  expect(invoke).not.toHaveBeenCalled();

  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  await publishDragRegions(regions);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("overlay_drag_regions", { regions });
});
