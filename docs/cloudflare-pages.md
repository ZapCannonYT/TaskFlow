# Deploy Taskflow to Cloudflare Pages

Taskflow is a static Vite application. It does not need Cloudflare Workers, Pages Functions, or a `wrangler` configuration file.

## First deployment

1. Push this project to GitHub or GitLab. Do not commit `.env`.
2. In the Cloudflare dashboard, open **Workers & Pages** and choose **Create application** > **Pages** > **Connect to Git**.
3. Select the repository and configure the project as follows:

   | Setting | Value |
   | --- | --- |
   | Framework preset | React (Vite) |
   | Production branch | `main` once it exists and is ready for release |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | leave blank, unless this app is moved into a monorepo |

4. Before deploying, open **Settings** > **Variables and Secrets** and add these **plain-text build variables** for both Production and Preview:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Your Supabase project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable key |
   | `VITE_VAPID_PUBLIC_KEY` | Your public VAPID key, once push is configured |

   Use `VITE_SUPABASE_ANON_KEY` only for a legacy Supabase project that does not have a publishable key. These values are intentionally public because Vite embeds `VITE_` variables in the browser build. Never add the VAPID private key, Supabase service-role key, or `TASKFLOW_DISPATCH_SECRET` to Cloudflare.

5. If the repository currently only has `dev`, first set `dev` as a preview branch (or temporarily set it as the production branch only if you are comfortable with it deploying publicly). Create/push `main` when the release is ready, then set `main` as the production branch in **Settings** > **Builds & deployments**. Cloudflare can treat the first pushed branch as production by default, so check this setting before the first deployment.
6. Deploy a preview and open its assigned `https://<branch>.<project>.pages.dev` URL. Verify sign-in, task creation/editing, audit-to-Inbox behavior, microphone capture, and a test notification before making a production deployment.

## Supabase authentication

In Supabase, open **Authentication** > **URL Configuration**. Set the Site URL to the production Cloudflare Pages URL (or the custom domain after it is attached), and add that same exact HTTPS origin to the Redirect URLs allow list. Add the previous Netlify origin temporarily only if users still need to sign in there during the cutover.

If you use Cloudflare preview deployments for sign-in testing, add the specific preview URL you are testing to the Redirect URLs allow list. Do not broadly allow untrusted redirect domains.

## Custom domain and Netlify cutover

1. In Cloudflare Pages, open the project and choose **Custom domains** > **Set up a custom domain**.
2. Add the domain you want users to visit. If its DNS is already managed by Cloudflare, approve the generated DNS record. Otherwise, first move the domain's DNS to Cloudflare or follow the dashboard's DNS instructions for your registrar.
3. Wait until Cloudflare shows the domain as active, then update Supabase's Site URL and Redirect URLs to use that HTTPS domain.
4. Test the custom domain in an incognito window: sign in, create and complete a task, install the PWA, grant notification permission, and send a test notification.
5. Only after the custom domain works, remove the domain or redirect from Netlify and remove the Netlify URL from Supabase's redirect allow list.

## Ongoing deployments

Pushes to the production branch deploy to production. Configure preview deployments for pull requests or non-production branches in Cloudflare Pages so changes can be tested before merging. Environment-variable changes apply to new builds, so trigger a new deployment after changing a `VITE_` value.

## When to deploy

Create the Pages project when you are ready to test the app on a real HTTPS origin, especially for sign-in redirects, installable PWA behavior, and browser notifications. Do not use the production domain until the matching Supabase migrations and Edge Function changes are deployed and the preview build has been checked. The frontend changes in this repo require migration `20261024010000_phase6_descriptions_inbox_audit.sql`; deploy it to Supabase before using this app build against that project. Use the `dev` preview to check changes, then promote a reviewed `main` branch to production.

## Manual deploy alternative

Use Git integration for normal deployments. If you deliberately choose a direct-upload Pages project instead, run `npm run build` locally and deploy the `dist` directory with `npx wrangler pages deploy dist --project-name=<project-name>`. A Pages project created as Direct Upload cannot later be converted to Git integration; create a separate Git-integrated Pages project if you need automatic deployments.
