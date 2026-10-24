# Taskflow — Low-Friction Task Capture and Daily Companion Plan

## Product goal

Build a personal task manager for Android and Windows that makes adding a task nearly effortless without interrupting the user's current activity, and that quietly brings the user back with the one thing worth doing next.

> **See also:** [`architecture.md`](./architecture.md) explains how the pieces fit together (layers, data flow, voice capture, reminders) and why each choice was made. This file is the plan; that file is the explanation.

**Primary product principle:** capture now, organize later.

**Second principle: companion, not nag.** The app gives you a reason to open it. Once a day it tells you the one task to do next (direct, plain wording, e.g. "Do now: Submit lab report · due today"). Tasks captured with almost no detail get one gentle follow-up an hour later so they are not overlooked. It must never feel like a second job: few notifications, silent where possible, always dismissible, never switched off for being ignored.

**Voice:** speech-to-text only (no text-to-speech), using open-source models that run on the device. Audio never leaves the phone or laptop.

A task should be savable with only a title. When, size, importance, label, reminders, and notes are optional and can be added later. The app must not force a workflow, demand excessive metadata, open a large form for every task, or interrupt the user with unnecessary prompts.

## Target platforms

- **Phone:** Android, initially through an installable Progressive Web App (PWA) in Chrome.
- **Laptop:** Windows, through an installable PWA in Chrome or Edge.
- **Shared source of truth:** Supabase PostgreSQL.
- **Initial timezone:** `Asia/Kolkata`, while storing timezone-aware timestamps and supporting user preferences.

## Recommended stack

- React + TypeScript + Vite
- Tailwind CSS
- shadcn/ui (open-source components built on Radix) as the UI starting point
- Lucide icons
- `@huggingface/transformers` (Transformers.js) running open-source Whisper in a Web Worker for speech-to-text (WebGPU when available, WASM fallback)
- Supabase Auth, PostgreSQL, Row Level Security (RLS), and Realtime
- `vite-plugin-pwa` + Workbox
- Supabase Cron + Edge Functions for reminder scheduling
- Web Push with VAPID for notifications
- Vitest + React Testing Library; Playwright for end-to-end tests
- Static frontend hosting over HTTPS

Do not add an AI API, a separate Express server, Redux, calendar synchronization, or complex integrations to the first phase. Add infrastructure only when a validated use case requires it.

---

## 1. The capture experience

### 1.1 One-field quick add

The main task entry should be a single text field with placeholder text such as:

> Add a task…

The user should be able to:

1. Focus the field.
2. Type a title.
3. Press Enter on the laptop or tap Add on the phone.
4. Continue with what they were doing.

That is the default path. No required date, size, label, confirmation dialog, or mandatory second step (the optional tap chips from 1.3A may be tapped, never required).

### 1.2 Save immediately

- Create a task as soon as the user submits a non-empty title.
- Clear the input after a successful save.
- Keep keyboard focus in the field on desktop so several tasks can be entered consecutively.
- On mobile, keep the input available and avoid unnecessary page transitions.
- Show a small, non-blocking status if saving fails. Do not silently discard text.
- Prevent accidental duplicate submissions while a save is in progress.
- Use an optimistic UI only if failed saves can be clearly rolled back or retried.

### 1.3 Capture first, organize later

A new task defaults to:
- Status: `open`
- When (due date): none
- Size: not set
- Important: off
- Label: none
- List: Inbox
- Reminder: none unless the user has configured an explicit default

Never require a user to choose a label, date, size, importance, or reminder just to save a task.

### 1.3A Optional tap chips (the "few intuitive buttons")

While the quick-add field has text in it, a single compact row of chips appears under it. Tapping a chip is optional; **Enter / Add always saves immediately, with or without chips.**

| Chip | Options |
|---|---|
| **When** | Today, Tomorrow, This weekend, Next week, Pick date |
| **Size** | Quick (under 15 min), An hour, Big (half a day or more) |
| **Important** | a star, on or off |
| **Label** | one label from a short editable list (starter set such as Study, Work, Personal) |

Each chip is one tap to set and shows its value once set. No priority levels, projects, nested tags, or multi-label tagging.

**Basic vs complete task** (used by the follow-up in Section 6A):
- The optional fields are When, Size, Important (counts only when on), and Label.
- A task with **0 to 2** of these set is **basic**.
- A task with **3 or more** set is **complete** and is never prompted for details.
- Capturing a basic task is always fine, for example in a meeting. Details can be added later.

### 1.4 Keyboard-first desktop interaction

Recommended shortcuts:
- `N` or `C`: focus quick-add when not typing in another input.
- `Enter`: submit the task.
- `Esc`: close an expanded editor or cancel an unsaved draft.
- `Ctrl/Cmd + K`: open a lightweight command/search palette, later in development.

Do not intercept shortcuts while the user is typing in an input, textarea, or editable element. Show shortcuts unobtrusively in help or tooltips.

### 1.5 Mobile-first capture

- Keep an obvious Add Task control near the bottom of the screen, reachable with one thumb.
- Consider a floating `+` button, but do not let it cover task content or the keyboard.
- Tapping `+` should focus a compact input, not open a full-screen multi-field form.
- Use sensible input sizing and spacing for touch.
- Avoid requiring drag-and-drop to complete, reorder, or organize tasks.
- Keep the task title visible when the keyboard opens.
- Add an Android home-screen widget only after the PWA's basic workflow is proven; a true Android widget may require a native wrapper or a separate native implementation.

### 1.6 Do not obstruct the user

Avoid:
- Onboarding tours that block the app.
- Repeated prompts to set dates or priorities.
- Forced daily planning.
- Modal dialogs for normal task creation.
- Automatic AI interpretation that changes a task without confirmation. (Voice transcription is allowed because it only converts speech to the title text, and every voice-added task shows an Undo/Edit toast.)
- Aggressive notification permission requests on first launch.
- Streaks, gamification, or productivity scores in the MVP.
- Requiring a project or tag before saving.
- Pop-ups asking for feedback during task entry.

Ask for notification permission only after the user explicitly enables reminders or tests a notification. Explain why permission is needed.

---

## 2. Progressive enhancement for faster capture

Implement these in order (they are folded into the build phases in Section 9); none should compromise the one-field baseline.

### Enhancement A — Quick add with optional details

After the basic capture path works, support optional syntax such as:

- `Submit lab report tomorrow`
- `Pay bill Friday 6pm`
- `Buy USB-C cable`

Initially, keep parsing conservative. If the app recognizes a date, show the interpreted date as a small editable chip before or after saving. If interpretation is uncertain, preserve the entire input as the title instead of guessing.

A reliable manual title-only save is more important than imperfect natural-language parsing.

### Enhancement B — Inline date and reminder controls

After a task is created, allow optional details through small inline controls:
- When (due date), with due time / all-day toggle
- Reminder presets
- Size, Important, Label (the same tap chips as 1.3A)
- Notes

Do not show all controls by default. Reveal them only when the user opens a task or asks to add details.

Suggested date presets:
- Today
- Tomorrow
- This weekend
- Next week
- Pick a date

Suggested reminder presets:
- None
- At due time
- 1 day before
- 2 days before
- 1 day before + due time
- 2 days before + 1 day before + due time
- Custom

### Enhancement C — Capture from anywhere

Potential later additions:
- PWA share target for links and text where supported.
- Browser extension for saving the current page as a task.
- Email-to-task capture.
- Android share-sheet support through a native wrapper if the PWA alone is insufficient.
- Voice capture: a mic button inside the quick-add field using on-device open-source Whisper (see Section 2A). The phone keyboard's built-in dictation remains the zero-effort baseline and always works.

Do not build every capture surface simultaneously. Start with the app itself, then add the capture path that saves the most repeated effort.

---

## 2A. Voice capture (speech-to-text)

Goal: say a task out loud and have it saved, with no typing and no extra screens.

### Behavior
- A mic button sits inside the quick-add field. One tap starts listening.
- Listening stops automatically when the user stops talking (voice activity detection). No second tap needed.
- The transcript becomes the task title and is saved straight to Inbox.
- A small toast appears for a few seconds: `Added "buy USB-C cable"` with **Undo** and **Edit**. This replaces a confirmation dialog: fix mistakes after, never ask before.
- If transcription fails or nothing is heard, show a quiet message and keep the mic available. Never save an empty task.
- Ask for microphone permission only the first time the mic is tapped, with one plain sentence explaining why.
- Manifest shortcut ("Add by voice") on the installed app icon opens the app with the mic ready, so capture is one long-press plus speaking. The browser may still require one tap before the mic starts; test this per platform.

### Technology (all open source)
- Whisper speech model, run through Transformers.js in a Web Worker so the UI never freezes.
- Default model: Whisper base (English), around 74 MB; Whisper tiny (around 39 MB) as the fast fallback for weak devices. Models download once and are cached in the browser.
- WebGPU when the device supports it, WebAssembly otherwise (slower but works).
- Audio is processed on the device. Nothing is uploaded.
- Do not use the browser's built-in Web Speech API as the primary path: it is not open source and may send audio to a third-party server.

### Limits to document and test
- First use downloads the model; show a one-time "Getting voice ready…" state, and keep typing fully usable meanwhile.
- Phones without WebGPU will transcribe more slowly. Measure on the actual Android phone before choosing the default model.
- Accuracy varies with accent and background noise; this is why Undo/Edit is mandatory.

---

## 3. Core screens

Keep navigation small. Use plain words: **Today, Inbox, Later, Done**. Quick details appears only as a card or notification action, not as a tab.

### Today
- Opens to **one thing**: the task the companion would recommend now (rule in Section 6A), with Done and Later buttons and the reason ("Big task · due Friday").
- Below it: the rest of today's tasks, with missed tasks in a separate section.
- A **7-day strip** at the top; tap a day to see that day's tasks. A **This week** option groups the whole week by day.
- If there are basic tasks waiting, one small card: "3 tasks are just titles. Add details?" (opens Quick details).
- No hourly timeline. No requirement to assign tasks to Today manually.
- On a laptop-width screen, show **Today** on the left and **This week** on the right.

### Inbox
- Default destination for tasks without a date and for dated tasks that still need review. A dated task stays in Inbox until the user completes its audit; its saved date and time are preserved.
- Quick-add field always visible (bottom on phone, top on laptop).
- Newest tasks easy to find. Complete, edit, and remove inline.

### Later
- Tasks with a future date, grouped by day. Easy rescheduling with the same When chips.
- Tasks with no date stay in Inbox, clearly distinguished.

### Done
- Recently completed tasks and a way to restore one. Completion is never irreversible.

### Quick details (the audit)
- Only for **basic** tasks (Section 1.3A). Never a full-list review.
- One task per screen. Review date, exact due time, size, importance, label, recurrence, reminder, and description, plus **Skip** and **Done**.
- Audit tasks with fewer than five of those seven optional detail categories. Keep them in Inbox until the user finishes or skips the audit; preserve their date/time meanwhile.
- Reached from the Today card or the details prompt notification. Never forced.

### Settings
- Default reminder offsets.
- Quiet hours and timezone.
- Notification permission and test-notification action.
- Device subscriptions.
- Data export and account management.

Avoid building projects, kanban boards, calendar views, habit tracking, and analytics until the capture and reminder workflows are reliable.

---

## 4. Task data model

Use PostgreSQL as the source of truth.

### `tasks`

Suggested fields:
- `id` UUID primary key
- `user_id` UUID, references authenticated user
- `title` text, required after trimming whitespace
- `notes` text, optional
- `status` enum or constrained text (`open`, `completed`)
- `due_at` timestamptz, nullable
- `is_all_day` boolean
- `timezone` text, e.g. `Asia/Kolkata`
- `size` text or enum, nullable (`quick`, `hour`, `big`); null means not set and is treated as `hour` when ranking
- `is_important` boolean, default false
- `label_id` UUID, nullable, references a small per-user `labels` table (one label per task)
- `details_prompted_at` timestamptz, nullable; set when the one-hour details prompt was sent
- `created_at` timestamptz
- `updated_at` timestamptz
- `completed_at` timestamptz, nullable
- `deleted_at` timestamptz, nullable

### `labels`

Per-user list of short label names (starter set editable). One label per task; no nesting.

### `task_reminders`

One row per planned reminder:
- `id` UUID primary key
- `task_id` UUID
- `user_id` UUID
- `scheduled_at` timestamptz
- `kind` (`advance`, `due`, `daily`, `daily_repeat`, `weekly`, `details_prompt`): why this reminder exists; the dispatcher uses it for copy, sound, and budget rules
- `delivered_via` text, nullable (`push` or `in_app`): which channel actually delivered it, so the same reminder is never shown twice
- `status` (`pending`, `processing`, `sent`, `failed`, `cancelled`)
- `sent_at` timestamptz, nullable
- `attempt_count` integer
- `last_error` text, nullable
- `created_at` timestamptz

Use constraints and atomic claims to avoid concurrent workers processing the same reminder. Rebuild pending reminders when the due date or reminder settings change. Completed and deleted tasks must not generate future reminders.

### `push_subscriptions`

Store the browser push endpoint and its public subscription keys, linked to the user. Support multiple subscriptions per user and allow invalid subscriptions to be disabled or removed.

### `user_preferences`

Store timezone, default reminder offsets, quiet hours (default 10:30 PM to 8:00 AM), daily nudge time (default 6:30 PM), weekly summary day (default Sunday), and notification settings. Defaults should be sensible and editable; do not require preference setup before using the app.

### Security requirements

- Enable RLS on all user-owned tables.
- Users can only read and modify their own data.
- Keep service-role credentials and VAPID private keys server-side.
- Never put privileged secrets in `VITE_` environment variables.
- Validate all input on the server/database boundary.
- Provide a data export path before treating the app as the user's only task store.

---

## 5. Cross-device synchronization

1. Save tasks to PostgreSQL.
2. Show the result immediately where practical, with clear recovery if the save fails.
3. Use Supabase Realtime for changes from other clients.
4. Refresh tasks on app focus and reconnect.
5. Handle duplicate events idempotently.
6. Do not overwrite newer server state with an older local update.

For the first version, require connectivity for writes and clearly show when offline. Add offline task capture with IndexedDB and a retry queue later. Offline synchronization needs explicit conflict handling; it should not be improvised as a side effect of caching the page.

---

## 6. Reminder behavior

The reminder system must work when neither the phone nor laptop has the app open, subject to browser/OS push support and permissions.

### Recommended defaults

For a normal task:
- No reminder unless the user chooses one or sets a default.

For a task with a due time:
- User-selectable reminders such as 2 days before, 1 day before, and at due time.

For all-day tasks:
- Use a clearly displayed default reminder time, such as 6:30 PM local time (same as the default daily nudge time), only if the user enables a reminder. Never silently schedule an all-day task at midnight.

### Server-side scheduling

- Supabase Cron invokes an Edge Function on a regular interval.
- The function finds due reminder rows.
- Claim each row atomically to avoid concurrent duplicate processing.
- Recheck that the task is still open and not deleted or rescheduled.
- Apply quiet hours and user notification settings.
- Send Web Push using VAPID.
- Record success or failure and retry transient failures with bounded exponential backoff.
- Disable expired subscriptions after appropriate push-service responses.

Design for at-least-once attempts rather than promising exactly-once push delivery. Network failures can occur after a push service accepts a message but before the sender receives the response.

### Notification actions

Where supported, include:
- Open task
- Complete
- Snooze for a configurable interval

The service worker should handle notification clicks and actions. Server-side mutations must verify the authenticated user and task ownership. A push payload must not be treated as trusted authorization.

### Quiet hours and anti-spam rules

- User-configurable quiet hours.
- No repeated notifications for every overdue task.
- Limit reminders per task by default.
- Completed/deleted tasks cancel pending reminders.
- Rescheduling invalidates obsolete reminder records.
- Provide a test-notification button and a clear permission status.
- Do not send the same alert independently from both local scheduling and cloud push without a deduplication strategy.

---

## 6A. Daily companion (the reason to open the app)

Goal: remind the user of required work in a way that is useful, direct, and easy to ignore without consequences. The app comes to you with one thing instead of waiting to be checked.

### Notification budget (the whole list)
| Notification | When | Sound | Limit |
|---|---|---|---|
| **Daily nudge** | Once a day at the user's time (default 6:30 PM) | Normal | 1 per day; skipped on days with nothing to surface |
| **Urgent re-ping** | About 3 hours after the nudge, never later than 10:15 PM | Silent | 1 per day, only if the surfaced task is due today or missed, only if the nudge was not tapped |
| **Details prompt** | 1 hour after a **basic** task is added (Section 1.3A) | Silent | Batched into one; max 2 per day; deferred out of quiet hours |
| **Explicit reminders** | The due-date reminders the user chose | Normal | As configured, outside quiet hours |
| **Weekly summary** | Sunday evening | Normal | Replaces that day's daily nudge |

Quiet hours (default 10:30 PM to 8:00 AM) always win. Nothing in this table repeats beyond its limit.

### Choosing the one task
Computed on the fly from raw fields (no stored scores, no vectors, no AI):

| Signal | Points |
|---|---|
| Missed (overdue) | 100, plus 1 per day overdue (max 20) |
| Due today | 80 |
| Due tomorrow | 50 |
| Due in 2 to 3 days | 30 |
| Due in 4 to 7 days | 15 |
| Important | +25 |
| Size **Big** and due within 2 days | +40 ("start now, it needs time") |
| Size **An hour** and due within 1 day | +15 |
| Size not set | treated as **An hour** |
| No date | 0, plus 1 per day untouched (max 10); only considered when nothing dated is open |

Highest score wins; ties go to the oldest. Keep the constants in one file with unit tests so they are easy to tune. Always show a short reason in the notification ("Big task, due Friday").

### Wording (direct, plain, no mascot)
- Missed or due today: `Do now: {title} · due today` or `Missed: {title}. Do it now.`
- Big task approaching: `Start today: {title} · Big, due {day}`
- Otherwise: `Next up: {title}` plus `· {n} more` when others are waiting
- Details prompt: `Add details to "{title}"?` (or `{n} tasks are just titles` when batched)

Actions on the daily nudge: **Done**, **Later** (opens Tomorrow / This weekend / Next week), **Skip today**.

### Ignored nudges
- The re-ping is the only repeat. If the nudge and re-ping are both ignored, nothing more is sent that day.
- The next day starts normally. The companion **never switches itself off** for being ignored.
- A tap on any nudge, or a completed task, resets everything to normal.

### Details prompt (audit of basic tasks)
- When an unaudited task has fewer than five of seven optional detail categories (exact date, size, importance, label, recurrence, description, reminder), schedule one `details_prompt` reminder for one hour later.
- Cancel it if the task reaches five categories, is completed, removed, or already reviewed.
- Tapping opens **Quick details** for that task (or the batch).
- A task with five or more categories is never prompted.
- The prompt is silent and also appears as the Today card, so it never makes noise during a meeting.

### Permission flow
- After the user's first saved task, show an in-app one-line card: "Want a daily nudge so nothing slips?" with **Yes** and **Not now**.
- Only **Yes** triggers the real browser permission prompt.
- **Not now** re-offers once after about 3 days, then waits for the user to enable it in Settings.

### Sunday weekly summary
Replaces that day's nudge: `This week: {n} open, {m} due soon · Biggest: {title}`. Tapping opens the This week view.

---

## 7. UI principles

- Fast, calm, and visually quiet.
- One obvious primary action: add a task.
- Plain language, no jargon. Examples: "Snooze" becomes "Remind me later"; "Due date" becomes "When"; "Priority" becomes "Important"; "Overdue" becomes "Missed"; "Delete" becomes "Remove" (with Undo); "Reminders" presets read as sentences ("A day before").
- Forgive instead of confirm: prefer Undo toasts to "Are you sure?" dialogs.
- Start from proven open-source components (shadcn/ui) and simple todo layouts; do not invent new interaction patterns.
- Minimize navigation depth.
- Prefer inline edits over modal dialogs.
- Use text labels for important actions; do not rely on icons alone.
- Use clear empty states without pressuring the user.
- Keep completed tasks visually distinct but easy to restore.
- Support keyboard navigation and visible focus.
- Meet accessible contrast and touch-target sizing.
- Avoid animations that delay interaction.
- Use optimistic interactions only when errors can be recovered from.
- Make saving, offline state, and notification permission status understandable without intrusive alerts.

### Capture performance goals

These are project targets to validate, not universal research findings:
- A title-only task should require one text entry and one submission.
- A returning user should be able to add a task without navigating away from the current list.
- Keep capture UI responsive while saving.
- Avoid mandatory fields beyond the title.
- Do not show a modal or confirmation step after a successful add.
- Keep the keyboard open after desktop submissions for consecutive entry.

---

## 8. Testing and definition of done

### Capture tests
- Title-only task saves successfully.
- Whitespace-only title is rejected without losing the user's input.
- Enter submits on desktop.
- Shortcuts do not fire while typing in other fields.
- Rapid submissions do not create accidental duplicates.
- Failed saves preserve the draft and show a retry path.
- Mobile keyboard does not obscure the input or submit control.

### Companion tests
- Ranking function: unit tests for each row of the scoring table, ties, size lead-time boost, no-date fallback.
- At most one daily nudge and one re-ping per day; none on days with nothing to surface.
- Re-ping only when the task is due today or missed and the nudge was not tapped; never after 10:15 PM.
- Basic task schedules one details prompt for 1 hour later; cancelled when it becomes complete (3 or more fields), completed, or removed.
- Details prompts are batched, capped at 2 per day, silent, and deferred out of quiet hours.
- Ignored days do not disable the companion; the next day sends normally.
- Sunday sends the weekly summary instead of the daily nudge.
- Permission: browser prompt appears only after tapping Yes on the in-app card.

### Sync tests
- Android-created tasks appear on Windows.
- Edits, completion, deletion, and restoration sync both ways.
- Reconnection refreshes current state.
- Concurrent edits do not silently erase newer data.

### Reminder tests
- Two-day, one-day, and due-time reminders are scheduled correctly.
- Editing a due date invalidates old pending reminders.
- Completing or deleting a task cancels future reminders.
- Duplicate scheduler invocations do not create duplicate processing.
- Failed push attempts are recorded and retried appropriately.
- Quiet hours behave as configured.
- Each device's subscription can be independently revoked.

### Security tests
- User A cannot read, update, or delete User B's tasks.
- Client code does not contain privileged secrets.
- Notification action handlers validate task ownership.

### Platform tests
- Install and use on Android Chrome.
- Install and use on Windows Chrome or Edge.
- Test with app open, backgrounded, and closed.
- Test permission denied, permission granted, expired subscription, and offline state.
- Document platform-specific notification limitations.

---

## 9. Development roadmap (phases)

Build the base first, then add each layer only when the previous one works.

### Phase 1: Base (useful task manager)
- Project setup, responsive shell, Supabase auth and RLS.
- Task CRUD with soft deletion and restoration.
- One-field quick add with the optional tap chips (When, Size, Important, Label); database columns for all of them from day one.
- Inbox, Today (list only), Later, Done.
- Basic cross-device sync.

**Exit condition:** tasks can be captured and managed on Android and Windows, and a title-only task takes one entry and one tap or Enter.

### Phase 2: Installable app and views
- Manifest, icons, installability, service worker.
- Today "one thing" card (static ordering at first), 7-day strip, This week view, two-pane layout on laptop.
- Keyboard-first desktop flow and thumb-friendly mobile capture.
- Clear offline/read-only status.

**Exit condition:** installed on both devices; capture is fast and the day and week views are clear.

### Phase 3: Reminders and companion
- `task_reminders`, Supabase Cron, Edge Function dispatcher, VAPID, push subscriptions, atomic claims, retries.
- Explicit due-date reminders with Done / Remind me later actions; quiet hours.
- Ranking function and the daily nudge with re-ping, Skip today, and ignored-day behavior.
- Two-step permission flow. Sunday weekly summary.

**Exit condition:** a nudge arrives while the app is closed on each supported platform, picks a sensible task, and never exceeds the notification budget.

### Phase 4: Voice capture
- Whisper speech-to-text in a Web Worker (Section 2A), mic button, Undo/Edit toast, "Add by voice" manifest shortcut.

**Exit condition:** a task can be added by voice with one tap plus speaking.

### Phase 5: Quick details (audit of basic tasks)
- Basic-task detection, one-hour details prompt (silent, batched, capped), Today card.
- Quick details review: one task at a time, with optional When, Size, Important, Label, and Repeat choices plus Skip and Done. Repeat presets should cover daily, weekdays, weekly, and monthly; default to Never and keep the title-only capture path untouched.
- A recurring task completes its current occurrence and creates the next dated occurrence, so Done history stays meaningful and mistakes can be restored.
- Plain-language wording pass over every label.

**Exit condition:** a title-only task gets exactly one gentle follow-up, and complete tasks never do.

### Phase 6: Extras (only if they earn their keep)
- Android widget or native wrapper, PWA share target, conservative natural-language dates.
- Offline writes only after conflict handling is designed.
- Google Calendar (read-only), email-to-task, export and backup improvements.
- Optional AI-assisted parsing with explicit confirmation.

**Exit condition:** every addition saves more effort than it adds in complexity.

---

## 10. AI-assisted development workflow

Use an AI coding assistant in VS Code, but ask it to work in small, reviewable increments.

For each change:
1. Ask it to inspect the existing project before editing.
2. Give it one bounded task.
3. Ask for the list of files it plans to change.
4. Require database migrations and RLS policies for schema changes.
5. Ask it to explain security-sensitive code and environment variables.
6. Run tests and inspect the diff.
7. Test the feature manually before moving to the next phase.
8. Commit working phases to Git.

### Voice coding prompt (use at Phase 4)

> Implement Phase 4 from `plan.md` only. Add an in-field mic button that records audio, detects silence to stop, and transcribes on-device with Whisper through `@huggingface/transformers` in a Web Worker (WebGPU if `navigator.gpu` gives an adapter, WASM otherwise). Save the transcript as a title-only task in Inbox and show an Undo/Edit toast. Handle permission denied, no speech, model still downloading, and transcription errors without losing the user's ability to type. Use shadcn/ui components and plain-language labels. Do not add text-to-speech, cloud speech APIs, or AI task interpretation. Summarize the plan and files first, then give exact manual verification steps for Android Chrome and Windows Chrome/Edge.

### Companion coding prompt (use at Phase 3)

> Implement Phase 3 from `plan.md` only (Section 6 and 6A). Add `task_reminders`, a Supabase Cron-triggered Edge Function dispatcher with atomic claims, VAPID Web Push, and subscription management. Implement the ranking function exactly as the scoring table in Section 6A, with the constants in one file and unit tests for every row. Implement the daily nudge (default 6:30 PM, user-editable), one silent re-ping about 3 hours later only for due-today or missed tasks, Skip today, Sunday weekly summary, quiet hours, and the two-step permission flow. Respect the notification budget table; never send more than the limits. Do not add voice, AI, or the details prompt yet. Show the plan and files before editing, add versioned SQL migrations with RLS, and give exact manual verification steps.

### First coding prompt

> Inspect this repository and implement Phase 1 only from `plan.md`. Use React, TypeScript, Vite, Supabase Auth, PostgreSQL, and RLS. Prioritize a one-field, title-only quick-add workflow that does not require a date, size, importance, label, or reminder, with the optional tap chips from Section 1.3A. Implement the responsive shell, task CRUD, soft deletion/restoration, and Inbox/Today/Later/Done views, including the size, is_important, and label columns. Do not implement push notifications, AI, calendar integration, or offline writes yet. Create versioned SQL migrations and document required environment variables. Before editing, summarize the plan and files to change. After implementation, run the available tests and provide exact manual verification steps. Do not claim completion for untested behavior.

---

## Product success criteria

The product is successful if the user trusts it enough to capture tasks immediately and stops thinking about how to operate the tool.

Optimize for:
1. **Low capture friction** — title-only entry works everywhere.
2. **Low interruption** — no mandatory organization or intrusive prompts.
3. **Trust** — saves and synchronization are reliable.
4. **Reminder correctness** — alerts are timely, relevant, and cancellable.
5. **Recoverability** — accidental deletion, failed saves, and sync errors are recoverable.
6. **Progressive complexity** — advanced features appear only when requested.

7. **Companion usefulness** — the daily nudge picks a task you agree with, arrives at most as often as the budget allows, and gets you back into the app without guilt.

**Non-negotiable principle:** never make task organization a prerequisite for remembering the task.
