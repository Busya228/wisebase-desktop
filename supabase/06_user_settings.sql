-- ============================================================================
-- WiseBase CRM — ЛИЧНЫЕ НАСТРОЙКИ СОТРУДНИКА В БАЗЕ (для 29.2.0+)
--
-- Зачем. Тема, вид списков (карточки/таблица), ширина колонок, меню, свёрнутые
-- разделы, тип задачи по умолчанию и т. п. раньше хранились только на одном
-- компьютере и терялись при переустановке, на другом устройстве или в браузере.
-- Теперь они привязаны к учётной записи: настроил один раз — везде так же.
--
-- Права: каждый видит и меняет ТОЛЬКО свою строку (даже администратор чужие
-- настройки не видит — это личный вид интерфейса, не рабочие данные).
-- Можно запускать повторно. Удалить: drop table public.user_settings;
-- ============================================================================
begin;

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own on public.user_settings
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.user_settings from anon;
grant select, insert, update, delete on public.user_settings to authenticated;

commit;

-- Проверка: должна вернуться одна строка user_settings / true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'user_settings';
