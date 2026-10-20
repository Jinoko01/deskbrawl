# 풀스택 데스크톱 게임 프로젝트

## 기술 기준

| 영역              | 선정 기술                                                           |
| ----------------- | ------------------------------------------------------------------- |
| 데스크톱          | Tauri 2 + Rust                                                      |
| UI                | React + TypeScript + Vite, shadcn/ui + Tailwind CSS                 |
| 게임 렌더링       | PixiJS 8                                                            |
| 상태              | Zustand, TanStack Query                                             |
| 클라이언트 통신   | Socket.IO Client, REST                                              |
| 네이티브          | Tauri Plugins + Win32 API                                           |
| 서버              | NestJS + TypeScript, REST Controller, WebSocket Gateway + Socket.IO |
| 인증·인가         | JWT + Guards + 초대 토큰                                            |
| 영속 데이터       | PostgreSQL + Prisma                                                 |
| 입력 계약         | Zod + 공유 프로토콜                                                 |
| 게임 시뮬레이션   | TypeScript 기반 Fixed Tick Loop                                     |
| 클라이언트 테스트 | Vitest + React Testing Library + Playwright + Rust Tests            |
| 서버 테스트       | Jest + Supertest + Socket.IO 통합 테스트                            |
| 향후 확장         | Redis — 현재 필수 의존성이 아니며 필요가 확인될 때 도입             |

- JavaScript·TypeScript 패키지는 `pnpm`, Rust 의존성과 검증은 `cargo`로 관리한다.
- Tauri 2와 PixiJS 8 외 버전은 대상 프로젝트의 manifest와 lockfile을 따른다. React·Tailwind 등의 버전을 임의로 확정하거나 올리지 않는다.
- 선정 목록은 기술 기준이다. 한 번에 모든 패키지나 설정을 설치·생성하라는 지시가 아니다.

## 규칙과 문서 적용

- 작업 전에 `.agents/rules/00-baseline.md`와 대상 영역의 규칙을 읽는다. `paths`는 루트 기준 적용 범위 안내이며, 도구가 자동으로 읽는다고 가정하지 않는다.
- 공통 코드 품질은 `docs/code-quality.md`, 클린 코드는 `docs/clean-code-guide.md`, 통신은 `docs/api-guide.md`, 검증은 `docs/testing-guide.md`를 읽는다.
- `.agents/rules/`가 기준이며 `.claude/rules/`는 동일 내용의 Claude용 미러다. 규칙 변경 시 둘을 함께 갱신한다.
- 사용자 요청을 우선한다. 문서끼리 충돌하거나 필수 문서가 없으면 해당 사실을 보고하고, 영향받는 결정을 임의로 확정하지 않는다.
- 기존 구조·패턴·이름을 먼저 확인한다. 아래 예시를 맞추기 위한 파일 이동이나 새 아키텍처 도입을 하지 않는다.

| 작업 영역          | 읽을 규칙                                                |
| ------------------ | -------------------------------------------------------- |
| React·상태         | `10-react-state.md`, `30-typescript-structure.md`        |
| REST·서버 캐시     | `20-api-data.md`, `110-shared-protocol.md`               |
| UI·접근성          | `40-styling-accessibility.md`                            |
| 오류·인증·보안     | `50-error-security.md`                                   |
| 의존성·설정·테스트 | `60-dependencies-tests.md`, `80-e2e-rules.md`            |
| Git·PR             | `70-git-conventions.md`                                  |
| NestJS             | `90-nestjs-server.md`, `110-shared-protocol.md`          |
| PostgreSQL·Prisma  | `100-database-prisma.md`                                 |
| Socket.IO          | `110-shared-protocol.md`, `120-realtime-simulation.md`   |
| 게임 시뮬레이션    | `120-realtime-simulation.md`                             |
| Tauri·Rust·Win32   | `130-tauri-rust-native.md`, `50-error-security.md`       |
| PixiJS             | `140-pixijs-rendering.md`, `40-styling-accessibility.md` |

표의 규칙 파일명은 모두 `.agents/rules/` 기준 상대 경로다.

## 경계와 디렉토리

새 저장소에 구조가 없다면 다음 배치를 기본 예시로 사용한다. 이미 `frontend/`, `backend/` 등을 사용하면 유지하고 규칙의 경로 패턴을 실제 구조에 맞춘다.

```text
apps/
  desktop/
    src/
      pages/             # 화면, 페이지 전용 하위 UI는 pages/<화면>/components/
      components/ui/     # shadcn/ui 기반 공통 UI
      components/        # 여러 화면에서 사용하는 제품 컴포넌트
      api/               # REST 전송과 도메인 API
      hooks/queries/     # Query key·options·hook
      stores/            # 공유 클라이언트 상태
      realtime/          # Socket.IO 연결·이벤트 어댑터
      game/              # PixiJS 렌더링·입력·스냅샷 보간
      native/            # Tauri IPC 어댑터
    src-tauri/           # Rust, capabilities, Tauri 설정
  server/
    src/modules/         # 도메인별 NestJS 모듈
    src/game/            # 서버 시뮬레이션
    prisma/              # schema와 migrations
    test/                # REST·Socket.IO 통합 테스트
packages/
  protocol/src/          # 공유 Zod 스키마·DTO·이벤트 계약
```

- 이 배치는 경계 설명이다. 필요 없는 빈 디렉토리·workspace·파일을 미리 만들지 않는다.
- 공유 프로토콜은 브라우저와 서버 양쪽에서 사용할 수 있어야 한다. NestJS·Prisma·Tauri·PixiJS·React 런타임에 의존하지 않는다.
- 서버가 게임 상태·판정·결과를 결정한다. 클라이언트는 입력 의도 전송, 렌더링, 명세된 예측·보간을 담당한다.
- REST 조회 캐시, 실시간 스냅샷, UI 상태의 소유자를 구분하고 동일 데이터의 수정 가능한 사본을 여러 저장소에 만들지 않는다.
- 네이티브 기능은 Tauri 경계에서 처리한다. UI에서 OS 권한이나 서버 인가를 대신 보장하지 않는다.

## 작업 범위와 승인

- 명세에 없는 기능·화면·버튼·설정은 추가하지 않는다. 로딩·빈 상태·오류·접근성·창 크기 대응·중복 실행 방지·연결 단절 안내는 기본 완성 범위다.
- 요청과 무관한 리팩터링·이름 변경·포맷 변경을 함께 수행하지 않는다. 전체 구현을 요청받으면 요청 범위까지 구현·검증하고 중간 승인을 반복해서 기다리지 않는다.
- 파일 삭제, 대규모 이동, 공개 REST·Socket.IO·IPC 계약의 호환성을 깨는 변경, 설정의 광범위한 변경은 사전 확인한다. 해당 조치가 사용자 요청에 이미 명시적으로 포함되었다면 중복 확인하지 않는다.
- 새 JS 패키지·Rust crate 설치, 기존 의존성 제거, 주요 버전 변경은 사전 확인한다.
- 파괴적 DB 작업·운영 마이그레이션 실행·배포·서명·배포판 게시 전에는 대상과 변경 결과를 제시하고 명시적인 승인을 받는다. 이미 승인된 범위의 준비·로컬 검증은 계속한다.
- Redis, 분산 락, 별도 메시지 브로커, 범용 게임 엔진 추상화는 실제 요구 없이 도입하지 않는다.

## 디자인 기준

- 일반 UI는 shadcn/ui와 Tailwind 토큰으로 구현한다. 기존 shadcn 컴포넌트의 접근성 동작을 유지한다.
- PixiJS 장면과 DOM UI의 책임을 구분한다. 동적 좌표·캔버스 크기 등 렌더링에 필요한 값은 전용 어댑터에서 처리한다.
- 지원 OS·최소 창 크기·DPI·테마는 명세를 따른다. Win32 전용 기능은 다른 OS에서 지원되는 것처럼 표시하지 않는다.

## 완료와 보고

- 변경 전 manifest·lockfile·CI·실제 스크립트를 확인하고 `docs/testing-guide.md`에 따라 관련 검증을 실행한다. 이 문서의 명령 예시가 실제로 등록되어 있다고 가정하지 않는다.
- 검증을 위해 ESLint·TypeScript·Rust 검사나 기존 테스트를 완화·삭제하지 않는다.
- 실행한 명령과 결과, 실행하지 못한 검증과 이유를 구분한다. 웹 UI 테스트 통과를 Tauri·Win32 실기기 검증으로 보고하지 않는다.
- 코드·실행 결과로 확인한 사실만 보고하고, 미정인 수치·정책은 `TBD`로 표시한다.
