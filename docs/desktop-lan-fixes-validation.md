# LAN 사용 피드백 수정 검증

검증일: 2026-10-22. Windows 11 PC 한 대에서 실제 Tauri 릴리스 앱·WebView2·Win32 입력과 PostgreSQL 테스트 DB를 사용했다. 원격 호스트·방문자는 별도 인증을 가진 Socket.IO 클라이언트로 구성했다. 실제 PC 두 대 검증은 별도로 남는다.

## 변경 동작

- WORK/PLAY 단축키가 홈 창을 표시·최소화 해제·활성화하지 않는다. 홈 창을 트레이에 숨긴 상태에서도 전환한다.
- Windows 입력 전용 스레드가 PLAY 중에만 키보드 훅을 설치한다. 설정된 물리 게임 키를 전달하고 자동 반복 공격을 막는다. Ctrl·Alt·Win 조합은 전달하며, Esc·WORK·오버레이 숨김·세션 변경 시 입력 캡처를 끝낸다.
- 방문자 PC도 주 모니터 전체 투명 오버레이에 호스트와 같은 서버 월드를 표시한다. 서로 다른 화면 비율은 기존 렌더러의 비율 유지 배치를 사용한다. 홈 창의 방문 미리보기도 유지한다.
- 호스트 종료·강퇴·연결 실패 시 서버 입력을 정리하고 WORK로 돌아가 로컬 장면을 즉시 다시 그린다. 서버 재접속은 사용자가 **내 공간 연결**로 실행한다.

## 실행 검증

| 검사 | 명령·방법 | 결과 |
| --- | --- | --- |
| 데스크톱 정적 검사 | `pnpm --filter @deskbrawl/desktop lint`, `typecheck` | 통과 |
| 데스크톱 단위 테스트 | `pnpm --filter @deskbrawl/desktop test` | 8개 파일, 35개 통과 |
| 네이티브 스크립트 문법 | `node --check apps/desktop/scripts/test-overlay-webview.mjs` | 통과 |
| Rust 포맷 | `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check` | 통과 |
| Rust 정적 검사 | `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --offline --all-targets -- -D warnings` | 통과 |
| Rust 단위 테스트 | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline` | 13개 통과 |
| 웹 빌드 | `pnpm build:web` | 통과 |
| 실제 Windows 회귀 | `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --local --m3` | 실제 키·방문·호스트 종료·기존 M3 흐름 통과 |
| LAN 설치 파일 | `pnpm --filter @deskbrawl/desktop tauri build --config src-tauri/tauri.network.conf.json` | 기존 서버 `http://70.12.247.103:3000`, Windows x64 NSIS 생성 통과 |

단위 테스트는 방문 중 서버 좌표·두 캐릭터 표시, 종료 후 로컬 장면 즉시 복구, 로컬 PLAY 재개, 보간·구독 정리를 확인한다. Rust 검사는 물리 스캔 코드와 DOM 키 코드의 일치 및 기존 네이티브 안전장치를 포함한다.

네이티브 검사는 별도 앱 식별자 `dev.deskbrawl.fixes-check`, 로컬 3002 포트, 기존 `deskbrawl_test` DB, 임시 WebView 프로필을 사용했다. 앱의 서버 주소와 CSP도 같은 포트로 빌드했다. 백그라운드 입력 검사는 Windows .NET Framework 컴파일러로 `scripts/fixtures/BackgroundInputProbe.cs`를 임시 실행 파일로 만든다. 이 테스트 소유 작업 창이 실제 포그라운드일 때만 입력을 주입한다. 홈 창을 숨긴 채 이동·키 해제·Esc가 동작하고, PLAY에서 작업 창에 게임 키가 전달되지 않으며 WORK에서는 다시 전달되는지 검사한다. 테스트 앱·입력 창·임시 프로필은 종료 시 정리한다.

네트워크 검사에서는 방문자의 전체 화면 오버레이·미리보기에 같은 피격 상태가 나타나고, 원격 호스트 소켓 종료 후 로컬 캐릭터와 `local_available`이 복구되는지 확인했다. 집중·개별/전체 강퇴·이전 입력 거부·트레이 상주·딥링크·DPAPI 복원·효과 감소·GPU 오류 복구도 검사했다.

## 시행 중 확인한 사항과 제한

- 초기 PowerShell 키 주입 검사는 일반 게임 키가 훅에 도착하지 않아 실패했다. 별도 네이티브 입력 창에서는 훅 호출을 확인했고, 최종 검사를 테스트 소유 네이티브 작업 창으로 교체했다. 검사 완화를 통해 통과시키지 않았다.
- 첫 네트워크 검사는 검사기의 기본 서버 주소와 테스트 앱의 주소가 달라 입장 단계에서 실패했다. 이 시도에서 기존 개발 서버에 테스트용 기기 등록 요청 1회가 발생했다. 이후 검사기의 `DESKBRAWL_TEST_SERVER_ORIGIN`을 3002 포트로 지정해 테스트 DB에서 재검증했다. 기존 데이터 삭제나 운영 마이그레이션은 실행하지 않았다.
- 시스템 기본 Node 24·pnpm 11 대신 이미 캐시된 Node 22.20.0·pnpm 10.34.7을 사용했다. 의존성·lockfile 변경은 없다.
- Vite의 큰 chunk 경고와 Rust incremental cache의 hard link 실패 후 복사 경고는 남아 있다. 검사는 성공했다.
- 실제 두 PC의 서로 다른 해상도·DPI, 장시간 네트워크 지연, 설치본 업그레이드는 별도 확인 대상이다. 화면 공유 기능은 추가하지 않았다.

기존 LAN 서버 주소를 사용하는 `tauri.network.conf.json` override로 설치 파일을 생성했다. 결과는 `apps/desktop/src-tauri/target/release/bundle/nsis/DeskBrawl_0.1.0_x64-setup.exe`다. 패키징은 샌드박스 네트워크 제한으로 NSIS 확인이 한 번 실패했으며, 정상 접근 가능한 경로에서 재실행해 성공했다. 설치·서명·게시는 수행하지 않았다.

## 종료 버튼·X 동작 후속 수정

홈 창의 X를 누르면 트레이에 숨기던 동작을 전체 종료로 변경하고, 화면 상단에 **종료** 버튼을 추가했다. X·종료 버튼·트레이 종료는 Rust의 같은 종료 경로로 PLAY 입력과 네이티브 키보드 훅을 중단하고 앱 전체를 종료한다. 종료 요청이 실패하면 버튼을 다시 활성화하고 오류를 안내한다. 홈 창 닫기 권한은 main에만 허용하며 overlay에는 허용하지 않는다.

백그라운드 실행은 최소화로 유지한다. 기존의 창 숨김 검사는 실제 최소화 검사로 변경했다. 종료 검사에서는 PLAY를 활성화한 상태에서 버튼 클릭과 WM_CLOSE(X 경로)를 각각 실행한 뒤 정상 종료 코드, 프로세스 종료, 오버레이·트레이 창 제거를 확인한다.

- `pnpm --filter @deskbrawl/desktop lint`, `typecheck`, `test`: 통과. 클라이언트 테스트 35개.
- `pnpm build:web`: 통과.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check`, Clippy(`--all-targets -- -D warnings`), Rust 테스트: 통과. Rust 테스트 13개.
- `pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --m3`: 실제 종료 버튼·X 종료, main 전용 권한, 기존 방문·복귀·집중·강퇴·최소화·렌더링 회귀 통과.
- `pwsh -NoProfile -File apps/desktop/scripts/test-window-lifecycle.ps1`: main·overlay·tray 세 시나리오 통과. 종료 후 홈 창·오버레이·트레이 창이 모두 제거됨.
- 초기 `--local --m3` 실행은 기존 사용자 앱의 단축키 점유로 등록 확인 단계에서 중단됐다. 사용자 앱은 종료하지 않았고, 종료 회귀는 테스트 앱의 기존 트레이 **플레이 시작** 경로로 활성화해 검증했다. 전역 단축키 조작 회귀는 이번 후속 수정에서 완료로 보고하지 않는다.

네이티브 검사는 앞서 사용한 테스트 전용 앱 식별자·3002 포트·테스트 DB를 사용했다. 서버·프로토콜·의존성 변경은 없다. 설치본 업그레이드와 실제 두 PC 검증은 수행하지 않았다.
