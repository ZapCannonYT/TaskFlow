# Taskflow — Architecture

This file explains how Taskflow is built and how its parts fit together. For setup and deployment, see `README.md`.

---

## 1. The goal in one sentence

Add a task in seconds (typing or speaking), and have the app quietly bring you back with the one thing worth doing next.

Three rules decide almost every design choice below:

1. **Capture now, organize later.** Only the title is required.
2. **Fix after, never ask before.** Undo toasts instead of "Are you sure?" dialogs.
3. **Add machinery only when a real need appears.** No extra servers, no AI APIs (voice transcription is the one exception, see Section 5), no integrations in the first versions.
4. **Companion, not nag.** Few notifications, mostly silent, never switched off for being ignored.

---

## 2. Big picture

```
┌─────────────────────────── YOUR DEVICES ───────────────────────────┐
│  Android phone (PWA)                      Windows laptop (PWA)      │
│                                                                      │
│  ┌──────────────────────────── React app ────────────────────────┐  │
│  │  UI screens:  Today · Inbox · Later · Done · Quick details    │  │
│  │  Capture:     [ Add a task…            mic ]                  │  │
│  │                         │                │                    │  │
│  │                    typed text      audio from mic             │  │
│  │                         │                │                    │  │
│  │                         │       ┌────────▼─────────┐          │  │
│  │                         │       │ Cloud STT        │          │  │
│  │                         │       │ /api/transcribe  │          │  │
│  │                         │       │ Fallback: on-    │          │  │
│  │                         │       │ device Moonshine │          │  │
│  │                         │       └────────┬─────────┘          │  │
│  │                         └────────┬───────┘ text               │  │
│  │                                  ▼                            │  │
│  │                         Supabase client (JS)                  │  │
│  └──────────────────────────────────┼────────────────────────────┘  │
│  Service worker: receives push, shows notification, handles         │
│  "Complete" / "Remind me later" buttons                             │
└──────────────────────────────────────┼───────────────────────────────┘
                                       │ HTTPS (login token on every call)
┌──────────────────────────────────────▼───────────────────────────────┐
│                              SUPABASE                                │
│  Auth ── Postgres (tasks, labels, task_reminders,                    │
│          push_subscriptions, user_preferences)                       │
│          ── Row Level Security ── Realtime                           │
│                                                                      │
│  Cron (every minute) ──► Edge Function: reminder-dispatcher          │
│                              │  checks the notification budget,      │
│                              │  ranks tasks, claims the reminder,    │
│                              │  respects quiet hours, sends Web Push │
│                              ▼                                       │
│                       Push service (Google / Microsoft)  ──► devices │
│                                                                      │
│  Edge Function: task-action (Complete / Remind-later from a          │
│                              notification; verifies who you are)     │
└──────────────────────────────────────────────────────────────────────┘
```

If you think in networking terms: the app is the client, Supabase is the server and database, and the push service is a relay that can wake your device even when the app is closed.

---

## 3. The layers, explained

### 3.1 Client: React PWA
- **PWA** = a website you can install like an app (home-screen icon, own window, works with a service worker). One codebase serves Android and Windows.
- **UI**: React + TypeScript + Vite, Tailwind for styling, **shadcn/ui** for ready-made accessible components (inputs, buttons, toasts, checkboxes). Details in Section 7.
- **State**: keep it simple. Components read tasks from Supabase and subscribe to changes; no Redux.
- **Service worker**: a small background script. It exists mainly for push notifications and for caching the app shell. It is the only thing that can react when the app is closed.

### 3.2 Voice: cloud speech-to-text with an on-device fallback
See Section 5 for the full flow. The main path is a Cloudflare Worker endpoint (`POST /api/transcribe`) running Workers AI Whisper; the on-device Moonshine model is the fallback.

### 3.3 Backend: Supabase (managed Postgres plus extras)
- **Postgres** is the single source of truth. Phone and laptop never talk to each other; both talk to the database.
- **Auth** gives each request a signed login token.
- **Row Level Security (RLS)** is a database rule: "a row is only visible/editable if `user_id` equals the logged-in user." Even if the frontend has a bug, user A cannot read user B's tasks. This is why the app needs no custom server.
- **Realtime** pushes database changes to open clients, so a task added on the phone appears on the laptop without refresh.

### 3.4 Scheduling and delivery
- **Cron** wakes an **Edge Function** (a small serverless function) on a schedule.
- The function sends **Web Push** using VAPID keys (a keypair identifying your server to the push services). The private key stays server-side only.

### 3.5 Edge: Cloudflare Worker
- The app is deployed as a Cloudflare Worker that serves the static build and the `POST /api/transcribe` endpoint (`src/cloudflare-worker.ts`).
- The Worker holds an `AI` binding for Workers AI and only public values (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) under `vars` in `wrangler.jsonc`.
- Before running any model, it verifies the caller's Supabase login token through Supabase Auth. No private key lives in the Worker.

---

## 4. Data model

| Table | Purpose | Key fields |
|---|---|---|
| `tasks` | Every task | `title` (required), `notes`, `status`, `due_at`, `is_all_day`, **`size`** (`quick`/`hour`/`big`), **`is_important`**, **`label_id`**, `details_prompted_at`, `completed_at`, `deleted_at` (soft delete = Undo works) |
| `labels` | Small per-user list of labels | `name`; one label per task, no nesting |
| `task_reminders` | One row per planned reminder or nudge | `scheduled_at`, `kind` (`advance` / `due` / `daily` / `daily_repeat` / `weekly` / `details_prompt`), `status`, `delivered_via`, `attempt_count` |
| `push_subscriptions` | One row per device allowed to get push | endpoint, public keys, `disabled_at` |
| `user_preferences` | Settings with sensible defaults | timezone, nudge time (default 6:30 PM), quiet hours (default 10:30 PM to 8 AM), weekly day, default reminder offsets |

Why these choices:
- **Soft delete** (`deleted_at` instead of removing the row) is what makes "Remove → Undo" trivial and safe.
- **A reminder is its own row** (not a field on the task) so one task can have several, and each can be claimed, retried, cancelled, or rescheduled independently.
- **`kind`** tells the dispatcher which copy, sound, and budget rules apply (a silent `details_prompt` is treated very differently from a normal `daily` nudge).
- **`size`, `is_important`, `label_id`** are plain columns, not stored scores. The ranking is computed fresh each time from these and the due date, so changing a task instantly changes what gets recommended.
- **`delivered_via`** records which channel actually delivered a reminder, so the same reminder is never shown twice (once by push, once in the app).
- **Custom reminder offsets** let a task reminder be set to "Custom…" with a number and a unit (minutes, hours, or days). The choice is stored as `reminder_offset = 'custom'` with the length in `reminder_minutes` (1 to 40320, that is 28 days). Migration `supabase/migrations/20261026000000_custom_reminder.sql` adds the column and constraints and updates the `sync_task_reminder` trigger. It must be applied with `supabase db push`.

Every table has RLS on. Secrets (service-role key, VAPID private key) live only in Edge Function environment variables, never in `VITE_` variables.

---

## 5. Voice capture (speech-to-text)

### 5.1 Cloud first, on-device fallback
- **Main path: cloud.** The Worker endpoint `POST /api/transcribe` runs the open-source **OpenAI Whisper** model `@cf/openai/whisper-large-v3-turbo` on Workers AI, called through the `AI` binding declared in `wrangler.jsonc` (`"ai": { "binding": "AI" }`). Workers AI has a free daily allowance on Cloudflare's Workers plan, so there is no per-use cost within that allowance.
- **Fallback: on-device.** The existing on-device **Moonshine** model handles transcription only when the endpoint is unavailable (for example under plain `npm run dev`, which has no Worker) or fails. It loads lazily when it is needed, not at startup.
- **Privacy.** On the cloud path, audio is sent to Cloudflare for transcription. On the fallback path, audio stays on the device.
- The browser's built-in Web Speech API is still **not** used: it is not open source and can send audio to a third-party server.

### 5.2 Step-by-step flow
1. User taps the mic button in the quick-add field (first time only: the browser asks for mic permission).
2. The app records the whole utterance, using voice activity detection to end it after about 2 seconds of silence, or at 60 seconds at most.
3. The recording is encoded as **mono, 16 kHz WAV** (`src/features/voice/cloudTranscribe.ts`), the format Whisper expects.
4. The app sends the WAV to `POST /api/transcribe` with the user's Supabase access token as `Authorization: Bearer ...`. Requests over about 2.2 MB are rejected.
5. The Worker (`src/cloudflare-worker.ts`) verifies the token by calling `{SUPABASE_URL}/auth/v1/user` with the publishable key, then runs Whisper through the `AI` binding and returns the text.
6. If the request fails or the endpoint is unavailable, the app transcribes on the device with Moonshine instead. That runs in a **Web Worker**, a background thread, so the screen never freezes.
7. The text is saved as a title-only task in Inbox.
8. A toast shows `Added "buy USB-C cable"` with **Undo** and **Edit**.

Mistakes are expected (accents, noise), so correction is cheap: Undo or Edit, no dialogs.

### 5.3 Original on-device sketch (background only)
The shipped fallback uses Moonshine rather than the Whisper setup below. The sketch is kept only as background on the original design.

```ts
// worker.ts
import { pipeline } from "@huggingface/transformers";

const device = (await navigator.gpu?.requestAdapter()) ? "webgpu" : "wasm";
const asr = await pipeline(
  "automatic-speech-recognition",
  "onnx-community/whisper-base.en",   // or whisper-tiny.en on weak phones
  { device }
);

self.onmessage = async (e) => {
  const { audio } = e.data;            // Float32Array, mono, 16 kHz
  const { text } = await asr(audio);
  self.postMessage({ text: text.trim() });
};
```

Check the exact model names and API in the current Transformers.js docs when implementing; model IDs and options change.

### 5.4 Known limits
- **Connection and sign-in**: the cloud path needs a connection and a valid Supabase login token. Requests over about 2.2 MB are rejected; the 60-second cap keeps recordings below that size.
- **Quota**: cloud calls count against the Workers AI free daily allowance. If a request fails for any reason, including an exhausted allowance, the fallback is used.
- **Local testing**: plain `npm run dev` has no Worker. Use `npm run build` then `npx wrangler dev` (requires `npx wrangler login`). Workers AI bindings always call Cloudflare remotely and count against the allowance.
- **Fallback first use** downloads the Moonshine model the first time it is needed. Keep typing fully usable meanwhile.
- **Speed of the fallback** on your phone is unknown until measured.
- **Language**: Whisper large-v3-turbo is multilingual, so the cloud path covers more languages than the fallback. The fallback covers whatever the Moonshine model in use supports.
- **Always works fallback**: the Android keyboard's own mic button. Taskflow does not need to do anything for this to work.

### 5.5 "Add by voice" from the home screen
The app manifest can declare a **shortcut**. Long-pressing the installed app icon on Android shows "Add by voice", which opens the app with the mic ready. The browser may still need one tap before recording starts; test this on your device.

---

## 6. The companion: reminders that bring you back

### 6.1 What it is
Two kinds of notification exist: **reminders you set** on a task (due-time alerts), and **companion messages** the app sends on its own. The companion exists for one reason: so you don't add tasks and forget the app for days. It is deliberately small.

### 6.2 The notification budget
| Notification | When | Sound | Limit |
|---|---|---|---|
| Daily nudge | Once a day, default 6:30 PM (you can change it) | Normal | 1 per day; skipped if nothing to surface |
| Urgent re-ping | About 3 hours later, never after 10:15 PM | Silent | 1 per day; only if the task is due today/missed and the nudge was not tapped |
| Details prompt | 1 hour after a basic task is added | Silent | Batched; max 2 per day |
| Your own reminders | Whatever you set | Normal | As configured |
| Weekly summary | Sunday evening | Normal | Replaces that day's daily nudge |

Quiet hours (10:30 PM to 8 AM by default) always win.

### 6.3 Choosing the one task (the ranking function)
A small pure function `rankTasks(tasks, now)` returns the best task plus a reason. It adds points from plain signals:

- Missed: 100 (+1 per day overdue, up to 20). Due today: 80. Tomorrow: 50. In 2 to 3 days: 30. In 4 to 7 days: 15.
- Important: +25.
- **Size boost:** a **Big** task due within 2 days gets +40 (it needs lead time, so "start now"). An **hour** task due within a day gets +15. Unset size counts as an hour.
- No date: 0, plus 1 per day untouched (up to 10), only when nothing dated is open.

Highest score wins; ties go to the oldest task. The notification shows the reason ("Big task, due Friday") so the pick never feels random.

Why not vectors or AI? Ranking needs only a few numbers, and a formula you can read and test beats a model you can't explain. (Embeddings are for "which tasks mean the same thing", which is a different problem and a possible later extra.)

Constants live in one file with a unit test per rule, so tuning is a one-line change.

### 6.4 Wording
Direct and plain, no mascot or chatter:
- `Do now: Submit lab report · due today`
- `Start today: Project report · Big, due Friday`
- `Next up: Buy USB-C cable · 3 more`

Buttons on the nudge: **Done**, **Later**, **Skip today**.

### 6.5 Flow (step by step)
1. Cron runs the dispatcher every minute.
2. For each user it checks the budget: is a nudge due now, has today's limit been reached, are we in quiet hours?
3. It calls the ranking function, builds the message, and **atomically claims** the reminder row so no two runs send it twice.
4. It sends Web Push. The service worker shows it with the actions.
5. Tapping an action calls `task-action`, which verifies your login and that the task is yours (a push payload is never trusted as identity).
6. If you tap or complete something, the re-ping is cancelled. If both are ignored, the day ends quietly and tomorrow starts normally.

### 6.6 Ignored nudges
The companion **never turns itself off**. Ignoring today changes nothing about tomorrow. The one re-ping is the only repeat, and it only exists for urgent tasks.

### 6.7 The details prompt (audit of basic tasks)
- Every task has four optional fields: When, Size, Important, Label.
- **Basic** = 0 to 2 of them set. **Complete** = 3 or more.
- On creating a basic task, a `details_prompt` reminder is scheduled one hour out. It is cancelled if the task becomes complete, is completed, or is removed.
- It arrives silently (and as a card on Today), is batched if several tasks qualify, and opens **Quick details**: one task at a time with tap chips and a Skip button.
- Complete tasks are never prompted, so people who fill in details are never nagged.

### 6.8 Permission, the polite way
Browsers make a denied permission hard to undo, so Taskflow asks twice: first its own one-line card after your first saved task ("Want a daily nudge so nothing slips?" Yes / Not now). Only **Yes** shows the real browser prompt. "Not now" re-offers once after about 3 days.

### 6.9 Honest limits
- Web Push on Android Chrome and Windows Chrome/Edge works with the app closed, but delivery is best-effort and battery savers can delay it.
- The system is at-least-once: a rare duplicate is possible; the claim logic keeps it rare.
- "Silent" notifications depend on the platform's notification channel settings; test on your phone.

---

## 7. UI: how to make it extremely intuitive

### 7.1 Use templates, don't invent
Start from existing open-source building blocks and layouts:
- **shadcn/ui** (free, open source): Input, Button, Checkbox, Toast, Dialog. Copy components into your project and restyle.
- **Todo list "minimal" and "quick add" layouts** on the shadcn.io blocks site: a borderless list with one add input is almost exactly our Inbox. Note shadcn.io says it is not affiliated with the official shadcn/ui, so check each block's license before copying code. Treat them as visual references if unsure.
- **Open-source task apps** (for example Vikunja, Super Productivity) are good to *study*: see which screens they simplify and which they bury. Don't copy their complexity.

Steps: scaffold with Vite, install shadcn/ui, build the Inbox from a minimal-list reference, then delete anything that isn't the add field, the list, or a checkbox.

### 7.2 Principles, with the reason behind each

| Principle | What it means here | Why it works |
|---|---|---|
| **One primary action** | The add field is the biggest thing on screen | People never wonder "what do I press?" |
| **Progressive disclosure** | Date, reminder, notes appear only after tapping a task | Hides options you don't need 95% of the time |
| **Recognition over recall** | Buttons say what they do ("Remind me later"), not icons or jargon | Nothing to remember or decode |
| **Forgive, don't confirm** | Remove, Done, and voice adds all show Undo toasts | Fast path stays fast, mistakes stay cheap |
| **Thumb zone** | On phone, the add field and main buttons sit near the bottom | Reachable one-handed |
| **Sensible defaults** | New task = Inbox, no date, normal priority | You decide nothing to save |
| **Consistency** | Same row layout and same buttons everywhere | You learn it once |
| **Visible state** | Offline, saving, and "voice ready" shown quietly | You trust it without checking |

### 7.3 Plain-language wording
| Avoid | Use |
|---|---|
| Snooze | Remind me later |
| Due date | When |
| Priority | Important |
| Overdue | Missed |
| Delete / archive | Remove (with Undo) |
| Backlog / triage | Inbox / Quick details |
| "Set recurrence rule" | "Repeat" (when added later) |

Rule of thumb: if a friend would need to ask what a word means, replace it.

### 7.4 Screens
- **Today / Inbox / Later / Done**: four plain tabs, same row design in each.
- **Add field + chips (composer)**: top on laptop, bottom on phone, mic inside the field (Phase 4). The first row shows only **When**, **Size**, and **Time**. Once any of them is set, a second row appears with **Reminder**, **Label**, **Repeat**, **Important**, and an **Add note** button for the description. Tapping is optional; Enter always saves.
- **Today**:
  - phone: one column. A big **"one thing"** card on top (the ranking function's pick, with Done / Later), a 7-day strip, then the day's list. A **This week** option groups the week by day.
  - laptop: two panes, **Today** on the left and **This week** on the right.
- **Day schedule**: the time axis stretches where a task needs more room than its duration gives it, so titles are not clipped. Side-by-side columns are capped at 2 on narrow screens and 3 on wide ones, and crowded tasks show only the first few words of the title. Layout logic is `layoutDay` in `src/features/today/dayLayout.ts`.
- **Why this layout?** Todoist's phone apps use a strip of days you swipe through and don't offer columns in Upcoming; Singularity's phone default is a one-week row of day tabs. Columns are cramped on a phone, so the phone gets one column plus a day strip, and the laptop has room for two panes.
- **Task row**: checkbox, title, small chips only for fields that are set. Tap a row to reveal inline details. No modals.
- **Quick details** (the audit, only for basic tasks): one task per screen, chips for When / Size / Important / Label / Repeat, plus **Skip** and **Done**. Repeat is optional, defaults to Never, and offers daily / weekdays / weekly / monthly. Completing a repeating task closes this occurrence and creates its next dated occurrence; it is never required to save or review a task. Reached from the Today card or the details prompt.

### 7.5 A quick usability test you can run yourself
1. Hand your phone to a friend with the app open; say "add: buy milk." Time it. Target: a few seconds, no hesitation.
2. Add a title-only task and wait an hour. Does the silent "Add details?" prompt make sense, and can they finish Quick details in a few taps?
3. Wherever they hesitate, rename or remove something. Repeat.

### 7.6 Motion setting
- Settings has a **Motion** option: **Full animations** (the default), **Reduced**, or **Follow system**.
- The choice is stored per device in `localStorage` under `taskflow:motion` (`src/lib/motion.ts`) and applied as `data-motion` on the `html` element.
- Reason: on Windows with "Animation effects" turned off, Chrome, Edge, and Helium report `prefers-reduced-motion`. Before this setting, that flag disabled every animation on PC. Because Full animations is the default, the system flag no longer does that unless a user picks Reduced or Follow system.

---

## 8. Sync and offline

- Writes go to Postgres; Realtime updates other devices; the app also refetches when it regains focus or reconnects.
- Version 1 requires a connection to save, and says so clearly rather than silently failing. A failed save keeps your typed or spoken text.
- Offline capture (queue in IndexedDB, retry later) comes later, only after conflict rules are designed.
- Voice transcription uses the cloud endpoint when it is reachable. When it is not, the on-device Moonshine model transcribes instead, and that works offline once the model is cached. Saving still needs a connection.

---

## 9. Security checklist
- RLS on every user table; test that user A cannot touch user B's rows.
- No privileged keys in client code.
- `task-action` verifies the login token and task ownership on every call.
- `/api/transcribe` verifies the Supabase login token through Supabase Auth before it runs the model. The Worker holds only public values.
- Validate input at the database (title trimmed and non-empty).
- Offer data export before relying on the app as your only task store.

---

## 10. Suggested project layout

```
taskflow/
├─ src/
│  ├─ components/          # AddTask, TaskRow, TaskList, OneThingCard, UndoToast
│  ├─ components/ui/       # shadcn/ui components
│  ├─ features/
│  │  ├─ tasks/            # queries, mutations, realtime subscription
│  │  ├─ voice/            # recorder, silence detection, cloudTranscribe.ts, on-device fallback worker, useVoiceCapture
│  │  ├─ reminders/        # defaults, preset labels, permission card
│  │  ├─ companion/        # rankTasks(), nudge copy, basic-task check
│  │  └─ quick-details/    # one-task-at-a-time detail chips
│  ├─ lib/motion.ts        # motion preference: Full, Reduced, or Follow system
│  ├─ lib/supabase.ts
│  ├─ cloudflare-worker.ts # POST /api/transcribe (Workers AI Whisper)
│  ├─ sw.ts                # service worker (push, notification actions)
│  └─ main.tsx
├─ supabase/
│  ├─ migrations/          # versioned SQL (tables, RLS, indexes)
│  └─ functions/
│     ├─ reminder-dispatcher/   # budget rules, ranking, claims, push
│     └─ task-action/
└─ architecture.md
```

---

## 11. Product implementation phases

1. **Phase 1, Base:** tasks, login, RLS, one-field add with tap chips, Inbox / Today / Later / Done, sync. Size, Important, and Label columns exist from day one.
2. **Phase 2, Installable app and views:** PWA, one-thing card, 7-day strip, This week, two-pane laptop layout.
3. **Phase 3, Reminders and companion:** push pipeline, explicit reminders, ranking function, daily nudge and re-ping, permission flow, Sunday summary.
4. **Phase 4, Voice capture:** mic button, Undo/Edit toast, "Add by voice" shortcut, on-device speech model. Cloud-first transcription was added later (see Section 5).
5. **Phase 5, Quick details:** basic-task detection, one-hour details prompt, Quick details screen, wording pass.
6. **Phase 6, Extras:** widget, share target, offline writes, integrations (only if they earn their keep).

---

## 12. Decisions and open questions

**Decided**
- Speech-to-text only. Cloud transcription (Workers AI Whisper) comes first, with an on-device Moonshine fallback that loads only when needed.
- Voice tasks auto-save with an Undo/Edit toast (fix after, never ask before).
- Companion is a quiet helper: direct wording, no mascot, no streaks or scores.
- One daily nudge (default 6:30 PM, editable) plus one silent re-ping only for urgent tasks; it never turns itself off.
- Ranking is a readable formula over due date, Important, and Size. No vectors, no AI.
- Four optional tap fields (When, Size, Important, Label). 0 to 2 set means basic; 3 or more means complete.
- Basic tasks get one silent details prompt an hour after creation; complete tasks never do.
- Phone: one column with a day strip. Laptop: Today and This week side by side.
- Phase order: base, installable app and views, reminders and companion, voice, quick details, extras.

**To verify on your devices**
- Does the on-device fallback run fast enough on your Android phone? Check how often it is used in practice.
- Does the "Add by voice" shortcut start the mic without an extra tap?
- Do background push notifications, including the silent ones, behave as expected with your phone's battery settings?
- Is the default scoring table right for how you actually work? Tune the constants after a week of real use.
- Is cloud transcription accurate enough for your speech, and is the Workers AI daily allowance enough for regular use?
