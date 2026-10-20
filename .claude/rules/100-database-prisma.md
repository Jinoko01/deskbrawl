---
paths:
  - "apps/server/prisma/**"
  - "apps/server/src/**/*.ts"
  - "apps/server/test/**"
  - "**/schema.prisma"
  - "**/migrations/**"
  - "**/prisma.config.*"
---

# PostgreSQL·Prisma

- 스키마 변경 시 Prisma schema와 migration을 함께 검토한다. 생성된 Prisma Client는 직접 수정하거나 공유 프로토콜로 노출하지 않는다.
- Prisma CLI·Client 버전과 datasource 설정은 설치된 버전을 따른다. 문서 예시 때문에 설정을 임의로 이전·변경하지 않는다.
- 개발 마이그레이션은 격리된 개발 DB에서 생성·검증한다. 운영에는 검토된 migration을 배포 절차로 적용하며 개발용 migrate dev·reset·임의 db push를 사용하지 않는다.
- 이미 공유·적용된 migration을 수정·삭제하지 않고 후속 migration을 만든다. 생성된 SQL의 데이터 손실·테이블 잠금·기존 행의 제약 위반을 확인한다.
- 컬럼 삭제·필수화·대량 backfill은 기존 데이터와 구버전 앱의 호환성을 검토한다. 필요하면 추가 → 이전 → 전환 → 제거 단계로 나눈다.
- 운영 적용·파괴적 변경 실행 전에는 대상·영향·백업과 복구 절차를 제시하고 승인받는다. 임의 rollback SQL이 항상 안전하다고 가정하지 않는다.
- 외래키·unique·NOT NULL 등 불변식은 가능한 한 DB 제약으로 보장한다. 서비스의 사전 조회만으로 동시 요청을 제어하지 않는다.
- 초대 토큰 소비·게임 결과 저장 등 여러 변경이 하나의 결과여야 하면 transaction·조건부 갱신·unique key로 원자성과 멱등성을 보장한다.
- transaction 안에서 외부 통신·Socket.IO ack·전체 게임 루프를 기다리지 않는다. 재시도는 충돌 종류와 작업의 멱등성을 검토해 제한한다.
- 필요한 필드만 select하고 N+1·무제한 목록·불필요한 연결 생성을 피한다. 인덱스는 실제 조회·정렬·제약에 근거해 추가한다.
- raw SQL이 필요하면 매개변수화한다. 사용자 입력을 SQL 문자열에 결합하지 않는다.
- 게임 매 틱마다 DB를 쓰지 않는다. 영속 대상과 저장 시점·실패 재시도·서버 장애 시 허용되는 데이터 손실을 계약으로 정한다.
- 테스트는 운영 DB와 분리하고 실제 PostgreSQL의 제약·동시성을 확인한다. SQLite 대체 결과를 PostgreSQL 검증으로 보고하지 않는다.
