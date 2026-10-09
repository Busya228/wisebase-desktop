-- WiseBase CRM: фоновые push-уведомления.
-- Выполните весь файл в Supabase → SQL Editor.

-- ============================================================
-- 1. Таблица подписок на push (по одной строке на устройство)
--    Уже используется приложением (index.html → subscribeToPush()).
-- ============================================================
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select using (auth.uid() = user_id);
create policy push_subscriptions_insert on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy push_subscriptions_update on public.push_subscriptions for update using (auth.uid() = user_id);
create policy push_subscriptions_delete on public.push_subscriptions for delete using (auth.uid() = user_id);

-- ============================================================
-- 2. Расписание: вызывать функцию crm-push каждые 5 минут, чтобы
--    напоминания «через 15 минут» и «просрочено» приходили вовремя.
--    ПЕРЕД ЗАПУСКОМ ЗАМЕНИТЕ:
--      YOUR_PROJECT_REF — ref вашего проекта (Settings → General),
--      YOUR_ANON_KEY   — anon key (Settings → API Keys).
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'crm-push-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/crm-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer YOUR_ANON_KEY'),
    body := '{}'::jsonb
  );
  $$
);

-- Полезное:
-- Отключить рассылку:
--   select cron.unschedule('crm-push-reminders');
-- Проверить список задач:
--   select * from cron.job;
-- Посмотреть последние запуски:
--   select * from cron.job_run_details order by start_time desc limit 10;
