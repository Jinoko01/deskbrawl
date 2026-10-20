# 검증 가이드

## 도구별 책임

| 대상                       | 도구                           | 핵심 검증                                  |
| -------------------------- | ------------------------------ | ------------------------------------------ |
| 클라이언트 순수 로직·계약  | Vitest                         | 변환·검증·보간·입력 처리                   |
| React UI                   | Vitest + React Testing Library | 사용자 동작·로딩·실패·접근성               |
| 웹 UI 핵심 흐름            | Playwright                     | Vite UI와 실제 서버를 잇는 사용자 시나리오 |
| 서버 유스케이스·시뮬레이션 | Jest                           | 인가·상태 전이·고정 step·중복 처리         |
| REST 통합                  | Jest + Supertest               | 실제 Nest 앱·검증·Guard·DB 제약            |
| 실시간 통합                | Jest + Socket.IO Client        | 여러 사용자·방 격리·ack·재연결·정리        |
| Rust·IPC·OS 어댑터         | Rust Tests                     | 입력·오류·소유권·자원 해제                 |
| Tauri·Win32 실행           | 대상 OS에서 실행 검증          | WebView·권한·DPI·포커스·네이티브 동작      |

Playwright의 웹 테스트와 Tauri API mock은 실제 네이티브 앱 실행을 검증하지 않는다. 선택한 도구만으로 자동화할 수 없는 항목은 Windows 실행 체크리스트로 남긴다. 별도 네이티브 자동화가 필요할 때 공식 WebDriver 지원을 검토하며, 새 프레임워크를 승인 없이 추가하지 않는다. [Tauri 테스트 범위](https://v2.tauri.app/develop/tests/)

## 최소 검증 선택

- 문서만 변경: 참조 경로·링크·규칙 미러·누락·내용 충돌을 검사한다.
- UI 변경: 관련 컴포넌트 테스트와 창 크기·키보드·오류 상태를 확인한다. 핵심 사용자 흐름에 영향을 주면 Playwright를 추가한다.
- 프로토콜 변경: 양쪽 타입 검사·schema 계약 테스트·해당 REST/Socket.IO 통합 테스트를 실행한다.
- 게임 규칙 변경: 고정 dt와 입력 시퀀스를 주입해 재현한다. 실제 시간 sleep 대신 명시적으로 step을 진행한다.
- 인증·DB 변경: 실패·권한·동시 요청·원자성·멱등성과 migration 적용을 격리된 PostgreSQL에서 확인한다.
- 네이티브 변경: Rust 검사와 지원 Windows 환경에서 실제 실행을 확인한다. OS 테스트가 불가능하면 해당 한계를 명시한다.

각 범주의 모든 테스트를 무조건 새로 만들지 않는다. 변경으로 깨질 수 있는 동작을 기존 테스트에 반영하고 필요한 위험 경로만 추가한다.

## 실행 명령

먼저 대상 프로젝트의 package.json, workspace 설정, Cargo.toml, toolchain, CI를 읽는다. 아래는 명령 형태 예시이며 이 문서 묶음은 스크립트를 생성하거나 실행 환경을 설치하지 않는다.

| 범위                 | 예시                                                                                          | 실행 전 확인                                                      |
| -------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| JS·TS lint·타입·빌드 | `pnpm --filter <실제-package-name> run <실제-script>`                                         | 등록된 lint·typecheck·build script                                |
| Vitest·Jest          | `pnpm --filter <실제-package-name> run <실제-test-script>`                                    | watch 없이 끝나는 검증 모드와 테스트 DB                           |
| Playwright           | `pnpm exec playwright test`                                                                   | Playwright를 설치한 패키지 위치에서 실행, webServer·브라우저 준비 |
| Rust 포맷            | `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check`                | 실제 Cargo manifest 경로                                          |
| Rust 정적 검사       | `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | 실제 target·feature·네이티브 도구 준비                            |
| Rust 테스트          | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`                                | OS SDK·링커·지원 플랫폼                                           |
| Prisma               | `pnpm exec prisma validate`                                                                   | 서버 패키지 위치·실제 config·테스트 환경                          |

Prisma schema 변경 시 선택한 버전의 명령으로 migration을 격리 DB에 적용하고 Client 생성·서버 타입 검사까지 확인한다. `validate`만으로 migration 성공을 보고하지 않는다. Tauri 설정·기능 변경은 기존 빌드 스크립트로 패키징도 확인하되 서명·게시는 별도 승인 범위다.

## 비결정성과 정리

- 단위 시뮬레이션에는 시간·seed·입력을 주입한다. 전역 fake timer로 Socket.IO heartbeat까지 멈추는 통합 테스트를 만들지 않는다.
- socket 연결·ack·broadcast 대기는 동작 전에 등록하고 timeout을 둔다. 임의 sleep이나 무한 polling을 피한다.
- 테스트마다 독립 사용자·방·DB 데이터를 준비한다. 인증 fixture·trace·DB URL·토큰을 저장소에 노출하지 않는다.
- 소켓·리스너·타이머·Nest 앱·Prisma Client·PixiJS 앱·Rust handle을 종료한다. open handle 경고를 강제 종료로 숨기지 않는다.

## 보고 형식

실행 대상과 명령, 결과, 미실행 항목과 이유를 적는다. mock UI / 실제 서버·DB / 네이티브 실행의 결과를 구분한다. 실행하지 않은 성능 수치·커버리지·OS 지원은 추정하지 않고 TBD로 남긴다.
