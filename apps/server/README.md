# 서버 코드 작성 기준

`eslint.config.js`와 `.prettierrc.json`을 서버 코드의 실행 가능한 기준으로 사용한다.
루트의 `pnpm lint`와 `pnpm check`에도 서버 ESLint 검사가 포함된다.

## 포맷과 ESLint

- 들여쓰기 2칸, 작은따옴표, 세미콜론, 마지막 쉼표를 사용한다. 줄 너비는 80자를 기준으로 자동 정리한다.
- 조건문·반복문에 항상 중괄호를 사용하고, 한 줄에 여러 문장을 압축하지 않는다. 중첩 삼항식은 조건 분기나 이름 있는 함수로 풀어 쓴다.
- 한 파일에는 클래스 하나를 둔다. 생성자, 메서드와 처리 단계 사이에는 빈 줄을 두어 흐름을 구분한다.
- TypeScript의 `recommendedTypeChecked`를 적용한다. 처리하지 않은 Promise, 비동기 콜백 오용, 안전하지 않은 `any` 접근·대입·반환을 검사한다.
- 타입 전용 의존성은 `import type`으로 분리하고 함수의 반환 타입을 명시한다. 콜백은 문맥에 따른 타입 추론을 허용한다.
- `any`, non-null assertion, 검사 비활성화로 오류를 우회하지 않는다. Nest가 주입하는 `@WebSocketServer()` 필드의 definite assignment는 일반적인 non-null assertion과 구분한다.
- Prisma 생성 코드와 빌드 결과물은 직접 수정하거나 포맷하지 않는다. 테스트와 설정 파일도 ESLint·Prettier 검사 대상이다.

## NestJS 구조

- 기존 `src/modules/`의 도메인 경계와 모듈 진입 파일(`auth.ts`, `rooms.ts`, `invites.ts`, `visits.ts`)을 유지한다.
- Controller·Service·Guard·Gateway는 각각 `*.controller.ts`, `*.service.ts`, `*.guard.ts`, `*.gateway.ts`로 분리한다. 새 모듈·필터·데코레이터에는 `*.module.ts`, `*.filter.ts`, `*.decorator.ts`를 사용한다.
- Controller는 REST 경계, Gateway는 Socket.IO 경계를 처리한다. 인증·인가·유스케이스·DB 접근은 Service와 Guard에 둔다. 게임 상태와 판정은 시뮬레이션이 소유한다.
- 설정은 시작 시 검증하고 Nest DI로 전달한다. 테스트마다 독립 설정을 주입할 수 있도록 `AppModule.forRoot(config)`를 사용한다.
- 현재 esbuild 빌드는 decorator metadata를 생성하지 않는다. 생성자 의존성의 명시적인 `@Inject(...)`를 유지한다.
- wire 타입은 공유 Zod 스키마에서 가져오거나 추론한다. 포맷을 맞추기 위해 계약·인가·작업 순서·게임 수치를 변경하지 않는다.
- 타이머·DB·소켓의 정리는 Nest 생명주기에서 수행하고 테스트에서도 앱을 종료한다.

## 작성 후 검증

저장소 루트에서 실행한다.

```sh
pnpm --filter @deskbrawl/server lint:fix
pnpm --filter @deskbrawl/server format:check
pnpm --filter @deskbrawl/server typecheck
pnpm --filter @deskbrawl/server test
```

인증·DB·방 참여·실시간 처리에 영향을 주는 변경에는 격리된 PostgreSQL을 준비하고
`TEST_DATABASE_URL`을 지정한 뒤 `pnpm --filter @deskbrawl/server test:integration`도 실행한다.
마이그레이션과 서버 실행 방법은 [M2 개발 안내](../../docs/m2-development.md)를 따른다.
자동 수정 후 남는 오류는 코드에서 해결하며 기존 검사를 완화하지 않는다.

## 기준 자료

- [NestJS 공식 starter의 Prettier 설정](https://github.com/nestjs/typescript-starter/blob/master/.prettierrc): 작은따옴표와 마지막 쉼표 기준.
- [TypeScript ESLint typed linting](https://typescript-eslint.io/getting-started/typed-linting/): `recommendedTypeChecked`와 `projectService` 설정.
- [Prettier의 ESLint 연동](https://github.com/prettier/eslint-plugin-prettier#configuration-new-eslintconfigjs): 포맷을 ESLint 검사에 포함하는 설정.

현재 공식 starter의 검사 도구와 무관하게 이 프로젝트는 요청된 ESLint를 유지한다.
프로젝트에서 추가한 가독성 규칙은 Prettier 연동 뒤에 적용해 중괄호·문장 수 검사가 꺼지지 않게 한다.
