---
paths:
  - "apps/server/**/*.ts"
---

# NestJS 서버

- 서버 코드를 작성·수정하기 전에 `apps/server/README.md`, `apps/server/eslint.config.js`, `apps/server/.prettierrc.json`을 확인하고 해당 규칙을 따른다.
- Controller·Service·Guard·Gateway·Filter는 역할별 파일과 NestJS 접미사로 구분한다. 기존 도메인 경계와 모듈 진입 경로를 유지하며, 한 파일에는 클래스 하나를 둔다.
- 한 줄에 여러 문장을 압축하지 않는다. 조건문·반복문은 중괄호를 사용하고 중첩 삼항식은 명시적인 분기로 풀어 쓴다. 메서드와 처리 단계 사이에 빈 줄을 둔다.
- 타입 전용 import와 함수 반환 타입을 명시하고, Promise의 실패·종료 경로를 처리한다. ESLint typed lint와 포맷 규칙을 비활성화해 통과시키지 않는다.
- 수정 후 서버 `lint:fix`, `format:check`, `typecheck`, 관련 테스트를 실행한다. 인증·DB·실시간 유스케이스를 변경하면 격리 PostgreSQL·Socket.IO 통합 테스트도 실행한다.

- 도메인별 Module을 구성하고 의존성은 NestJS DI로 주입한다. 새 컨테이너나 서비스 로케이터를 만들지 않는다.
- REST Controller는 입력·인증 컨텍스트 전달·응답 매핑, Gateway는 연결·이벤트 경계를 담당한다. 핵심 유스케이스와 규칙은 Service·도메인 로직에 둔다.
- REST와 Gateway가 같은 유스케이스를 호출할 때 인가·상태 전이 규칙이 달라지지 않도록 한다. 서로의 핸들러를 직접 호출하지 않는다.
- HTTP body·path·query와 Socket.IO payload를 공유 Zod 계약으로 각각 검증한다. HTTP용 Pipe·Filter가 WebSocket에도 같은 방식으로 작동한다고 가정하지 않는다.
- Zod를 선택한 프로젝트에 class-validator를 기계적으로 추가하지 않는다. NestJS 연결에 필요한 Pipe·오류 매핑은 기존 구현을 우선 사용한다.
- Guards는 인증과 작업 접근을 검사하고, 리소스 소유권·방 멤버십·현재 게임 단계는 해당 유스케이스에서도 검사한다.
- DB 접근은 해당 도메인의 Service 또는 필요가 확인된 데이터 접근 계층에 둔다. Controller·Gateway가 Prisma를 직접 호출하지 않는다.
- 게임 입력은 검증 후 명령 큐에 전달한다. Gateway 콜백에서 게임 상태를 임의로 수정해 틱 순서를 우회하지 않는다.
- 설정은 시작 시 검증한다. DB URL·JWT 키 등 필수 설정 누락을 임의 기본값으로 숨기지 않는다.
- 인증 시도·초대 사용·이벤트 폭주와 payload 크기를 경계에서 제한한다. 이벤트 루프를 막는 연산과 동기 I/O를 피한다.
- 애플리케이션 종료 시 게임 루프·socket 서버·타이머·Prisma 연결을 정리한다. 테스트도 같은 생명주기를 검증한다.
