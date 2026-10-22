# 데스크톱 디자인·UX 개편 검증

2026-10-22, Windows / Tauri 개발 빌드 / 실제 WebView2 기준.

## 적용 기준

사용자가 지정한 [Supanova Design Engine](https://github.com/uxjoseph/supanova-design-skill/blob/main/taste-skill/SKILL.md)과 [Redesign Engine](https://github.com/uxjoseph/supanova-design-skill/blob/main/redesign-skill/SKILL.md)을 읽고 적용했다. 단일 강조색, 한국어 타이포그래피, 비대칭 배치, 명확한 주요 행동, 상호작용 상태와 절제된 모션을 반영했다. 랜딩페이지용 단일 HTML/CDN/마케팅 섹션 지침은 사용자가 요청한 기존 데스크톱 앱과 저장소 기술 기준에 맞춰 React + 로컬 Tailwind로 조정했다.

- 중립적인 어두운 녹색 바탕과 민트 강조색, 일관된 SVG 선 아이콘.
- Pretendard Variable을 앱에 포함해 외부 폰트 서버 없이 동작. 원본: [Pretendard](https://github.com/orioncactus/pretendard), 라이선스: `apps/desktop/src/assets/fonts/OFL.txt`.
- 긴 단일 폼을 내 공간 / 조작 설정 탐색으로 나눴다. 설정 전환 시 입력 초안과 연결은 유지한다.
- 캐릭터 카드와 연결·방문 영역을 분리했다. 8종 에셋, 이미지 양옆 화살표, 아래 이름, 선택 순서를 표시한다.
- WORK / PLAY / FOCUS와 집중모드 제어를 상단에 배치했다. 오버레이 배지 색상도 앱과 맞췄다.
- 연결 후 참여자·초대·귀환을 상태에 맞게 표시한다. 링크 재발급·폐기는 접을 수 있는 관리 영역으로 분리했다.
- 빈 입력·중복 제출을 막고, 방문 오류를 해당 입력의 `aria-describedby`와 연결했다. 실패해도 입력값을 유지한다.
- 불필요한 서버 URL은 연결 정보 안으로 옮겼다. 방문 미리보기가 페이지를 강제로 스크롤하던 동작을 제거했다.
- 모션은 transform / opacity만 사용하고 `prefers-reduced-motion`을 따른다.

## 캐릭터 변경 요청

실제 서버 연결 검증에서 화살표를 빠르게 연속 조작하면 `player:profile`의 초당 5회 제한에 걸리는 문제를 재현했다. 미리보기는 즉시 반영하고, 선택이 400ms 동안 바뀌지 않으면 최종 선택만 기존 Mutation으로 저장한다. 타이머는 선택 변경·다른 작업 중·언마운트 시 정리한다. 저장 실패 시 서버가 확인한 캐릭터로 되돌리고 기존 오류를 표시한다. 서버의 제한과 공개 계약은 바꾸지 않았다.

## 실행 검증

| 명령 | 결과 |
| --- | --- |
| `pnpm check` | 워크스페이스 lint·타입 검사·웹 빌드 통과 |
| `pnpm --filter @deskbrawl/desktop test` | 기존 55개 테스트 통과 |
| `node apps/desktop/scripts/test-overlay-webview.mjs --dev --design` | 실제 WebView의 폰트, 배치, 8종 선택, 입력·오류 유지, 메뉴 전환, 키보드 설정 취소, 집중모드, reduced motion 통과 |
| `node apps/desktop/scripts/test-overlay-webview.mjs --dev --m3` | 실제 로컬 서버의 닉네임·캐릭터 반영, 6인 참여, 채팅, 재연결, 집중모드·입장 차단, 단일/전체 내보내기, 링크 유지·트레이 복사, 방문·귀환·이전 방 복귀, cold-start 링크 처리 통과 |

두 WebView 명령 모두 기존 렌더러 회귀, 투명 배경, GPU 손실 복구, 효과 설정 유지, 종료 버튼과 창 X 종료 검사까지 통과했다. 첫 네트워크 실행의 연속 캐릭터 선택 실패는 위 요청 병합 수정 후 동일 명령으로 해결을 확인했다. 설정 키보드 테스트는 창을 실제 전면으로 가져오고 Enter 입력의 문자 값을 함께 보내도록 하네스를 교정했다.

UI 뷰포트는 800×600, 1100×800, 540×760, 360×760, 400×300에서 가로 넘침과 캐릭터 양옆 화살표 배치를 확인했다. 400×300은 기본 창을 200%로 확대했을 때의 CSS 가용 공간을 검사한 것이며, Windows의 실제 DPI 설정 변경 검증은 아니다. 기본 창은 연결 버튼과 닉네임 입력이 보이고 나머지는 세로 스크롤로 접근한다.

캡처는 `apps/desktop/node_modules/.cache/desktop-*.png`, 연결된 호스트 화면은 `m3-host-controls*.png`에 생성된다. 초대 링크는 캡처 전에 가렸다. 네이티브 테스트는 자신이 실행한 앱·임시 프로필을 정리하고 장치 자격 증명을 복원한다. 새 패키지, Rust 변경, 설치본 생성·배포는 없다.
