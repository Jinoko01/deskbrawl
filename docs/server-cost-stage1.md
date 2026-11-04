# 서버 비용 1단계 실행 기록 — 대기 중 반복 스냅샷 생략

작성일: 2026-11-04 · 상태: 구현·로컬 검증 완료 / Windows 실기기 화면 확인 전이라 **단계 완료 보류**

[실행 계획](server-cost-stage1-plan.md)에 따라 50ms 고정 tick 계산은 그대로 두고, 변화가 없는 온라인 방의 정기 `world:snapshot` 송신을 지원 연결에 한해 생략했다. 커밋·배포는 하지 않았다.

## 1. 변경 내용

| 위치 | 변경 |
| --- | --- |
| [protocol](../packages/protocol/src/index.ts) | `socketCapabilitiesSchema` 추가. handshake auth의 선택적 `health`·`idleSnapshots` boolean을 읽는다. version·이벤트·snapshot·ack payload와 `server:features`는 변경하지 않았다. |
| [VisitsGateway](../apps/server/src/modules/visits.gateway.ts) | tick 콜백의 송신만 `periodic`으로 표시. `world.tick`을 0으로 바꾼 snapshot JSON을 방별 직전 송신값(`WeakMap<RoomWorld>`)과 비교한다. 변경이 있거나 시간 진행 중이면 송신하고, 변화가 멈추면 마무리 1회 송신 후 `idleSnapshots: true` 연결에만 생략한다. 명시적 이벤트(호스트·입장·재개·프로필·퇴장·강퇴·정리·집중 모드)는 항상 송신하고 비교 기준을 갱신한다. HP 협상 판정도 같은 스키마를 사용한다. |
| 시간 진행 판정 | 채팅·투사체·효과가 남아 있거나, 어느 플레이어든 `tick <` 넉백·기절·무적·근접/돌 쿨다운 종료 tick이거나, 공격 표시 구간(근접 400ms·투척 300ms) 안이면 진행 중으로 본다. 이력 필드만 남은 상태는 종료 tick과 현재 tick의 관계로 판정해 유휴가 된다. |
| [networkScene](../apps/desktop/src/game/networkScene.ts) | 위치 보간 시간을 `min(tickMs, tick 간격 × tickMs)`로 제한. 긴 무수신 뒤 첫 움직임이 대기 시간만큼 느려지지 않는다. 외삽·서버 tick 변경은 없다. |
| [visitClient](../apps/desktop/src/realtime/visitClient.ts) | 보간 보정과 함께 handshake에 `idleSnapshots: true`를 보낸다. 연결 상태 판단은 기존대로 Socket.IO disconnect 이벤트만 사용한다. |
| [cost-benchmark](../apps/server/test/cost-benchmark.cjs) | `COST_BENCH_IDLE_SNAPSHOTS=1` 옵션과 제품 소스 hash(`sourceSha256`: server·protocol·game-core의 테스트 제외 `.ts`) 기록 추가. |

`simulation.ts`는 수정하지 않았다. 채팅 만료(`expireChats`)는 기존처럼 송신 판단 전에 실행된다. `step()`과 Gateway의 중복 snapshot 생성 제거, 새 의존성, DB migration은 없다.

## 2. 기능 검증

| 검증 | 방법 | 결과 |
| --- | --- | --- |
| 혼합 방 완전 유휴 | 통합 테스트: 지원 호스트 + 옵션 없는 방문자, 600ms 관찰 | 지원 연결 0건, 구버전 연결 8건 이상·HP 필드 없음, 서버 tick 8 이상 진행 |
| 이동·정지 | 이동 입력 1회 후 900ms 관찰 | 첫 snapshot에 적용 sequence 1, 매 tick 위치 송신, 같은 좌표의 마무리 1회 뒤 0건 |
| 좌표가 같은 입력 | 0벡터 입력 seq 2 | 새 `lastProcessedSeq` 전달 |
| 근접 공격·피격 | 공격 후 1200ms 관찰 | 공격 표시 종료 tick(+8)과 쿨다운 종료 tick 모두 수신, 그 뒤 0건 |
| 채팅 | 입력·빈 문자열 제거 | 채팅이 있는 동안 정기 송신, 제거 snapshot 뒤 0건 |
| 프로필·퇴장 | 유휴 중 방문자 닉네임 변경·퇴장 | 즉시 전체 snapshot 송신 |
| 긴 정지 후 첫 이동 | `networkScene.test.ts`: 600 tick 간격 후 12 단위 이동 | 25ms에 절반, 50ms에 완료, 마무리 snapshot에서 `idle` |
| 긴 무수신 연결 | `visitClient.test.ts`: 120초 snapshot 없음 | 종료 안내 없음, 이후 입력 정상 송신, handshake에 옵션 포함 |
| 실제 heartbeat | 벤치마크 유휴 구간(상태별 10초×3, 연속 30초 이상) | 유휴 구간 송신은 연결당 3바이트 Engine.IO ping뿐, 이후 활동·재접속 실패 0건 |
| 재접속 | 벤치마크 1·2·3개 방 | 방문자·호스트 모두 같은 world·토큰 교체·이전 visit 거부 |
| 자원 정리 | 종료 후 65초 관찰 | 방·멤버·HTTP 연결 0. 비교 캐시는 방 객체 수명에 묶인 `WeakMap` |

호환 조합은 다음 근거로 확인했다.

- **신클라 → 구서버**: 변경 전 서버에 `idleSnapshots: true`를 보낸 기준선 측정에서 정기 송신(1인 대기 20.0건/s)이 그대로 유지됐다. 구서버는 version·token·health 외 auth 필드를 읽지 않는다.
- **구클라 → 신서버**: 변경 후 서버에 옵션 없이 보낸 1개 방 측정에서 대기 송신이 변경 전과 같았다(아래 표).
- **혼합 방**: 위 통합 테스트. 구버전 연결이 남은 방은 snapshot 생성 비용과 해당 연결 송신량이 줄지 않는다.
- **신클라 → 신서버**: 아래 전후 측정과 통합 테스트.

미확인: Windows Tauri 앱의 실제 화면 동작(첫 이동·WORK 드래그·재접속 시 표시)은 실행하지 않았다. 웹 단위 테스트 통과를 실기기 검증으로 보지 않는다. 8초 채팅 만료·5초 fade의 실시간 통합 관찰은 테스트 시간 제한으로 실행하지 않았고, 채팅이 있는 동안 정기 송신이 유지된다는 판정과 기존 단위 테스트로 대신했다.

## 3. 전후 측정

같은 장비·Node·Docker PostgreSQL 전용 컨테이너·입력 조건에서 0단계 명령 조건(준비 3초 제외, 10초×3, 추가 활동 120초, 방 재생성 5회, 종료 후 65초)으로 실행했다. 두 실행 모두 `COST_BENCH_IDLE_SNAPSHOTS=1`, `health: true`다. 로컬 loopback 측정이며 운영 청구 트래픽·수용량이 아니다.

| 원본 | 제품 소스 hash | 비고 |
| --- | --- | --- |
| [변경 전](measurements/server-cost-stage1-before-2026-11-04.json) | `01b362f38130…` | 옵션을 보냈으나 서버가 무시 |
| [변경 후](measurements/server-cost-stage1-after-2026-11-04.json) | `44f5495fe627…` | 지원 연결 |
| [변경 후·옵션 없음](measurements/server-cost-stage1-after-legacy-2026-11-04.json) | `44f5495fe627…` | 1개 방, 구버전 경로 |

서버 소켓 송신(`bytesWritten`, 3회 평균)과 서버 CPU(1코어 기준 %):

| 방 | 상태 | 전 KB/s | 후 KB/s | 감소율 | 전 snapshot/s | 후 snapshot/s | 전 CPU | 후 CPU |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1인 대기 | 19.95 | 0.00 | 100.0% | 20.0 | 0 | 3.64 | 1.40 |
| 1 | 6인 대기 | 370.27 | 0.00 | 100.0% | 120.2 | 0 | 8.39 | 1.72 |
| 1 | 6인 활동 | 548.65 | 551.45 | −0.5% | 119.9 | 120.1 | 25.50 | 12.59 |
| 2 | 1인 대기 | 39.82 | 0.00 | 100.0% | 40.0 | 0 | 1.88 | 1.15 |
| 2 | 6인 대기 | 739.59 | 0.00 | 100.0% | 239.9 | 0 | 5.52 | 0.57 |
| 2 | 6인 활동 | 1117.58 | 1113.29 | 0.4% | 239.9 | 240.1 | 17.23 | 15.50 |
| 3 | 1인 대기 | 59.93 | 0.00 | 100.0% | 60.2 | 0 | 3.85 | 1.51 |
| 3 | 6인 대기 | 1113.90 | 0.00 | 100.0% | 361.1 | 0 | 6.46 | 1.15 |
| 3 | 6인 활동 | 1686.61 | 1663.83 | 1.4% | 360.8 | 359.9 | 22.11 | 24.26 |

- 감소율 = (변경 전 − 변경 후) / 변경 전 × 100. 대기 구간의 남은 송신은 구간당 0~24바이트(Engine.IO ping)라 표에서 0.00으로 반올림된다. 인증 확인은 서버 내부 DB 조회이며 소켓 송신이 없다.
- 활동 구간은 20Hz 전송이 유지됐다. 송신량 차이 ±1.4%는 실행 간 변동 범위로 본다. CPU는 실행 간 편차가 커서(1개 방 활동 25.5→12.6%, 3개 방 활동 22.1→24.3%) 개선·악화로 해석하지 않는다.
- 활동 구간 room step 평균은 0.186→0.099ms(1개 방), 0.060→0.052ms(3개 방). 비교용 직렬화를 포함한 scheduler 실행 p95는 3개 방 활동 3.91→3.31ms, 지연 p95는 13.3→11.8ms로 반복 악화는 보이지 않았다.
- 입력 ack RTT p95(활동): 1개 방 26.6→8.7ms, 2개 방 18.9→17.0ms, 3개 방 23.9→21.6ms. ack는 수락 응답 기준이며 화면 반응 시간이 아니다. 첫 snapshot의 적용 sequence 확인 시간과 실제 화면 반응은 별도로 측정하지 않았다(TBD).
- 120초 추가 활동(3개 방, 18명): 1711.16→1662.35KB/s, ack p95 19.4→18.9ms, 서버 peak RSS 246.5→251.6MiB. 종료 후 방·멤버·연결 0.
- 옵션 없는 연결(1개 방): 1인 대기 19.95→19.98KB/s, 6인 대기 370.27→370.19KB/s, 6인 활동 548.65→550.55KB/s로 기존 정기 송신 유지.

## 4. 실행한 검사

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter @deskbrawl/server build` / `test` | 통과 (8 tests) |
| `pnpm --filter @deskbrawl/server exec … jest --config jest.integration.config.cjs` (`TEST_DATABASE_URL`: 격리 로컬 DB) | 통과 (2 suites, 13 tests, 신규 1건 포함) |
| 서버 `eslint . --max-warnings 0` / `tsc --noEmit` | 통과 (수정이 필요 없어 `lint:fix`는 변경 없음) |
| 서버 `prettier --check .` | **실패** — 기존 `.agents/skills` Prisma Markdown 63개, 0단계와 동일. 관련 없는 파일이라 수정·제외하지 않음 |
| 서버 `prettier --check src test` | 통과 |
| `pnpm --filter @deskbrawl/protocol lint` / `typecheck` / `test` | 통과 (9 tests) |
| `pnpm --filter @deskbrawl/desktop lint` / `typecheck` / `build` | 통과 |
| desktop `vitest run src/realtime/visitClient.test.ts src/game/networkScene.test.ts` | 통과 (24 tests) |
| 위 조건의 `node apps/server/test/cost-benchmark.cjs` 3회 | 모두 `completed: true`, 실패 명령 0 |

실행하지 않음: Tauri·Win32 실기기 실행, 운영 배포.

## 5. 남은 제한과 다음 결정

- 완료 조건 3(Windows 화면 동작 확인)이 남아 단계 완료를 보류한다. 확인 항목: 장시간 대기 후 첫 이동·WORK 드래그·채팅 fade·재접속 표시.
- 문제 시 복귀: 서버 `isSettledRepeat`가 항상 `false`를 반환하게 하면 기존 정기 송신으로 돌아간다. 새 클라이언트는 정기 송신도 처리하므로 DB·판정 변경이 없다.
- 공격 표시 구간(400/300ms)은 클라이언트 렌더 규칙을 서버 송신 판단에 복제한 값이다. 클라이언트 표시 시간을 바꾸면 Gateway 상수도 함께 바꿔야 한다.
- 구버전 클라이언트가 남은 방은 절감이 제한된다. 비율은 실제 배포 분포 확인 전까지 TBD.
- 유휴 방의 계산 중지, 활동 중 10Hz 전송, 인증 조회 축소는 후속 단계다. 월 예산·운영 입장 상한·목표 절감률은 여전히 TBD.
