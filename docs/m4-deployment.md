# M4 배포 준비·6인 베타 검증

M4의 정원은 **호스트 1명 + 방문자 5명, 총 6명**이다. 서버 인스턴스 하나가
월드를 소유한다. 이 문서는 로컬 빌드와 인수 절차이며 운영 배포·서명·자동
업데이트 완료를 의미하지 않는다.

## NestJS 이미지

저장소 루트에서 빌드한다. Docker Linux 컨테이너 엔진이 필요하다.

```powershell
docker build --file apps/server/Dockerfile --tag deskbrawl-server:m4 .
```

이미지는 저장소의 Node 22.20.0·pnpm 10.34.7·lockfile을 사용한다.
`pnpm --filter @deskbrawl/server build`가 Prisma Client를 생성하고 게임 코어와
프로토콜을 `dist/main.mjs`에 번들한다. 외부 NestJS·Socket.IO·Prisma runtime 및
Prisma의 동적 WASM 모듈은 `pnpm deploy --prod --legacy`의 운영 의존성에 포함한다.
런타임에는 소스·개발 도구·Prisma CLI를 복사하지 않고 `node` 사용자로 실행한다.
`.env`와 로컬 생성물은 Docker 빌드 컨텍스트에서 제외한다.

기존 [개발용 compose](../compose.yaml)는 로컬 DB 전용이며 운영 설정이 아니다.
운영 PostgreSQL 주소·자격 증명·백업·접근 정책은 배포 대상 확정 후 설정한다.
DB를 준비한 뒤 **대상 DB와 migration 결과를 검토하고 승인받아** 기존
`pnpm --filter @deskbrawl/server db:migrate`를 별도 실행한다. 서버 시작 시 자동으로
migration을 수행하지 않는다.

배포 대상에서 보관하는 환경 파일에는 [기존 예시](../apps/server/.env.example)의
필수 값을 모두 설정한다. 이 파일을 이미지·저장소·설치본에 넣지 않는다.

| 값                                         | 설정 기준                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | 컨테이너에서 접근 가능한 PostgreSQL 주소. `127.0.0.1`은 컨테이너 자신이다.             |
| `JWT_SECRET`                               | 예시 문자열과 다른 충분한 난수. 모든 서버 교체에서 기존 세션 정책과 함께 관리한다.     |
| `PORT`                                     | 기본 `3000`; 변경 시 컨테이너 포트 매핑도 변경한다.                                    |
| `PUBLIC_ORIGIN`                            | 운영은 실제 `https://` origin. TLS 프록시 뒤에서도 외부 주소를 지정한다.               |
| `CLIENT_ORIGINS`                           | 설치 앱의 `http://tauri.localhost,tauri://localhost`와 실제 허용 웹 origin만 지정한다. |
| `ACCESS_TTL_SECONDS`, `INVITE_TTL_SECONDS` | 기존 설정 검증 범위 내 값. 제품 정책 확정 여부는 TBD.                                  |

승인된 배포 대상에서 아래 형태로 실행한다. 환경 파일 경로는 예시이며 실제
비밀 파일로 바꾼다. TLS 프록시는 WebSocket 업그레이드도 전달해야 한다.

```powershell
docker run --detach --name deskbrawl-server --restart unless-stopped --env-file <server-env-file> --publish 127.0.0.1:3000:3000 deskbrawl-server:m4
docker inspect --format '{{.State.Health.Status}}' deskbrawl-server
```

기본 이미지는 `NODE_ENV=production`이므로 HTTPS가 아닌 `PUBLIC_ORIGIN`을 거부한다.
HTTP LAN 검증에서만 `docker run`에 `--env NODE_ENV=development`를 추가하고 LAN에
공개할 바인딩·방화벽 범위를 명시한다. 이미 실행 중인 개발 DB의 포트를 외부에
공개할 필요는 없다. 운영 전환 시 개발 재정의를 제거한다.

`/health`는 DB 조회를 포함한다. 이미지 healthcheck는 해당 HTTP 성공 여부를
검사한다. 서버 교체 시 메모리 월드는 종료되므로 현재 방문자에게 종료 안내와
로컬 복귀가 표시되는지 확인한다. Redis나 복수 서버 배치는 이번 범위에 포함하지
않는다.

## Windows NSIS 설치본

Windows MSVC Rust toolchain·Visual C++ Build Tools·Windows SDK·WebView2와 기존
pnpm 의존성이 준비된 PC에서 실행한다. 실제 서버 주소를 지정한다.

```powershell
pnpm --filter @deskbrawl/desktop network:config https://<server-origin>
pnpm --filter @deskbrawl/desktop tauri build --config src-tauri/tauri.network.conf.json
```

HTTP LAN이면 첫 명령에 `http://<server-lan-ip>:3000`을 사용한다. 설정 명령은
Vite 서버 주소와 Tauri CSP를 함께 생성한다. 실제 파일·동작은
[설정 스크립트](../apps/desktop/scripts/configure-network.mjs)를 따른다.
빌드 결과는 `apps/desktop/src-tauri/target/release/bundle/nsis/`에 생성된다.
현재 bundle target은 NSIS이며 MSI 생성은 구성하지 않았다. 바이너리와 설치본은
두 PC 이상에 동일하게 배포하고 구버전 앱을 트레이까지 완전히 종료한 뒤 설치한다.

현재 manifest에는 Tauri updater JS 패키지·Rust plugin·업데이트 endpoint·공개키가
없다. 자동 업데이트를 완료하려면 새 의존성 승인과 업데이트 호스팅 주소·릴리스
버전 정책·서명키 보관 주체를 정해야 한다. Tauri updater 서명과 Windows
Authenticode 설치본 서명은 별개이며, 서명 인증서·개인키·비밀값 없이 완료했다고
보고하지 않는다. 이 준비 작업은 키 생성·서명·릴리스 게시를 실행하지 않는다.

## 6대 인수 체크리스트

동일 설치본·서버 주소로 호스트 A와 방문자 B~F가 서로 다른 Windows PC에서
확인한다. 아래 항목은 실행 전 체크리스트이며 체크 여부와 수치는 실제 결과를
기록한다. 자동 Socket.IO 검사는 실제 DPI·입력·투명 합성 검증을 대신하지 않는다.

- [ ] A가 내 공간을 연결하고 B~F가 같은 링크로 방문하면 정확히 6개 캐릭터가
      각 PC의 전체 화면 오버레이에 표시된다. 일곱 번째 입장은 정원 초과로 거부된다.
- [ ] 6명 모두 이동·공격·투척을 동시에 수행하고 각 PC가 같은 서버 상태로
      수렴한다. 서로 다른 방에는 상태·채팅이 전달되지 않는다.
- [ ] 작업 앱에 포커스를 둔 상태에서 전환 단축키로 WORK/PLAY를 바꾸며 홈 창이
      앞으로 나오지 않는다. WORK에서는 작업 앱의 입력이 유지된다.
- [ ] `/`로 채팅을 열고 한국어 IME 조합·Enter 전송·Esc 취소를 확인한다.
      입력 중 게임 이동·공격이 실행되지 않으며 종료 후 입력이 고착되지 않는다.
- [ ] 방문자 한 명의 Wi-Fi를 잠시 끊었다 복구하고 중복 캐릭터·과거 공격·눌린
      이동키가 재현되지 않는지 확인한다. 복구 불가·초대 만료 안내도 기록한다.
- [ ] 호스트를 X·앱 종료 버튼·트레이 종료로 각각 종료하면 B~F가 WORK와 로컬
      캐릭터로 복귀한다. 종료된 호스트 캐릭터가 남지 않는다.
- [ ] 호스트의 집중 모드·방문자 강퇴 후 재연결이 입장 제한을 우회하지 않는다.
- [ ] 각 PC의 100%·125%·150% DPI, 서로 다른 해상도에서 캐릭터·채팅 위치와
      크기를 확인한다. DPI/해상도 변경 후 안전 숨김과 트레이 복구도 확인한다.
- [ ] 최소화·절전 복귀·앱 종료·재실행 후 오버레이·키보드 훅·트레이·연결이
      중복 생성되지 않는다. 다중 모니터 지원 범위는 별도로 기록한다.

지연 검증은 테스트 네트워크에서만 0/100/250/500ms 지연, 지터, 일시 단절을
조건별로 기록한다. 500ms는 실패 경로를 확인하기 위한 조건이며 보장 지연이
아니다. 도구가 없으면 임의 통과 처리하지 않고 미실행으로 남긴다.

| 기록 항목                                          | 조건·결과 |
| -------------------------------------------------- | --------- |
| 설치본 버전·서버 revision·OS·GPU·해상도·DPI        | TBD       |
| 6인 지속 시간·disconnect/reconnect 횟수            | TBD       |
| 입력 ack RTT p50/p95·snapshot 간격 p50/p95         | TBD       |
| 서버 CPU·메모리·tick 실행 시간 p95·tick 밀림       | TBD       |
| PC별 WORK/PLAY CPU·GPU·메모리·활성 FPS             | TBD       |
| 중복 캐릭터·오래된 공격·입력 고착·포커스 이동 횟수 | TBD       |

입력 ack RTT는 서버 큐 수락 응답까지의 시간이며 입력 적용·화면 표시 지연과
구분한다. tick/FPS 값을 실제로 계측하지 않았다면 RTT나 snapshot 간격으로
대체하지 않는다. JWT·초대 링크·채팅 전체 내용은 측정 로그에 남기지 않는다.

## 준비 상태

2026-10-22 기준 기본 sandbox에서는 Docker named pipe 접근이 거부됐다.
권한을 확장한 읽기 검사에서 Docker daemon 29.9.2 접근을 확인했고,
`docker build --check --file apps/server/Dockerfile .`는 실제 BuildKit에서
Node base image manifest 확인을 포함해 경고 없이 통과했다. Node base image와
JS 의존성의 새 다운로드가 필요한 전체 이미지 빌드·컨테이너 실행은 미검증이다.
NSIS 빌드, 6대 실기기, 서명, updater, 운영 DB migration, 외부 HTTPS/WSS 배포는
각각 별도 실행 증거로 확인해야 한다.
