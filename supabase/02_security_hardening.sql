-- ============================================================================
-- WiseBase CRM — ПРАВА ПО РОЛЯМ НА УРОВНЕ БАЗЫ (запись)
--
-- Зачем. Сейчас политики RLS проверяют только «состоит ли человек в организации».
-- Поэтому любой сотрудник, зная публичный ключ (он есть в index.html), может через
-- API изменить или удалить ЧУЖИХ клиентов и задачи, а главное — поменять СЕБЕ роль
-- на administrator. Интерфейс этого не позволяет, но интерфейс не защита.
--
-- Что делает скрипт (повторяет правила интерфейса, см. «РОЛИ» в index.html):
--   • profiles      — роль назначает/меняет только администратор (в CRM) или владелец проекта
--                     (панель Supabase); чужой профиль правит только администратор;
--                     старое правило trg_prevent_self_role_change заменяется (с резервной копией);
--   • clients       — менять: admin/administrator, руководитель подразделения (role='user'),
--                     владелец, тот, кому владелец открыт через «Менеджер»; удалять насовсем — только admin;
--   • tasks         — менять: admin, владелец, делегат, общие задачи, а также тот, кто может
--                     менять клиента задачи (нужно для удаления клиента вместе с задачами);
--   • offers        — менять: admin, владелец, тот, кто может менять клиента сделки;
--   • client_history — удалять: admin или тот, кто может менять клиента;
--   • access_delegations — открывать и снимать доступ к данным коллег может ТОЛЬКО
--                     администратор (в CRM: Профиль → Настройки → «Доступ к данным коллег»);
--   • audit_log     — журнал нельзя изменить или удалить.
--
-- ЧТЕНИЕ НЕ ОГРАНИЧИВАЕТСЯ: «Карта региона», «Статистика» и «Предложения» по задумке
-- показывают данные всей команды, поэтому читать по-прежнему может вся организация.
--
-- Как это устроено. Добавляются только политики AS RESTRICTIVE (имена wb_*) — они
-- работают ПОВЕРХ существующих: доступ есть, только если его дают старые политики
-- И новые ограничения. Существующие политики не меняются и не удаляются.
--
-- Порядок:
--   1) запустить 01_security_audit.sql и убедиться, что в блоке 5 owner_id / delegate_id —
--      uuid, а id клиентов — integer/bigint (иначе этот скрипт откатится целиком с ошибкой);
--   2) запустить этот файл целиком (он в одной транзакции — либо всё, либо ничего);
--   3) проверить в CRM под менеджером, руководителем подразделения и администратором;
--   4) если что-то пошло не так — 03_security_rollback.sql вернёт всё как было.
-- Скрипт можно запускать повторно.
-- Запросы из SQL Editor и сервисного ключа (Edge Function crm-push) не затрагиваются.
-- ============================================================================
begin;

-- ---------- Предохранитель: без администратора не запускаем ----------
-- После этого скрипта роли меняет только администратор. Если его нет, назначать
-- роли из CRM будет некому (останется только SQL Editor).
do $$
begin
  if not exists (select 1 from public.profiles where role in ('admin','administrator')) then
    raise exception 'Сначала назначьте хотя бы одного администратора (profiles.role = ''administrator''), затем запустите скрипт снова.';
  end if;
end $$;

-- ---------- Вспомогательные функции ----------
-- SECURITY DEFINER + фиксированный search_path: читают profiles/access_delegations
-- в обход RLS (иначе политика profiles вызывала бы сама себя), но только для auth.uid().
create or replace function public.wb_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.wb_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','administrator') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.wb_is_delegate_of(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner is not null and exists (
    select 1 from public.access_delegations d
    where d.owner_id = p_owner and d.delegate_id = auth.uid())
$$;

-- Может ли текущий пользователь менять данные владельца p_owner (клиента и т.п.)
-- — то же, что canEditClient() в index.html.
create or replace function public.wb_can_edit_owner(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.wb_is_admin()
      or public.wb_my_role() = 'user'
      or p_owner = auth.uid()
      or public.wb_is_delegate_of(p_owner)
$$;

create or replace function public.wb_can_edit_client(p_client_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select p_client_id is not null and exists (
    select 1 from public.clients c
    where c.id = p_client_id and public.wb_can_edit_owner(c.owner_id))
$$;

revoke all on function public.wb_my_role(), public.wb_is_admin(), public.wb_is_delegate_of(uuid),
  public.wb_can_edit_owner(uuid), public.wb_can_edit_client(bigint) from public, anon;
grant execute on function public.wb_my_role(), public.wb_is_admin(), public.wb_is_delegate_of(uuid),
  public.wb_can_edit_owner(uuid), public.wb_can_edit_client(bigint) to authenticated;

-- ---------- profiles: роль меняет только администратор ----------
create or replace function public.wb_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() пустой = SQL Editor / сервисный ключ — разрешаем (так роли и назначают).
  if auth.uid() is null then return new; end if;
  if new.id is distinct from old.id then
    raise exception 'Нельзя менять id профиля';
  end if;
  if new.role is distinct from old.role and not public.wb_is_admin() then
    raise exception 'Роль может изменить только администратор';
  end if;
  return new;
end $$;

drop trigger if exists wb_profiles_guard on public.profiles;
create trigger wb_profiles_guard before update on public.profiles
  for each row execute function public.wb_profiles_guard();

-- Старое правило trg_prevent_self_role_change молча возвращало прежнюю роль даже
-- из панели Supabase — поэтому роли нельзя было назначить вообще. Его заменяет
-- wb_profiles_guard выше: сотрудник роль не меняет (ни свою, ни чужую), администратор
-- в CRM и владелец проекта в панели Supabase — меняют. Определение старого правила
-- сохраняем в wb_backup_triggers, чтобы 03_security_rollback.sql мог его вернуть.
create table if not exists public.wb_backup_triggers (
  trigger_name text primary key,
  definition   text not null,
  saved_at     timestamptz not null default now()
);
alter table public.wb_backup_triggers enable row level security;   -- без политик: из CRM не видна
revoke all on public.wb_backup_triggers from anon, authenticated;
insert into public.wb_backup_triggers (trigger_name, definition)
select t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t
where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'trg_prevent_self_role_change' and not t.tgisinternal
on conflict (trigger_name) do nothing;
drop trigger if exists trg_prevent_self_role_change on public.profiles;

-- Новый профиль самому себе — только без повышенных прав (роль назначает админ).
create or replace function public.wb_profiles_insert_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.wb_is_admin() then return new; end if;
  if new.role in ('admin','administrator','user') then
    raise exception 'Повышенную роль может назначить только администратор';
  end if;
  return new;
end $$;

drop trigger if exists wb_profiles_insert_guard on public.profiles;
create trigger wb_profiles_insert_guard before insert on public.profiles
  for each row execute function public.wb_profiles_insert_guard();

drop policy if exists wb_profiles_update_guard on public.profiles;
create policy wb_profiles_update_guard on public.profiles as restrictive
  for update to authenticated
  using (id = auth.uid() or public.wb_is_admin())
  with check (id = auth.uid() or public.wb_is_admin());

drop policy if exists wb_profiles_delete_guard on public.profiles;
create policy wb_profiles_delete_guard on public.profiles as restrictive
  for delete to authenticated using (public.wb_is_admin());

-- ---------- clients ----------
drop policy if exists wb_clients_update_guard on public.clients;
create policy wb_clients_update_guard on public.clients as restrictive
  for update to authenticated
  using (public.wb_can_edit_owner(owner_id))
  -- новый владелец может быть любым (передача клиента коллеге), но только у
  -- сотрудника с назначенной ролью
  with check (public.wb_my_role() is not null);

drop policy if exists wb_clients_insert_guard on public.clients;
create policy wb_clients_insert_guard on public.clients as restrictive
  for insert to authenticated
  with check (public.wb_my_role() is not null);

drop policy if exists wb_clients_delete_guard on public.clients;
create policy wb_clients_delete_guard on public.clients as restrictive
  for delete to authenticated using (public.wb_is_admin());   -- в CRM удаление «мягкое» (deleted_at)

-- ---------- tasks ----------
drop policy if exists wb_tasks_update_guard on public.tasks;
create policy wb_tasks_update_guard on public.tasks as restrictive
  for update to authenticated
  using (
    public.wb_is_admin()
    or owner_id = auth.uid()
    or coalesce(is_shared, false)
    or public.wb_is_delegate_of(owner_id)
    or public.wb_can_edit_client(client_id)
  )
  with check (public.wb_my_role() is not null);

drop policy if exists wb_tasks_insert_guard on public.tasks;
create policy wb_tasks_insert_guard on public.tasks as restrictive
  for insert to authenticated
  with check (public.wb_my_role() is not null);

drop policy if exists wb_tasks_delete_guard on public.tasks;
create policy wb_tasks_delete_guard on public.tasks as restrictive
  for delete to authenticated using (public.wb_is_admin() or owner_id = auth.uid());

-- ---------- offers ----------
drop policy if exists wb_offers_update_guard on public.offers;
create policy wb_offers_update_guard on public.offers as restrictive
  for update to authenticated
  using (
    public.wb_is_admin()
    or owner_id = auth.uid()
    or public.wb_is_delegate_of(owner_id)
    or public.wb_can_edit_client(client_id)
  )
  with check (public.wb_my_role() is not null);

drop policy if exists wb_offers_delete_guard on public.offers;
create policy wb_offers_delete_guard on public.offers as restrictive
  for delete to authenticated using (public.wb_is_admin() or owner_id = auth.uid());

-- ---------- client_history ----------
drop policy if exists wb_history_delete_guard on public.client_history;
create policy wb_history_delete_guard on public.client_history as restrictive
  for delete to authenticated using (public.wb_is_admin() or public.wb_can_edit_client(client_id));

drop policy if exists wb_history_update_guard on public.client_history;
create policy wb_history_update_guard on public.client_history as restrictive
  for update to authenticated using (public.wb_is_admin() or public.wb_can_edit_client(client_id));

-- ---------- access_delegations: открывает и снимает доступ ТОЛЬКО администратор ----------
drop policy if exists wb_deleg_insert_guard on public.access_delegations;
create policy wb_deleg_insert_guard on public.access_delegations as restrictive
  for insert to authenticated with check (public.wb_is_admin());

drop policy if exists wb_deleg_delete_guard on public.access_delegations;
create policy wb_deleg_delete_guard on public.access_delegations as restrictive
  for delete to authenticated using (public.wb_is_admin());

drop policy if exists wb_deleg_update_guard on public.access_delegations;
create policy wb_deleg_update_guard on public.access_delegations as restrictive
  for update to authenticated using (public.wb_is_admin());

-- ---------- audit_log: журнал только дописывается ----------
drop policy if exists wb_audit_update_guard on public.audit_log;
create policy wb_audit_update_guard on public.audit_log as restrictive
  for update to authenticated using (false);

drop policy if exists wb_audit_delete_guard on public.audit_log;
create policy wb_audit_delete_guard on public.audit_log as restrictive
  for delete to authenticated using (false);

-- ---------- Без входа (anon) — ничего ----------
-- Если какая-то старая политика по ошибке пускает anon, эти ограничения её перекроют.
-- RLS здесь НЕ включается принудительно: на таблице без разрешающих политик это
-- заблокировало бы всех. Таблицы с выключенным RLS покажет блок 1 аудита — для них
-- сначала нужны обычные политики организации.
do $$
declare t text;
begin
  foreach t in array array['clients','tasks','offers','client_history','links','staff_contacts',
                           'trips','profiles','access_delegations','audit_log','push_subscriptions','reports'] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('drop policy if exists wb_no_anon on public.%I', t);
      execute format('create policy wb_no_anon on public.%I as restrictive for all to anon using (false) with check (false)', t);
    end if;
  end loop;
end $$;

commit;

-- Проверка: должны появиться политики wb_* (RESTRICTIVE).
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and policyname like 'wb\_%' order by tablename, policyname;
