# M4 검증 기록

2026-10-22, Windows 11. Node 22.20.0·pnpm 10.34.7과 기존 lockfile을 사용했다. **핵심 기능 구현과 M4 전체 출시 완료를 구분한다.** 실제 6대 PC, 서명·updater, 운영 배포, 베타 튜닝은 아직 완료하지 않았다.

## 코드·서버 검증

| 대상 | 결과 |
| --- | --- |
| 데스크톱 Vitest | 44개 통과: 채팅 IME·두 줄·만료, 복구·오래된 응답 무시, 6인 표현·로컬 복귀 |
| 게임 코어 Vitest | 70개 통과 |
| 공유 프로토콜 Vitest | 5개 통과: v2·6인 상한·초안·복구 토큰 |
| 서버 Jest | 6개 통과: 이동·공격 seq·중복, 단절 입력 폐기, 채팅 수명·스폰 |
| PostgreSQL + Socket.IO 통합 | 7개 통과: 6인·7번째 거부, 방 격리·인가, 호스트/방문자 복구, 토큰 회전·재사용 거부, 강퇴·명시적 종료 |
| Rust 테스트 | 13개 통과 |
| Rust Clippy | `--all-targets --offline -- -D warnings` 통과 |
| JS·TS | workspace lint·타입 검사, 웹 빌드 실행. 최종 변경 후 결과는 아래 최종 확인 기록을 따른다. |
| Docker | daemon 29.9.2에서 BuildKit `build --check` 무경고 통과. 전체 이미지 빌드·실행 미검증 |

DB migration은 격리된 `deskbrawl_test`에만 적용했다. 기존 개발·운영 DB는 변경하지 않았다. 정원 migration과 v2 서버·클라이언트 동시 갱신은 [M4 안내](m4-development.md)를 따른다. 새 JS 패키지·Rust crate를 추가하지 않았다.

## Windows 앱 검증

`test-overlay-webview.mjs`는 테스트용 identifier·WebView2 프로필·localhost:3002 서버로 실제 릴리스 exe를 실행한다. 실제 키 입력은 테스트가 소유한 보이는 WinForms 작업 창에서만 보낸다. 사용자 앱이 차지한 전역 단축키를 강제로 빼앗지 않고 트레이의 PLAY 시작으로 진입한다.

확인한 채팅 경로는 `/` 네이티브 캡처 → 별도 Tauri 입력창 → IPC → Socket.IO → 다른 참가자의 snapshot → PixiJS 말풍선이다. 한글 문자열은 실제 WebView 입력으로 공유했고, IME composition 중 Enter·Escape 규칙은 단위 테스트로 확인했다. 이 결과를 물리 한국어 IME의 모든 후보창 검증으로 확대하지 않는다.

테스트 중 발견한 공간 전환의 `ALREADY_VISITING`은 이전 연결을 dispose하기 전에 명시적 leave를 기다리도록 수정했다. 인증 거부 후 복구 중에 머무는 경로도 종료 안내로 바꿨다. 포커스 검증 도중 테스트용 작업 창이 숨겨진 채 실행되던 문제와 Windows stdout 줄바꿈 중복을 수정했다. 제품의 숨겨진 창에 대한 포커스 복원 방지 조건은 유지했다.

스크린샷은 테스트 캐시의 `m4-chat-editor.png`, `m4-chat-overlay.png`, `m4-six-characters.png`에 생성한다. 채팅 화면·이름·말풍선을 눈으로 확인하며 초대 링크가 보이는 홈 스크린샷은 마스킹한다.

## 지연·리소스 측정

실제 Socket.IO 연결 6개로 별도 서버 프로세스를 측정했다. 5초 정상 구간과 5초 120ms 지연·25% 입력 의도 누락 구간에서 보낸 입력의 ack 실패는 0개였다. 정상 ack p95 11.86ms, 지연 구간 의도 생성→ack p95 141.58ms였다. 서버 peak RSS 139.36MiB였다. 측정 조건·CPU·snapshot 간격·재현 스크립트와 한계는 [실측 문서](m4-server-measurements.md)를 따른다. 실제 Wi-Fi 패킷 유실·6대 PC·장시간 부하의 결과가 아니다.

## 남은 인수·출시 작업

- 실제 서로 다른 6대 PC의 동일 Wi-Fi 참여, DPI·주 모니터 변경, 물리 IME 후보창·장시간 동시 채팅·공격.
- 실제 네트워크 지연·유실·대기 복귀, 서버 재시작과 방화벽 환경.
- Docker 이미지 전체 빌드·컨테이너 실행과 운영 PostgreSQL·HTTPS/WSS 배포.
- 코드 서명 인증서·업데이트 endpoint·updater 의존성 승인과 키 관리. updater는 현재 설치하지 않았다.
- 베타 사용성 테스트와 단절 유예·키보드·피격 강도 정책 튜닝.

서명·게시·운영 migration은 실행하지 않았다. [배포 준비 문서](m4-deployment.md)에 필요한 입력과 절차를 정리했다.

## 최종 확인 기록

2026-10-22 최종 변경본 기준으로 다시 실행했다.

| 명령 | 결과 |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | 4개 workspace 통과 |
| `pnpm test` | game-core 70, protocol 5, desktop 44, server Jest 6 통과 |
| `test:integration` (`deskbrawl_test`) | 2 suite, 7개 통과 |
| `cargo fmt --check`, `clippy -D warnings`, `cargo test` | 통과, Rust 테스트 13개 |
| `test-overlay-webview.mjs --local --m3` | 12개 항목 PASS: 백그라운드 키 캡처, 6인 전체 화면 오버레이, `/` 채팅·포커스 복원, 단절 복구, M3 호스트 제어, 호스트 종료 복귀, 종료 버튼·X 종료 |
| `test-window-lifecycle.ps1` | main·overlay·tray 종료 경로 PASS |
| `tauri build --config src-tauri/tauri.network.conf.json` | NSIS 설치 파일 생성, 번들에 `http://70.12.247.103:3000` 포함 확인 |

네이티브 검사는 이 PC 한 대의 테스트 서버(`127.0.0.1:3002`)에서 실행했다. 실제 여러 PC·Wi-Fi 환경 검증은 위 남은 작업에 포함된다.
