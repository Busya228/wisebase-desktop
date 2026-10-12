-- ============================================================================
-- WiseBase CRM — ОБЩИЕ ОТЧЁТЫ (вкладка «Аналитика → Отчёты»)
-- Supabase → SQL Editor → New query → вставить → Run. Запускать один раз
-- (повторный запуск безопасен). Нужен для версии 29.1.0 и новее.
--
-- Раньше загруженные .xlsx-отчёты хранились только на устройстве, где их
-- загрузили. Теперь — в таблице public.reports, одна строка на месяц:
--   • ПОЛНЫЙ ДОСТУП у всех сотрудников с ролью (administrator, admin, user, manager):
--     видят, загружают, заменяют и удаляют отчёты. Чтобы снова ограничить загрузку,
--     уберите лишние роли из функции wb_reports_can_edit() ниже и запустите скрипт ещё раз.
--   • изменения сразу приходят всем открытым CRM (Realtime).
-- ============================================================================
begin;

create table if not exists public.reports (
  id               bigserial primary key,
  year             integer     not null check (year between 2000 and 2100),
  month            integer     not null check (month between 1 and 12),
  rows             jsonb       not null default '[]'::jsonb,   -- строки отчёта (только нужные колонки)
  file_name        text,
  loaded_at        timestamptz not null default now(),
  uploaded_by      uuid        default auth.uid(),
  uploaded_by_name text,
  unique (year, month)
);
comment on table public.reports is 'WiseBase CRM: загруженные .xlsx-отчёты по месяцам (вкладка Аналитика → Отчёты)';

-- Роль текущего пользователя (SECURITY DEFINER — чтобы не зависеть от политик profiles).
create or replace function public.wb_reports_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.wb_reports_can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.wb_reports_role() in ('admin','administrator','user','manager'), false)
$$;
revoke all on function public.wb_reports_role(), public.wb_reports_can_edit() from public, anon;
grant execute on function public.wb_reports_role(), public.wb_reports_can_edit() to authenticated;

alter table public.reports enable row level security;
revoke all on public.reports from anon;
grant select, insert, update, delete on public.reports to authenticated;
grant usage, select on sequence public.reports_id_seq to authenticated;

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (public.wb_reports_role() is not null);

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (public.wb_reports_can_edit());

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports for update to authenticated
  using (public.wb_reports_can_edit()) with check (public.wb_reports_can_edit());

drop policy if exists reports_delete on public.reports;
create policy reports_delete on public.reports for delete to authenticated
  using (public.wb_reports_can_edit());

-- Realtime: новые/заменённые отчёты сразу видны у всех.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports') then
    alter publication supabase_realtime add table public.reports;
  end if;
end $$;

commit;

-- Проверка: таблица и политики на месте.
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'reports' order by cmd;
