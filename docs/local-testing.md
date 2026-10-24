# Local testing

## Laptop

Run `npm run dev`, then open `http://localhost:5173`.

## Phone over USB (recommended)

The microphone and service worker need a secure context, and `http://<LAN-IP>` is not secure. Enable Developer options and USB debugging on the phone, then connect it by USB. On the laptop, open `chrome://inspect/#devices`; under **Port forwarding**, add `5173` to `localhost:5173` and `4173` to `localhost:4173`, then enable it. Open `http://localhost:5173` in Chrome on the phone. Edits hot-reload.

## Phone without USB

Install the Cloudflare Tunnel binary, then run `cloudflared tunnel --url http://localhost:5173` from the project root. Open the HTTPS URL it prints. The temporary URL is free and changes each run.

## Production-like test

Run `npm run preview:local`, then repeat the USB or tunnel procedure using port `4173`. Use this mode to test the service worker, installation, push notifications, and voice timings. Voice timings must not be measured in `npm run dev`, because StrictMode initializes the model twice in development.

## Debugging on the phone

Open `chrome://inspect`, then choose **inspect** for the phone tab.

## Before any push

Run `npx tsc --noEmit`, `npm test`, and `npm run build`. ESLint is not installed in this project, so there is intentionally no `npm run check` script yet.

## Dev panel

Add `?dev=1` to the development URL. Use a separate Supabase project for development data and point `.env.local` to it. The panel warns in red when the configured host matches `VITE_PRODUCTION_SUPABASE_HOST`.

## Deploy rules

Use a non-production branch for work. With Cloudflare Pages Git integration, configure preview deployments for pull requests or development branches, and merge to `main` only after a batch passes local testing. Only `main` should deploy production.
