# Taskflow

Taskflow is a responsive, installable React app backed by Supabase Auth and Postgres. It includes task capture, Inbox/Today/Later/This week/Done views, per-user labels, soft delete/restore, live updates between open clients, explicit due-date reminders, and an optional daily companion nudge. Task ranking is deterministic and uses documented rules; it does not use AI.

## Run locally

1. Create a Supabase project.
2. In its SQL editor, run the Phase 1 migration if you have not already. For Phase 3, follow the ordered setup below: deploy the functions and set secrets, run the schema migration, add Vault values, then install the separate scheduler migration. This prevents cron from calling an unconfigured endpoint. Also apply `20261022020000_phase4_voice_phase5_quick_details.sql` and `20261024000000_phase5_recurrence.sql` in order; recurrence controls do not work until the latter migration is applied.
3. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and (after Phase 3 push setup) `VITE_VAPID_PUBLIC_KEY`. The VAPID public key is safe in the browser; never put a secret, VAPID private key, dispatch token, or service-role key in a `VITE_` variable.
4. Install and start:

   ```sh
   npm install
   npm run dev
   ```

For a production build and automated tests, run `npm run build` and `npm test`.

## Deployment

Taskflow is hosted on Cloudflare Pages. Follow [docs/cloudflare-pages.md](docs/cloudflare-pages.md) for the first deployment and domain migration. Cloudflare Pages builds this Vite app with `npm run build` and publishes `dist`. Set the public `VITE_` values in Cloudflare Pages before the first production build, then add the deployed origin to Supabase Auth's allowed redirect URLs. The manifest and service worker cache only the static app shell and versioned front-end assets. Task and Supabase API data are not cached; offline use is read-only for data already loaded in the open tab, and writes require a connection.

On supported Chrome versions, use the **Install app** button when it appears in Taskflow. If Chrome does not show that button, open the browser menu and choose **Install Taskflow** (Windows) or **Add to Home screen** (Android). The install prompt is browser-controlled and may not appear until the site meets the browser's install criteria.

## Environment variables

| Name | Purpose | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project endpoint | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable client key; RLS protects data access | No |
| `VITE_SUPABASE_ANON_KEY` | Legacy public key for older projects | No |
| `VITE_VAPID_PUBLIC_KEY` | Public push key used to subscribe this browser | No |

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

## Phase 5 and Phase 6 features

Recurring tasks can be set to daily, weekdays, weekly, or monthly from the add-task details, Quick details, or task editor. Completing an occurrence creates its next dated occurrence; Undo removes that next occurrence and reopens the completed task. Monthly repeats preserve the original day of the month when possible (for example, a task on the 31st moves to the last day of shorter months).

Task titles can include explicit dates and times such as `Call Sam tomorrow at 3pm`, `Review notes next Monday`, `Pay rent on Oct 24`, or `Submit report at 15:30`. Taskflow puts the date/time in the deadline fields and saves only the remaining title. Installed PWAs can also receive shared text or a link through the system Share menu. Export and restore are available in **Settings**. Offline task writes remain disabled until a conflict policy is designed.
