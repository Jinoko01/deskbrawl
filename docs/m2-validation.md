# M2 검증 기록

검증일: 2026-10-21, Asia/Seoul. 외부 배포는 수행하지 않았다. 로컬 개발·테스트 DB는 새로 생성한 PostgreSQL 17.11이며 실제 PostgreSQL을 사용했다.

## 구현 범위

- NestJS 12 단일 인스턴스의 기기 인증/JWT, Rooms·Invites·Visits·Simulation 모듈.
- Prisma 7 schema·초기 migration, 기기 비밀 해시·룸 소유권·초대 해시/만료 저장.
- 기기 등록·재인증, 내 룸 조회, 링크 생성/재발급/폐기와 최소 방문 웹 페이지.
- 공유 Zod REST·Socket.IO schema, 범위·버전·권한·정원·seq·visitId 검사.
- 고정 tick·최대 catch-up·입력 만료, `game-core` 기반 서버 권위 이동·근접·돌·넉백·기절.
- main 소유 socket, overlay로 검증된 snapshot IPC 전달, 추상 방문 미리보기·귀환·오류 안내.
- Windows DPAPI 기기 자격 증명 저장·재인증, Tauri 딥링크·단일 인스턴스 전달.

## 실행 결과

| 명령/대상 | 결과 |
|---|---|
| `pnpm typecheck`, `pnpm lint` | 전체 workspace 통과 |
| `pnpm --filter @deskbrawl/game-core test` | 기존 70개 통과 |
| `pnpm --filter @deskbrawl/protocol test` | 입력 경계·URL 검증 2개 통과 |
| `pnpm --filter @deskbrawl/server test` | 서버 시뮬레이션 3개 통과 |
| `pnpm --filter @deskbrawl/desktop test` | 27개 통과, M2 표현 버퍼·기존 로컬 게임 회귀 포함 |
| `pnpm build:web` | 통과, 500kB 이상 chunk에 관한 기존 형식의 Vite 경고 발생 |
| `pnpm --filter @deskbrawl/server db:generate`, `db:validate` | Client 생성·schema 검증 통과 |
| `DATABASE_URL` 지정 후 `db:migrate` | 새 개발·격리 테스트 DB 모두 초기 migration 적용 통과 |
| `TEST_DATABASE_URL` 지정 후 `test:integration` | 실제 Nest·PostgreSQL·Socket.IO 2개 시나리오 통과 |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | 11개 통과, DPAPI 암복호화·잘못된 blob 거부 포함 |
| `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | 통과 |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check` | 통과 |
| `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml` | Windows 개발 실행 파일 생성 통과 |
| `pnpm build` | Windows 실행 파일·NSIS 설치 파일 생성 통과. 설치·서명·게시 미실행 |
| `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --dev --network` | 아래 Windows WebView 흐름 및 기존 렌더러 회귀 통과 |
| 같은 WebView 검사 `--dev --local` | Ctrl+Shift+G·방향키·근접·돌·Esc·포커스 복원 경로 통과 |
| 같은 WebView 검사 `--network` (release) | 패키징된 실행 파일의 실제 CSP·서버 연결·딥링크·미리보기·귀환과 기존 native 회귀 통과 |

REST/Socket.IO 통합 테스트에서 실제 확인한 항목은 잘못된 JSON·과대 payload 거부, 인증 없는 요청 거부, 비밀값 검증, 잘못된 JWT/origin 거부, 기기 재인증, 링크 회전·폐기, 기존 방문 유지, 자체 방문 거부, 중복 방문의 동일 세션 반환, 2인 정원, 다른 세션의 입력·불법 이동값 거부, 중복 공격 ID, 두 소켓의 동일 snapshot/피격·기절, 미참가 소켓 격리, 호스트 종료와 이후 입력 차단이다.

## Windows WebView 실행

테스트 소유 앱과 별도 WebView2 프로필에서 실제 서버에 접속했다. 테스트가 생성한 보조 소켓을 두 번째 참가자로 사용했으므로 실제 PC 두 대 검증과 구분한다.

- 메인 UI로 호스트 연결·링크 생성, 방문자가 호스트 오버레이에 등장.
- 방문자 소켓의 돌 공격이 실제 호스트 WebView에 피격/기절로 표시.
- 방문 종료 시 오버레이에서 방문자 제거.
- 실행 중 두 번째 프로세스에 URI 인자를 전달하면 그 프로세스가 종료되고 기존 앱이 미리보기로 입장.
- 방문 중 자체 오버레이 비우기, 미리보기에서 같은 월드와 서버 피격 표시, 귀환 후 자체 호스트 복원.
- 앱 종료 후 URI 인자로 시작해 DPAPI에 보관한 동일 기기 자격 증명을 재인증하고 입장·귀환.
- overlay의 자격 증명 읽기와 main의 overlay 전용 조회 IPC 거부.
- 미리보기는 main 전용의 읽기 IPC로 같은 효과 감소 설정을 구독하며 overlay 제어 권한은 갖지 않는다.
- 미리보기의 idle 애니메이션 진행과 효과 감소 시 반복 그리기 중단을 실제 WebGL draw 호출로 확인했다. 20Hz idle snapshot도 불필요한 GPU 그리기를 만들지 않는다.
- 기존 M1 렌더러·투명 픽셀·동작 줄이기·텍스처 수명·GPU 손실 숨김/복구·트레이 회귀 통과.

기존 로컬 입력 검사의 첫 WALK 프레임은 12단위 이동만 보장해 초기 144단위 간격에서 근접 사거리에 못 미칠 수 있었다. 이 검사에는 명시적인 150ms 키 유지 입력을 추가했다. 이동·명중·상태 전환 자체는 관찰 가능한 결과를 기다려 검증한다.

브라우저 두 탭에서도 main UI → 실제 REST/DB → socket 입장 → DOM 참가자 목록 → PixiJS 미리보기 흐름을 확인했다. 이는 전역 단축키·Win32 입력 통과 검증을 대신하지 않는다.

## 환경과 한계

Docker Desktop 시작 시 기존 환경의 inference 소켓 오류가 발생해 Docker 설정을 변경하지 않았다. EDB 공식 PostgreSQL 바이너리의 실행에 필요한 부분을 git 제외 `.local/pg17`에 추출하고, 별도 `.local/pg-data` 클러스터를 loopback 포트 54329에서 실행해 검증했다. 시스템 서비스는 설치하지 않았다. 임시 DB 재실행/종료는 다음과 같다.

```powershell
.local/pg17/pgsql/bin/pg_ctl.exe -D C:/project/deskbrawl/.local/pg-data -l C:/project/deskbrawl/.local/postgres.log -o '-p 54329 -h 127.0.0.1' -w start
.local/pg17/pgsql/bin/pg_ctl.exe -D C:/project/deskbrawl/.local/pg-data -w stop
```

실제 PC 두 대에서 네트워크를 사이에 두고 동시에 조작하는 M2 최종 인수 검증은 미실행이다. NSIS 설치 후 브라우저 클릭으로 시작하는 Windows URI 등록 경로, LAN 방화벽·서로 다른 DPI/모니터와 물리 전경 포커스, 외부 HTTPS/WSS 배포도 이번 검증으로 확정하지 않는다. 설치 파일 생성과 설치·게시 검증을 구분한다. 서명·업데이트·자동 재연결·4인 확장은 M4 범위다.

플러그인 동작 기준: [Tauri 딥링크](https://v2.tauri.app/plugin/deep-linking/), [Tauri 단일 인스턴스](https://v2.tauri.app/plugin/single-instance/). 임시 DB 출처: [EDB 공식 바이너리](https://www.enterprisedb.com/download-postgresql-binaries?lang=en).

## 추가 검증 — 2026-10-22, Asia/Seoul

위 기록 이후, 현재 PC 한 대에서 설치본 검증을 추가했다. 설치된 Node 22.20.0과 고정 pnpm 10.34.7을 사용했다. 기본 Node 24와 pnpm 11에서는 pnpm 버전 전환이 제한되어 초기 명령을 완료하지 못했으며, 고정 버전을 사용할 수 있는 환경에서 아래 검사를 다시 실행했다. manifest·lockfile·검사 규칙은 변경하지 않았다.

| 명령/대상 | 결과 |
|---|---|
| `pnpm check` | 전체 lint·타입 검사·웹 빌드 통과. 기존 500kB chunk 경고 유지 |
| `pnpm test` | game-core 70개, protocol 2개, desktop 27개, server 3개 통과 |
| 서버 `db:generate`, `db:validate`, `db:migrate` | 기존 migration을 새 로컬 격리 DB에 적용하고 검증 통과 |
| 서버 `test:integration` | 실제 NestJS·PostgreSQL·Socket.IO 2개 통과 |
| `cargo test`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings` | 실제 desktop manifest 대상 Rust 테스트 11개·포맷·Clippy 통과 |
| `pnpm build` | 현재 소스의 Windows 실행 파일·NSIS 생성 통과. 서명·게시 없음 |
| 테스트 origin/CSP override를 지정한 `tauri build --config …` | 기존 설정 파일을 수정하지 않고 별도 포트용 설치본 생성 통과 |
| NSIS `/S` | 현재 사용자 설치 및 URI 등록 통과. 설치기가 `/D` 인자 대신 기본 `%LOCALAPPDATA%\DeskBrawl`을 사용했으며 실제 경로로 검사 |
| `DESKBRAWL_TEST_EXECUTABLE`, `DESKBRAWL_TEST_SERVER_ORIGIN` 지정 후 WebView 검사 `--network --registered-link` | 아래 설치본 흐름과 기존 native 회귀 통과 |
| `node --check apps/desktop/scripts/test-overlay-webview.mjs` | 검사 스크립트 문법 통과 |

기존 WebView 검사기에 설치된 실행 파일과 서버 주소 지정, 등록된 URI 명령 확인 및 ShellExecute 전달 옵션을 추가했다. 설치본에서 실제 확인한 항목은 다음과 같다.

- 호스트 연결·링크 발급·방문자 표시, 방문자 돌의 서버 판정과 호스트 WebView 피격·기절 표시.
- 방문 종료 후 방문자 제거, Windows에 등록된 `deskbrawl://` 전달로 실행 중 앱의 방문 미리보기 입장·귀환.
- 설치본 실행 파일에 URI 인자를 주어 꺼진 앱 시작, DPAPI 기기 자격 증명 복원·재인증·입장·귀환.
- IPC 창별 접근 거부, 효과 감소·설정 복원·투명 배경·모니터 경계·GPU 손실 시 숨김과 복구.

DB는 이미 설치된 PostgreSQL 18 바이너리로 workspace의 `.local/m2-pg-data`에 별도 클러스터를 만들고 loopback 포트 54329에서 실행했다. 시스템 서비스는 설치하지 않았다. 새 `deskbrawl_test` DB만 사용했다. 기존 포트 3000의 서비스는 유지하고, 검사 서버와 설치본은 포트 3001을 사용했다. 앱 설정 `.env.local`과 기본 Tauri CSP 파일은 변경하지 않았다.

검사 후 테스트 설치본은 공식 uninstaller로 제거하고 실행 파일·URI 등록 제거를 확인했다. 테스트 서버와 PostgreSQL 클러스터를 종료했으며, 기본 설정으로 `pnpm build`를 다시 실행해 설치 파일도 복원했다. 격리 DB 파일과 DPAPI 기기 자격 증명은 재검증용으로 유지한다.

**남은 M2 인수 항목:** 실제 PC 두 대의 동시 조작·판정 일치, 설치 후 실제 브라우저 링크 클릭으로 실행 중/꺼진 앱 방문. 사용자는 현재 PC만 사용할 수 있다고 확인했으며, 이 환경에는 지정된 브라우저 도구인 `wmux` 실행 파일이 없어 브라우저 클릭은 수행하지 않았다. ShellExecute 전달과 실행 파일 URI 시작을 브라우저 클릭 결과로 보고하지 않는다. 최종 M2 인수 완료로 표시하지 않았다.
