# DeskBrawl

Tauri 2 + React + TypeScript + Vite 기반 데스크톱 게임 프로젝트입니다.
현재는 M0의 **기본 앱과 `main`·`overlay` 창 분리**를 구성했습니다.
`main`은 기존 React 화면을 표시하고, `overlay`는 별도 `overlay.html`을 사용하는 투명 최상위 창으로 숨긴 상태에서 생성됩니다.
오버레이는 네이티브 명령 권한이 없으며, `main`을 닫으면 숨겨진 오버레이까지 앱과 함께 종료됩니다. 오버레이만 닫으면 `main`은 유지됩니다.
클릭 통과와 안전장치가 준비된 뒤 표시 제어를 연결합니다. PixiJS 렌더링, 입력 통과, 트레이와 서버는 후속 작업입니다.
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
네이티브 명령·플러그인이 없으므로 `main`·`overlay` 각각의 capability 권한 목록은 비어 있습니다.
개발용 CSP만 Vite의 React 갱신 스크립트·스타일 주입과 로컬 WebSocket을 허용하며, 배포용 CSP에는 해당 예외가 없습니다.
UI는 Tailwind 의미 기반 토큰을 사용하며, shadcn/ui 컴포넌트는 실제 컨트롤이 필요한 단계에서 추가합니다.

Windows에서 `pnpm build` 후 창 생성·숨김·네이티브 스타일·종료 순서를 검증하려면:

```powershell
pwsh -File apps/desktop/scripts/test-window-lifecycle.ps1
```

이 검증은 실제 Windows 창을 두 번 실행합니다. 오버레이만 닫아도 `main`이 유지되는지, `main`을 닫으면 숨겨진 오버레이 때문에 프로세스가 남지 않는지 확인합니다. 클릭 통과·투명 합성·DPI 검증은 별도 후속 범위입니다.

## 구조

```text
apps/desktop/
  src/               React 화면과 Tailwind 스타일
  src-tauri/         Rust 진입점, 창 설정, 최소 capability
packages/game-assets/ 기존 캐릭터·무기·돌·효과 에셋
docs/                기획·구현 계획·개발 가이드
```

앱 아이콘은 `apps/desktop/src-tauri/icons/source.svg`로 만든 임시 식별 아이콘이며 캐릭터 디자인과 별개입니다.
