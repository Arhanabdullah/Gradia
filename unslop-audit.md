# Unslop Audit — Gradia Landing Page

## Direction (to be confirmed by user)

Before editing, I need to establish the design direction. Based on the Gradia product (Student Result Management System with Supabase backend), here's my preliminary direction:

- **Product.** A student result management system that simplifies academic result workflows for students, teachers, and administrators.
- **Character.** Calm, exact, a little warm — the system deals with academic data that should feel reliable and organized, not hype-filled.
- **World.** Academic institutional space — paper, records, classrooms, administrative workflows. The world sets tint of neutrals (graphite/ink) and accent (a single meaningful color).
- **Moments.** One or two places where the screen gets rich detail — e.g., a rendered result card or chart showing real data, or a key visual from the academic world.
- **Signature.** One small detail only this product would have — e.g., a status dot for published results, or a keycap-style number format.

Please confirm or adjust this direction before I proceed with the nine passes.

---

## Audit Signs Found

### 1. Spacing Inconsistencies
- `mt-[13px]` and `py-[11px]` appear throughout (these break the 4px grid rhythm)
- Various margins/paddings that aren't multiples of 4
- Sidebar has `p-4 md:w-56` and inner `p-4 py-2.5` — mixed spacing scales
- `mt-7`, `mt-9`, `mt-8` used inconsistently
- `pb-20 sm:pb-24 md:pb-24` — the `md:pb-24` duplicates `pb-20` effectively

### 2. Color Issues
- **Ambient lighting layers** with multiple glowing color blobs:
  - `ambient-light-primary` (rgba 241, 122, 126 = coral pink)
  - `ambient-light-secondary` (rgba 255, 201, 75 = orange/yellow)
  - Multiple `ambient-light` divs with different sizes and positions
  - These create a "glowing" effect across the page
- **Hero glow** (`hero-glow` class): absolute positioned radial gradient blurred heavily — this is a decorative glow blob
- **Nav glass** uses `rgba(241, 122, 126, 0.55)` — the primary color at 55% opacity
- **Glass panels** have gradient backgrounds with primary tint
- **Primary color** `#f17a7e` (coral/red) used extensively as the main accent
- **Dark theme** switches primary to `#e0295a` — still a strong red accent
- **Grid background** has radial gradients with ambient-primary and ambient-secondary
- **Status colors** (`--danger`, `--success`) are bright and saturated

### 3. Icon/Emoji Issues
- **Browser bar** in ProductPreview has emoji-like spans: `<span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />` etc. — these are color blocks but behave like decorative emoji
- No actual lucide icons used anywhere in landing page

### 4. Copy Issues
- **"Academic results, without the complexity."** — hype-adjacent copy, not concrete enough
- **"Gradia brings students, teachers, and academic administrators together in one streamlined platform..."** — "streamlined" is vague, the long description is marketing fluff
- **"Make academic results simpler for everyone."** — CTA copy, generic
- **"Explore platform"** — button label, fine but generic
- Number labels like `1,248`, `12`, `78.4%`, `312` in mock data — these are plausible but still mock data
- "How it works" section title
- "Platform" label in Features section

### 5. Type Issues
- `font-editorial` (Newsreader) used for headlines — this is fine as it's the project's chosen font
- `font-ui` (Geist) used for UI text
- Some text uses `text-[11px]` — minimum allowed per design system
- Tracking `[-0.035em]` on h1, `[-0.02em]` on navbar label
- Headlines use `italic text-(--primary)` inside them — this is a secondary color inside a headline, which per unslop rules should be avoided; headline should be one color
- `text-sm` used extensively, some `text-xs`

### 6. Layout Issues
- Hero section has text centered with `items-center text-center` and the headline spans the full width
- ProductPreview has `grid md:grid-cols-[224px_1fr]` — the 224px fixed sidebar is fine for desktop
- Sections are stacked vertically with `pb-20` between them
- Hero has `pb-12 pt-16 md:pb-14 md:pt-20`
- CTA section has `py-24 md:py-28`
- Everything centered in hero, which per unslop rules is the "template default" — should consider asymmetric layout

### 7. Details Issues
- `rounded-2xl` used everywhere — consistent but generic
- `border-(--border)` used extensively
- `bg-(--surface-secondary)` used for muted backgrounds
- `focus-visible:outline-2 focus-visible:outline-(--primary)` appears in several places — this is actually good per the design system, but the `--primary` outline is a strong visual
- `transition-colors` used widely
- `whileHover` with `y: -3` or `y: -4` on multiple elements — this is movement on hover

### 8. Visual Issues
- **Glossy blobs/orbs**: The ambient lighting layers, hero-glow, all the radial gradients with blur
- **Floating cubes/grid**: The grid-background with multiple radial gradients and linear gradients
- **Glowing grids**: Not exactly, but the ambient lights create a similar effect
- **The hero-glow** is a classic slop element: an absolutely positioned blurred gradient that "glows" behind the content
- **ProductPreview** has `animate-pulse` on the loading spinner (`h-12 animate-pulse rounded-lg`)

### 9. Motion Issues
- `animate-pulse` on the class loading spinner in DashboardStats/ManageClasses
- `whileHover` with `scale: 1.05` on NavLink's motion.span
- `whileHover` with `scale: 1.04` on HeroActions buttons
- `whileHover` with `y: -3` / `y: -4` on dashboard cards and product preview cards
- `whileHover` with `borderColor: "var(--primary)"` on multiple elements
- `transition={{ duration: 0.25, ease: "easeOut" }}` used everywhere
- `custom={0.3}` / `custom={0.45}` / `custom={0.15}` on Reveal components
- `animate-ping` not present but `animate-pulse` is
- Multiple `motion.div`/`motion.button` with variants

### 10. Other
- `product-mockup's miniature chrome` — the ProductPreview is a mockup within a mockup, with browser chrome, sidebar, dashboard header, stats, charts, recent results all in one
- The entire landing page feels like "vibecode" — many surfaces, colors, and effects without clear purpose

---

## Summary of Slop Signs by Category

| Category | Signs Found |
|----------|------------|
| **Spacing** | `mt-[13px]`, `py-[11px]`, inconsistent multiples of 4, mixed scales |
| **Color** | Multiple ambient glow blobs, hero-glow, primary accent used everywhere, grid gradients, status colors bright |
| **Icons/Emoji** | Color blocks in browser bar treating like emoji, no lucide icons |
| **Copy** | Hype-adjacent copy ("streamlined", "without the complexity"), mock data numbers |
| **Type** | `text-[11px]` at minimum, italic inside headlines, mixed tracking |
| **Layout** | Everything centered in hero (template default), sections stacked |
| **Details** | `rounded-2xl` everywhere, `focus-visible:outline-(--primary)` is strong, `whileHover` y-translations |
| **Visual** | Ambient glow blobs, hero-glow, grid-background with multiple gradients, `animate-pulse` |
| **Motion** | `animate-pulse`, hover scaling, y-translations on hover, transitions everywhere |

Now I need the user to confirm the design direction before I proceed with the nine passes. Let me present this audit and direction.