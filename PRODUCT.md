# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

- 데스크톱 앱(`apps/desktop`): Tauri 2 + React + TypeScript + Vite, PixiJS 8. 기존 코드가 기준이다.
- 랜딩페이지(`apps/landing`, 2026-11-16 사용자 확정): 모노레포의 신규 Vite + TypeScript 워크스페이스. `packages/game-core`와 `packages/game-assets`를 재사용하고 새 외부 패키지는 추가하지 않는다.

## Users

PC 앞에서 오랜 시간을 보내는 개발자·디자이너·대학생. 각자 작업하면서 친구와 소소한 즐거움을 나누고 싶은 사람들. 랜딩페이지 방문자는 아직 앱을 설치하지 않은 같은 부류의 사람이다.

## Product Purpose

작업하던 데스크톱을 친구와 잠깐 어울리는 놀이터로 바꾸는 앱. 투명 오버레이 위의 픽셀 캐릭터를 조작해 장난치고, 초대 링크로 친구의 데스크톱에 놀러 간다.

## Positioning

혼자 구경하는 데스크톱 펫이 아니라 **실시간 멀티플레이 데스크톱 펫**이다. 작업 창을 가리거나 포커스를 빼앗지 않고(WORK), 단축키 한 번으로 놀이로 전환한다(PLAY). 승패가 없다.

## Operating Context

- WORK/PLAY 전환: 기본 단축키 Ctrl+Shift+G, Esc로 WORK 복귀. PLAY 중 방향키 이동, Z 근접 공격, X 돌 던지기. macOS에서는 DeskBrawl 창에 포커스가 있을 때 조작한다.
- WORK에서는 클릭이 아래 작업 창으로 통과한다. Windows에서는 마우스로 캐릭터를 끌어 옮길 수 있다.
- 초대 링크로 방문, 호스트 포함 최대 6인, `/` 두 줄 채팅, 집중 모드(방문 차단), 강퇴.
- 트레이 메뉴: 홈 열기·링크 복사·집중 모드·플레이 시작·오버레이 표시/숨김·효과 감소·종료.

## Capabilities and Constraints

- 캐릭터 8종: 모찌, 민트, 써니, 코랄, 루미, 러스티, 바이트, 베리. 능력치 차이 없음.
- HP 50, 근접 3·돌 1 피해, HP 0이면 3초 기절 후 회복. 사망·제거 없음.
- 검증된 지원 범위는 Windows 11 주 모니터. macOS 빌드 대상은 macOS 15 이상이며, 실기기 검증은 TBD다. [macOS 빌드 가이드](docs/macos-build.md)
- 서명·운영 배포·공개 설치 파일 URL은 아직 없다.

## Brand Commitments

`docs/branding.md`가 기준이다. 이름 DeskBrawl · 데스크브롤, 슬로건 "작업과 놀이 사이, DeskBrawl.", 민트 메인 컬러, 픽셀 워드마크와 픽셀 캐릭터, Pretendard, 짧고 친근한 해요체. 피할 것: 과도한 그라데이션·네온·입체 효과, 공격적인 경쟁 분위기, 유아적 표현, 과한 움직임.

## Evidence on Hand

- 캐릭터·무기·돌·이펙트 스프라이트: `packages/game-assets/`
- 로고·배너: `apps/desktop/public/brand/`
- 실제 판정 로직: `packages/game-core`
- 저장소: https://github.com/Jinoko01/deskbrawl (랜딩 CTA 목적지, 2026-11-16 사용자 확정)
- 없는 것(지어내지 않는다): 사용자 수, 후기, 언론 보도, 다운로드 URL, 가격.

## Product Principles

1. 설명보다 체험 — 직접 움직여 보면 이해된다.
2. 작업을 존중한다 — 놀이는 사용자가 켤 때만 시작한다.
3. 승패 없는 장난 — 경쟁이 아니라 어울림.
4. 느슨한 연결 — 링크 하나로 오고, 부담 없이 떠난다.

## Accessibility & Inclusion

OS의 동작 줄이기 설정을 따른다(앱의 '효과 감소'와 같은 원칙). 키보드만으로 체험 가능해야 하고, 터치 기기에는 대체 조작을 제공한다.
