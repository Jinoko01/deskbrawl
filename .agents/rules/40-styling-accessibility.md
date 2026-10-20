---
paths:
  - "apps/desktop/src/**/*"
  - "apps/desktop/index.html"
  - "apps/desktop/components.json"
---

# shadcn/ui·Tailwind와 접근성

- 기존 shadcn/ui 기반 컴포넌트와 프로젝트의 의미 기반 테마 토큰을 재사용한다. 생성한 컴포넌트도 프로젝트 소유 코드로 검토한다.
- Tailwind 설정 방식은 설치된 버전을 따른다. v3 설정과 v4 CSS 테마 구성을 임의로 혼용하지 않는다.
- 일반 UI는 Tailwind 유틸리티·테마 변수를 우선한다. 색상·간격·폰트·테마를 이전 제품 값으로 고정하지 않는다.
- inline style은 캔버스 크기·동적 좌표·런타임 CSS 변수·라이브러리 필수 연동처럼 정적 유틸리티로 표현하기 어려운 경우에 제한한다.
- PixiJS 내부 장면은 렌더러 API로 제어한다. DOM 스타일 규칙을 PixiJS DisplayObject에 강제하지 않는다.
- button·input·label 등 시맨틱 요소와 접근 가능한 이름을 사용한다. 클릭 가능한 컨트롤에는 적절한 cursor를 제공한다.
- hover·focus-visible·active·disabled·loading 상태를 함께 구현한다. 모달·메뉴의 포커스 이동·복원과 키보드 조작을 유지한다.
- 오류·연결 상태·게임 결과를 색상만으로 전달하지 않는다. 실시간 점수 안내가 과도하게 aria-live를 갱신하지 않도록 한다.
- 게임 조작법·연결 안내·중요한 결과는 접근 가능한 DOM UI로도 제공한다. canvas에 텍스트를 그렸다는 이유로 접근성이 충족되었다고 가정하지 않는다.
- 지원하는 최소 창 크기·DPI·줌·포커스 상실을 확인한다. 작은 창에서 필요한 영역만 스크롤하고 주요 조작을 가리지 않는다.
- 장식 모션은 reduced motion을 지원한다. 게임 핵심 동작의 모션 정책은 명세를 따르고 임의로 비활성화하지 않는다.
