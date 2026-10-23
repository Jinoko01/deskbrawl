# WORK 드래그와 PLAY 표시 검증

검증일: 2026-10-23. Windows의 주 모니터에서 확인했다.

## 동작

- PLAY에서는 클릭을 통과시키는 초록색 테두리를 표시한다. 효과 감소 또는 OS 동작 줄이기에서는 반복 애니메이션을 끄고 빛을 유지한다.
- WORK에서는 캐릭터를 잡은 왼쪽 버튼 동작만 Windows 마우스 훅으로 처리한다. 나머지 입력은 아래 작업 창으로 전달하고, 오버레이는 포커스를 받지 않는다.
- 로컬에서는 두 캐릭터, 멀티플레이에서는 본인만 옮긴다. 기절·PLAY·연결 복구 중에는 드래그를 차단한다. 화면 좌표는 DPI와 월드 표시 배율을 적용해 변환한다.
- 서버는 위치 의도를 다음 고정 tick에 적용한다. 동일 tick에는 최신 위치만 적용하며, PLAY 전환·집중·연결 단절·긴 시계 공백에서는 대기 위치를 폐기한다.
- 기존 서버에 연결하면 게임은 유지하고 멀티플레이 드래그를 비활성화한다. 기능 사용에는 앱과 서버 갱신이 필요하다.

## 확인 결과

| 대상 | 실행·결과 |
|---|---|
| ESLint·TypeScript·웹 빌드 | `pnpm check` 통과 |
| JS 단위 테스트 | game-core 74개, protocol 8개, desktop 61개, server 8개 통과 |
| 서버 통합 | `pnpm --filter @deskbrawl/server test:integration` 12개 통과. 새 `deskbrawl_work_drag_test` DB와 실제 NestJS·Socket.IO 사용 |
| Rust | `cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings`, `cargo test --offline` 통과. 테스트 14개 |
| Windows 실행 | `scripts/test-overlay-webview.mjs --dev --local` 전체 1회 통과. 실제 마우스 드래그·DPI 변환·포커스 유지·클릭 통과·배경 키보드 입력·모드 전환·종료 확인 |
| PLAY 시각 확인 | WebView 캡처로 테두리·PLAY 배지 확인. `prefers-reduced-motion: reduce`에서 애니메이션 중단 확인 |
| Windows 패키징 | 기존 `tauri.network.conf.json`으로 NSIS 빌드 통과. `DeskBrawl_0.1.1_x64-setup.exe` 생성 |

테두리 캡처를 추가한 재실행에서는 새 드래그·PLAY 표시 검증 이후 기존 배경 입력 probe가 `probe lost foreground`로 중단됐다. 최초 전체 실행의 통과와 구분한다. 실패를 숨기기 위해 재시도 횟수나 검사를 완화하지 않았다.

## 제자리 드래그 회귀 수정

사용자 영상의 증상을 상대 마우스 이동으로 재현했다. `WH_MOUSE_LL` 훅이 드래그 중 `WM_MOUSEMOVE`도 차단해 Windows 커서 좌표가 갱신되지 않았다. 기존의 단일 `SetCursorPos` 테스트는 절대 좌표를 직접 지정하므로 이 문제를 발견하지 못했다.

- 훅은 잡은 캐릭터의 왼쪽 버튼 누름·해제만 차단하고, 마우스 이동은 다음 훅으로 전달한다. 오버레이의 포커스 정책은 유지한다.
- 네이티브 회귀 검증은 버튼을 누른 채 상대 이동을 12회 보내고, 커서 이동 누적과 캐릭터의 최종 좌표 일치를 확인한다. 수정 전에는 누적 이동이 `0px`로 실패했고, 수정 후에는 통과했다.
- `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --dev --local` 전체 통과: 상대 이동 드래그, DPI 변환, 포커스 유지, WORK 입력 통과, PLAY·WORK 전환, 렌더러 복구와 종료 확인.
- `pnpm --filter @deskbrawl/desktop lint`, `typecheck`, `test` 통과. desktop 테스트 61개 통과.
- `cargo test` 14개, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all -- --check` 통과. 모두 `--manifest-path apps/desktop/src-tauri/Cargo.toml`을 사용했다.
- `pnpm --filter @deskbrawl/desktop tauri build --config src-tauri/tauri.network.conf.json` 통과. 같은 버전 `0.1.1`의 NSIS 설치 파일을 수정 코드로 다시 생성했다.

## 범위

실제 Windows PC 두 대의 LAN 드래그 동기화, 추가 DPI·다중 모니터 인수는 TBD다. 소켓 두 개의 통합 테스트를 PC 두 대 검증으로 간주하지 않는다. 설치·서명·게시·운영 서버 갱신은 실행하지 않았다.
