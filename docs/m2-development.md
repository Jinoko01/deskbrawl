# M2 로컬 서버와 링크 방문

NestJS 단일 서버, PostgreSQL/Prisma, 공유 Zod 계약과 기존 `game-core`를 사용한다. 서버는 고정 50ms tick으로 이동·공격·돌·넉백·기절을 결정하고 전체 snapshot을 전송한다. 이 주기와 M1의 전투 수치는 개발 검증용이며 최종 튜닝 값은 TBD다. 정원은 M2의 호스트 포함 2명이다.

## 첫 준비

```powershell
pnpm install
pnpm --filter @deskbrawl/server db:generate
Copy-Item apps/server/.env.example apps/server/.env
```

기존 `.env`가 있으면 덮어쓰지 않는다. `.env`의 `JWT_SECRET`을 32바이트 이상의 새 난수로 설정한다. 예를 들어 다음 명령의 출력값을 사용한다. 실제 키를 문서·로그·커밋에 남기지 않는다.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up -d --wait
```

Compose는 개발 PostgreSQL만 `127.0.0.1:54329`에 노출하고 별도 볼륨에 보관한다. 개발용 자격 증명은 `.env.example`과 일치한다. Docker를 쓰지 않으면 별도 로컬 PostgreSQL을 실행하고 `DATABASE_URL`을 변경한다. 운영 DB를 개발·테스트에 사용하지 않는다.

환경 파일을 읽은 상태에서 개발 DB에 migration을 적용한다. `prisma.config.ts`는 process 환경을 사용하고 CLI가 `.env`를 자동으로 읽는다고 가정하지 않는다.

```powershell
pnpm --filter @deskbrawl/server exec node --env-file=.env node_modules/prisma/build/index.js migrate deploy
pnpm dev:server
```

다른 터미널에서 데스크톱 앱을 실행한다.

```powershell
pnpm dev
```

기본 서버 주소는 `http://127.0.0.1:3000`이다. `GET /health`는 실제 DB 연결도 확인한다. `pnpm dev:server`는 빌드 후 실행하며 파일 감시 기능은 없다. 서버 소스를 바꾸면 종료하고 다시 실행한다. `pnpm dev:web`은 웹 UI만 실행하며 전역 단축키·Tauri IPC·Windows 링크 등록을 검증하지 않는다.

## 사용 흐름

1. 호스트가 닉네임을 입력하고 **내 공간 연결**을 선택한다. 닉네임은 최초 기기 등록에만 사용한다.
2. **방문 링크 생성**으로 발급받은 링크를 친구에게 전달한다. 링크를 가진 누구나 승인 없이 입장할 수 있다.
3. 방문자는 서버의 `/join/<token>` 페이지에서 **앱에서 방문하기**를 선택하거나 앱의 **친구 방문 링크**에 HTTP 링크 또는 `deskbrawl://join/<token>`을 붙여 넣는다.
4. 호스트와 방문자는 각 PC의 주 모니터 전체 투명 오버레이에서 같은 월드의 모찌·민트를 본다. 해상도가 다르면 호스트 월드의 비율을 유지해 표시한다. 방문자의 홈 창 미리보기도 유지한다. 실제 화면·창 제목·파일·클립보드는 서버에 전송하지 않는다.
5. 기본 `Ctrl+Shift+G`로 PLAY를 시작한다. 호스트는 모찌, 방문자는 민트를 조작한다. 기존 설정된 이동·근접·투척 키를 사용하며 Esc·포커스 상실 때 입력을 중단한다.
6. **귀환**하면 방문을 끝내고 자신의 공간을 다시 연다. 호스트가 연결을 종료하면 방문자에게 종료 사유를 안내한다.

WORK/PLAY 단축키와 Esc는 홈 창을 앞으로 가져오거나 포커스를 옮기지 않는다. Windows 네이티브 입력은 PLAY 중에만 캡처한다. 호스트 종료·강퇴·연결 실패 시 입력을 중단하고 로컬 캐릭터를 즉시 복원한다. 서버 접속을 자동 재시도하지 않으며 **내 공간 연결**로 다시 연결한다.

링크 재발급·폐기는 새 입장에만 영향을 준다. 기존 방문자는 유지한다. 초대 만료와 access token 수명은 필수 환경 변수로 설정하며 예시 값은 개발용이다. 제품 수명 정책은 TBD다. access token은 메모리에만 두고, 기기 재인증 자격 증명은 서버 origin별로 Windows DPAPI를 사용해 앱 로컬 데이터의 `device-credential.bin`에 저장한다. 일반 설정 파일이나 localStorage에 평문으로 저장하지 않는다. 서버는 비밀값·초대 토큰의 SHA-256 해시만 저장한다.

서버 재시작 시 기기·룸 소유권·초대 해시는 DB에 유지되고 활성 월드는 종료된다. M2는 자동 재연결을 하지 않는다. **내 공간 연결** 또는 링크 방문으로 새 세션을 시작한다. refresh·다인원·강퇴·집중 모드·네트워크 장애 복구는 각각 후속 M3/M4 범위다.

## 계약과 상태 소유권

| 이벤트 | 방향 | 입력·결과 |
|---|---|---|
| `room:host` | client → server | `version`, 호스트 논리 `bounds`; 소유 기기의 공간 활성화 |
| `visit:join` | client → server | `version`, 초대 `token`; 입장 ack 및 `visit:joined` |
| `visit:leave` | client → server | 현재 `visitId`; 세션 종료 후 ack |
| `player:input` | client → server | `visitId`, 단조 증가 `seq`, -1/0/1 이동 의도 |
| `player:action` | client → server | `visitId`, UUID `actionId`, `melee`/`stone` |
| `world:snapshot` | server → room | 버전·room/world ID·tick·world·공개 참가자 정보·적용된 seq |
| `room:closed` | server → room | 안전한 종료 오류 code |

입장 ack는 멤버십 생성과 전체 snapshot을 확인한다. 입력·공격 ack는 검증 후 큐 수락이며, 실제 적용은 고정 tick에서 수행한다. 입력 적용 순서는 snapshot의 `lastProcessedSeq`로 확인한다. 이전 visitId와 오래된 seq는 상태를 변경하지 않는다. 동일 세션의 최근 128개 공격 ID는 중복 제거하고 한 tick에 대기하는 공격은 하나로 제한한다. 자동 공격 재전송은 하지 않는다. 장기 재시도·재연결의 더 넓은 멱등성 정책은 M4에서 확장한다.

DB 변경과 입장은 현재 단일 서버의 bounded 직렬 큐에서 순서를 정한다. 게임 tick은 DB·비동기 네트워크 호출과 분리한다. 입력은 20Hz로 갱신하며 5 tick 동안 갱신이 없으면 정지한다. 서버 지연의 catch-up은 최대 5 tick이며 과거 공격을 몰아 실행하지 않는다. 클라이언트는 이동을 한 snapshot 간격 내에서 보간하고 판정을 재계산하지 않는다. 장면이 같으면 idle snapshot으로 GPU를 다시 그리지 않는다.

REST 조회는 TanStack Query, UI 폼은 로컬 React 상태, 고빈도 snapshot과 socket은 main의 게임 런타임이 소유한다. overlay는 제한된 IPC로 받은 상태만 표시한다. 세션/월드 전환은 기존 PLAY를 끝내고 눌린 키를 정리한다.

## 같은 LAN의 PC 두 대

한 PC에서만 서버와 DB를 실행한다. 두 앱 모두 같은 서버의 내부 IP를 사용한다. 예를 들어 `http://192.168.0.10:3000`을 쓸 때 서버 `.env`의 `PUBLIC_ORIGIN`을 해당 값으로 바꾼다. DB 포트는 공유하지 않고 필요한 서버 포트만 Windows 방화벽에서 허용한다.

각 PC에서 정확히 그 서버 origin만 CSP에 허용한다. 다음 명령은 git에서 제외된 `.env.local`과 Tauri 설정 override를 만든다.

```powershell
pnpm --filter @deskbrawl/desktop network:config http://192.168.0.10:3000
pnpm --filter @deskbrawl/desktop tauri dev --config src-tauri/tauri.network.conf.json
```

설치 파일을 준비할 때도 같은 override를 사용한다.

```powershell
pnpm --filter @deskbrawl/desktop tauri build --config src-tauri/tauri.network.conf.json
```

개발 중 딥링크 전달은 실행 파일에 URI 인자를 주어 검사할 수 있다. Windows에서 브라우저 링크를 클릭해 앱을 실행하는 경로는 NSIS 설치가 등록하는 URI scheme까지 실제 설치 상태에서 별도로 확인한다. 웹 링크는 설정된 서버 origin만 허용하며 외부 링크의 서버 주소로 인증 정보를 보내지 않는다.

인터넷 친구 테스트에는 별도 HTTPS/WSS 개발 서버가 필요하다. 정확한 서버·클라이언트 origin과 TLS를 설정하고 서버 주소에 맞춰 앱을 빌드한다. 이 단계에서 외부 배포는 실행하지 않았다.

## 검증

```powershell
pnpm check
pnpm test
pnpm --filter @deskbrawl/server db:validate
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

REST/Socket.IO 통합 테스트에는 별도의 PostgreSQL DB를 준비하고 같은 migration을 적용한다. 테스트 DB 이름에는 `test`가 포함되어야 하며 테스트는 자신이 만든 기기·룸·초대만 정리한다.

```powershell
$env:DATABASE_URL = 'postgresql://<user>:<password>@127.0.0.1:54329/deskbrawl_test'
pnpm --filter @deskbrawl/server db:migrate
$env:TEST_DATABASE_URL = $env:DATABASE_URL
pnpm --filter @deskbrawl/server test:integration
```

Node 22의 Jest ESM 실행은 `--experimental-vm-modules`를 사용해 경고가 표시된다. 단위·통합 검증을 구분하며 `pnpm test`에 실제 DB 검증을 몰래 포함하지 않는다.

Vite·서버·개발 앱 바이너리가 준비된 Windows에서는 다음 검사를 실행한다. 진단 포트는 테스트 소유 앱에만 열고 별도 WebView 프로필을 정리한다. 기기 자격 증명은 실제 개발 서버 origin의 DPAPI 파일에 보관해 재시작 복원을 검사한다.

```powershell
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --dev --network
```

결과와 남은 실기기 항목은 [M2 검증 기록](m2-validation.md)을 따른다.

### 설치본과 Windows URI 등록 검증

같은 서버 주소로 빌드한 NSIS를 설치한 뒤, 설치본 경로를 지정해 검사한다. 현재 사용자 설치의 기본 경로는 다음과 같다. 검사기는 등록된 `deskbrawl://` 명령이 해당 설치본을 가리키는지 확인하고, Windows ShellExecute로 실행 중 앱에 링크를 전달한다. 테스트 서버에는 검증용 기기·룸·초대가 생성되므로 별도 로컬 테스트 DB를 사용한다.

```powershell
$env:DESKBRAWL_TEST_EXECUTABLE = "$env:LOCALAPPDATA\DeskBrawl\deskbrawl.exe"
$env:DESKBRAWL_TEST_SERVER_ORIGIN = 'http://127.0.0.1:3000'
pnpm --filter @deskbrawl/desktop exec node scripts/test-overlay-webview.mjs --network --registered-link
Remove-Item Env:DESKBRAWL_TEST_EXECUTABLE, Env:DESKBRAWL_TEST_SERVER_ORIGIN
```

`DESKBRAWL_TEST_SERVER_ORIGIN`은 생략하면 기존 로컬 서버 주소를 사용한다. 값을 지정할 때는 설치본의 `VITE_SERVER_URL` 및 CSP도 같은 주소로 빌드해야 한다. `--registered-link`는 설치된 release 앱을 대상으로 하며 `--dev`와 함께 사용하지 않는다. 꺼진 앱 시작 검사는 실행 파일의 URI 인자를 사용한다. OS URI 전달 검사는 브라우저의 외부 앱 실행 확인 UI를 대신 검증하지 않는다.

M2 최종 인수 시에는 다음 두 항목을 별도로 기록한다.

1. 설치된 앱을 실행한 상태와 종료한 상태에서 각각 `/join/<token>` 페이지의 **앱에서 방문하기**를 클릭한다. 승인 없이 방문 미리보기가 열리고, 실행 중에는 기존 앱에 전달되는지 확인한다.
2. 같은 LAN의 Windows PC 두 대에서 각각 호스트와 방문자로 접속한다. 양쪽에서 이동·근접·돌을 조작해 동일한 피격·넉백·기절과 귀환 후 방문자 제거를 확인한다. 서버 주소·Windows 버전·DPI·관찰 결과를 기록하며 두 번째 클라이언트 소켓만으로 이 항목을 완료 처리하지 않는다.
