# 집중모드 복귀·모드 표시·프로필 변경 검증

2026-10-22 기준 변경 및 검증 기록이다.

## 동작

- 친구 방에서 집중모드를 켜면 현재 방문 링크를 메모리에 기억한다. 해제하면 같은 링크로 복귀하며, 링크 만료·호스트 종료·정원 초과 등으로 입장하지 못하면 내 방을 열고 실패 이유를 표시한다.
- 데스크톱 오버레이 우상단에 반투명 WORK/PLAY 배지를 표시한다. 네이티브 입력·정지 이벤트를 구독하며 마우스 입력을 받지 않는다.
- 연결 전과 연결 후에 8종 캐릭터를 좌우 화살표로 선택할 수 있다. 화살표 사이에 atlas에서 잘라 표시한 캐릭터 이미지와 이름을 보여준다. 선택은 로컬 표시 설정으로 저장하며, 방에 입장하거나 연결을 복구할 때 서버에 전달한다.
- 내 방과 친구 방에서 닉네임을 수정할 수 있다. 서버가 검증한 닉네임은 기존 기기 데이터에 저장하며 현재 방의 이름표에도 반영한다.
- 정지한 이동 의도를 반복 전송하지 않고, 이동 ack가 대기 중이면 후속 이동 의도를 합친다. 공격은 서버 월드의 공격별 cooldown을 기준으로 중복 전송을 줄인다. 일시적인 입력·공격·채팅 RATE_LIMITED 응답은 연결을 유지하고 1초 뒤 최신 이동 의도로 재개한다. 거절된 공격을 재전송하지 않는다.
- 방 이동은 유효한 인증 소켓을 재사용하고, 인증 토큰이 갱신되면 새 소켓을 만든다.
- 캐릭터 교체 시 이전 이름표를 함께 파괴한다. 장면 해제는 해당 장면의 renderer·canvas·소유 texture를 정리하고, 다른 장면도 사용하는 Pixi 전역 풀은 해제하지 않는다.

## 추가 계약

| 이벤트 | 방향 | 입력·결과 |
| --- | --- | --- |
| `player:profile` | client → server | 현재 `visitId`, 선택적인 `nickname`·`skin` 중 하나 이상. 자신의 현재 멤버십만 변경한다. 성공 ack는 닉네임 DB 저장과 활성 멤버 정보 반영 완료를 뜻한다. |
| `room:profiles` | server → room | `roomId`, `worldId`, 최대 6개의 `{ playerId, skin }`. 입장·프로필 변경 시 같은 방에만 전송한다. |

캐릭터 값은 `mochi`·`mint`·`sunny`·`coral`·`lumi`·`rusty`·`byte`·`berry`, 닉네임은 공백 제거 후 1~24자다. 기존 v2 클라이언트의 strict 스냅샷과 호환되도록 서버의 `world:snapshot`·입장 ack 멤버 필드에 skin을 추가하지 않는다. 새 앱은 별도 이벤트의 캐릭터 정보를 합쳐 렌더링한다. 새 기능을 쓰려면 변경된 서버도 실행해야 한다. 구형 2종 클라이언트는 새 캐릭터 이벤트를 해석하지 못하면 기존 역할별 모습으로 표시한다. DB 스키마 변경은 없다.

## 초기 구현 실행 결과

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| 전체 lint | `pnpm lint` | 통과 |
| 변경 패키지 최종 lint | `pnpm --filter @deskbrawl/desktop lint:fix`, `pnpm --filter @deskbrawl/server lint:fix` | 통과 |
| 서버 포맷 | `pnpm --filter @deskbrawl/server format:check` | 통과 |
| 전체 타입 검사 | `pnpm typecheck` | 통과 |
| 웹 프로덕션 빌드 | `pnpm build:web` | 통과 |
| 프로토콜 단위 테스트 | `pnpm --filter @deskbrawl/protocol test` | 6개 통과 |
| 데스크톱 단위 테스트 | `pnpm --filter @deskbrawl/desktop test` | 52개 통과 |
| 서버 단위 테스트 | `pnpm --filter @deskbrawl/server test` | 6개 통과 |
| REST·Socket.IO 통합 | `pnpm --filter @deskbrawl/server test:integration` | 8개 통과 |
| Windows 개발 앱 빌드 | `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml` | 통과 |
| 실제 Windows 앱 사용자 흐름 | `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --dev --local --m3` | WORK/PLAY 배지·실제 단축키·호스트/방문자 프로필·친구 방 복귀·복귀 실패 후 내 방 복원·재연결 통과. 이후 기존 렌더링 검사에서 오래된 레이어 개수 가정으로 실패 |
| Windows 렌더링·자원·종료 | `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --dev` | 전역 자원 해제 경로 수정 후 통과. 기존 장면 유지·처리되지 않은 error 이벤트 부재·캐릭터/이름표 파괴·투명 배경·모션·DPR/resize·GPU 오류 복구·버튼/X 종료 확인 |

통합 테스트는 새 임시 PostgreSQL 16 컨테이너의 `deskbrawl_test` DB에 기존 마이그레이션 2개를 적용하여 실행했다. 개발·운영 DB는 사용하지 않았다. 초기 네이티브 검증은 기존 실행 파일에 최신 트레이 메뉴가 없어 실패했고, 소스로 다시 빌드한 뒤 재실행했다.

기존 렌더링 검사는 이름표 추가 전의 stage 자식 개수와 배열 위치를 가정하고 있었다. 캐릭터·이름표를 각각 식별하고 두 레이어의 개수 및 제거 여부를 검증하도록 보완했다. 네트워크 검사 중 기기 자격 증명은 임시 기기로 분리하고 기존 암호화 파일을 종료 시 복원했다.

반복 렌더러 생성·해제 검사에서 Pixi Batcher의 `textures.ids` 접근 오류 로그가 추가로 관찰되었다. 설치된 PixiJS 구현에서 `app.destroy(true, ...)`가 전역 resource registry도 비우는 것을 확인했고, 다른 장면과 공유하는 풀을 해제하지 않는 renderer 옵션으로 변경했다. 기존 장면의 canvas 유지와 처리되지 않은 error 이벤트 부재도 회귀 검사에 포함한다.

설치본·Windows URI 등록·다중 모니터/DPI 조합과 실제 WAN 지연에서의 체감 성능은 이번 자동 검증 대상이 아니며 TBD다. Rust 소스·네이티브 권한은 변경하지 않았고 Rust 단위 테스트·Clippy는 실행하지 않았다. 배포·서명·설치 파일 게시는 실행하지 않았다.

## 추가 수정: 연결 오류 복구와 8종 캐릭터 선택

실제 개발 서버 `http://127.0.0.1:3000/health`가 500을 반환했다. 읽기 전용 DB 검사에서 `P2010` / `DatabaseNotReachable`, 대상 `127.0.0.1:54329` 연결 실패를 확인했다. PostgreSQL이 실행되지 않은 상태였으며, `docker compose up -d --wait`와 기존 마이그레이션 2개 적용 후 같은 서버의 health가 200으로 복구됐다. 수정된 서버도 같은 개발 설정으로 재시작했다. 개발 DB는 복구된 상태로 유지한다.

DB 도달 불가 오류는 기존 안전한 응답 본문을 유지하면서 HTTP 503으로 반환한다. 앱은 일반 내부 오류 대신 PostgreSQL 실행 상태를 확인하도록 안내한다. DB URL·비밀값·SQL은 응답에 포함하지 않는다.

캐릭터 ID·이름·PNG·atlas를 `apps/desktop/src/game/characters.ts`에 연결했다. 선택 UI는 실제 idle 프레임 영역을 사용하며, 방향 버튼과 키보드 좌우 키로 처음/끝을 순환한다. 연결·저장 중 중복 입력을 막고, 선택 버튼이 닉네임 연결 폼을 제출하지 않도록 한다. Pixi 장면도 8개 atlas와 이름을 사용한다.

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| 타입 검사 | `pnpm typecheck` | 통과 |
| 변경 패키지 lint | `pnpm --filter @deskbrawl/desktop lint:fix`, `pnpm --filter @deskbrawl/server lint:fix` | 통과 |
| 서버 포맷 | `pnpm --filter @deskbrawl/server format:check` | 통과 |
| 웹 빌드 | `pnpm build:web` | 통과, 8종 PNG 포함 |
| 데스크톱 단위 테스트 | `pnpm --filter @deskbrawl/desktop test` | 55개 통과 |
| 프로토콜 단위 테스트 | `pnpm --filter @deskbrawl/protocol test` | 6개 통과 |
| 서버 통합 테스트 | `pnpm --filter @deskbrawl/server test:integration` | 별도 PostgreSQL 17의 `deskbrawl_test` DB에서 10개 통과 |
| Windows 개발 앱 | `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --dev --local` | 2회 모두 8종 이미지·이름·버튼·키보드 순환·선택 저장·게임 반영 통과. 뒤의 기존 입력 회귀 검사는 각각 전경 창 일치 실패와 `probe lost foreground`로 완주하지 못함 |
| Windows 렌더링 | `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --dev` | 통과. 8개 실제 atlas 교체·레이어/자원 정리·투명 픽셀·모션·GPU 복구·종료 검사 포함 |

개발 DB에는 기존 마이그레이션만 적용했으며 schema 변경·데이터 삭제·운영 배포는 하지 않았다. 서버 통합 검증의 DB 장애는 경계에 주입하고 정상 연결 복구를 함께 검사했다. 검증용 DB는 개발 DB와 별도 컨테이너로 분리했다.
