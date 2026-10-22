# M3 검증 기록

검증일: 2026-10-22. Windows 11 PC 한 대, 실제 Tauri 릴리스 앱·WebView2·Win32 창과 로컬 Docker PostgreSQL 17을 사용했다. 두 번째 사용자는 별도 인증을 가진 Socket.IO 클라이언트로 구성했다. 실제 두 PC 검증으로 보고하지 않는다.

## 통과 결과

| 대상 | 명령·방법 | 결과 |
| --- | --- | --- |
| 정적 검사 | `pnpm check` | 전체 lint·타입 검사·웹 빌드 통과 |
| 단위 테스트 | `pnpm test` | game-core 70, protocol 3, desktop 32, server 4: 총 109개 통과 |
| 실제 DB·서버 통합 | `pnpm --filter @deskbrawl/server test:integration` | 격리 DB `deskbrawl_test`, 4개 통과 |
| Rust | `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check` | 통과 |
| Rust | `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | 통과 |
| Rust | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | 12개 통과 |
| 네이티브 M3 | `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --m3` | 실제 릴리스 앱·서버에서 아래 흐름 통과 |
| 로컬 키보드 회귀 | `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --local` | 최종 스크립트에서 Ctrl+Shift+G·이동·근접 공격·돌·Esc·WORK 전환 통과 |
| 창 수명 | `pwsh -File apps/desktop/scripts/test-window-lifecycle.ps1` | main·overlay·tray 3개 시나리오 통과 |
| UI | 실제 WebView 800×600, 540×760 CSS viewport | 접속자·강퇴·집중 모드 표시, 가로 넘침 없음, 캡처 시 초대 링크 마스킹 |
| 빌드 | Tauri 릴리스 빌드·NSIS 생성 | 통과, 설치·서명·게시하지 않음 |

서버 통합 검사는 `TEST_DATABASE_URL`을 테스트 전용 PostgreSQL에 지정하고 기존 migration을 적용한 상태에서 실행한다. URL·JWT·장치 비밀값은 기록하지 않는다. 네이티브 검사는 실행 중 개발 서버와 분리한 3002 포트와 테스트 DB를 사용했고, `VITE_SERVER_URL` 및 별도 임시 Tauri CSP 설정으로 주소를 맞췄다. 테스트 종료 후 배포 빌드는 기본 설정으로 다시 생성한다. 원래 개발 서버·DB와 기존 M2 미커밋 변경은 보존한다.

## 확인한 경계

- 서버: 호스트 이외 제어 거부, 이전 visitId의 입력·공격 거부, 같은 명령 ID의 중복 실행 방지, 중복 강퇴가 재입장한 방문자를 내보내지 않음.
- 경합: 집중·입장·초대 재발급의 직렬 처리, 집중 상태로 처음 호스팅할 때 입장 거부, Socket.IO 방 연결 중 퇴장 시 멤버십 재검사, 호스트 종료 시 방문 종료.
- 입력: 집중 시 입력·예약 공격 초기화와 tick 정지, 방문 종료 시 타이머·소켓 정리, 집중 이전 입력의 늦은 오류 무시, 같은 tick의 방문자 제거 반영. 키 해제·포커스 상실·수정키 입력은 기존 순수 입력 테스트로 검증한다.
- 네이티브: 집중 모드에서 캐릭터 숨김·PLAY IPC 거부·전역 PLAY 요청 차단·트레이 표시 우회 거부, 해제 시 기존 링크 재사용.
- 사용자 흐름: 개별·전체 강퇴와 사유 통지, 방문 중 집중 시 자신의 보호된 공간으로 복귀, 홈 창을 닫아도 호스팅 유지, 트레이 홈·집중 상태 동기화·Windows 클립보드 링크 복사.
- 기존 방문 회귀: 호스트 오버레이·서버 권위 피격, 실행 중 단일 인스턴스 딥링크 전달, 콜드 스타트와 DPAPI 장치 복원, 방문 미리보기, 귀환, 효과 감소·설정 저장·GPU 오류 후 복구.
- IPC: overlay에서 집중·초대·인증 명령 거부, main에서 overlay 전용 조회 거부.

네이티브 스크립트는 소유한 앱에만 로컬 진단 포트를 열고 별도 WebView2 프로필을 만든다. 효과 감소를 원래 값으로 돌리고 앱·소켓·프로필을 정리한다. Windows 클립보드 검사에서는 생성한 테스트 초대 링크를 복사한다. 테스트 DB에는 DPAPI 복원 확인용 테스트 장치가 남을 수 있으므로 개발 DB와 분리한다.

## 제한과 별도 확인

- 초기 `--local` 시도에서 저장된 근접 공격 키가 `A`인데 기본 `Z`를 보내는 검사 문제를 확인했다. PLAY 시작·이동 관찰 대기가 실패한 시도도 있었다. 실제 저장 키를 사용하고 조작키 UI 로딩 완료·트레이 홈의 포커스를 기다리도록 보완한 최종 스크립트는 통과했다. 이 검사는 실제 키보드 입력과 대화형 포그라운드를 필요로 하므로 다른 창이 포커스를 가져가면 실패할 수 있다.
- 실제 두 PC·같은 LAN 동기화와 설치본 브라우저 링크 클릭은 M2의 미완료 인수 항목으로 유지한다. 이번에는 두 번째 PC가 없고 `wmux`도 설치되어 있지 않다.
- M3 설치본 업그레이드·장시간 사용성, 다중 모니터·추가 OS 지원은 미검증이다. 네이티브 UI viewport 검사를 실제 모니터 해상도·DPI 변경 검사로 보고하지 않는다.
- Vite의 기존 큰 chunk 경고와 Rust incremental cache의 hard link 실패 후 복사 경고가 있었지만 명령은 성공했다. 측정하지 않은 성능 수치는 TBD다.

동작과 계약은 [M3 개발 안내](m3-development.md)를 따른다.
