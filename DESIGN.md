# Gradia design system — locked for the Hallmark redesign

This file is the system at every depth. Every page reads it and varies **composition only**; the system below does not vary between pages. Client rule from `AGENTS.md`: plain JS/JSX, Tailwind 4, glass.

## What is fixed (do not change)

- **The glass token system** in `Client/src/index.css` (`:root` / `.dark`) — glass visuals, ambience, backgrounds. Append nothing to it except what the redesign stamp block already added (status/ring tokens, focus, reduced-motion, x-clip). The `.dark` toggle (`src/lib/theme.js`, persisted in localStorage) is kept exactly as is.
- **Faces**: `Instrument Serif` = display/editorial voice (headlines, hero, "Sign in"), `Plus Jakarta Sans` = everything else. Two families total, no more. No display face on labels, buttons, table heads or data.
- **Tokens**: every colour rides a CSS variable (`--background`, `--surface`, `--foreground`, `--muted-foreground`, `--primary`, `--primary-deep`, `--tertiary`, `--border`, `--border-subtle`, `--danger(+subtle)`, `--success(+subtle)`). No literal hex/rgb/Tailwind-red classes in markup. Dark-mode appearance comes from `.dark` re-declaring tokens; do not add per-element light/dark classes.
- **Radius per nesting level**: one radius per level — page shells/panels `rounded-2xl`, cards `rounded-xl`, controls and chips `rounded-lg` / `rounded-full`.
- The universal `* { border-radius: 12px }` rule **stays** (it is the glass material's base).

## What the redesign enforces (Floor — non-negotiable)

1. **No tracked caps / no eyebrows.** Labels, captions, table heads, tags, sidebar items, card labels: **sentence case**, body face (`Geist`), one step smaller than body context, **no `uppercase` and no `tracking-*`**. Replace `text-[10px] uppercase tracking-[0.1em]` with `text-xs` at most — never below **11px functional text / 12px for labels** the user reads a lot.
2. **Text sizes**: minimum 11px anywhere (was 7–10px); running text 12px+; the stat values can stay large.
3. **Copy punctuation**: never em dashes joined in copy ("Students · 3 entered · max 40" → use commas or plain spacing, e.g. `3 of 40 entered`); never arrows glued to link text ("manage →" → a verb like "Manage"); no decorative status dots; no middle-dot meta strings. Use typographic quotes in prose (`’`).
4. **Focus**: every interactive element shows `:focus-visible` instantly (global rule in index.css already covers it; do not override with outline-none without a replacement ring).
5. **Motion**: `transform`/`opacity` only; **never `transition-all`** (use `transition-colors` / `transition-transform`); one reveal at most per screen; `prefers-reduced-motion` already handled globally. Theme change on `<body>` keeps its existing 300ms colors transition.
6. **Controls**: app-range heights 32–40px with a 44px hit area on the primary daily controls (`px-3.5 py-2.5` ≈ 38px is right); buttons `whitespace-nowrap` (labels never wrap to 2 lines); figures use `tabular-nums`.
7. **All eight states on interactive elements**: default, hover, `:focus-visible`, `active`, disabled, loading (`animate-pulse` or spinner text), error, success — the forms on these pages have error/message states; keep them, wire them to the shared primitives, don't invent logic.
8. **Data loads have four states**: loading (skeleton in the shape of what is coming), empty (what belongs here + the action that fills it), error (what broke + what to do), full. Most pages have loading/empty; check error paths exist where a query can fail (`.error` from supabase calls) — add a small inline error line if missing, without inventing logic beyond that.
9. **Figures are the product's own**: no invented metrics, no trend arrows nobody measured. Charts: axis labels ≥11px, `chartAxis`/`chartTooltip` config reused, `tabular-nums` on values.
10. **Wiring is sacred**: keep every link, field, `name`, `id`, `key`, `type`, `href`, handler, supabase call, RPC name, route and prop exactly as found. Edit markup inside the component that owns it; never move logic or rename props. A missing state (failed load) is noted, never fabricated.
11. **No new dependencies.** No gradients purple-to-blue, no emoji icons, no card-inside-card (use surface ladder: `glass-panel` > `glass-inner` > bare `--surface`).

## App screens (all dashboard pages) — additional rules

- Skip marketing structure: no hero, no fold targets, no section word budgets.
- Density is the design: tables before cards where a table already exists; one container recipe per page; consistent column gap.
- Sidebar/text: sidebar items are the body face, sentence case, no tracking.
- Charts (recharts) keep the glass look: `var(--border-subtle)` grid, `var(--primary)` bars, existing `chartAxis`/`chartTooltip`.

## Landing page only

- Editorial voice stays: Newsreader display headline, glass mockup, grid background.
- The eyebrow pill ("ACADEMIC RESULTS PLATFORM" with its dot) is **cut**; open with the headline.
- The product mockup (ProductPreview) gets **clickable tabs**: sidebar items Students, Results, Subjects, Reports switch the mockup's preview panel content locally (useState; no routing). Keep `PREVIEW_ITEMS`/`fluid` fallbacks intact so the landing page never crashes — see AGENTS.md gotcha.
- Hero copy budget: headline ≤7 words, one sentence ≤12 words, 1–2 actions, ~80 words on the first screen.

## Sweep / build hygiene

- Mark changed files with the project's stamp only in `index.css` (already present). No per-file stamps needed.
- Run nothing global: the coordinator runs `npm run lint` and `npm run build` at the end; each page edit must keep `npm run lint` clean in principle — no unused imports, no unused vars (this repo's ESLint ignores JSX usage but flags real ones).
- Supabase: no service-role key anywhere in the client; never write `result_sheets`/`result_items` directly.
