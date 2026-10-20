# REST·Socket.IO·IPC 계약 가이드

## 세 경계

```text
React → Query/Mutation → 도메인 REST 함수 → HTTP 어댑터
      → 실시간 어댑터 → Socket.IO → NestJS Gateway
      → native 어댑터 → Tauri IPC → Rust → Plugin / Win32

NestJS Controller / Gateway → Service / 게임 명령 큐 → 시뮬레이션 / Prisma
클라이언트·서버 → packages/protocol의 Zod 스키마·wire 타입
```

REST는 요청·응답과 일반 서버 캐시, Socket.IO는 실시간 이벤트, IPC는 로컬 OS 기능을 담당한다. 같은 유스케이스를 여러 경로로 노출해야 하면 서버 규칙과 중복 방지 경계를 공유한다.

## 상태 소유권

| 데이터                  | 수정 가능한 원본          | 사용 방식                   |
| ----------------------- | ------------------------- | --------------------------- |
| 일반 REST 조회 결과     | TanStack Query 캐시       | 화면이 Query Hook을 구독    |
| 게임 진행·판정·결과     | 서버 시뮬레이션·영속 저장 | 클라이언트는 입력 의도 전송 |
| 수신 snapshot·보간 버퍼 | 클라이언트 게임 런타임    | PixiJS와 필요한 HUD가 구독  |
| 여러 화면의 UI 설정     | Zustand                   | 필요한 slice만 구독         |
| 폼·단일 화면의 UI       | 로컬 React 상태           | 제출 시 검증·Mutation       |
| OS 자원·handle          | Rust 모듈                 | IPC로 필요한 결과만 노출    |

실시간 이벤트가 일반 조회 데이터를 바꾸는 경우 Query 캐시 갱신 또는 무효화 경로를 하나로 정한다. 같은 데이터를 Zustand에도 복제하지 않는다.

## 새 REST 기능

1. 공유 Zod schema로 요청·응답·안전한 오류 code를 정한다. 입력 길이·범위와 JSON 직렬화 표현을 명시한다.
2. NestJS Controller 경계에서 body·path·query를 검증하고 Guard와 유스케이스 인가를 적용한다.
3. Service에서 규칙을 처리한다. 원자적 갱신·중복 방지가 필요한 곳은 transaction·DB 제약으로 보장한다.
4. 클라이언트 도메인 API 함수는 HTTP 어댑터를 사용하고 응답을 검증한다. UI는 transport 세부사항을 받지 않는다.
5. key·options·Hook을 도메인에 모은다. Query key에 모든 응답 결정 입력을 포함하고 AbortSignal을 전달한다.
6. UI는 로딩·빈 결과·오류·재시도·중복 제출 방지를 표시한다. 성공 시 캐시 갱신과 이동 정책을 정한다.
7. 계약과 위험에 맞는 단위·통합 검증을 추가한다.

fetch를 쓰면 HTTP 실패 상태를 명시적으로 검사한다. axios가 이미 있으면 기존 어댑터를 따른다. envelope·endpoint·타임아웃·헤더 규격을 이전 프로젝트에서 복사하지 않는다.

## 새 Socket.IO 명령·이벤트

1. 이름·방향·payload schema·room 범위·ack와 오류 code를 공유 프로토콜에 정의한다.
2. 인증 컨텍스트·멤버십·게임 단계·payload·입력 빈도·sequence를 서버에서 검증한다.
3. 중요한 변경에는 command ID와 중복 수신 정책을 정한다. ack가 수락·실행·저장 중 어느 단계인지 명시한다.
4. 입력을 서버 큐에 넣고 틱 경계에서 적용한다. 수신 콜백에서 게임 상태를 직접 바꾸지 않는다.
5. snapshot·delta에는 필요한 순서 기준을 둔다. 재연결 시 기준 snapshot부터 복원하고 오래된 이벤트·입력을 처리하는 정책을 정한다.
6. 연결 소유자가 구독을 해제한다. 여러 클라이언트 통합 테스트로 방 격리·중복 처리·복구를 확인한다.

Socket.IO 기본 전달은 재연결 후 누락 재생·정확히 한 번 실행을 자동 보장하지 않는다. 재시도 기능을 켤 때도 서버 멱등성과 결과 확인이 필요하다. [공식 전달 보장](https://socket.io/docs/v4/delivery-guarantees/)

## 새 IPC 명령

1. 노출할 최소 기능·입력·출력·오류와 허용 창을 정한다.
2. UI는 native 어댑터를 사용하고 Rust는 serde 타입과 별도 입력 검증을 적용한다.
3. 필요한 plugin permission·scope와 앱 자체 명령 접근 구성을 확인한다. 파일·URL·shell 범위를 입력 그대로 허용하지 않는다.
4. OS 실패·권한 거부·취소·종료·자원 해제를 처리한다. unsafe는 최소 영역에서 안전 조건을 명시한다.
5. mock IPC 검증과 실제 OS 검증 결과를 나누어 보고한다.

## 오류·인증 정책

- 예상 오류는 안정적인 code와 안전한 message로 변환한다. HTTP 상태·WebSocket 예외·IPC Result는 각 전송 계층에서 매핑한다.
- 재시도 가능 여부를 구분한다. 비멱등 변경·초대 소비·게임 시작에 무조건 자동 재시도를 적용하지 않는다.
- JWT를 서버에서 검증하고 연결 후 만료·권한 변동도 처리한다. 초대 토큰은 범위·만료·사용 횟수와 원자적 소비를 정한다.
- 토큰 저장 위치·refresh 계약·로그아웃 후 연결 및 캐시 정리는 구현 전 대상 프로젝트 정책으로 확정한다.
- 운영의 구버전 데스크톱 앱을 고려해 계약 버전·호환 기간·비호환 안내·배포 순서를 정한다.
