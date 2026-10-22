# M4 Figma 커서 채팅 조사

조사일: 2026-10-22. 사용자가 지정한 Figma 설치본과 이미 내려받은 로컬 캐시를 REA로 정적 분석했다. Figma에서 다른 사용자에게 실제 메시지를 보내거나 파일을 수정하지 않았다.

## 확인한 동작과 DeskBrawl 적용

| 항목 | Figma 코드에서 확인한 동작 | DeskBrawl 적용 기준 |
| --- | --- | --- |
| 입력 공유 | 입력 변경으로 현재 줄이 바뀌면 effect가 `sendChatMessage(current, previous)`를 호출한다. | Enter를 기다리지 않고 같은 공간의 사용자에게 입력 중인 내용을 공유한다. |
| Enter | 현재 줄을 이전 줄로 넘기고 현재 입력을 비운다. 입력창을 닫지 않는다. | 현재 줄과 직전 줄을 표시하고 계속 입력할 수 있게 한다. |
| 닫기 | Escape, blur, unmount에서 종료하며 빈 두 줄을 전송해 지운다. | 명시적 닫기와 모드 전환·방 이탈·연결 종료 때 말풍선을 정리한다. |
| 비활성 | 현재 입력 변경을 기준으로 5초 후 흐려지고 8초 후 종료한다. 원격 표시도 5초 fade, 8초 hide 타이머를 사용한다. | 같은 5초·8초 수명을 적용한다. |
| IME | compositionstart에서 단축키 keydown 처리를 제거하고 compositionend에서 복원한다. | 한글 조합 중 Enter·Escape를 채팅 명령으로 처리하지 않는다. |
| 길이 | 실제 HTML input의 `maxLength`는 50이다. | 줄별 50 UTF-16 코드 단위 제한을 입력과 서버 검증에 일치시킨다. |
| 표시 | 원격 사용자의 이름·현재 줄·이전 줄을 사용자별 커서 좌표에 붙여 표시한다. | 게임에서는 해당 사용자의 캐릭터에 말풍선을 붙인다. |

`/`로 입력을 여는 요구는 사용자가 제시한 동작이다. 캐시에서 `start-chat` 액션과 이전 마우스 좌표를 사용하는 시작 코드는 확인했지만, `/` 키와 액션의 정확한 연결은 이번 분석 범위에서 확인하지 못했다. PLAY에서만 전역 `/`를 받거나 별도 Tauri 입력창을 사용하는 방법은 DeskBrawl의 포커스·입력 요구에 맞춘 구현 결정이며 Figma 내부 구현으로 확인한 사실이 아니다.

## 근거와 재현 가능한 위치

- 시작 메뉴 대상: `C:\Users\SSAFY\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Figma.lnk`.
- 실제 실행 파일: `C:\Users\SSAFY\AppData\Local\Figma\app-126.9.16\Figma.exe`.
- 원본 ASAR SHA-256: `a15a9eaf5e2f848ae6e23a92b6906d3af7713ed48e9e99a9192a898b59ffa4fd`.
- 캐시 원본: `C:\Users\SSAFY\AppData\Roaming\Figma\DesktopProfile\v43\Cache\Cache_Data\f_0000b3`. Brotli를 표준 Node zlib로 해제했으며 코드를 실행하지 않았다.
- 해제한 번들 SHA-256: `7908904717d57643eafa120de75cbabd9dda1b42386dd94d16a2e1315e062408`.
- 채팅 입력 선언의 원본 UTF-16 범위: `[3469420, 3474359)`. 이 구간을 바꾸지 않고 임시 `cursor-chat-input.js`로 저장해 REA에 전달했다.
- 실시간 공유 effect: offset `3472206`. 비활성 타이머: `3472481`. IME listener: `3472869`.
- 원격 말풍선 표시는 같은 번들의 `tc` 컴포넌트, 좌표 변환은 `tu` 컴포넌트에 있다. `start-chat` 액션은 별도 캐시 번들 `f_0000ab.js`의 offset `1869279`에서 확인했다.
- REA 입력 분석 parent Evidence: `ev_55f8e216475807b0651c0bda0349b56a5f7ffbbbe90755c7b06f6a417f5c56f1`.
- REA summary Evidence: `ev_8471752ec4935f736603882267d4bcb6219be0b5bfd9e8bf0555f434b07b41aa`.
- 로컬 Evidence 보관: `C:\Users\SSAFY\AppData\Local\Temp\deskbrawl-figma-chat-input\rea-evidence.json`. 제3자 전체 소스와 사용자 캐시는 저장소에 추가하지 않았다.

## 분석 범위와 한계

원본 ASAR에는 음수 크기의 `.codesign` 메타데이터가 있어 REA inventory가 malformed로 거절했다. 원본을 변경하지 않고 선택한 packed 파일만 임시 디렉터리로 추출했다. 초기 desktop shell 분석은 worker heap 한도로 일부만 분석되었다. 웹 채팅은 이미 내려받은 캐시에서 발견했으며, 이 캐시 번들이 설치된 desktop 버전과 정확히 같은 배포 시점이라는 보장은 없다.

38 KB 전체 커서 모듈은 REA semantic node 한도에 도달했으므로 4,939자 입력 선언 구간으로 범위를 좁혔다. 이 최종 분석은 JavaScript 1개 파싱, parse failure 0개, AST 1,359개를 기록했다. 선택 범위의 application 분석은 complete이나 외부 심볼·동적 호출·React 효과 실행은 미확인이고 semantic unknown 281개가 남는다. 본문의 행동 설명은 실제 코드의 상태 변경·효과·타이머를 근거로 한 정적 추론이며 실사용 네트워크 관찰 결과가 아니다.

실행 중 Figma에는 기존 CDP 인수가 없었고 main.js에는 production에서 `remote-debugging-port`를 제거하는 코드가 있었다. 앱을 강제 재시작하거나 디버깅 설정을 바꾸지 않았다. 실제 transport, 전달 빈도, 서버 저장 여부, 패킷 구조는 확인하지 않았다. DeskBrawl의 Socket.IO 이벤트·서버 검증·방 격리·비영속 정책은 이 프로젝트의 별도 계약이다.
