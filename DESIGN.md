---
name: DeskBrawl
description: 작업과 놀이 사이 — 민트 바탕화면 위의 픽셀 캐릭터
colors:
  background: "#f2f8f6"
  foreground: "#183b33"
  card: "#ffffff"
  muted-foreground: "#526e65"
  border: "#b8cec6"
  accent: "#167563"
  accent-foreground: "#ffffff"
  accent-hover: "#105e50"
  surface: "#e5f1ec"
  rail: "#eaf4ef"
  stage: "#dcefe6"
  key-shadow: "#b8cec6"
  code-warm: "#8a5318"
typography:
  display:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "clamp(2rem, 1.1rem + 2.9vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 1.14
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Pretendard, Malgun Gothic, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.6
  code:
    fontFamily: "ui-monospace, Cascadia Code, D2Coding, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.75
rounded:
  key: "6px"
  window: "10px"
  bubble: "14px"
spacing:
  sm: "12px"
  md: "20px"
  lg: "28px"
  xl: "44px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.window}"
    padding: "0 18px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.accent}"
    rounded: "{rounded.window}"
    padding: "0 18px"
    height: "48px"
  button-outline-hover:
    backgroundColor: "{colors.surface}"
  window:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.window}"
  keycap:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.key}"
---

# Design System: DeskBrawl

## Overview

**Creative North Star: "일하는 중인 바탕화면"**

DeskBrawl의 화면은 누군가 일하고 있는 PC 바탕화면이다. 내용은 작업 창 안에 담기고, 캐릭터는 그 위의 투명한 층에 산다. 색은 민트 한 가지가 화면 전체를 차지하고, 장난스러움은 픽셀 캐릭터와 키캡 같은 작은 물건에만 싣는다. 색·서체 토큰의 원본은 `apps/desktop/src/brand-theme.css`이며 랜딩(`apps/landing`)은 그 파일을 그대로 가져다 쓴다. 다크 모드는 OS 설정을 따라 같은 토큰 이름으로 전환한다.

**Key Characteristics:**

- 민트 바탕(`stage`)에 점 격자. 화면 전체가 한 색이다.
- 2px 테두리와 점 세 개 제목 표시줄을 가진 창.
- 굵은 검은 외곽선의 픽셀 스프라이트는 캔버스에 nearest로 그린다.
- 헤드라인은 Pretendard 800, 로고만 픽셀 워드마크.
- 상태 변화는 색이 아니라 화면 가장자리의 빛과 스위치 위치로 알린다.

## Colors

민트 단색 전략이다. 바탕·창·버튼이 모두 같은 색상 계열의 명도 차이로 구분된다.

### Primary

- **딥 민트** (`accent` #167563, 다크 #81cbb9): 주 버튼, 활성 창 테두리, 체크 표시, 코드 키워드, 워드마크.

### Neutral

- **민트 화이트** (`background` #f2f8f6) · **무대 민트** (`stage` #dcefe6): 바탕화면. 무대 민트 위에 점 격자를 얹는다.
- **카드** (`card` #ffffff): 창과 버튼의 면.
- **딥 그린** (`foreground` #183b33): 본문과 헤드라인. 순수한 검정은 쓰지 않는다.
- **보조 글자** (`muted-foreground` #526e65): 제목 표시줄, 각주, 코드 주석. 회색이 아니라 민트 기운이 있는 녹회색이다.

### Named Rules

**The One Hue Rule.** 인터페이스 색은 민트 계열뿐이다. 다른 색은 캐릭터 스프라이트와 코드 창의 따뜻한 갈색(`code-warm`)에서만 나온다.

## Typography

Pretendard 가변 서체 하나로 전부 쓴다(`apps/desktop/src/assets/fonts`에 자체 호스팅). 한국어는 `word-break: keep-all`, 헤드라인은 `text-wrap: balance`.

### Hierarchy

- **Display** — 800, clamp(2rem → 3.75rem), 자간 -0.03em. 문서 창의 h1 하나뿐이다.
- **Body** — 400, 1.0625rem/1.7, 최대 34em.
- **Label** — 600, 0.8125rem. 제목 표시줄, 작업 표시줄, 각주.
- **Code** — 고정폭은 코드 창 안에서만 쓴다.

### Named Rules

**The Wordmark Rule.** 픽셀 글자는 로고 워드마크(`/wordmark.png` 알파 마스크)에만 쓴다. 본문이나 제목에 픽셀 서체를 끌어오지 않는다.

## Layout

- 1080px 이상: 창 세 열(4fr / 5.4fr / 3.4fr)이 서로 28–40px 겹친다. 가운데 문서 창이 가장 위에 온다.
- 1079px 이하: 한 열로 쌓고 최대 640px. 꾸밈용 코드 창은 숨긴다.
- 작업 표시줄은 높이 56px로 하단에 고정한다. 모드 스위치와 조작키 범례가 항상 거기 있다.
- 오버레이(캐릭터 캔버스, 테두리 빛, 말풍선)는 뷰포트에 고정되고 스크롤과 무관하다.

## Elevation & Depth

그림자를 쓰지 않는다. 창의 위아래는 2px 테두리와 겹침 순서로만 구분한다. 유일한 깊이 표현은 키캡의 `0 2px 0 var(--key-shadow)`와 PLAY 모드의 화면 가장자리 빛이다.

### Named Rules

**The Edge Glow Rule.** 안쪽 그림자 빛(`inset 0 0 16px` + `inset 0 0 96px`)은 PLAY 상태를 뜻하는 신호로만 쓴다. 앱 오버레이와 같은 값이며, 장식으로 다른 요소에 붙이지 않는다.

## Shapes

- 창·버튼·말풍선 10px, 키캡 6px, 제목 표시줄의 점은 9px 정사각형에 2px 모서리.
- 메신저 말풍선만 14px이고 말하는 쪽 아래 모서리가 4px다.
- 테두리는 2px(`--line`). 활성 창은 `accent`, 나머지는 `border`.

## Components

### Buttons

- **Primary**: 딥 민트 면, 흰 글자, 높이 48px, 700. hover는 `accent-hover`.
- **Outline**: 카드 면, 딥 민트 2px 테두리와 글자. hover는 `surface`.
- 버튼 안의 단축키는 키캡으로 붙인다.

### Window

`.window` + `.titlebar`. 제목 표시줄은 38px, `surface` 면, 점 세 개와 파일 이름. 본문 안쪽 여백은 창마다 다르다(문서 24–44px, 메신저 16px).

### Keycap

`kbd`. 1px 테두리, 6px 모서리, `0 2px 0` 눌림 깊이. 앱의 키캡과 같은 모양이다.

### Mode Switch

작업 표시줄의 WORK / PLAY 두 칸 스위치. 선택된 칸은 WORK일 때 딥 그린, PLAY일 때 딥 민트로 찬다. 집중 모드에서는 반투명해지고 PLAY를 받지 않는다.

### Speech Bubble

캐릭터를 따라다니는 말풍선. 카드 면, 2px 테두리, 아래쪽 10px 꼬리. 안내 말풍선은 딥 민트, 친구의 말은 딥 그린 테두리.

### Checklist

문서 창의 할 일 목록. 22px 상자가 완료되면 딥 민트로 차고 체크가 0.35s 동안 튀어나온다.

## Do's and Don'ts

### Do:

- 색·서체는 `apps/desktop/src/brand-theme.css`의 토큰을 가져다 쓴다.
- 스프라이트는 `image-rendering: pixelated` 또는 캔버스 nearest로 그린다.
- 아이콘은 20px 격자, 2px 선의 인라인 SVG로 그린다.
- 움직임은 OS의 동작 줄이기 설정에서 멈춘다.
- 말투는 짧은 해요체로 쓴다.

### Don't:

- 그라데이션, 네온, 유리 효과, 입체 그림자를 쓰지 않는다.
- 인터페이스에 민트 밖의 강조색을 들이지 않는다.
- 이모지를 아이콘으로 쓰지 않는다.
- 고정폭 서체를 코드가 아닌 곳에 쓰지 않는다.
- 없는 다운로드 수, 후기, 지원 OS를 적지 않는다.
