// 위치·거리·속도는 모니터의 물리 픽셀이 아닌 동일한 월드 논리 단위를 사용한다.
export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export type MovementAxis = -1 | 0 | 1;
export type PlayerAction = "melee" | "stone";

export interface PlayerInput {
  readonly playerId: string;
  readonly movement: {
    readonly x: MovementAxis;
    readonly y: MovementAxis;
  };
  readonly action?: PlayerAction;
}

export interface PlayerState {
  readonly id: string;
  readonly hp: number;
  // 원형 충돌 영역의 중심. 그림의 발 기준 anchor와의 변환은 렌더러가 담당한다.
  readonly position: Vector2;
  readonly facing: Vector2;
  readonly knockbackVelocity: Vector2;
  readonly knockbackUntilTick: number;
  readonly stunnedUntilTick: number;
  readonly invulnerableUntilTick: number;
  readonly meleeReadyAtTick: number;
  readonly stoneReadyAtTick: number;
  readonly lastAction: { readonly kind: PlayerAction; readonly tick: number } | null;
  readonly lastHitTick: number | null;
}

export interface ProjectileState {
  readonly id: string;
  readonly ownerId: string;
  readonly position: Vector2;
  // 월드 논리 단위/초.
  readonly velocity: Vector2;
  readonly expiresAtTick: number;
}

export interface WorldEffect {
  readonly id: string;
  readonly kind: "impact" | "dust";
  readonly position: Vector2;
  readonly startedAtTick: number;
  readonly expiresAtTick: number;
}

export interface CombatRules {
  readonly meleeReach: number;
  readonly meleeCooldownMs: number;
  readonly stoneCooldownMs: number;
  readonly stoneSpeedUnitsPerSecond: number;
  readonly stoneRadius: number;
  readonly stoneLifetimeMs: number;
  readonly stunMs: number;
  readonly invulnerabilityMs: number;
  readonly knockbackMs: number;
  readonly knockbackSpeedUnitsPerSecond: number;
  readonly effectMs: number;
}

export interface WorldBounds {
  readonly width: number;
  readonly height: number;
}

export interface GameRules {
  readonly tickMs: number;
  readonly moveSpeedUnitsPerSecond: number;
  readonly playerRadius: number;
  readonly combat?: CombatRules;
}

export interface WorldState {
  readonly tick: number;
  readonly bounds: WorldBounds;
  readonly rules: GameRules;
  readonly players: readonly PlayerState[];
  readonly projectiles: readonly ProjectileState[];
  readonly effects: readonly WorldEffect[];
}

export interface WorldSetup {
  readonly bounds: WorldBounds;
  readonly rules: GameRules;
  readonly players: readonly Pick<PlayerState, "id" | "position">[];
}
