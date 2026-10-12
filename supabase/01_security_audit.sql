-- ============================================================================
-- WiseBase CRM — АУДИТ БЕЗОПАСНОСТИ БАЗЫ (только чтение, ничего не меняет)
-- Supabase → SQL Editor → New query → вставить → Run.
-- Результат каждого блока смотрите во вкладке Results (переключатель внизу,
-- если блоков несколько — запускайте их по одному, выделив текст блока).
-- ============================================================================

-- 1. Включён ли RLS на каждой таблице. Везде должно быть rls_enabled = true.
--    Таблица с false доступна ЛЮБОМУ, у кого есть публичный (anon) ключ из index.html.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

-- 2. Все политики. Обратите внимание на:
--    • roles = {public} или {anon} — политика действует и без входа;
--    • qual / with_check = true — пускает всех без условий;
--    • permissive = RESTRICTIVE — дополнительные ограничения (их добавляет 02_security_hardening.sql).
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- 3. Функции, на которые опираются политики (is_org_member, my_org_role и т.п.).
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end as security,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname ilike '%org%' or p.proname ilike '%role%' or p.proname ilike 'wb_%')
order by p.proname;

-- 4. Какие роли реально назначены. Допустимые: administrator, admin, user
--    (= «Руководитель подразделения»), manager. Всё остальное — ошибка ввода.
select coalesce(role, '(пусто)') as role, count(*) as people
from public.profiles group by role order by people desc;

-- 5. Типы ключевых колонок (нужны для 02_security_hardening.sql:
--    owner_id/delegate_id/user_id — uuid, id клиентов — целое число).
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('clients','tasks','offers','client_history','access_delegations','profiles','audit_log','trips','reports')
  and column_name in ('id','owner_id','client_id','is_shared','delegate_id','role','deleted_at','user_id')
order by table_name, column_name;

-- 6. Права ролей anon/authenticated на таблицы (при включённом RLS это нормально,
--    решающее слово за политиками; при выключенном — это открытая дверь).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
group by table_name, grantee order by table_name, grantee;

-- 7. Пользователи без профиля и профили без роли (такие люди увидят пустую CRM).
select u.id, u.email, p.role
from auth.users u left join public.profiles p on p.id = u.id
where p.id is null or p.role is null;

-- 8. Какие таблицы транслируют изменения в реальном времени (см. realtime_setup.sql).
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename;

-- 9. Доступы к данным коллег, которые сотрудники открыли себе САМИ (до версии 29.1.0
--    это было разрешено). Теперь доступ назначает только администратор — проверьте
--    этот список в CRM (Профиль → Настройки → «Доступ к данным коллег») и снимите лишнее.
select d.delegate_id, pd.full_name as who_sees, pd.role as who_role,
       d.owner_id, po.full_name as whose_data
from public.access_delegations d
left join public.profiles pd on pd.id = d.delegate_id
left join public.profiles po on po.id = d.owner_id
order by pd.full_name, po.full_name;
