import type { CombatRules } from "./types";

export const MAX_HP = 50;
export const KNOCKOUT_MS = 3000;
export const ATTACK_DAMAGE = { melee: 3, stone: 1 } as const;

// M1 로컬 검증값을 M2 서버에서도 사용한다. 최종 제품 수치는 실기기 검증 후 정한다.
export const DEFAULT_COMBAT: CombatRules = {
  meleeReach: 72, meleeCooldownMs: 600, stoneCooldownMs: 900,
  stoneSpeedUnitsPerSecond: 650, stoneRadius: 8, stoneLifetimeMs: 1500,
  stunMs: 400, invulnerabilityMs: 500, knockbackMs: 200,
  knockbackSpeedUnitsPerSecond: 450, effectMs: 300,
};
