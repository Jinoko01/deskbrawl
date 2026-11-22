# macOS에서 DeskBrawl 빌드하기

macOS 15 이상을 대상으로 DeskBrawl을 실행하거나 Apple Silicon과 Intel용 앱을 하나의 DMG로 빌드할 수 있어요.

## 소스에서 실행하기

Mac에 Xcode Command Line Tools, Git, Node.js 22.13 이상(22.x), pnpm 10.34.7, Rust 1.95 이상을 설치하세요. Xcode Command Line Tools는 `xcode-select --install`로 설치할 수 있어요. [Tauri macOS 준비 사항](https://v2.tauri.app/start/prerequisites/#macos)

저장소 루트에서 실행하세요.

```sh
pnpm --filter '@deskbrawl/desktop...' install --frozen-lockfile
pnpm dev
```

DeskBrawl 창에서 **플레이 시작**을 누르거나 `Ctrl+Shift+G`를 누르세요. `Esc`를 누르거나 다른 앱으로 전환하면 작업 모드로 돌아가요. 메뉴 막대에서 홈 창을 다시 열거나 오버레이를 숨길 수 있어요. macOS에서는 조작키와 플레이 전환 단축키를 DeskBrawl 창에서 사용해요. 작업 모드에서 캐릭터를 마우스로 옮기는 기능은 Windows에서 사용할 수 있어요.

## DMG 만들기

두 Mac 아키텍처용 Rust 타깃을 설치하고 저장소 루트에서 빌드하세요. `network:config`에 방문에 사용할 HTTPS 서버 주소를 지정하세요.

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm --filter @deskbrawl/desktop network:config https://api.deskbrawl.xyz
pnpm --filter @deskbrawl/desktop tauri build --target universal-apple-darwin --config src-tauri/tauri.network.conf.json -- --locked
```

DMG는 `apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/`에 생성돼요. GitHub Actions의 **Build macOS installer**에서도 `DeskBrawl-macOS-universal` 아티팩트를 받을 수 있어요. 이 워크플로는 테스트용 DMG를 생성해요. 공개 배포에는 Developer ID 서명과 Apple 공증이 필요해요.

## 공개 릴리스 준비하기

GitHub 저장소의 **Settings → Secrets and variables → Actions**에 서명과 공증에 필요한 저장소 시크릿을 등록하세요. [Tauri macOS 서명 및 공증 가이드](https://v2.tauri.app/distribute/sign/macos/)

- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`에 Developer ID Application 인증서, 인증서 비밀번호, 서명 ID를 설정하세요.
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`에 Apple 계정, 앱 암호, Apple Developer 팀 ID를 설정하세요.

**Prepare desktop release**에서 서명과 공증을 확인한 뒤 Windows 설치 파일과 `DeskBrawl_macOS-universal.dmg`를 같은 초안에 첨부해요. 두 운영체제에서 설치를 확인하고 안정 릴리스를 게시하면 웹사이트에 **macOS 15+ 다운로드**가 표시돼요. [공통 릴리스 절차](windows-release.md#release-a-new-version)

## Mac에서 확인하기

1. DeskBrawl을 열고 주 모니터에서 투명 오버레이가 표시되는지 확인하세요. 뒤에 있는 앱의 클릭과 스크롤이 동작해야 해요.
2. **플레이 시작**과 전환 단축키를 각각 눌러 이동과 공격을 확인하세요. `Esc`, 앱 전환, 창 닫기로 플레이가 끝나야 해요.
3. 같은 서버에 연결된 두 기기로 방문 링크 복사·열기, 방문, `/` 채팅을 확인하세요. 앱을 다시 열었을 때 키체인 자격 증명으로 기존 기기 세션을 복구해야 해요.
4. 메뉴 막대에서 오버레이 숨김·표시와 집중 모드를 전환하세요. 창을 닫은 뒤 Dock 아이콘이나 메뉴 막대로 다시 열고, 메뉴 막대에서 종료하세요.
