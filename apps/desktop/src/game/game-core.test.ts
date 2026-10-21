import { advance, createWorld } from "@deskbrawl/game-core";
import { expect, test } from "vitest";

test("workspace 공개 진입점을 통해 직렬화한 월드의 시뮬레이션을 이어갈 수 있다", () => {
  const setup = {
    bounds: { width: 800, height: 600 },
    rules: { tickMs: 50, moveSpeedUnitsPerSecond: 200, playerRadius: 16 },
    players: [{ id: "local", position: { x: 100, y: 100 } }],
  };
  const first = advance(createWorld(setup), [
    { playerId: "local", movement: { x: 1, y: 0 } },
  ]);
  const restored: typeof first = JSON.parse(JSON.stringify(first));
  expect(advance(restored, [])).toEqual(advance(first, []));
  expect(restored.players[0]?.position).toEqual({ x: 110, y: 100 });
});
