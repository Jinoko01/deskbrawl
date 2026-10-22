import type { Snapshot } from "@deskbrawl/protocol";
import type { CharacterMotion, CharacterSceneSnapshot } from "./characterScene";
import { sameCharacterScene } from "./characterScene";

export function networkScene(snapshot: Snapshot, previous?: Snapshot): CharacterSceneSnapshot {
  const { world } = snapshot;
  return {
    bounds: world.bounds,
    characters: world.players.map((player, index) => {
      let motion: CharacterMotion;
      const before = previous?.world.players.find((candidate) => candidate.id === player.id);
      const action = player.lastAction;
      if (world.tick < player.knockbackUntilTick) {
        motion = { kind: "hit", actionId: `${player.id}:hit:${player.lastHitTick}` };
      } else if (world.tick < player.stunnedUntilTick) {
        motion = { kind: "stun" };
      } else if (action !== null && (world.tick - action.tick) * world.rules.tickMs < (action.kind === "melee" ? 400 : 300)) {
        motion = { kind: action.kind === "melee" ? "melee" : "throw", actionId: `${player.id}:${action.tick}` };
      } else {
        motion = { kind: before !== undefined && (before.position.x !== player.position.x || before.position.y !== player.position.y) ? "walk" : "idle" };
      }
      return {
        id: player.id,
        nickname: `${snapshot.members.find((member) => member.playerId === player.id)?.nickname ?? "친구"} · ${index + 1}`,
        position: player.position,
        facing: player.facing,
        motion,
        skin: snapshot.members.find((member) => member.playerId === player.id)?.role === "host" ? "mochi" : "mint",
      };
    }),
    projectiles: world.projectiles,
    effects: world.effects,
  };
}

// Render one snapshot interval behind with bounded interpolation. Never extrapolate hits.
export function createSnapshotView(render: (scene: CharacterSceneSnapshot) => void) {
  let current: Snapshot | undefined;
  let previous: Snapshot | undefined;
  let receivedAt = 0;
  let animation = 0;
  let rendered: CharacterSceneSnapshot | undefined;
  const chatTimes = new Map<string, { revision: number; since: number }>();
  function frame(now: number): void {
    if (current === undefined) {
      return;
    }
    const scene = networkScene(current, previous);
    const sameWorld = previous?.worldId === current.worldId;
    const duration = sameWorld && previous !== undefined ? Math.max(1, (current.world.tick - previous.world.tick) * current.world.rules.tickMs) : 1;
    const alpha = Math.min(1, Math.max(0, (now - receivedAt) / duration));
    const interpolated = {
      ...scene,
      characters: scene.characters.map((character) => {
        const draft = current?.chats.find((chat) => chat.playerId === character.id);
        const seen = chatTimes.get(character.id);
        const age = seen === undefined ? 8000 : now - seen.since;
        const caption = draft === undefined || age >= 8000
          ? undefined
          : {
              current: draft.current, previous: draft.previous, opacity: age >= 5000 ? 0.5 : 1,
            };
        const withChat = { ...character, ...(caption === undefined ? {} : { chat: caption }) };
        const before = sameWorld ? previous?.world.players.find((player) => player.id === character.id) : undefined;
        if (before === undefined) {
          return withChat;
        }
        return {
          ...withChat,
          position: {
            x: before.position.x + (character.position.x - before.position.x) * alpha,
            y: before.position.y + (character.position.y - before.position.y) * alpha,
          },
        };
      }),
    };
    if (!sameCharacterScene(rendered, interpolated)) {
      rendered = interpolated;
      render(interpolated);
    }
    const moved = sameWorld && current.world.players.some((player) => {
      const before = previous?.world.players.find((candidate) => candidate.id === player.id);
      return before !== undefined && (before.position.x !== player.position.x || before.position.y !== player.position.y);
    });
    if (alpha < 1 && moved) {
      animation = requestAnimationFrame(frame);
    }
  }
  return {
    receive(snapshot: Snapshot): void {
      if (snapshot.worldId === current?.worldId && snapshot.world.tick < current.world.tick) {
        return;
      }
      cancelAnimationFrame(animation);
      previous = current;
      current = snapshot;
      receivedAt = performance.now();
      const ids = new Set(snapshot.chats.map((chat) => chat.playerId));
      for (const id of chatTimes.keys()) {
        if (!ids.has(id)) {
          chatTimes.delete(id);
        }
      }
      for (const chat of snapshot.chats) {
        if (chatTimes.get(chat.playerId)?.revision !== chat.updatedAt) {
          chatTimes.set(chat.playerId, { revision: chat.updatedAt, since: receivedAt });
        }
      }
      frame(receivedAt);
    },
    dispose(): void {
      cancelAnimationFrame(animation);
      current = undefined;
      previous = undefined;
      rendered = undefined;
      chatTimes.clear();
    },
  };
}
