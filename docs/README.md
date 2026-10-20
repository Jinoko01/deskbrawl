# DeskBrawl v1.4 문서 안내

본 문서는 Windows 모니터 전체의 **투명한 최상위 오버레이**를 유지하고, **Tauri 2 클라이언트 · NestJS 서버** 구조로 고도화한 DeskBrawl 설계 문서 모음입니다.

1. [서비스 기획안](./DeskBrawl_01_Proposal.md) — 목적·페르소나·MVP·성공 지표
2. [기능 명세서](./DeskBrawl_02_Functional_Spec.md) — 요구사항/화면/이벤트/인수 테스트 및 구현 매핑
3. [구현 계획](./DeskBrawl_03_Implementation_Plan.md) — 단계별 실행 계획, 위험, 테스트, 모듈 구성
4. [기술 스택 및 상세 아키텍처](./DeskBrawl_04_Technical_Architecture.md) — Tauri·React·PixiJS·NestJS·PostgreSQL 구체 설계

**불변 조건:** 링크로 자동 입장, 호스트의 실제 화면 미공유, 근접/돌 공격에 의한 넉백·일시적 기절만 존재, 죽음·체력·승패 없음, 작업 프로그램 위에서도 캐릭터가 보이고 작업 입력을 가로채지 않음.
