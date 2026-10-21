# M0 Windows 11 검증 기록

검증일: 2026-10-21 (Asia/Seoul). Windows 10 검증은 사용자가 이번 작업 범위에서 제외했다. 아래 결과는 Windows 10 지원을 의미하지 않는다.

## 환경과 구현 범위

- Windows 11 Enterprise, 10.0.26200, 주 모니터 2880×1800 / 200%.
- Tauri/Rust 2.12.4, 공식 JS API 2.12.4, PixiJS 8.22.0. 기타 버전은 manifest·lockfile 기준.
- Node 22.20.0으로 검사·빌드. 로컬 NSIS 생성까지 수행했으며 서명·게시는 범위 밖이다.
- 오버레이는 주 모니터 전체의 물리 경계에 맞추고, 중앙에 논리 프레임 96 CSS px의 캐릭터 하나를 표시한다.
- DPI·해상도·작업 영역·셸 변경 또는 렌더 실패 시 숨긴다. 트레이의 **오버레이 표시**로 웹뷰를 재생성하고 최신 모니터 경계를 적용한다.

## 실행 검증

아래 명령은 저장소 루트 기준이다. `cargo`를 찾지 못하는 기존 터미널에서는 `%USERPROFILE%\.cargo\bin`의 PATH 반영이 필요하다.

| 검증 | 명령 | 결과 |
| --- | --- | --- |
| ESLint·strict TypeScript·웹 빌드 | `pnpm --config.use-node-version=22.20.0 check` | 통과 |
| Rust 포맷 | `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check` | 통과 |
| Rust 정적 검사 | `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --offline --all-targets -- -D warnings` | 통과 |
| Rust 오류 경로·모니터 값 검증 | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --offline` | 6개 통과 |
| 배포 실행 파일·NSIS | `pnpm --config.use-node-version=22.20.0 build` | 통과, `DeskBrawl_0.1.0_x64-setup.exe` 생성 |
| 창·트레이 생명주기 | `pwsh -File apps/desktop/scripts/test-window-lifecycle.ps1` | 3개 시나리오 통과 |
| 실제 WebView2·IPC·설정·GPU 오류 | `pnpm --config.use-node-version=22.20.0 --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs` | 통과 |
| WebGL 렌더러 | Vite의 `overlay.html`에서 `testOverlayRendering()` | 현재 대기 애니메이션을 포함한 DPR 2 검사 통과 |
| 변경 형식 | `git diff --check` | 통과 |

WebGL 검사는 투명 픽셀, 캐릭터 존재, 대기 프레임 진행, 동작 줄이기 정지, resize/DPR, 반복 mount/해제, 초기화 취소, 이미지 실패와 context 손실 정리를 확인한다. 기존 정적 표시 단계의 DPR 1·2 검증과 구분하며, 이번 대기 애니메이션 추가 후 DPR 1 재실행은 브라우저 작업 공간 소실로 완료하지 못했다. 실제 Windows에서는 아래 125%·200% 전환도 별도로 확인했다.

생명주기 스크립트는 주 모니터 경계와 네이티브 스타일을 확인한다. `WS_EX_NOACTIVATE`, `WS_EX_TRANSPARENT`, `WS_EX_LAYERED`, `WS_EX_TOOLWINDOW` 및 `WS_EX_APPWINDOW` 제거를 검사한다. 표시/숨김·재생성·전체 종료·포그라운드 유지와 포커스/디스플레이/셸 통지에 대한 안전 중단을 확인한다. 메시지 주입 결과를 실제 OS 설정 변경 결과로 간주하지 않는다.

WebView2 스크립트는 자신이 실행한 배포 프로세스에만 진단 포트를 연다. `main`에서 오버레이 명령 호출이 거부되는지, 트레이 설정이 렌더러에 전달되는지, 효과 감소에서 반복 그리기가 멈추는지, 앱 재실행 후 값이 유지되는지 확인한다. 실제 `WEBGL_lose_context`로 네이티브 창 숨김과 트레이를 통한 새 renderer 복구도 검사한다. 테스트 후 원래 효과 감소 값과 임시 프로필을 정리한다.

## 실기기 관찰

| 시나리오 | 결과와 근거 |
| --- | --- |
| 투명 합성·일반 창 위 표시 | 배포 실행 파일에서 배경 앱이 비치고 캐릭터 하나만 표시됨 |
| VS Code 최대화 | 임시 `.ts` 문서 위 캐릭터 표시. 캐릭터 위 클릭 후 편집, Ctrl+Home, Ctrl+S 및 휠 스크롤 정상. 저장된 임시 파일의 입력 문구와 Code의 포그라운드 소유 확인 |
| Chrome 최대화 | 미완료. 도구가 현재 브라우저 URL을 확실하게 확인하지 못해 Computer Use를 중단함 |
| 좌클릭·우클릭·드래그·휠 | 네이티브 입력 수신기에서 캐릭터 위 좌/우클릭, 캐릭터를 가로지르는 드래그와 휠 수신. 카운트 `left=3`, `right=1`, `drag=15`, `wheel=1` |
| 키보드·포커스 | 같은 수신기에 `M0 input confirmed` 입력 성공. 종료까지 `keys=4`, `probeText=true`. Alt+Tab 후 포그라운드는 오버레이가 아닌 다른 작업 앱이며 오버레이 표시·모니터 경계 유지 |
| DPI 변경 | 실제 Windows 설정에서 200%→125%→200%. 각 변경에서 자동 숨김, 트레이 복구 후 올바른 중앙 좌표·캐릭터 크기·주 모니터 경계 확인. 설정 창의 포그라운드 유지 |
| 해상도 변경·복귀 | 실제 2560×1600 전환 중 자동 숨김 관찰. Windows 확인 시간 만료로 원래 2880×1800 / 200%로 자동 복귀한 뒤 트레이 복구·전체 경계 확인. 변경된 해상도를 유지한 장시간 검사는 수행하지 않음 |
| Explorer 재시작 | 실제 Explorer 종료 후 새 프로세스 생성 확인. 오버레이 자동 숨김 및 재생성된 트레이의 표시 메뉴로 복구 확인 |
| Win+D 표시·복귀 | 사용자가 Win+D 두 번 실행 후 정상 표시·복귀 및 입력을 확인함. 에이전트 키 주입 결과와 구분 |
| 트레이·효과 감소 | 표시/숨김/종료, 효과 감소 체크·값 저장·다음 실행 유지 확인. OS 동작 줄이기와 문서 숨김에서도 애니메이션 중단 |
| GPU 손실 | 실제 WebView2 context 손실 시 네이티브 오버레이 숨김. 표시 메뉴로 새 renderer가 생성되어 복구됨 |

DPI 변경 검증에서 기존 WebView2가 이전 rasterization scale을 유지하는 결함을 발견해 수정했다. 복구 시 기존 웹뷰를 재사용하지 않고 다시 생성한 뒤 실제 125%→200% 전환을 재검증했다. 모든 변경 후 디스플레이는 원래 **2880×1800 / 200%**로 복구했다.

기존 `test-overlay-input.ps1`는 이 환경에서 수신 창의 입력 대상 확보 조건을 만족하지 못해 중단됐다. 이 실패를 통과로 바꾸거나 가드를 완화하지 않았다. 별도 C# 수신기에 실제 Windows 입력을 전달해 검증했다. 수신기는 기본 Windows .NET Framework 컴파일러로 만들며 추가 패키지를 설치하지 않는다.

수신기 재현 예시 (`apps/desktop`에서 실행, 오버레이 실행 상태):

```powershell
$probeSource = (Resolve-Path scripts/fixtures/M0InputProbe.cs).Path
$probeExecutable = Join-Path (Get-Location) 'node_modules/.cache/M0InputProbe.exe'
$probeResult = Join-Path (Get-Location) 'node_modules/.cache/m0-input-result.json'
New-Item -ItemType Directory -Force -Path (Split-Path $probeExecutable) | Out-Null
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$probeExecutable" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll $probeSource
Start-Process -FilePath $probeExecutable -ArgumentList $probeResult -WindowStyle Normal
```

검증 창을 전면에 표시하고 최대화한다. 캐릭터 위 클릭·우클릭·드래그·휠과 문구 입력 후 창을 닫으면 JSON 결과가 기록된다. 자동 입력 없이 직접 실행해도 된다. 결과 파일과 실행 파일은 무시되는 `node_modules/.cache`에만 생성된다.

## 예외와 남은 범위

- Windows 10은 사용자 요청으로 제외했다. 추가 Windows 빌드·다중 모니터·혼합 DPI·GPU 조합은 TBD다.
- 보안 데스크톱(UAC/잠금)과 독점 전체 화면에서는 표시를 보장하지 않는다. 보안 설정이나 보안 화면을 조작해 검증하지 않았다.
- 다른 최상위 창과의 상대 순서는 보장하지 않는다. 일반 앱 위 표시를 위해 반복적으로 포커스나 z-order를 회수하지 않는다.
- 절전 통지에 대한 숨김은 구현했으나 실제 절전·복귀는 미실행이다.
- Chrome 최대화 확인 후 M0 체크리스트의 해당 항목을 갱신한다.
