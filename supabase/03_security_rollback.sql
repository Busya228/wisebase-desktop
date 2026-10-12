-- ============================================================================
-- WiseBase CRM — ОТКАТ 02_security_hardening.sql
-- Убирает все политики wb_*, триггеры и функции, добавленные тем скриптом.
-- Старые политики организации не трогает. RLS остаётся включённым.
-- ============================================================================
begin;
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname like 'wb\_%' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
-- Вернуть старое правило trg_prevent_self_role_change, если оно было сохранено.
do $$
declare d text;
begin
  if to_regclass('public.wb_backup_triggers') is not null then
    select definition into d from public.wb_backup_triggers where trigger_name = 'trg_prevent_self_role_change';
    if d is not null and not exists (select 1 from pg_trigger where tgname = 'trg_prevent_self_role_change'
                                     and tgrelid = 'public.profiles'::regclass) then
      execute d;
    end if;
  end if;
end $$;
drop table if exists public.wb_backup_triggers;
drop trigger if exists wb_profiles_guard on public.profiles;
drop trigger if exists wb_profiles_insert_guard on public.profiles;
drop function if exists public.wb_set_user_role(uuid, text);   -- из 05_roles.sql
drop function if exists public.wb_profiles_guard();
drop function if exists public.wb_profiles_insert_guard();
drop function if exists public.wb_can_edit_client(bigint);
drop function if exists public.wb_can_edit_owner(uuid);
drop function if exists public.wb_is_delegate_of(uuid);
drop function if exists public.wb_is_admin();
drop function if exists public.wb_my_role();
commit;
