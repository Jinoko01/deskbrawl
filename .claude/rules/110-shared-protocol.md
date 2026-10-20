---
paths:
  - "packages/protocol/**"
  - "apps/desktop/src/api/**"
  - "apps/desktop/src/realtime/**"
  - "apps/desktop/src/native/**"
  - "apps/server/**/*.ts"
---

# Zod·공유 프로토콜

- REST 요청·응답, Socket.IO 이벤트·ack·snapshot의 계약은 공유 Zod 스키마를 기준으로 정의한다. TS 타입은 스키마에서 추론한다.
- 공유 패키지는 순수 데이터 계약과 검증에 한정한다. React·NestJS·Prisma·PixiJS·Tauri·Node 전용 코드나 서버 비밀값을 가져오지 않는다.
- 이벤트 이름·방향·payload·ack·실패 code를 한곳에서 관리한다. 클라이언트와 서버에 별도 수기 타입을 복제하지 않는다.
- 외부 입력은 수신 경계에서 검증한다. 숫자는 finite·정수 여부·범위, 문자열·배열은 길이, 객체는 불필요한 필드 처리 정책까지 정한다.
- 스키마 검증과 인가는 별개다. 유효한 roomId라도 멤버십·소유권·현재 단계가 확인되지 않으면 거부한다.
- ID, tick, sequence, 좌표, 시간의 단위·범위·기준을 명시한다. JSON에서 Date·BigInt·Map·클래스 인스턴스가 그대로 전송된다고 가정하지 않는다.
- 서버 메시지의 revision·tick과 명령 ID·sequence는 실제 순서·중복 처리에 필요한 범위로 설계한다. 일반 DTO마다 쓰지 않는 메타데이터를 강제하지 않는다.
- IPC 입력도 신뢰 경계다. Rust에서는 serde 타입과 Rust 검증을 적용한다. TypeScript Zod가 Rust 안에서 자동 실행되거나 타입을 동기화한다고 가정하지 않는다.
- 데스크톱 클라이언트는 서버와 동시에 갱신되지 않을 수 있다. 계약 변경 시 구버전 지원·버전 협상·거부 안내와 배포 순서를 정한다.
- 요청·응답·event·ack의 정상값과 잘못된 값에 대한 계약 테스트를 둔다. 스키마 변경 시 양쪽 호출자와 fixture를 함께 점검한다.
