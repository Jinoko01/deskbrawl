// 위치·거리·속도는 모니터의 물리 픽셀이 아닌 동일한 월드 논리 단위를 사용한다.
export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export type MovementAxis = -1 | 0 | 1;

export interface PlayerInput {
  readonly playerId: string;
  readonly movement: {
    readonly x: MovementAxis;
    readonly y: MovementAxis;
  };
}

export interface PlayerState {
  readonly id: string;
  // 원형 충돌 영역의 중심. 그림의 발 기준 anchor와의 변환은 렌더러가 담당한다.
  readonly position: Vector2;
  readonly facing: Vector2;
}

export interface ProjectileState {
  readonly id: string;
  readonly ownerId: string;
  readonly position: Vector2;
  // 월드 논리 단위/초. 생성·이동·충돌 처리는 돌 던지기 단계에서 추가한다.
  readonly velocity: Vector2;
  readonly expiresAtTick: number;
}

export interface WorldBounds {
  readonly width: number;
  readonly height: number;
}

export interface GameRules {
  readonly tickMs: number;
  readonly moveSpeedUnitsPerSecond: number;
  readonly playerRadius: number;
}

export interface WorldState {
  readonly tick: number;
  readonly bounds: WorldBounds;
  readonly rules: GameRules;
  readonly players: readonly PlayerState[];
  readonly projectiles: readonly ProjectileState[];
}

export interface WorldSetup {
  readonly bounds: WorldBounds;
  readonly rules: GameRules;
  readonly players: readonly Pick<PlayerState, "id" | "position">[];
}
