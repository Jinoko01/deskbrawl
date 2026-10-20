---
paths:
  - "apps/desktop/src/**/*.ts"
  - "apps/desktop/src/**/*.tsx"
---

# React와 상태 소유권

- 상태를 서버 REST 캐시, 실시간 게임 상태, 공유 UI 상태, 로컬 폼·UI 상태, 파생 값으로 먼저 분류한다.
- REST 조회·변경 상태는 TanStack Query가 소유한다. 응답을 Zustand·Context·로컬 state에 중복 저장하지 않는다.
- 실시간 고빈도 스냅샷은 게임 런타임이 소유한다. 매 틱 Query 캐시 무효화나 React 전체 렌더를 발생시키지 않는다.
- Zustand는 여러 화면이 공유하는 클라이언트 상태에 사용한다. 필요한 slice를 구독하고 전체 store 구독을 피한다.
- 단일 컴포넌트의 폼·열림 상태는 가까이 둔다. 파생 값은 계산하고 별도 state로 동기화하지 않는다.
- 라우터가 있는 경우 복원·공유가 필요한 탐색 상태만 URL 사용을 검토한다. 라우터 설치나 `route.ts` 존재를 전제하지 않는다.
- `useEffect`는 Socket.IO·Tauri·PixiJS 같은 외부 시스템과의 동기화에 사용한다. 요청 캐시·파생 값·사용자 이벤트 처리를 대신하지 않는다.
- effect는 구독·타이머·리스너 해제를 반환한다. Strict Mode 재실행과 비동기 초기화 중 언마운트를 처리한다.
- `useMemo`, `useCallback`, `memo`는 비용이나 참조 안정성이 필요한 경우에만 사용한다.
- 서버 변경은 Mutation의 pending·error를 사용한다. 같은 요청 상태를 여러 Hook에 중복 저장하지 않는다.
- 로그아웃·계정 전환 시 Query 캐시, 연결, 사용자별 UI 상태를 정리해 이전 세션 데이터를 노출하지 않는다.
