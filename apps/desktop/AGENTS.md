# Desktop 코드 작성 규칙

루트 `AGENTS.md`와 `.agents/rules/`를 먼저 적용한다. 이 디렉토리의 TypeScript·React 코드는 `eslint.config.js`를 기준으로 작성하고, 변경 후 `pnpm --filter @deskbrawl/desktop lint`를 통과해야 한다.

- React 함수 컴포넌트와 Hook의 기존 이름·배치를 유지한다. props는 이름 있는 타입으로 표현하고, 복잡한 상태 표시와 여러 단계를 수행하는 이벤트 처리는 JSX 밖에서 이름을 붙인다.
- 중첩 삼항식 대신 조기 반환·조건문·상태별 매핑을 사용한다. 조건문·반복문에는 중괄호를 쓰고, 여러 동작을 한 줄에 압축하지 않는다.
- ESLint Stylistic으로 공백 2칸, 큰따옴표, 세미콜론, JSX 속성·표현식 줄바꿈을 통일한다. 자동 수정은 `pnpm --filter @deskbrawl/desktop lint:fix`를 사용한다. JSX의 여러 줄 속성은 한 줄에 하나씩 쓴다.
- 타입 전용 의존성은 `import type`으로 분리한다. `any`, non-null assertion, 검사 억제로 오류를 우회하지 않는다.
- 비동기 작업은 `await` 또는 명시적인 오류 처리로 종료한다. 이벤트 콜백에서 Promise를 시작하면 실패 처리 책임이 드러나게 한다.
- Tauri API·플러그인은 `src/native/`에서만 import한다. React는 UI, native 어댑터는 IPC, PixiJS 런타임은 렌더링과 자원 수명을 담당한다.
- effect·socket·이벤트·타이머·PixiJS 자원은 생성한 소유자가 해제한다. 비동기 초기화 중 언마운트와 Strict Mode 재실행을 유지한다.
- 테스트에도 동일한 TypeScript 규칙을 적용한다. 가독성 개선 때문에 검증을 약화하거나 동작·공개 계약을 바꾸지 않는다.
- Rust는 ESLint 대상이 아니다. Rust를 변경하면 기존 rustfmt·Clippy·Rust 테스트 기준을 별도로 따른다.

기본 검증은 실제 등록된 `lint`, `typecheck`, `test`, `build` 스크립트로 실행한다. 네이티브 코드를 변경하지 않은 웹 검증을 Tauri·Win32 실기기 검증으로 보고하지 않는다.

설정은 [typescript-eslint 권장 타입 검사](https://typescript-eslint.io/users/configs/), [React Hooks 권장 규칙](https://react.dev/reference/eslint-plugin-react-hooks), [ESLint Stylistic](https://eslint.style/guide/config-presets)을 기반으로 한다. 공백·따옴표·JSX 줄바꿈의 구체적인 선택은 이 프로젝트의 컨벤션이며, 설치된 버전과 `eslint.config.js`를 따른다.
