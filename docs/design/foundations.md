# RastUp Design Foundations (v0)

_Last updated: 2025-11-26_

This is the base design system for the web app. It is intentionally small
so it can be applied consistently by humans and AI agents.

---

## 1. Brand & Tone

- Overall feel: **modern, editorial, minimal**.
- Primary use case: booking creative talent (models, photographers, studios).
- Personality:
  - Calm, confident, not shouty.
  - Clear typography, generous whitespace.
  - Imagery does the talking; UI chrome stays subtle.

---

## 2. Color tokens (CSS custom properties)

Define these in your global stylesheet (e.g. `web/styles/globals.css`):

```css
:root {
  --color-bg: #050509;
  --color-surface: #0f1016;
  --color-surface-alt: #171925;

  --color-primary: #f97316;      /* accent (orange) */
  --color-primary-soft: #fed7aa; /* soft background accents */

  --color-text: #f9fafb;
  --color-muted: #9ca3af;

  --color-border: #27272f;
  --color-danger: #f97373;
  --color-success: #4ade80;
}
