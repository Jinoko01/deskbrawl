---
paths:
  - "apps/desktop/src/native/**"
  - "**/src-tauri/**"
---

# Tauri 2·Rust·Win32

- UI는 native 어댑터를 통해 invoke·plugin API를 사용한다. OS 세부사항을 페이지·컴포넌트 전반에 흩뿌리지 않는다.
- 공식 Tauri Plugin이 요구를 충족하면 먼저 사용한다. 직접 Win32 호출은 필요한 기능에 한정하고 crate 추가는 승인 규칙을 따른다.
- capability·permission·scope는 필요한 창·명령·경로에 최소 범위로 설정한다. 문제 해결을 위해 wildcard·전체 파일시스템·임의 shell 권한을 열지 않는다.
- custom Rust command도 호출 가능한 창과 입력 범위를 검사한다. plugin capability만으로 모든 invoke_handler 등록 명령이 자동 제한된다고 가정하지 말고 앱 명령 권한 구성을 확인한다.
- CSP·외부 URL·파일 접근 범위는 실제 필요로 제한한다. 원격 콘텐츠에 네이티브 기능을 무심코 노출하지 않는다.
- IPC 입력은 serde로 역직렬화한 뒤 경로·크기·범위·허용 동작을 Rust에서 검증한다. JS 측 검증만 신뢰하지 않는다.
- Rust 명령은 Result 기반으로 실패를 반환한다. 외부 입력·OS 실패에 unwrap·expect·panic을 사용하지 않는다. 내부 오류는 안전한 IPC 오류로 변환한다.
- blocking I/O·Win32 대기·무거운 작업은 UI thread나 async executor를 막지 않게 실행한다. thread affinity가 필요한 API는 해당 스레드 규칙을 따른다.
- unsafe·FFI는 작은 모듈로 격리한다. 포인터·버퍼 길이·문자 인코딩·handle 소유권·스레드 조건을 문서화하고 모든 경로에서 RAII로 자원을 해제한다.
- Win32 구현은 cfg(windows) 등으로 경계를 명시한다. 지원하지 않는 플랫폼에서는 명확한 오류나 명세된 대체 동작을 제공한다.
- 창 크기·모니터·DPI 변환의 물리/논리 좌표를 구분한다. 포커스 상실·최소화·권한 거부·OS 호출 실패를 처리한다.
- 비동기 event listen 중 화면이 닫혀도 최종 unlisten이 실행되도록 한다. 단축키·tray·hook·백그라운드 작업은 종료 시 해제한다.
- 비밀값을 평문 설정 파일이나 앱 바이너리에 보관하지 않는다. 서명키·업데이트 키·배포 자격 증명은 서버/CI 보안 설정에서 관리한다.
- Rust 단위 테스트·IPC 경계 테스트와 실제 Windows 실행 검증을 구분한다. mock runtime은 실제 WebView·OS 동작을 대체 검증하지 않는다.
