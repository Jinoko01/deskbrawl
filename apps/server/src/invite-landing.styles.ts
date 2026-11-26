export const inviteLandingStyles = `/* Hallmark · theme: DeskBrawl brand · genre: playful · job: join · v2.0.0 */
/* Hallmark · pre-emit critique: app entry leads, with the download action beside it. */
/* Palette from apps/desktop/src/brand-colors.css. */
:root {
  color-scheme: light dark;
  --body-face: Pretendard, "Malgun Gothic", system-ui, sans-serif;
  --stage: #dcefe6;
  --stage-dot: #16756326;
  --card: #fff;
  --foreground: #183b33;
  --muted-foreground: #526e65;
  --border: #b8cec6;
  --accent: #167563;
  --accent-foreground: #fff;
  --accent-hover: #105e50;
  --surface: #e5f1ec;
}

@media (prefers-color-scheme: dark) {
  :root {
    --stage: #233e33;
    --stage-dot: #81cbb926;
    --card: #192824;
    --foreground: #edf8f3;
    --muted-foreground: #a7bfb5;
    --border: #3b554b;
    --accent: #81cbb9;
    --accent-foreground: #102d28;
    --accent-hover: #a1dfce;
    --surface: #22372f;
  }
}

*, *::before, *::after { box-sizing: border-box; }
html, body { overflow-x: clip; }

body {
  display: grid;
  place-items: center;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0;
  padding: clamp(16px, 5vw, 44px);
  background: var(--stage) radial-gradient(var(--stage-dot) 1px, transparent 1px) 0 0 / 12px 12px;
  color: var(--foreground);
  font-family: var(--body-face);
  line-height: 1.7;
  word-break: keep-all;
}

.invite {
  width: min(100%, 36rem);
  padding: clamp(20px, 6vw, 44px);
  border: 2px solid var(--border);
  border-radius: 10px;
  background: var(--card);
}

.invite img {
  display: block;
  object-fit: contain;
  margin-bottom: 20px;
}

h1 {
  min-width: 0;
  margin: 0;
  font-size: clamp(2rem, 1.1rem + 2.9vw, 3.25rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.14;
  text-wrap: balance;
  overflow-wrap: break-word;
}

p {
  margin: 12px 0 0;
  color: var(--muted-foreground);
  font-size: 1.0625rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 28px;
}

.actions a {
  display: inline-grid;
  place-items: center;
  min-height: 48px;
  padding: 8px 16px;
  border: 2px solid var(--accent);
  border-radius: 10px;
  background: var(--card);
  color: var(--accent);
  font-weight: 700;
  text-align: center;
  text-decoration: none;
}

.actions a:hover { background: var(--surface); }
.actions a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.actions a:active { transform: translateY(1px); }

.actions .primary {
  background: var(--accent);
  color: var(--accent-foreground);
}

.actions .primary:hover {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
}
`;
