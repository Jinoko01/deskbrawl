---
paths:
  - "apps/desktop/src/game/**"
  - "apps/desktop/src/**/*.tsx"
---

# PixiJS 8 렌더링

- 프로젝트에 설치된 PixiJS 8 API를 사용한다. 이전 major의 동기 Application 초기화 예제를 그대로 적용하지 않는다.
- React는 canvas 호스트와 DOM HUD, PixiJS는 장면·sprite·렌더 루프를 소유한다. 양쪽이 같은 노드나 frame 상태를 경쟁해서 수정하지 않는다.
- 비동기 Application 초기화 중 언마운트·재초기화를 처리한다. 초기화가 끝난 뒤 닫힌 호스트에 canvas를 붙이거나 해제된 자원을 사용하지 않는다.
- ticker·포인터·키보드·resize·socket 구독과 Application을 소유자가 정리한다. Strict Mode·HMR·게임 재입장에도 루프가 중복되지 않게 한다.
- GPU 자원·texture·asset은 소유권에 따라 해제한다. 공유 asset을 한 장면이 파괴해 다른 장면을 깨뜨리지 않는다.
- 매 frame React state나 전역 store 전체를 갱신하지 않는다. sprite·보간 상태는 게임 런타임에 두고 HUD는 필요한 변화만 구독한다.
- 서버 snapshot의 tick·sequence에 따라 보간한다. 클라이언트 예측을 구현하면 서버 보정과 입력 재적용 범위를 명세하고 판정 권한을 서버에 유지한다.
- 캔버스 크기·DPR·viewport 스케일과 입력 좌표 변환을 일치시킨다. 해상도·렌더 비용은 실제 창 크기·대상 기기에서 확인한다.
- 포커스 상실·키 해제 누락·최소화 후 복귀를 처리한다. 클라이언트가 정지해도 서버 시뮬레이션은 같은 정책으로 진행한다.
- 리소스 로딩·실패·재시도·WebGL context 손실 시 동작을 정의한다. 프레임마다 asset 로드나 불필요한 객체 생성을 하지 않는다.
- 중요한 안내·조작·결과는 접근 가능한 DOM UI와 연결한다. 픽셀 스냅샷만으로 게임 규칙·네트워크 동기화가 검증되었다고 보고하지 않는다.
