# Taskflow

Taskflow is a responsive, installable React app backed by Supabase Auth and Postgres. It includes task capture, Inbox/Today/This week/Done views, per-user labels, soft delete/restore, live updates between open clients, explicit due-date reminders, and an optional daily companion nudge. Task ranking is deterministic and uses documented rules; it does not use AI. Voice capture transcribes in the cloud through Cloudflare Workers AI and falls back to an on-device model.

## Run locally

1. Create a Supabase project.
2. In its SQL editor, run the Phase 1 migration if you have not already. For Phase 3, follow the ordered setup below: deploy the functions and set secrets, run the schema migration, add Vault values, then install the separate scheduler migration. This prevents cron from calling an unconfigured endpoint. Also apply `20261022020000_phase4_voice_phase5_quick_details.sql`, `20261024000000_phase5_recurrence.sql`, `20261024010000_phase6_descriptions_inbox_audit.sql`, and `20261025000000_phase7_inbox_and_reminders.sql` in order. Also apply `20261026000000_phase7_custom_reminder.sql` with `supabase db push` (see Custom reminders below). Finally apply `20261027000000_phase8_recurrence_dedupe.sql` and then `20261028000000_phase9_inbox_digest.sql` (see Inbox digest below).
3. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and (after Phase 3 push setup) `VITE_VAPID_PUBLIC_KEY`. The VAPID public key is safe in the browser; never put a secret, VAPID private key, dispatch token, or service-role key in a `VITE_` variable.
4. Install and start:

   ```sh
   npm install
   npm run dev
   ```

For a production build and automated tests, run `npm run build` and `npm test`.

Cloud voice is served by the Cloudflare Worker, so plain `npm run dev` has no `/api/transcribe` endpoint and voice uses the on-device fallback. To test cloud voice locally, run `npm run build` and then `npx wrangler dev`. Run `npx wrangler login` first. Workers AI calls always run on Cloudflare and count against the account's daily allowance.

## Deployment

Cloudflare Workers deployment: connect the GitHub repository under **Workers & Pages → Create application → Workers → Connect to Git**. Set the build command to `npm run build`, production deploy command to `npx wrangler deploy`, and preview deploy command to `npx wrangler preview`; `wrangler.jsonc` configures the built `dist` assets and enables branch previews. Use `main` as the production branch and `dev` as a preview branch. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and (when push is configured) `VITE_VAPID_PUBLIC_KEY` as build variables. These `VITE_` values are public in the browser; never add private keys or dispatch secrets to Cloudflare. Preview builds use the configured build variables, so use a test Supabase project if preview task writes should be isolated from production. `wrangler.jsonc` also declares the `AI` binding (`"ai": { "binding": "AI" }`) for Workers AI, plus the public `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values under `vars` that the `/api/transcribe` endpoint uses to verify login tokens. Point these at the same Supabase project as the `VITE_` values. Workers AI has a free daily allowance on Cloudflare's Workers plan. Apply the Supabase migrations and deploy the Edge Functions before deploying frontend changes that depend on them. Add the deployed HTTPS origin to Supabase Auth's allowed redirect URLs. The app and matching ONNX Runtime WASM assets are deployed together; the smaller threaded WASM build stays within Cloudflare's per-asset size limit. The manifest and service worker cache only the static app shell and versioned front-end assets. Task and Supabase API data are not cached; offline use is read-only for data already loaded in the open tab, and writes require a connection.

On supported Chrome versions, use the **Install app** button when it appears in Taskflow. If Chrome does not show that button, open the browser menu and choose **Install Taskflow** (Windows) or **Add to Home screen** (Android). The install prompt is browser-controlled and may not appear until the site meets the browser's install criteria.

## Environment variables

| Name | Purpose | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project endpoint | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable client key; RLS protects data access | No |
| `VITE_SUPABASE_ANON_KEY` | Legacy public key for older projects | No |
| `VITE_VAPID_PUBLIC_KEY` | Public push key used to subscribe this browser | No |
| `SUPABASE_URL` (Worker `vars` in `wrangler.jsonc`) | Supabase endpoint used by `/api/transcribe` to verify login tokens | No |
| `SUPABASE_PUBLISHABLE_KEY` (Worker `vars` in `wrangler.jsonc`) | Publishable key used by `/api/transcribe` to verify login tokens | No |

## Phase 3 push setup

Web Push requires a matching VAPID key pair. Generate one locally with `npx web-push generate-vapid-keys`. Put the **public** key in `.env` as `VITE_VAPID_PUBLIC_KEY`. The private key, subject (for example `mailto:you@example.com`), and a separate long random dispatch secret belong in Supabase Edge Function secrets. Never put the private key or dispatch secret in Cloudflare, `.env`, or browser code.

From a terminal at the project root, install the [Supabase CLI](https://supabase.com/docs/guides/cli), link it to your project, and deploy the two Edge Functions:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy companion-dispatch
supabase functions deploy test-push
```

In Supabase **Edge Function Secrets**, add `TASKFLOW_VAPID_PUBLIC_KEY`, `TASKFLOW_VAPID_PRIVATE_KEY`, `TASKFLOW_VAPID_SUBJECT`, and `TASKFLOW_DISPATCH_SECRET`. Keep the VAPID private key and dispatch secret out of chat, source files, and Cloudflare. Set the public key value to the same one used in local `.env`.

In the SQL editor, run `supabase/migrations/20261022000000_phase3_reminders.sql` after Phase 1. In Supabase Vault, add three secrets with these exact names: `taskflow_project_url` (your project URL), `taskflow_publishable_key` (the public publishable key), and `taskflow_dispatch_secret` (the same value as the Edge Function secret).

Run `supabase/migrations/20261022010000_phase3_schedule_dispatch.sql` in the SQL editor after saving the Vault values. That final migration schedules `companion-dispatch` once per minute through Supabase Cron. The schema migration enables Supabase's `pg_cron`, `pg_net`, and Vault extensions. Check **Integrations → Cron** and **Edge Functions → Logs** if delivery does not occur.

For Cloudflare Pages, set `VITE_VAPID_PUBLIC_KEY` as a build environment variable for the production and preview environments. The private VAPID key and dispatch secret stay only in Supabase Edge Function secrets.

In Taskflow, create at least one task, choose **Yes** on the optional daily-nudge invitation, then use **Settings → Send test notification**. A browser permission prompt appears only after choosing Yes or turning the daily nudge on in Settings. Explicit reminders are optional and appear after opening a task with a specific date.

## Recurrence, descriptions, and audit Inbox

Recurring tasks can be set to daily, weekdays, weekly, or monthly from the add-task details, Quick details, or task editor. Completing an occurrence creates the next future occurrence, even when the prior task was completed late; Undo removes that next occurrence and reopens the completed task. The next occurrence is scheduled on its own day and does not go to Inbox. Each repeat may have only one open occurrence at a time (migration `20261027000000_phase8_recurrence_dedupe.sql`). Monthly repeats preserve the original day of the month when possible (for example, a task on the 31st moves to the last day of shorter months). Descriptions are available when adding or editing a task.

The task audit checks seven detail categories: an exact date, size, importance, label, recurrence, description, and reminder. Tasks with three or fewer selected categories stay in Inbox. Once a task has at least four categories and has not changed for 1.2 seconds, it leaves Inbox and moves to the view matching its due date. Due dates and times remain saved while the task is in Inbox. The audit card offers the full set of date/time, size, importance, label, recurrence, reminder, and description controls. Apply migration `20261024010000_phase6_descriptions_inbox_audit.sql` and then `20261025000000_phase7_inbox_and_reminders.sql` before deploying this frontend or Edge Function.

Task titles can include explicit dates and times such as `Call Sam tomorrow at 3pm`, `Review notes next Monday`, `Pay rent on Oct 24`, or `Submit report at 15:30`. Taskflow puts the date/time in the deadline fields and saves only the remaining title. Installed PWAs can also receive shared text or a link through the system Share menu. Export and restore are available in **Settings**. Offline task writes remain disabled until a conflict policy is designed.

## Inbox digest

Each new Inbox capture schedules one Inbox digest an hour later. A later capture pushes that digest back to an hour after the newest capture. There is at most one digest per user per day (dedupe key `inbox-digest:<user>:<local day>`). When it is due, `companion-dispatch` builds the text at send time: "N tasks in Inbox" with the first two titles. If Inbox is clear, the digest is skipped. The notification is silent, and tapping it opens the app at `/?open=inbox`.

Apply `supabase/migrations/20261028000000_phase9_inbox_digest.sql`. It also cancels the old queued per-task "add details" prompts. Then redeploy the function:

```sh
supabase functions deploy companion-dispatch
```

## Voice capture

Voice capture records the whole utterance and ends it after about 2 seconds of silence, or after 60 seconds at most. The recording is encoded as 16 kHz mono WAV and sent to `POST /api/transcribe` with your Supabase login as a bearer token. The Cloudflare Worker checks that token with Supabase Auth and transcribes with Workers AI (`@cf/openai/whisper-large-v3-turbo`). Requests over about 2.2 MB are rejected.

Cloud transcription needs a connection and a signed-in session. On this path, audio is processed by Cloudflare. If the endpoint is unavailable or the request fails, Taskflow transcribes on the device with its Moonshine model instead. That model loads only when it is needed, not at startup, so the first fallback use may take a moment. On the fallback path, audio stays on the device.

## Custom reminders

A task reminder can be set to **Custom…**, followed by a number and a unit (minutes, hours, or days). Custom reminders range from 1 minute to 40320 minutes (28 days). They are stored as `reminder_offset = 'custom'` with the length in `reminder_minutes`. The migration `supabase/migrations/20261026000000_phase7_custom_reminder.sql` adds the column and constraints and updates the `sync_task_reminder` trigger. It must be applied with `supabase db push`.

## Add-task composer and day schedule

The add-task composer keeps the first row simple: **When**, **Size**, and **Time**. Once any of them is set, a second row appears with **Reminder**, **Label**, **Repeat**, **Important**, and an **Add note** button for the description.

The Today day schedule stretches its time axis where a task needs more room than its duration gives it, so titles are not clipped. Side-by-side columns are capped at two on narrow screens and three on wide screens. Crowded tasks show only the first few words of the title.

## Motion setting

Settings has a **Motion** option: **Full animations** (the default), **Reduced**, or **Follow system**. The choice is stored per device in local storage (`taskflow:motion`) and applied to the page. This matters on Windows: with "Animation effects" turned off, Chromium-based browsers report reduced motion, which previously turned off every animation on PC. With the default setting, Taskflow keeps its animations unless you choose Reduced or Follow system.
