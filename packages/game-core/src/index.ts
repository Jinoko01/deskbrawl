export type {
  GameRules,
  CombatRules,
  MovementAxis,
  PlayerInput,
  PlayerAction,
  PlayerState,
  ProjectileState,
  Vector2,
  WorldBounds,
  WorldEffect,
  WorldSetup,
  WorldState,
} from "./types";
export { advance, createWorld } from "./world";
export { ATTACK_DAMAGE, DEFAULT_COMBAT, KNOCKOUT_MS, MAX_HP } from "./defaults";
