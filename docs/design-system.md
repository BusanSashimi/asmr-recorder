# ASMR Recorder — Design System

Source of truth for the app's UI. Derived from `.claude/skills/apple-design.md` (cited as §N).
Platform: Tauri v2 on macOS 14+ (WKWebView ≈ Safari 17). Default window 800×600 (≈572px usable under the native title bar).

## 0. Principles for this app

| Principle (§16) | What it means here |
| --- | --- |
| Purpose | The job is *add sources → set audio → record → edit → export*. Every control serves one of those steps. |
| Familiarity | Look and behave like a first-party Mac app: system font, system colors, unified toolbar, right-hand **Inspector**, sheets for focused tasks. |
| Simplicity | One indicator per state (no duplicated REC pills/timers/buttons). The common path is visible; nothing important hides in a modal. |
| Agency | Inspector can be hidden; settings lock (visibly) only while recording, exactly as before. |
| Craft | Every value below is a token. No raw Tailwind palette colors (`red-500`, `blue-600`, `amber-500`, `gray-900`) in components. |
| Delight / emotion | **Calm and confident.** Neutral greys, one accent, red reserved for recording and destructive actions. |

Non-negotiables: no behavior removed; what `recording-canvas.tsx` draws into the video is untouched; works at 800×600 and scales up.

## 1. Color tokens

Defined in `src/index.css` as space-separated HSL channels (shadcn convention) so Tailwind opacity modifiers work. Tailwind maps every color as `hsl(var(--token) / <alpha-value>)`.

Appearance follows macOS automatically: light values on `:root`, dark values under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` **and** duplicated under `:root[data-theme="dark"] {…}`. Tailwind `darkMode: 'media'`. (There are no `dark:` utilities in the codebase today.)

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `--background` | window / area behind the stage | `0 0% 93%` | `0 0% 11%` |
| `--surface` | toolbar, inspector, monitor strip (structural chrome, §12 "heavier material for structure") | `0 0% 97%` | `0 0% 15%` |
| `--elevated` | dialogs, popovers, menus, toasts (solid fallback for materials) | `0 0% 100%` | `0 0% 19%` |
| `--foreground` | primary label | `0 0% 11%` | `0 0% 93%` |
| `--muted-foreground` | secondary label (AA ≥4.5:1 on every surface incl. `--fill`) | `0 0% 37%` | `0 0% 66%` |
| `--tertiary-foreground` | placeholders, disabled labels, hints | `0 0% 58%` | `0 0% 45%` |
| `--separator` / `--border` | hairlines | `0 0% 85%` | `0 0% 24%` |
| `--input` | control borders | `0 0% 82%` | `0 0% 28%` |
| `--fill` | neutral control fill (bezel buttons, segmented track, slider track) | `0 0% 88%` | `0 0% 24%` |
| `--fill-hover` | hover on neutral fills | `0 0% 84%` | `0 0% 28%` |
| `--accent` | system blue — selection, focus, toggles, primary non-record actions | `211 100% 50%` (#007AFF) | `210 100% 52%` (#0A84FF) |
| `--accent-foreground` | text on accent | `0 0% 100%` | `0 0% 100%` |
| `--record` | system red — record button, live/recording state, region selection | `3 100% 59%` (#FF3B30) | `3 100% 61%` (#FF453A) |
| `--record-foreground` | | `0 0% 100%` | `0 0% 100%` |
| `--destructive` | destructive actions (Clear Section, errors) | = `--record` | = `--record` |
| `--success` | system green (meters, saved) | `135 64% 48%` (#28CD41) | `135 68% 52%` (#32D74B) |
| `--warning` | system orange (update available, meter amber zone) | `35 100% 50%` (#FF9500) | `35 100% 52%` (#FF9F0A) |
| `--ring` | focus ring | = `--accent` | = `--accent` |
| `--stage` | the video stage behind sources (stays dark in both themes — media viewer convention) | `0 0% 7%` | `0 0% 5%` |
| `--hud` / `--hud-foreground` | overlay chips on video (always dark) | `0 0% 0%` / `0 0% 100%` | same |

shadcn aliases kept so existing classes keep working: `--card`=`--elevated`, `--popover`=`--elevated`, `--primary`=`--foreground` (primary button = neutral dark/light "default" bezel is replaced, see §6), `--primary-foreground`=`--background`, `--secondary`/`--muted`=`--fill`, `--secondary-foreground`=`--foreground`. Remove the unused `chart-*` tokens and the dead `.dark` class block.

Canvas code reads colors from CSS (`getComputedStyle(document.documentElement).getPropertyValue('--success')` etc.) so meters follow the theme. Meter zones: `--success` < −12 dBFS ≤ `--warning` < −3 dBFS ≤ `--record`; track = `--fill`.

### Accessibility overrides (§14)
- `@media (prefers-contrast: more)`: `--border`/`--separator`/`--input` darken (light `0 0% 55%`, dark `0 0% 60%`), `--muted-foreground` → `0 0% 25%` / `0 0% 80%`, materials go solid (see §4).
- `@media (prefers-reduced-transparency: reduce)`: all `--mat-*` backgrounds become their solid fallback and `--mat-blur: 0px`.

## 2. Typography (§15)

Font stack: `-apple-system, BlinkMacSystemFont, system-ui, sans-serif` (`-apple-system` first — WKWebView then uses SF Pro with **automatic optical sizing and size-specific tracking**). Because WebKit already applies SF's tracking table, components **do not set `letter-spacing`** on SF text, except uppercase micro-labels. Numbers that change (timers, dB, timecodes) use `tabular-nums` in SF, not a monospace face. `font-mono` (`ui-monospace, SF Mono`) only for pixel coordinates/dimensions.

Tailwind `fontSize` scale (macOS HIG sizes; leading tightens as size grows):

| Class | Size / line-height | Weight | Use |
| --- | --- | --- | --- |
| `text-title` | 15px / 20px | 600 | Dialog & sheet titles, region-selector heading |
| `text-headline` | 13px / 16px | 600 | Inspector section titles, emphasized labels |
| `text-body` | 13px / 18px | 400 | Default UI text, buttons, form labels |
| `text-callout` | 12px / 16px | 400 | Secondary descriptions, select items, chip text |
| `text-caption` | 11px / 14px | 400 | Hints, badges, timestamps, tooltip text |
| `text-micro` | 10px / 12px | 500, `uppercase tracking-[0.06em]` | Only tiny HUD badges (`REC`, dimensions) |

`body` default: `text-body`, `-webkit-font-smoothing: antialiased`. Hierarchy comes from weight + color (`text-foreground` vs `text-muted-foreground`), not extra sizes.

## 3. Spacing, radii, sizes

- 4px grid. Common gaps: 4, 6, 8, 12, 16. Inspector section padding 12px; row gap 8px.
- Radii: `--radius: 8px` → `rounded-lg` 8px (panels, cards, dialogs use `rounded-xl` 12px), `rounded-md` 6px (buttons, inputs, chips), `rounded-sm` 4px (badges, handles). Capsules `rounded-full` only for HUD pills, the Record button and switches.
- Control heights: regular 28px (`h-7`, toolbar & inspector controls — macOS regular control size), large 32px (`h-8`, dialog footer buttons), small 22px (`h-[22px]`, inline mute/mini buttons). Hit areas ≥ 28px; icon-only buttons are 28×28.
- Layout vars: `--toolbar-h: 44px`, `--inspector-w: 264px`, `--monitor-h: 52px`.

## 4. Materials & depth (§12)

Materials are used **only where a surface actually floats over other content** (§12 scroll-edge rule). Fixed chrome (toolbar, inspector, monitor strip) is solid `--surface` separated by a hairline — there is nothing underneath to blur, so translucency would just cost GPU during WebCodecs encoding.

| Material | Recipe (utility class in `index.css` `@layer components`) | Used by |
| --- | --- | --- |
| `.mat-popover` | `background: hsl(var(--elevated) / 0.82); backdrop-filter: blur(24px) saturate(180%);` + `--shadow-popover` + `1px` inner border `hsl(var(--foreground) / 0.08)` | Select menus, tooltips, toasts |
| `.mat-sheet` | `background: hsl(var(--elevated) / 0.9); backdrop-filter: blur(30px) saturate(180%);` + `--shadow-sheet` | Dialogs (Record source, Camera, Display picker, Trim) |
| `.mat-hud` | `background: hsl(var(--hud) / 0.55); backdrop-filter: blur(12px) saturate(160%); color: hsl(var(--hud-foreground));` | Chips/controls drawn over video (source badge, mute capsule, region-selector controls) |
| scrim (`--scrim`) | `0 0% 0% / 0.32` light, `/ 0.5` dark (dim to focus) | Behind modal dialogs; region selector uses `/ 0.7` |

Rules: never stack a translucent popover on a translucent sheet without the sheet being ≥0.9 opaque (§12). Bigger surface = deeper shadow: `--shadow-popover: 0 8px 24px -6px hsl(0 0% 0% / .25)`, `--shadow-sheet: 0 24px 64px -12px hsl(0 0% 0% / .35)`; dark mode raises alpha (.5/.6). Write only `backdrop-filter` — autoprefixer (browserslist default incl. Safari) emits `-webkit-backdrop-filter`; verify it in the built CSS. Reduced transparency / increased contrast → material background alpha 1, blur 0.

## 5. Motion (§1–§11, §14)

Library: `motion` (`motion/react`). Presets live in `src/lib/motion.ts`:

```ts
export const spring = {
  // §4 default: critically damped, no overshoot
  default:  { type: 'spring', bounce: 0, duration: 0.35 },
  snappy:   { type: 'spring', bounce: 0, duration: 0.25 },   // chips, small state swaps
  // §4 momentum: ONLY after a drag release that carried velocity
  momentum: { type: 'spring', bounce: 0.2, duration: 0.4 },
} as const
export const ease = { out: [0.32, 0.72, 0, 1] as const } // iOS sheet curve for CSS/opacity
export function rubberband(overshoot: number, dimension: number, c = 0.55) { … } // §9 verbatim
```

| Interaction | Technique |
| --- | --- |
| Press feedback on every button/tile | **CSS** on pointer-down, exactly §1: `motion-safe:active:scale-[0.97] transition-[transform,background-color,color] duration-100 ease-out` (in `buttonVariants` base). Large tiles `motion-safe:active:scale-[0.98]`. |
| Inspector show/hide | `motion` width spring (`spring.default`), interruptible (rapid toggles retarget from the live value, §3). Slides in from the right edge and out to the right (§7). |
| Toolbar status chips appear/disappear | `AnimatePresence` + `spring.snappy` (opacity + scale 0.9→1) |
| Dialog/sheet enter/exit | CSS via `tailwindcss-animate` data-state classes: enter `fade-in zoom-in-[0.96]` 240ms `ease.out`; exit `fade-out zoom-out-[0.98]` 150ms ease-in. Centered (window-modal). No bounce (click-triggered, §4). |
| Select / tooltip | Scale from the trigger via Radix `--radix-*-content-transform-origin` (§7 anchored origin), 160ms. |
| Region selector drag/resize | Pointer Events + `setPointerCapture`, 1:1 with grab offset (§2), rubber-band past the screen edge (§9), on release spring the visual overshoot back with the release velocity (`spring.momentum`, §5). Committed region is always clamped. |
| Section hover controls | CSS opacity transition 150ms (CSS transitions reverse from the current value — interruptible). |
| Recording dot | gentle opacity pulse 1.6s (not near 0.2 Hz, §14); static under reduced motion. |
| Toasts | Radix swipe-to-dismiss (follows the finger), enter slide+fade 240ms `ease.out`, exit to the same edge it entered from (§7). |

Reduced motion (§14): root `<MotionConfig reducedMotion="user">`; CSS `@media (prefers-reduced-motion: reduce)` disables transforms (`active:scale`, zoom/slide keyframes → fades only) and the pulse.

## 6. Components (`src/components/ui/*`)

| Component | Spec |
| --- | --- |
| **Button** `buttonVariants` | Base: `inline-flex items-center justify-center gap-1.5 rounded-md text-body font-medium select-none` + press feedback (§5) + focus `focus-visible:ring-2 ring-ring ring-offset-1 ring-offset-background`, disabled `opacity-40`. Variants: `default` = neutral bezel (`bg-elevated border border-input shadow-[0_1px_1px_hsl(0_0%_0%/.06)] hover:bg-fill-hover/40`); `accent` = `bg-accent text-accent-foreground hover:bg-accent/90`; `record` = `bg-record text-record-foreground hover:bg-record/90`; `destructive` = `text-destructive hover:bg-destructive/10` (plain) — filled destructive only via `record`; `secondary` = `bg-fill hover:bg-fill-hover`; `ghost` = `hover:bg-fill`; `outline` kept as alias of `default`; `link` unchanged; `hud` = `.mat-hud hover:bg-[hsl(var(--hud)/0.7)]`. Sizes: `sm` h-7 px-2.5, `default` h-7 px-3, `lg` h-8 px-4, `icon` h-7 w-7, `icon-sm` h-[22px] w-[22px]. Keep `asChild`, `forwardRef`, all existing variant names (they may be used). |
| **Tooltip** (new, `@radix-ui/react-tooltip`) | `.mat-popover rounded-md px-2 py-1 text-caption`, delay 500ms, `TooltipProvider` once at app root. Every icon-only button has a tooltip **and** `aria-label`. |
| **SegmentedControl** (new `ui/segmented-control.tsx`) | `role="radiogroup"`, track `bg-fill rounded-md p-0.5`, segments `h-6`, selected segment is an `elevated` pill with shadow that slides between segments with `motion` `layoutId` + `spring.snappy`; arrow-key navigation; supports icon-only segments with tooltip/aria-label. |
| **Switch** | macOS size 26×15: track `bg-fill` → checked `bg-accent`, white thumb with shadow, CSS transform 150ms `ease.out`. |
| **Slider** | 4px track `bg-fill`, range `bg-accent`, 16px white thumb with shadow + hairline, no focus-ring offset jump; `touch-none select-none`. Keep the Radix API. |
| **Select** | Trigger = default bezel at h-7 with chevron-up-down icon; content `.mat-popover rounded-lg p-1`, items `rounded-[5px] h-6 px-2 text-body`, highlighted `bg-accent text-accent-foreground`, check on the left (macOS menu). |
| **Dialog** | Scrim per §4; content `.mat-sheet rounded-xl p-5 gap-4`, `max-h-[calc(100vh-32px)] overflow-y-auto`, width per use. Title `text-title`, description `text-callout text-muted-foreground`. Close (X) button: `ghost icon-sm`, top-right, with `aria-label`. Footer right-aligned, primary action rightmost (macOS order). Animations per §5. |
| **Toast / Toaster** | Viewport bottom-right, `p-4 gap-2`. Toast `.mat-popover rounded-xl p-3 pr-8 text-body shadow`; destructive variant = same material + `text-destructive` title + leading 3px `--record` bar, not a red slab. Actions `default` button size sm. |
| **Card, Label, Separator, ScrollArea** | Token pass only: Card `bg-elevated rounded-xl border`, Label `text-body`, Separator `bg-separator`, ScrollArea thumb `bg-foreground/20 rounded-full`. |

## 7. Layout & IA

The modal Settings dialog becomes a persistent, collapsible **Inspector** on the right (§16 Grouping/Mapping: controls sit next to what they affect; Wayfinding: audio settings are always findable; Familiarity: Final Cut / Keynote / Xcode inspector). The 256px Timeline panel becomes a 52px **Monitor strip**: the preview stage gains ~110px of height.

```
800 × 600 (572px usable)                      Inspector open (default first run)
┌────────────────────────────────────────────────────────────────────────────┐
│ (●) Record  ▣2 🎙 🔊                         ⏏ Open   🔍 Show   ⟳Update  ▐▌│ 44  toolbar (surface)
├──────────────────────────────────────────────┬─────────────────────────────┤
│                                              │ Sources                     │
│   ┌──────────────────────────────────────┐   │  1 ▣ Display 1        ●     │
│   │ stage (16:9, --stage, rounded-xl)    │   │  2 ◻ Empty                  │
│   │  ┌─────────┐ ┌─────────┐             │   │ Audio                       │
│   │  │   ＋    │ │  live   │             │   │  🎙 Microphone      [◯━]    │
│   │  │Add Source│ │ feed   │             │   │     Device [Default ⌃⌄]     │ 476
│   │  └─────────┘ └─────────┘             │   │     Gain ━━━●━━  +2.1 dB 🔇 │
│   │  ┌─────────┐ ┌─────────┐   (hud)🔈 Ready│ │     High-pass 80 Hz [◯━]    │
│   └──────────────────────────────────────┘   │  🔊 System Audio    [━◯]    │
│                                              │ Video                       │
│                                              │  Layout [▦|▢|◫|⧉]          │
│                                              │  Resolution [1080p ⌃⌄] …    │
│                                              │ ─────────────────────────── │
│                                              │  v0.1.0 · Check for Updates │
├──────────────────────────────────────────────┴─────────────────────────────┤
│ Input ▌▌ ▁▃▅▇▅▃▁▃▅▇▅▃ spectrum ▁▃▅▇▅▃▁▃▅ │ 🎞 recording-0612.mp4 0:42 Edit │ 52  monitor strip
└────────────────────────────────────────────────────────────────────────────┘
```

- Root: `h-screen flex flex-col bg-background`. Middle row `flex-1 min-h-0 flex`. Preview column `flex-1 min-w-0 min-h-0`. Inspector `w-[--inspector-w] shrink-0 border-l bg-surface overflow-y-auto` (animated width; content has fixed inner width so it doesn't reflow while animating). Monitor strip full-width `h-[--monitor-h] border-t bg-surface`.
- **Stage sizing bug fix:** today the 16:9 card overflows its column at wide windows (at 1280×800 the timeline is pushed off-screen). The stage wrapper is a size container (`container-type: size`) and the card is `width: min(100cqw, 100cqh * 16 / 9)` + `aspect-ratio: 16/9`, so it is always fully visible and centered.
- Inspector open state persists in `localStorage` (`asmr.inspectorOpen`, try/catch, default `true`); toggled by the toolbar's rightmost `PanelRight` icon button (tooltip "Show/Hide Inspector", shortcut ⌥⌘I).
- At ≥1100px the inspector widens to 288px (optional).

### Toolbar (44px, `bg-surface border-b`)
Left → right:
1. **Record/Stop** — the hero: capsule `variant="record"` h-7 px-3, `Circle` filled icon + "Record"; while recording it becomes **Stop** (`Square` icon) followed by the live duration in `tabular-nums` and a pulsing red dot. Disabled (with tooltip "Add a source to start recording") when there is no content.
2. **Status chips** (what Record will capture): section count, mic, system audio — `bg-fill rounded-md h-6 px-1.5 text-caption text-muted-foreground`, icon + count, each with tooltip; `AnimatePresence`. While recording, the existing per-source StereoMeters render here (same condition as today).
3. flex spacer.
4. File actions, icon+label `ghost` size sm: **Open…** (`FolderOpen`), **Show in Finder** (`FolderSearch`, was "Export" — it reveals the saved file, §16 direct labels). Labels collapse to icon-only + tooltip below 720px.
5. **Update** (only when available): `ghost` with `text-warning` + `ArrowDownCircle`, tooltip "Update to vX — will relaunch"; while applying shows `NN%` tabular-nums caption.
6. **Inspector toggle** (`PanelRight`, icon, pressed state `bg-fill`).

Removed duplicates (behavior preserved elsewhere): toolbar **Re-edit** (the Monitor strip clip's **Edit** dispatches the same `recordingReadyForEdit` event with the same last blob); idle `00:00:00 / 00:00:00` readout (static, zero information); the text "Recording" label (the Stop button + red dot + timer carry it). The Settings button is replaced by the inspector toggle.

### Inspector (all former Settings controls, same handlers & state)
Sections with `text-headline` titles, 12px padding, hairline separators:
- **Sources** — one row per layout slot: index, icon (Monitor/Crop/Camera/empty), device name or "Empty" (`text-muted-foreground`), red dot when recording. Clicking a row opens the same Record-source flow as clicking the slot (if the existing handler is reachable cheaply; otherwise rows are read-only). Replaces the old read-only "Video Sources" text. Shows the validation hint "Add a source to start recording" when there is no content.
- **Audio** — Microphone switch (+ live StereoMeter), device select, Gain slider + dB readout + mute `icon-sm` button, High-pass 80 Hz switch; System Audio switch (+ "Not available" caption when unsupported), app select, gain/mute. Sub-controls are grouped under their switch with `pl-6` aligned to the label text (macOS indentation) and only shown when the switch is on (as today).
- **Video** — Layout as a **SegmentedControl** (icons `LayoutGrid`, `Square`, `Columns2`, `PictureInPicture2`; tooltips = `LAYOUT_LABELS`), PiP corner select (only for PiP), Output resolution, Frame rate, Quality selects as label-left/control-right rows.
- **Footer** — version + "Check for Updates" link button + "vX available" in `text-warning`.
- While recording every control is disabled exactly where the old Settings button was disabled, with a caption "Settings are locked while recording" at the top of the inspector.

### Preview stage
- Stage card: `bg-stage rounded-xl shadow-[0_1px_2px_hsl(0_0%_0%/.2),0_8px_24px_-8px_hsl(0_0%_0%/.3)] ring-1 ring-black/5`.
- Empty slot: dashed `border border-white/15 rounded-lg`, centered `Plus` in a 36px `bg-white/10` circle, label **"Add Source"** (`text-body text-white/80`) and caption "Section N" (`text-caption text-white/45`). Hover brightens (`bg-white/[.04]`), press `scale-[0.98]`. Keeps the existing click handler.
- Filled slot: source badge bottom-left `.mat-hud rounded-full h-6 px-2 text-caption`; region size badge top-right `.mat-hud text-micro font-mono`; hover controls = two `hud` buttons ("Change", X with aria-label) on a `bg-black/30` veil.
- Recording: each live slot gets an inset `ring-2 ring-record/80` (replaces the 2px red border); the per-slot "REC" badges and the global top-right "Recording" pill are removed (toolbar Stop + timer is the single indicator). The "Low res preview recording (performance limitation)" note stays but becomes a caption inside the bottom HUD capsule, worded "Preview is reduced while recording" (keep meaning; adjust wording only if the code shows a different meaning).
- Bottom HUD capsule (bottom-right, `.mat-hud rounded-full h-7 px-1`): mute `hud icon-sm` + status text `text-caption` ("Ready" / "Recording" / "No Sources"). The fake progress bar is removed only if it encodes no real progress (verify in code); otherwise restyle as a 2px `bg-white/20` track.

### Monitor strip (was Timeline)
`h-[--monitor-h] px-3 flex items-center gap-3 bg-surface border-t`:
`Input` caption · StereoMeter · Spectrum (`flex-1 h-8 rounded-md bg-fill/60`, theme colors) · vertical separator · clip chip.
Clip chip = button `h-8 rounded-md bg-fill hover:bg-fill-hover px-2.5 gap-2`: `Film` icon, file name (truncate, max 220px), duration `tabular-nums text-muted-foreground`, trailing **Edit** label in `text-foreground font-medium` (accent text on `--fill` fails AA; the whole chip is the button). Click → same `recordingReadyForEdit` dispatch. Empty: caption "No recording yet" in `text-tertiary-foreground`.

### Dialogs
- **Record source** (`record-modal`): width 380px; title "Add Source to Section N" / "Change Section N"; two side-by-side tiles (`h-24 rounded-xl bg-fill hover:bg-fill-hover flex-col gap-2`, 28px icon, title `text-headline`, caption `text-caption text-muted-foreground`): "Screen — Capture a display or region", "Camera — Use a connected camera". "Clear Section" = `destructive` plain button, left-aligned in footer.
- **Camera select**: width 480px; preview `aspect-video bg-stage rounded-lg`; camera list as a macOS source list (rows `h-8 rounded-md px-2`, selected `bg-accent text-accent-foreground` + check); footer Cancel (`default`) + "Use Camera" (`accent`).
- **Display picker** (inside preview.tsx): same source-list row style; dimensions right-aligned `text-caption tabular-nums`.
- **Trim editor** (sheet, `max-w-[720px] w-[calc(100vw-48px)]`): video `rounded-lg bg-stage`; range slider per §6 with selected range `bg-accent`, inactive segments `bg-accent/30 hover:bg-accent/45`; filmstrip `rounded-md overflow-hidden` with 1px gaps; In / Keeping / Out row `text-callout tabular-nums`, labels `text-muted-foreground`; segment chips `rounded-md h-6 px-2 text-caption tabular-nums`, active `bg-accent text-accent-foreground`, inactive `bg-fill`. Footer: left `Preview` (play/pause, `secondary`) + `Cut` (`default`); right "Frame-accurate" **Switch** with label, "Skip" → keep wording unless the original is already saved (then "Close"), primary "Save Trimmed Clip" (`accent`, spinner while exporting).

### Region selector (full-window overlay)
- Scrim `bg-black/70`; heading `text-title text-white` + caption `text-white/60`.
- Screen preview `rounded-lg overflow-hidden shadow-sheet ring-1 ring-white/10`; outside-selection mask `bg-black/55`.
- Selection: 1.5px `--record` border, no dashed inner box; 8 handles = 9px white circles (corners) / 14×6 white capsules (edges) with `shadow-[0_0_0_1px_hsl(var(--record)),0_1px_3px_rgba(0,0,0,.4)]`; hit area ≥ 20px via transparent padding; center crosshair removed (cursor `move` conveys it). Dimension label `.mat-hud rounded-md text-micro font-mono` below the box.
- Controls in a `.mat-hud rounded-xl p-1.5 gap-1.5` bar: Cancel (`hud`), Full Screen (`hud`), **Confirm Region** (`record`). Position/size readout `text-caption font-mono text-white/50`.
- Interaction per §5 (Pointer Events, capture, grab offset, rubber-band, velocity spring-back). Keep every existing clamp/min-size rule and the coordinate math in screen pixels.

### Error boundary
Centered `max-w-md` card: `AlertTriangle` in `text-warning`, `text-title` "Something went wrong", error message in `rounded-md bg-fill p-3 text-caption font-mono`, `accent` "Reload" button.

## 8. Do / Don't
- Do use tokens (`bg-surface`, `text-muted-foreground`, `bg-record`); don't use raw palette colors (exception: `white/x` and `black/x` on the always-dark stage/HUD).
- Do give every icon-only control an `aria-label` + tooltip.
- Do keep one indicator per state.
- Don't animate layout properties of the stage card or anything inside `recording-canvas.tsx`.
- Don't add bounce to anything a click triggers.
- Don't put translucent material on fixed chrome that has nothing beneath it.


## Editing Mode

The shared 40 px mode bar uses the existing segmented control for **Recording Mode** and **Editing Mode**. Capture/finalization and timeline voice-over lock mode switching. Editing uses the same typography, semantic colors, focus rings and 28 px controls as recording; no independent editor theme or palette is introduced.

A 44 px editor toolbar holds project actions, workspace selection, panel arrangement, Quick Trim and Export. Docked panel tab headers are 32 px. At 800×600, Media and Inspector share a tab group; the Program/Source monitors share another, with the timeline below. Resizable panels scroll internally. Assembly, Editing, Color, Effects and Audio presets offer focused layouts. Panels can be opened, moved and restored with toolbar menus as well as dragging.

The dark media stage is content chrome, including in light appearance. Blue marks selected clips, focus, active tools and the playhead. Green depicts audio waveforms/meters. Effect color samples, media colors and scope pixels represent actual content and are exempt from structural chrome tokens. Red remains reserved for recording and destructive/error states.

Parameter inspectors use labeled fields and collapsible groups; complex controls have keyboard alternatives (numeric vertices/handles, keyframe nudges, panel placement menus). All Actions provides searchable advanced forms, with unavailable operations disabled and an explanation. Long paths are exposed in tooltips while compact rows display basenames. Empty panels explain which selection or media is needed.

Implementation and validation: [FilmCraft migration](filmcraft-migration.md).
