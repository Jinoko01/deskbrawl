# DeskBrawl 브랜딩

사용자가 선택한 기본 캐릭터의 얼굴을 로고로 사용한다. 갈색 머리, 민트 헤드셋, 사각 눈과 픽셀 윤곽을 유지한다. 이미지 생성 도구로 흰 배경을 제거한 투명 PNG이며 벡터 파일은 아니다.

## 적용 위치

- 원본: `apps/desktop/public/brand/face.png`
- 앱 사이드바와 웹 파비콘: 같은 원본 PNG
- Windows 실행 파일·창·트레이·설치 프로그램: `apps/desktop/src-tauri/icons/icon.ico`
- 네이티브 PNG: `apps/desktop/src-tauri/icons/icon.png`
- `source.svg`는 원본 PNG를 참조하는 미리보기 래퍼이며 독립 벡터 원본이 아니다.

## 민트 테마

`apps/desktop/src/brand-theme.css`가 홈·설정·채팅·오버레이 상태 배지의 색상 원본이다. OS의 `prefers-color-scheme`에 따라 전환하며 별도의 설정 버튼이나 저장 상태를 만들지 않는다. 투명 게임 오버레이의 바탕은 계속 투명하다.

| 역할 | 라이트 | 다크 |
| --- | --- | --- |
| 주요 버튼·선택 상태 | `#167563` | `#81CBB9` |
| 주요 버튼 글자 | `#FFFFFF` | `#102D28` |
| 앱 배경 | `#F2F8F6` | `#111C1A` |
| 본문 | `#183B33` | `#EDF8F3` |

밝은 민트는 캐릭터의 고유 색상으로 유지하고, 라이트 테마의 작은 텍스트와 버튼에는 명도 대비를 확보한 짙은 민트를 사용한다. 오류 색상은 의미 구분을 위해 유지한다.

## 아이콘 재생성

저장소 루트에서 기존 Tauri CLI로 생성한다. 새 의존성은 필요 없다.

```powershell
pnpm --filter @deskbrawl/desktop exec tauri icon public/brand/face.png --output ../../output/branding/native-icons
Copy-Item -LiteralPath output/branding/native-icons/icon.ico -Destination apps/desktop/src-tauri/icons/icon.ico
Copy-Item -LiteralPath output/branding/native-icons/icon.png -Destination apps/desktop/src-tauri/icons/icon.png
```

생성 결과 중 현재 지원하는 Windows용 파일만 앱에 반영한다. 네이티브 아이콘은 재빌드한 실행 파일에 반영되며 이미 실행 중이거나 설치된 구버전 앱은 자동으로 교체되지 않는다.

## 검증 기록 — 2026-10-26

- Node 22.20.0, Corepack의 pnpm 10.34.7로 `pnpm --filter @deskbrawl/desktop lint`, `typecheck`, `test`, `build` 실행: 모두 통과. Vitest 11개 파일·61개 테스트 통과.
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --release --locked --offline`: 통과. 새 로고를 포함한 `target/release/deskbrawl.exe` 생성. 설치 프로그램 생성·설치·배포는 수행하지 않음.
- PNG의 RGBA 형식·투명 모서리, ICO의 16/24/32/48/64/256px 프레임 확인. 생성된 32px 아이콘을 직접 확인함.
- 라이트·다크의 본문·보조 텍스트·주요 버튼·오류 텍스트 등 16개 주요 토큰 조합을 계산: 최소 4.66:1. 실제 렌더링 전체에 대한 접근성 검사 결과는 아님.
- `git diff --check`: 통과.
- 실제 UI의 창 크기·키보드·테마 전환 검증은 미완료. `wmux` 미설치, 인앱 브라우저의 로컬 URL 연결 시간 초과, Computer Use의 Windows 브라우저 URL 확인 실패로 UI 조작이 중단됨. 기존 설치 앱은 변경하지 않았으며 새 네이티브 빌드의 실기기 실행 검증으로 보고하지 않음.
