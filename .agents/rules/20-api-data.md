---
paths:
  - "apps/desktop/src/**/*.ts"
  - "apps/desktop/src/**/*.tsx"
---

# REST와 TanStack Query

- `docs/api-guide.md`를 따른다. 기본 흐름은 `UI → Query/Mutation Hook·options → 도메인 API → HTTP 어댑터`다.
- UI에서 fetch·도메인 API를 직접 호출하지 않는다. Hook 하나를 만들기 위해 의미 없는 전달 계층을 추가하지 않는다.
- 기존 HTTP 클라이언트가 있으면 재사용한다. 새 프로젝트에서는 기본 fetch를 먼저 검토하고 axios 설치를 전제하지 않는다.
- Query key는 도메인별 팩토리에 모으고 응답에 영향을 주는 사용자·필터·페이지 등의 입력을 모두 포함한다. 토큰 원문은 key에 넣지 않는다.
- Query 함수의 AbortSignal을 전송 계층까지 전달한다. staleTime·retry 등 정책은 도메인별 options에서 관리한다.
- HTTP 실패·네트워크 실패·취소를 구분한다. 인증·권한·검증 오류를 무조건 재시도하지 않는다.
- 변경은 useMutation으로 실행하고 중복 제출을 제어한다. 비멱등 변경의 자동 재시도는 서버 중복 방지 계약이 있을 때만 한다.
- 변경 후 응답으로 캐시를 갱신할지 관련 key를 무효화할지 정한다. 낙관적 변경에는 취소·이전 값 보관·롤백·서버 재동기화를 포함한다.
- Socket.IO가 REST와 같은 데이터를 갱신하면 캐시 반영 경로와 revision 순서를 정의해 오래된 조회 응답이 최신 이벤트를 덮지 않도록 한다.
- 외부 JSON은 공유 스키마로 검증한다. 응답 envelope·endpoint·타임아웃을 이전 프로젝트 값으로 확정하지 않는다.
