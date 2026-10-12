-- ============================================================================
-- WiseBase CRM — «РОЛИ СОТРУДНИКОВ» В НАСТРОЙКАХ CRM (для администратора)
--
-- Зачем. После 02_security_hardening.sql роль может поменять только администратор.
-- Этот скрипт добавляет функцию, через которую администратор меняет роли прямо
-- в CRM: Профиль → ⚙️ Настройки → «Роли сотрудников».
--
-- Правила функции wb_set_user_role:
--   • вызвать может только администратор (admin / administrator);
--   • допустимые роли: administrator, user (руководитель подразделения), manager;
--   • нельзя снять роль с последнего администратора — иначе назначать роли будет некому.
-- Запросы из SQL Editor и панели Supabase по-прежнему работают как раньше.
--
-- Порядок: сначала 02_security_hardening.sql, потом этот файл. Можно запускать повторно.
-- Откат: 03_security_rollback.sql (удаляет и эту функцию).
-- ============================================================================
begin;

do $$
begin
  if exists (select 1 from pg_trigger
             where tgrelid = 'public.profiles'::regclass and tgname = 'trg_prevent_self_role_change') then
    raise exception 'Сначала выполните 02_security_hardening.sql, затем запустите этот файл снова.';
  end if;
end $$;

create or replace function public.wb_set_user_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
begin
  if auth.uid() is null or not exists (
       select 1 from public.profiles where id = auth.uid() and role in ('admin','administrator')) then
    raise exception 'Менять роли может только администратор';
  end if;
  if p_role is null or p_role not in ('administrator','user','manager') then
    raise exception 'Недопустимая роль: %', coalesce(p_role, 'пусто');
  end if;

  select role into v_old from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Сотрудник не найден';
  end if;
  if v_old is not distinct from p_role then
    return;
  end if;

  if v_old in ('admin','administrator') and p_role not in ('admin','administrator')
     and not exists (select 1 from public.profiles
                     where id <> p_user and role in ('admin','administrator')) then
    raise exception 'Нельзя снять роль с последнего администратора — сначала назначьте другого';
  end if;

  update public.profiles set role = p_role where id = p_user;
end $$;

revoke all on function public.wb_set_user_role(uuid, text) from public, anon;
grant execute on function public.wb_set_user_role(uuid, text) to authenticated;

commit;

-- Проверка: должна вернуться одна строка wb_set_user_role.
select proname from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'wb_set_user_role';
