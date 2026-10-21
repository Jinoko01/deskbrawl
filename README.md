# DeskBrawl

Tauri 2 + React + TypeScript + Vite 기반 데스크톱 게임 프로젝트입니다.
현재는 M0의 **창 분리·클릭 통과·포커스 안전장치·트레이 제어와 PixiJS 캐릭터 1개 표시**를 구성했습니다.
`main`은 기존 React 화면을 표시하고, `overlay`는 별도 `overlay.html`을 사용하는 투명 최상위 창입니다. 숨김 상태로 생성한 뒤 Rust에서 클릭 통과·포커스 비활성 설정이 성공해야 표시합니다.
오버레이는 네이티브 명령 권한이 없으며, `main`을 닫으면 숨겨진 오버레이까지 앱과 함께 종료됩니다. 오버레이만 닫으면 `main`은 유지됩니다.
트레이에서 상태 확인·오버레이 표시·숨김·종료가 가능합니다. 표시할 때마다 안전 설정을 다시 적용하며, 예상하지 않은 포커스 획득이나 설정 실패 시 숨깁니다. 숨김 실패 시 창 제거를 시도하고, 그것도 실패하면 앱을 종료합니다. 트레이의 표시 메뉴로 중지되거나 닫힌 오버레이를 복구할 수 있습니다.
Windows에서는 네이티브 클릭 통과·비활성 스타일을 확인하고, 비활성 표시와 숨김을 Win32로 보완합니다. 전역 키 등록이나 포커스 강제 복원은 사용하지 않습니다.
오버레이 중앙에 기존 `mochi-v2` atlas의 대기 프레임 하나를 PixiJS 8로 표시합니다. 논리 프레임 크기는 96 CSS px이며, PNG의 투명 영역과 발 기준 anchor를 유지합니다. HTML·캔버스 배경 알파는 0입니다.
정지 장면이므로 매 프레임 루프 없이 최초 표시·창 크기/배율 변경 시 다시 그립니다. 초기화 중 종료·React Strict Mode/HMR 재실행 시 canvas·renderer·texture·구독을 정리합니다. 로딩·렌더링 실패와 WebGL context 손실 시 안내를 표시하고, 실패한 canvas는 제거합니다. 재시도는 앱을 다시 실행합니다.
애니메이션, 효과 감소, 전체 모니터 경계/DPI 좌표 대응과 서버는 후속 작업입니다.
이 PC(Windows 11)에서 개발 앱 실행·한국어 표시·최대화/복원, 배포용 `deskbrawl.exe` 실행·종료, NSIS 설치 파일 생성과 설치·실행·제거까지 확인했습니다.
구현 계획 M0에서는 프로젝트 생성·Windows 패키징 항목만 완료 처리했습니다. Windows 10 실기기 검증은 TBD입니다.

## 로컬 환경

- Node.js 22.13 이상, 23 미만. 구성 시 확인한 버전: 22.20.0.
- pnpm 10.34.7. 설치된 Corepack과 호환되는 버전으로, `package.json`의 `packageManager`를 따릅니다.
- Windows 네이티브 빌드: Rust MSVC 툴체인(구성 시 설치한 버전: 1.99.1), Visual Studio Build Tools의 **Desktop development with C++** 및 Windows SDK.
- Microsoft Edge WebView2 Runtime.

설치 방법은 [Tauri Windows 준비 사항](https://v2.tauri.app/start/prerequisites/#windows)을 따릅니다.
Rust와 Visual C++ 도구는 JS 의존성 설치만으로 설치되지 않습니다.
이 PC에는 Rust 1.99.1, Visual Studio Build Tools 2022 17.14.42와 Windows SDK 10.0.26100을 설치했습니다.
설치 전에 열어 둔 터미널에서 `cargo`를 찾지 못하면 터미널을 새로 열어 PATH를 갱신합니다.

```powershell
pnpm install
pnpm dev
```

`pnpm dev`는 Vite 서버와 Tauri 기본 창을 함께 실행합니다. 종료는 터미널에서 `Ctrl+C`를 사용합니다.
개발 서버는 `127.0.0.1:1420`에만 열리며, 해당 포트가 사용 중이면 다른 포트로 이동하지 않고 오류로 종료합니다.
기본 Node가 프로젝트 범위와 다르면 `pnpm --config.use-node-version=22.20.0 dev`로 지정 버전을 사용할 수 있습니다. 최초 실행 시 pnpm이 해당 런타임을 내려받습니다.

Rust 도구 없이 웹 화면만 확인할 때:

```powershell
pnpm dev:web
```

## 검증과 빌드

```powershell
pnpm check
pnpm tauri:info
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm build
```

- `pnpm check`: ESLint, strict TypeScript, 웹 프로덕션 빌드.
- `pnpm build`: 웹 빌드, Rust 컴파일, 로컬 Windows NSIS 설치 파일 생성. 서명·게시 작업은 하지 않습니다.
- 설치 파일 위치: `apps/desktop/src-tauri/target/release/bundle/nsis/`.
- JS 의존성은 `pnpm-lock.yaml`, Rust 의존성은 `apps/desktop/src-tauri/Cargo.lock`으로 고정합니다. 두 파일 모두 패키지 관리 도구로 생성합니다.
- 웹 검증은 실제 Tauri 창·WebView·Windows 패키징 검증을 대신하지 않습니다.
- 네이티브 도구가 준비되면 `pnpm dev`로 화면 표시, 창 크기 변경, 닫기와 재실행을 확인하고 `pnpm build`로 설치 파일 생성을 검증합니다. Windows 10/11 호환성 및 최소 창 크기·DPI 정책은 아직 TBD입니다.

TypeScript는 현재 ESLint TypeScript 도구의 지원 범위에 맞춰 6.0.3을 사용합니다.
창·트레이 제어는 Rust에서 담당합니다. Tauri의 기존 `tray-icon` feature를 활성화했으며, 웹뷰 IPC 명령은 추가하지 않아 `main`·`overlay` 각각의 capability 권한 목록은 비어 있습니다.
개발용 CSP만 Vite의 React 갱신 스크립트·스타일 주입과 로컬 WebSocket을 허용하며, 배포용 CSP에는 해당 예외가 없습니다.
PixiJS는 `pixi.js/unsafe-eval` 모듈의 eval 없는 렌더링 경로를 사용하므로 CSP에 `unsafe-eval`을 추가하지 않습니다. PixiJS 8.22.0의 bitmap font 타입 선언과 `exactOptionalPropertyTypes`의 충돌은 `patches/pixi.js@8.22.0.patch`로 보정했습니다. 런타임에서 항상 초기화하는 `distanceField`를 `NonNullable`로 선언하며, TypeScript 검사 설정은 유지합니다. `pnpm install` 시 패치도 함께 적용됩니다.
UI는 Tailwind 의미 기반 토큰을 사용하며, shadcn/ui 컴포넌트는 실제 컨트롤이 필요한 단계에서 추가합니다.

Windows에서 `pnpm build` 후 창 생성·숨김·네이티브 스타일·종료 순서를 검증하려면:

```powershell
pwsh -File apps/desktop/scripts/test-window-lifecycle.ps1
```

이 검증은 실제 Windows 창을 세 번 실행합니다. 네이티브 입력 통과·비활성화 스타일, 트레이 표시/숨김과 포그라운드 유지, 포커스 통지 시 자동 숨김과 재표시, 오버레이 단독 종료·재생성, `main` 및 트레이 종료 시 전체 정리를 확인합니다. 포커스 이상 경로는 Windows 포커스 메시지를 주입해 재현합니다.

오버레이 아래 임시 창에 실제 클릭·드래그·우클릭·휠·키보드 입력을 보내 검증하려면:

```powershell
pwsh -STA -File apps/desktop/scripts/test-overlay-input.ps1
```

입력 검사는 수신 창이 실제 입력 대상인지 확인한 뒤 활성화하며, 키보드 입력은 해당 창에 포커스가 있을 때만 전송합니다. 조건을 만족하지 못하면 입력을 보내지 않고 중단합니다. 반복 표시/숨김의 포커스 유지, 닫힌 오버레이 재생성, 트레이 종료도 확인한 뒤 창과 입력 상태를 정리합니다.

현재 실행 환경에서는 수신 창의 입력 대상 확보 단계에서 중단되어 실제 클릭·드래그·휠·키보드 전달 성공은 미검증입니다. 네이티브 창·메뉴 메시지 기반 검증과 구분합니다. 투명 합성·DPI·VS Code/Chrome·Alt+Tab 실사용 시나리오와 Windows 10 검증도 후속 범위입니다.

PixiJS 렌더러 검증은 `pnpm dev:web` 실행 후 `http://127.0.0.1:1420/overlay.html`의 브라우저 개발자 콘솔에서 실행합니다.

```js
await (await import('/scripts/test-overlay-rendering.mjs')).testOverlayRendering()
```

실제 WebGL 픽셀에서 캐릭터 존재·투명 배경을 검사하고, resize/DPR, 반복 생성·해제, 비동기 초기화 취소, 이미지 로딩 실패, context 손실 시 정리를 확인합니다. 브라우저 배율 1·2에서 실행하며, 웹 검증 결과는 Windows 투명 합성·입력 전달 검증과 구분합니다.

2026-10-21 캐릭터 표시 검증:

- `pnpm --config.use-node-version=22.20.0 check`: ESLint·strict TypeScript·웹 빌드 통과.
- `testOverlayRendering()`: 브라우저 배율 1·2에서 모든 검사 통과.
- `pnpm --config.use-node-version=22.20.0 build`: Windows 실행 파일·NSIS 생성 통과.
- `test-window-lifecycle.ps1`: 창·트레이·포커스 안전장치 3개 시나리오 통과.
- 배포 실행 파일의 Windows 화면에서 모찌 1개와 투명 배경 표시 확인. VS Code·Chrome 최대화, 실제 입력 전달, 모니터 배율 변경 시나리오는 별도 미검증 범위입니다.

## 구조

```text
apps/desktop/
  src/               React 화면, PixiJS 장면(game/), 스타일
  src-tauri/         Rust 진입점, 창 설정, 최소 capability
packages/game-assets/ 기존 캐릭터·무기·돌·효과 에셋
docs/                기획·구현 계획·개발 가이드
```

앱 아이콘은 `apps/desktop/src-tauri/icons/source.svg`로 만든 임시 식별 아이콘이며 캐릭터 디자인과 별개입니다.
