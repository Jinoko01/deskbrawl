---
paths:
  - "**/package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - "**/Cargo.toml"
  - "**/Cargo.lock"
  - "**/*config*"
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/tests/**"
  - "**/test/**"
  - "**/src-tauri/**"
---

# 의존성·설정·테스트

- JS·TS 패키지는 pnpm, Rust는 cargo를 사용한다. lockfile은 도구로 갱신하고 직접 편집하지 않는다.
- 새 패키지·crate, 제거, 주요 버전 변경은 사전 확인한다. 이미 설치된 기능으로 해결되는 중복 의존성을 추가하지 않는다.
- Rust toolchain·Node·pnpm 버전과 JS/Rust Tauri 패키지·플러그인의 호환성을 manifest·lockfile·공식 문서에서 확인한다.
- Redis는 요구가 확인되기 전 설치·환경변수·adapter·테스트의 필수 조건으로 만들지 않는다.
- 테스트 도구의 책임과 명령 선택은 `docs/testing-guide.md`를 따른다. Vitest와 Jest의 전역 타입·설정이 서로 침범하지 않게 범위를 나눈다.
- 변경의 위험과 실패 경로에 맞는 가장 작은 검증을 추가·수정한다. 단순 문서·스타일 수정을 위해 의미 없는 테스트를 만들지 않는다.
- 공유 프로토콜·인증·멱등성·게임 규칙 변경에는 해당 경계의 회귀 검증을 포함한다.
- 실제 PostgreSQL·Socket.IO 통합 검증에는 격리된 테스트 자원을 사용하고 연결·타이머·DB 클라이언트를 종료한다.
- 기존 검증 규칙을 끄거나 타입·lint·테스트 수준을 낮춰 통과시키지 않는다. 재시도 횟수 증가로 비결정적 실패를 숨기지 않는다.
- 결과는 실행한 명령·대상·성공/실패·미실행 사유로 보고한다. 설치되지 않은 도구를 실행한 것처럼 쓰지 않는다.
