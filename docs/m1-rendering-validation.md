# M1 두 캐릭터 렌더링 검증

검증일: 2026-10-21 (Asia/Seoul). M1 구현 순서의 3단계이며 전체 M1 완료를 의미하지 않는다.

## 구현 범위

- 투명 오버레이에 모찌와 민트를 분리해 표시한다. 기본 논리 프레임은 96 CSS px이며 작은 영역과 다른 월드 비율에서는 크기를 비례 조정한다.
- `CharacterSceneSnapshot`은 위치·방향·스킨·모션만 담는 표현 모델이다. 위치·방향 타입은 게임 코어에서 가져오며 게임 규칙의 수정 가능한 사본을 만들지 않는다.
- `mountCharacter(host, onStatus)`는 `update(snapshot)`과 `dispose()`를 반환한다. `update`는 초기화 도중에도 받을 수 있고, 해제 뒤에는 적용하지 않는다. 초기화 도중 오류나 종료가 발생하면 진행 중인 decode/atlas parse가 끝난 뒤 자원을 정리한다.
- `idle`, `walk`는 반복하며 `melee`, `throw`, `hit`는 `actionId`별로 한 번만 재생한다. 동일 상태를 다시 받아도 처음으로 돌아가지 않는다. 단발 모션이 끝나면 마지막 프레임을 유지하며 다음 상태는 호출자가 정한다.
- `stun`은 마지막 피격 자세와 별 이펙트다. 기절 해제는 표현 상태가 결정하며 애니메이션 완료 콜백으로 게임 타이머를 바꾸지 않는다.
- 프레임별 anchor와 논리 크기를 적용한다. 좌우는 반전하며 상하 방향에서는 마지막 좌우 표현을 유지한다. 상하 전용 그림은 만들지 않는다.
- 효과 감소에서는 상태별 정적 자세와 기절 표시를 유지하고 ticker를 멈춘다. 위치·방향·상태 갱신은 계속 적용한다. 장면이 숨겨지거나 모든 단발 모션이 끝나도 ticker를 멈춘다.
- 각 장면이 세 atlas의 texture를 소유하고, 캐릭터 제거는 해당 sprite/container만 정리한다. 장면 종료 시 전체 renderer·texture·리스너를 해제한다.

## 검증 명령과 결과

Node 22.20.0, pnpm 10.34.7, Windows 11의 기존 Tauri/WebView2 환경에서 실행했다.

| 명령 | 확인 범위 | 결과 |
| --- | --- | --- |
| `pnpm --config.use-node-version=22.20.0 test` | 코어 56개, desktop 13개: 모션 반복/단발, actionId 중복 방지, 기절 표시, 좌우/anchor, 효과 감소, 공유 texture 수명, 작은 영역 | 69개 통과 |
| `pnpm --config.use-node-version=22.20.0 check` | 두 패키지 ESLint·strict TypeScript·웹 빌드 | 통과 |
| `pnpm --config.use-node-version=22.20.0 --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --dev` | 실제 개발 WebView2의 두 캐릭터 픽셀·모션·배경 알파·DPR·resize·제거·스킨 교체·오류 및 종료 정리 | 통과 |
| `pnpm --config.use-node-version=22.20.0 build` | Windows 배포 실행 파일·NSIS 설치 파일 생성 | 통과 |
| `pnpm --config.use-node-version=22.20.0 --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs` | 새 배포 실행 파일의 IPC·트레이 효과·설정 저장·GPU 오류 숨김/복구 회귀 | 통과 |
| `node --check apps/desktop/scripts/test-overlay-rendering.mjs` 및 `node --check apps/desktop/scripts/test-overlay-webview.mjs` | 수정한 진단 스크립트 구문 | 통과 |

개발 WebView 검사에는 먼저 `pnpm --config.use-node-version=22.20.0 --filter @deskbrawl/desktop tauri dev --no-watch`로 개발 빌드와 Vite 서버를 준비한다. cargo 경로가 없는 터미널에서는 사용자 Rust 도구 경로를 PATH에 추가한다. 검사는 별도 앱 프로세스·로컬 진단 포트·임시 WebView 프로필을 사용하고 종료 후 프로필과 설정을 정리한다. `--dev`에서는 로컬 개발 URL을 확인한 뒤에만 소스 기반 렌더링 검사를 실행한다. 배포 앱 설정에는 진단 포트를 넣지 않는다.

실제 WebGL 검사에서는 좌우 영역 모두에 불투명 캐릭터 픽셀이 있고 모서리 배경 알파는 0임을 확인했다. 초기화 취소, 두 번째 이미지 실패, 여러 atlas 로딩 도중 비정상 update 수신 후 재생성 방지, WebGL context 손실 후 정리도 확인했다. 같은 실행에서 기존 IPC 허용 창 검사, 트레이 효과 감소·설정 저장, 네이티브 모니터 경계, GPU 오류 시 안전 숨김과 새 웹뷰 복구가 통과했다.

처음 실행에서는 fixture가 ready 직후 비동기 Tauri 효과 설정을 너무 일찍 확인해 실패했다. 실제 설정 반영을 조건으로 기다리도록 고쳤고 전체 검사를 재실행해 통과했다.

이번 빌드에서 설치 파일을 생성했지만 설치·제거는 다시 실행하지 않았다. 서명·게시도 하지 않았다. Rust 소스·IPC 계약·창 권한은 변경하지 않아 cargo fmt/clippy/test는 이번 단계에서 재실행하지 않았다. 검증용 앱과 개발 서버는 종료했다.

## 후속 범위

현재 앱을 실행하면 두 캐릭터가 대기한다. 방향키/Z/X 입력, WORK/PLAY 전환, 로컬 월드의 실시간 진행, 공격·돌 충돌·넉백·기절 타이머는 후속 단계다. 미정 게임 수치와 성능 목표는 TBD로 유지한다.

이번 렌더링 검증은 Chrome 최대화·키보드/마우스 전달·DPI 설정 변경 등 모든 M0 수동 시나리오를 새로 검증했다는 의미는 아니다. Windows 10 지원은 확인하지 않았다.
