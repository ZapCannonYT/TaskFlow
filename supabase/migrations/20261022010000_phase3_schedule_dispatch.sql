-- Install the scheduler only after the required values have been stored in Vault.
-- See the Phase 3 setup steps in README.md.
select cron.unschedule(jobid)
from cron.job
where jobname = 'taskflow-companion-dispatch';

select cron.schedule(
  'taskflow-companion-dispatch',
  '* * * * *',
  $$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'taskflow_project_url') || '/functions/v1/companion-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'taskflow_publishable_key'),
        'x-taskflow-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'taskflow_dispatch_secret')
      ),
      body := '{}'::jsonb
    );$$
);
