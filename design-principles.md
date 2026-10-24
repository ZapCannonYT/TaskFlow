# Taskflow — Design Principles

How Taskflow should look, feel, and behave. This is the short rulebook for anyone building the UI, human or Claude Code.

**Reading order:** `plan.md` (what to build and in what order) → `architecture.md` (how it fits together) → this file (how it looks and behaves) → `color-scheme.md` (exact colours).

**For Claude Code:** when a screen or state is not covered here, choose the quieter, simpler option, and say what you chose in your summary. Do not add options, dialogs, animations, or colours that these files do not call for. Use shadcn/ui components and the tokens in `color-scheme.md`.

---

## 1. Feel

Three words: **quiet, direct, forgiving.**

- **Quiet:** few things on screen, no decoration, no noise. The one obvious thing is the add field.
- **Direct:** plain words, short labels, no jargon, no mascot.
- **Forgiving:** nothing is final. Mistakes are fixed after the fact with Undo, Edit, or Retry, never prevented by a question.

The app should feel like a notepad that happens to remember things, not a project manager.

---

## 2. Core principles

| Principle | In the build | Why |
|---|---|---|
| **Capture now, organize later** | Only the title is required. Every other field is optional. | Saving a thought must never depend on a decision. |
| **One primary action** | The add field is the largest, most prominent element on every capture screen. | Nobody wonders what to press. |
| **Rough first, specific later** | "When" accepts rough answers (This week, Next week) that are tightened later (Section 4). | People know roughly when, not exactly when, at the moment of capture. |
| **Progressive disclosure** | Details appear only after tapping a task or choosing to add them. | Hides options needed rarely. |
| **Forgive, don't confirm** | Remove, Done, voice adds, and date reading all show Undo. No "Are you sure?" dialogs. | The fast path stays fast. |
| **Show the state** | Each new row appears instantly; "Saving…" shows only if saving takes longer than about 400 ms; failed saves say "Not saved · Retry" and keep the text. | Trust comes from seeing that it worked. |
| **Thumb zone** | On phone, the add field, chips, and main buttons sit in the bottom third. | One-handed use. |
| **Recognition over recall** | Buttons say what they do in words. Icons are never the only label. | Nothing to decode or remember. |
| **Consistency** | The same row layout, chip style, and buttons everywhere. | Learn it once. |
| **Motion only for change** | See Section 7. | Speed first; animation explains, never delays. |

---

## 3. The add composer (the most important component)

**Anatomy, top to bottom on phone** (the composer sits above the keyboard, below the list):

1. **Field row:** text field (placeholder "Add a task…"), mic button inside the row, **Add** button at the right.
2. **When row:** four chips in one line: **Today**, **Tomorrow**, **This week**, **Next week**. One tap selects; tap again to clear.
3. **Details row:** **Pick date**, **Size**, a **star** (Important), **Label**.

**Rules**
- **Enter** (laptop) or **Add** (phone) always saves immediately, with or without any chip selected.
- The two chip rows appear only while the field has text. With an empty field only the field row shows.
- Nothing is required. A title-only task is normal and welcome.
- If the date reader finds a day or time in the text (for example "Friday 6pm"), it shows a filled, removable chip. It never changes the text silently.
- After saving: the field clears, focus stays in the field on laptop, and the new row appears at the top of the list.
- On laptop the composer sits at the top of the screen; on phone, at the bottom.
- Every control is at least 44 × 44 px. The title stays visible when the keyboard opens.
- Voice: press and hold the mic to talk, release to save. A toast shows `Added “…”` with **Undo** and **Edit**.

**Chip behaviour**
- Unselected: outline chip, text label.
- Selected: filled with `accent`, value visible.
- Rough date on a task row: dashed outline (see Section 4).
- No priority levels, no projects, no nested tags, no multiple labels.

---

## 4. When: from rough to specific

The four quick choices are deliberately coarse so capture stays one tap.

| Choice | Saved as | Counts as "When set"? | Shown in |
|---|---|---|---|
| **Today** | Exact day (today) | Yes | Today |
| **Tomorrow** | Exact day (tomorrow) | Yes | The 7-day strip, then Later |
| **This week** | Rough: the Sunday ending this week (flagged `due_is_approx`) | No | "Sometime this week" in the This week view |
| **Next week** | Rough: the Sunday ending next week (flagged `due_is_approx`) | No | "Next week" group in Later |
| **Pick date** | Exact day, optional time | Yes | That day |

- **This week** is hidden on Sundays, because it would mean today.
- A rough task is a **basic** task: it does not count toward the three fields that make a task complete, so it gets the one-hour details prompt like any other basic task.
- **Tightening it:** Quick details opens a rough task with a row of day buttons (the remaining days of that week) as the first thing on screen. One tap makes the date specific; Size, Important, and Label follow as optional chips.
- A rough task whose week passes unfinished becomes Missed, with the reason "Planned for last week".
- The companion's ranking uses the stored Sunday date, so a rough task rises in priority through the week without extra rules.

---

## 5. Layout, spacing, and type

**Spacing:** 4 px grid. Allowed steps: 4, 8, 12, 16, 24, 32. Screen side padding 16 px on phone.

**Shape:** rows 12 px radius; the add field 14 px; buttons 10 px; chips fully rounded. Borders over shadows. No drop shadows for hierarchy.

**Type:** system font stack only (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). No web fonts, which keeps the app fast and light.

| Use | Size / weight |
|---|---|
| Screen title (Inbox, Today) | 28 px / 700 |
| Task title, field text | 16 px / 400 |
| Secondary text, chip text, buttons | 14 px |
| Captions, row chips | 12–13 px, never below 12 |

**Touch targets:** 44 × 44 px minimum for anything tappable. Chips are 44 px tall on the composer and compact (about 22 px) when shown as read-only labels on a row.

**Screens and navigation:** four plain tabs: **Today, Inbox, Later, Done**. No other tabs. Quick details is a card or notification target, never a tab.

**Phone:** one column. The Today screen opens with a single "one thing" card on top (Done / Later buttons and the reason), a 7-day strip, then the day's list.
**Laptop:** two panes, **Today** on the left and **This week** on the right.

---

## 6. Components

**Task row:** checkbox circle (44 px target), title, then small chips only for fields that are set. Tap the row to reveal inline details; no modals. Status words ("Saving…", "Not saved · Retry", "Missed") appear at the right.

**Toast (Undo):** appears above the composer for about 5 seconds. Text `Added “…”` plus **Undo** and **Edit**. One toast at a time.

**"One thing" card (Today):** one task, why it was picked ("Big task · due Friday"), and **Done** and **Later**. Nothing else.

**Later sheet:** opens from "Later". Options: Tomorrow, This week, Next week, Pick a date, and **Skip today** for nudges.

**Quick details:** one task per screen. Rough-date day buttons first (if any), then chips for When, Size, Important, Label, with **Skip** and **Done**. Never a full-list review.

**Empty states:** one calm line, no pressure ("Nothing here yet."). No illustrations.

**Settings:** short list: reminders, quiet hours, nudge time, pause nudges, voice mode, notifications, devices, export.

---

## 7. Motion

Rule: **anything you reach for appears instantly; anything that changes state may get a short animation that never blocks input.**

| Element | Treatment |
|---|---|
| Focusing the field, typing, chip rows appearing, tab switches, the list on launch | Instant. No animation. |
| Tapping a chip or the star | Instant state change; an optional 100 ms colour fade |
| New row appearing after Add | 150 ms fade and slide; typing continues during it |
| Completing a task | Row collapses over about 180 ms, Undo available |
| Toast in and out | 150 ms fade |
| Details expanding on a row | About 120 ms; focus moves immediately |
| Hold-to-talk level meter | Live, because it is feedback |

Technical rules:
- Animate only `transform` and `opacity`. Never animate `width`, `height`, `top`, or `left`.
- Every duration is under 200 ms. Ease-out when something enters, ease-in when it leaves.
- Never wait for an animation to finish before accepting the next tap.
- No skeleton shimmer and no spinner for data that is already on the device.
- Show "Saving…" only after about 400 ms.
- Respect `prefers-reduced-motion`: turn transitions off.
- No decorative animation, no celebration effects, no streaks.

---

## 8. Wording

| Avoid | Use |
|---|---|
| Due date | When |
| Priority | Important |
| Overdue | Missed |
| Snooze | Remind me later |
| Delete / archive | Remove (with Undo) |
| Triage / backlog | Quick details / Inbox |
| Sync failed | Not saved · Retry |
| Reminder presets | Sentences: "A day before" |

Rules: sentence case, no exclamation marks, no emoji, no jargon. If a friend would need to ask what a word means, replace it. Notification wording is direct: `Do now: Submit lab report · due today`.

---

## 9. Accessibility

- Contrast meets WCAG 2.2 AA (see `color-scheme.md`).
- Colour is never the only signal.
- Real `<button>`, `<a>`, `<input>` and `<label>` elements; no clickable `div`s.
- Visible focus ring on every focusable element (2 px `accent`).
- Full keyboard use on laptop: `N` or `C` focuses the field, `Enter` saves, `Esc` closes. Shortcuts are ignored while typing in another field.
- Icon-only buttons have an `aria-label`.
- Text scales with the system font size; layouts do not break at large sizes.

---

## 10. Performance guardrails

- First-load shell under about 150 KB gzipped (target, to verify).
- Tasks render from the local cache first on launch, then refresh from the server.
- The speech model loads only when the mic is first used, never at start-up.
- System fonts only; no web fonts.
- Route-level code splitting.

---

## 11. Do not

- Do not add modal dialogs for normal task creation or removal.
- Do not require a date, label, size, or reminder to save.
- Do not add onboarding tours, streaks, scores, or celebrations.
- Do not show more than one primary button per area.
- Do not use more than one accent colour.
- Do not hide labels behind icons.
- Do not add animation to anything the user is trying to reach.

---

## 12. Done checklist for any screen

- [ ] Title-only task works with no extra taps.
- [ ] Every tappable element is at least 44 × 44 px.
- [ ] Text and borders pass the contrast table in `color-scheme.md` in light and dark.
- [ ] No hex values in components; only tokens.
- [ ] Failed save keeps the text and offers Retry.
- [ ] Each destructive action has Undo, not a confirmation.
- [ ] No animation delays an interaction; reduced-motion respected.
- [ ] Keyboard-only use works on laptop.
- [ ] Wording matches the table in Section 8.
