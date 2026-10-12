// Проверка SQL-скриптов прав на «игрушечной» базе Postgres (PGlite), имитирующей Supabase:
// роли anon/authenticated, auth.uid(), «дырявые» политики организации. Запуск:
//   cd supabase/tests && npm install && node policies.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const ex = async (sql, label) => { try { const r = await db.exec(sql); return r; } catch (e) { console.log('ERR', label||'', e.message); throw e; } };
await ex(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;
create table public.profiles(id uuid primary key, full_name text, email text, role text);
create table public.clients(id bigserial primary key, name text, owner_id uuid, deleted_at timestamptz, locked_by text);
create table public.tasks(id bigserial primary key, text text, owner_id uuid, client_id bigint, is_shared boolean default false, deleted_at timestamptz);
create table public.offers(id bigserial primary key, text text, owner_id uuid, client_id bigint, deleted_at timestamptz);
create table public.client_history(id bigserial primary key, client_id bigint, text text);
create table public.access_delegations(id bigserial primary key, owner_id uuid, delegate_id uuid);
create table public.audit_log(id bigserial primary key, txt text);
create table public.links(id bigserial primary key); create table public.staff_contacts(id bigserial primary key);
create table public.trips(id bigserial primary key, owner_id uuid); create table public.push_subscriptions(id bigserial primary key, user_id uuid);
do $$ declare t text; begin foreach t in array array['profiles','clients','tasks','offers','client_history','access_delegations','audit_log','links','staff_contacts','trips','push_subscriptions'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy org_all on public.%I for all to authenticated using (true) with check (true)', t);
  execute format('create policy anon_leak on public.%I for select to anon using (true)', t);
  execute format('grant all on public.%I to anon, authenticated', t);
end loop; end $$;
grant usage on all sequences in schema public to anon, authenticated;
-- Имитация существующего правила в боевой базе: молча возвращает старую роль
create function public.prevent_self_role_change() returns trigger language plpgsql as $f$
begin if new.role is distinct from old.role then new.role := old.role; end if; return new; end $f$;
create trigger trg_prevent_self_role_change before update on public.profiles for each row execute function public.prevent_self_role_change();
insert into public.profiles values
 ('00000000-0000-0000-0000-00000000000a','Админ','a@x','administrator'),
 ('00000000-0000-0000-0000-00000000000b','Глава','h@x','user'),
 ('00000000-0000-0000-0000-000000000001','Менеджер1','m1@x','manager'),
 ('00000000-0000-0000-0000-000000000002','Менеджер2','m2@x','manager');
insert into public.clients(name,owner_id) values ('C1 m1','00000000-0000-0000-0000-000000000001'),('C2 m2','00000000-0000-0000-0000-000000000002');
insert into public.tasks(text,owner_id,client_id,is_shared) values ('T m1','00000000-0000-0000-0000-000000000001',1,false),('T m2','00000000-0000-0000-0000-000000000002',2,false),('T shared','00000000-0000-0000-0000-000000000002',2,true);
insert into public.offers(text,owner_id,client_id) values ('O m2','00000000-0000-0000-0000-000000000002',2);
insert into public.client_history(client_id,text) values (2,'h');
insert into public.audit_log(txt) values ('a');
`, 'schema');
for (const f of ['01_security_audit.sql','realtime_setup.sql','02_security_hardening.sql','02_security_hardening.sql','04_reports.sql','04_reports.sql','05_roles.sql','05_roles.sql','06_user_settings.sql','06_user_settings.sql','01_security_audit.sql']) { await ex(fs.readFileSync(new URL('../'+f, import.meta.url),'utf8'), f); console.log('ran', f); }
const U = { admin:'00000000-0000-0000-0000-00000000000a', head:'00000000-0000-0000-0000-00000000000b', m1:'00000000-0000-0000-0000-000000000001', m2:'00000000-0000-0000-0000-000000000002' };
let fails = 0;
async function as(who, sql) {
  await db.exec('reset role');
  if (who === 'anon') { await db.exec(`select set_config('request.jwt.claim.sub','',false); set role anon;`); }
  else { await db.exec(`select set_config('request.jwt.claim.sub','${U[who]}',false); set role authenticated;`); }
  try { const r = await db.query(sql); return { rows: r.rows, n: r.affectedRows ?? r.rows.length }; }
  catch (e) { return { err: e.message }; } finally { await db.exec('reset role'); }
}
function check(cond, msg, extra) { console.log((cond ? 'ok   ' : 'FAIL ') + msg + (cond ? '' : ' ' + JSON.stringify(extra))); if (!cond) fails++; }
let r;
r = await as('m1', `update clients set name='x' where id=1`); check(r.n===1, 'менеджер меняет своего клиента', r);
r = await as('m1', `update clients set name='x' where id=2`); check(r.n===0, 'менеджер НЕ меняет чужого клиента', r);
r = await as('m1', `select count(*)::int c from clients`); check(r.rows?.[0].c===2, 'менеджер по-прежнему ЧИТАЕТ всех (карта/статистика)', r);
r = await as('m1', `update clients set owner_id='${U.m2}' where id=1`); check(r.n===1, 'менеджер передаёт своего клиента коллеге', r);
await as('admin', `update clients set owner_id='${U.m1}' where id=1`);
r = await as('head', `update clients set name='h' where id=2`); check(r.n===1, 'руководитель подразделения меняет любого клиента', r);
r = await as('m1', `delete from clients where id=2`); check(r.n===0, 'менеджер не удаляет клиента насовсем', r);
r = await as('m1', `update profiles set role='administrator' where id='${U.m1}'`); check(!!r.err, 'менеджер НЕ может сделать себя администратором', r);
r = await as('m1', `update profiles set full_name='Новое имя' where id='${U.m1}'`); check(r.n===1, 'менеджер меняет своё имя', r);
r = await as('m1', `update profiles set full_name='hack' where id='${U.m2}'`); check(r.n===0, 'менеджер не меняет чужой профиль', r);
r = await as('admin', `update profiles set role='user' where id='${U.m2}'`); check(r.n===1, 'администратор меняет роль', r);
await as('admin', `update profiles set role='manager' where id='${U.m2}'`);
r = await as('m1', `update tasks set text='x' where id=2`); check(r.n===0, 'менеджер не меняет чужую задачу', r);
r = await as('m1', `update tasks set text='x' where id=3`); check(r.n===1, 'менеджер меняет общую задачу', r);
r = await as('head', `update tasks set deleted_at=now() where client_id=2`); check(r.n===2, 'руководитель удаляет клиента вместе с его задачами', r);
r = await as('m1', `update offers set text='x' where id=1`); check(r.n===0, 'менеджер не меняет чужую сделку', r);
r = await as('m1', `insert into access_delegations(owner_id,delegate_id) values ('${U.m2}','${U.m1}')`); check(!!r.err, 'менеджер НЕ может сам открыть себе доступ к коллеге', r);
r = await as('head', `insert into access_delegations(owner_id,delegate_id) values ('${U.m2}','${U.head}')`); check(!!r.err, 'руководитель подразделения тоже не может открыть себе доступ', r);
r = await as('admin', `insert into access_delegations(owner_id,delegate_id) values ('${U.m2}','${U.m1}')`); check(!r.err, 'администратор открывает менеджеру доступ к коллеге', r);
r = await as('m1', `update clients set name='after deleg' where id=2`); check(r.n===1, 'после делегирования — может менять клиента коллеги', r);
r = await as('m1', `delete from access_delegations where delegate_id='${U.m1}'`); check(r.n===0, 'сотрудник не может сам снять доступ', r);
r = await as('m2', `delete from access_delegations where delegate_id='${U.m1}'`); check(r.n===0, 'владелец данных тоже не снимает доступ — только администратор', r);
r = await as('m1', `update access_delegations set owner_id='${U.admin}'`); check(r.n===0, 'нельзя переписать запись доступа на другого человека', r);
r = await as('admin', `delete from access_delegations where delegate_id='${U.m1}'`); check(r.n===1, 'администратор снимает доступ', r);
r = await as('m1', `update clients set name='no deleg' where id=2`); check(r.n===0, 'после снятия доступа — снова нельзя менять клиента коллеги', r);
// --- Общие отчёты (04_reports.sql) ---
r = await as('head', `insert into reports(year,month,rows,file_name) values (2026,7,'[{"РМ ФИО":"Иванов"}]','a.xlsx') returning uploaded_by`); check(!r.err && r.rows?.[0]?.uploaded_by===U.head, 'руководитель подразделения загружает отчёт (автор подставляется сам)', r);
r = await as('admin', `insert into reports(year,month,rows) values (2026,7,'[]') on conflict (year,month) do update set rows=excluded.rows, file_name='b.xlsx'`); check(!r.err, 'администратор заменяет отчёт за тот же месяц (upsert)', r);
r = await as('m1', `select count(*)::int c from reports`); check(r.rows?.[0].c===1, 'менеджер ВИДИТ общие отчёты', r);
r = await as('m1', `insert into reports(year,month,rows) values (2026,8,'[]')`); check(!r.err, 'менеджер загружает отчёт', r);
r = await as('m1', `update reports set file_name='m.xlsx' where month=7`); check(r.n===1, 'менеджер заменяет отчёт', r);
r = await as('m1', `delete from reports where month=8`); check(r.n===1, 'менеджер удаляет отчёт', r);
await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-0000000000cc','norole@x')`);
await db.exec(`insert into profiles(id,role) values ('00000000-0000-0000-0000-0000000000cc', null)`); U.norole='00000000-0000-0000-0000-0000000000cc';
r = await as('norole', `insert into reports(year,month,rows) values (2026,9,'[]')`); check(!!r.err, 'учётка без роли отчёты не загружает', r);
r = await as('norole', `select count(*)::int c from reports`); check(r.rows?.[0].c===0, 'и не видит', r);
r = await as('anon', `select count(*)::int c from reports`); check(!!r.err || r.rows?.[0].c===0, 'без входа отчёты не видны', r);
r = await as('m1', `insert into reports(year,month,rows) values (2026,13,'[]')`); check(!!r.err, 'месяц 13 не принимается', r);
r = await as('head', `delete from reports where year=2026 and month=7`); check(r.n===1, 'руководитель подразделения удаляет отчёт', r);
r = await db.query(`select count(*)::int c from pg_publication_tables where pubname='supabase_realtime' and tablename='reports'`); check(r.rows[0].c===1, 'отчёты включены в Realtime', r.rows);
r = await as('m1', `delete from client_history where client_id=2`); check(r.n===0, 'менеджер не удаляет историю чужого клиента', r);
r = await as('admin', `delete from audit_log`); check(r.n===0, 'журнал аудита нельзя удалить даже администратору', r);
r = await as('anon', `select count(*)::int c from clients`); check(r.rows?.[0].c===0, 'без входа данных не видно (даже при «дырявой» старой политике)', r);
r = await as('m1', `insert into profiles(id,role) values ('00000000-0000-0000-0000-0000000000ff','administrator')`); check(!!r.err, 'нельзя создать себе профиль администратора', r);
// --- Назначение ролей ---
await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`);
await db.exec(`update profiles set role='user' where id='${U.m2}'`);
r = await db.query(`select role from profiles where id='${U.m2}'`); check(r.rows[0].role==='user', 'из панели Supabase (SQL Editor / Table Editor) роль меняется', r.rows);
await db.exec(`update profiles set role='manager' where id='${U.m2}'`);
r = await db.query(`select count(*)::int c from pg_trigger where tgname='trg_prevent_self_role_change'`); check(r.rows[0].c===0, 'старое правило, блокировавшее роли, снято', r.rows);
r = await db.query(`select count(*)::int c from wb_backup_triggers where trigger_name='trg_prevent_self_role_change'`); check(r.rows[0].c===1, 'его определение сохранено для отката', r.rows);
r = await as('m1', `update profiles set role='administrator' where id='${U.m2}'`); check(!!r.err || r.n===0, 'менеджер не меняет чужую роль', r);
r = await as('head', `update profiles set role='administrator' where id='${U.head}'`); check(!!r.err, 'руководитель подразделения не повышает себя', r);
r = await as('admin', `update profiles set role='user' where id='${U.m2}' returning role`); check(!r.err && r.rows?.[0]?.role==='user', 'администратор назначает роль в CRM', r);
await as('admin', `update profiles set role='manager' where id='${U.m2}'`);
r = await as('m1', `select count(*)::int c from wb_backup_triggers`); check(!!r.err, 'резервная копия из CRM недоступна', r);
// --- Личные настройки (06_user_settings.sql) ---
await db.exec(`reset role; insert into auth.users values ('${U.m1}','m1@x'),('${U.m2}','m2@x') on conflict do nothing`);
r = await as('m1', `insert into user_settings(settings) values ('{"crm_theme":"t3"}') returning user_id`); check(!r.err && r.rows?.[0]?.user_id===U.m1, 'сотрудник сохраняет свои настройки', r);
r = await as('m1', `insert into user_settings(user_id,settings) values ('${U.m2}','{}')`); check(!!r.err, 'нельзя записать настройки за коллегу', r);
r = await as('m2', `select count(*)::int c from user_settings`); check(r.rows?.[0].c===0, 'чужие настройки не видны', r);
r = await as('admin', `select count(*)::int c from user_settings`); check(r.rows?.[0].c===0, 'даже администратору чужие настройки не видны', r);
r = await as('m2', `update user_settings set settings='{}' where user_id='${U.m1}'`); check(r.n===0, 'чужие настройки не изменить', r);
r = await as('m1', `update user_settings set settings='{"crm_theme":"t5"}' where user_id='${U.m1}'`); check(r.n===1, 'свои настройки меняются', r);
r = await as('anon', `select count(*)::int c from user_settings`); check(!!r.err || r.rows?.[0].c===0, 'без входа настроек не видно', r);
// --- Роли сотрудников в CRM (05_roles.sql) ---
r = await as('admin', `select wb_set_user_role('${U.m2}','user')`); check(!r.err, 'администратор меняет роль через «Роли сотрудников»', r);
r = await db.query(`select role from profiles where id='${U.m2}'`); check(r.rows[0].role==='user', 'роль действительно сохранилась', r.rows);
r = await as('admin', `select wb_set_user_role('${U.m2}','manager')`); check(!r.err, 'и возвращает обратно', r);
r = await as('head', `select wb_set_user_role('${U.m1}','user')`); check(!!r.err && /администратор/.test(r.err), 'руководитель подразделения роли не меняет', r);
r = await as('m1', `select wb_set_user_role('${U.m1}','administrator')`); check(!!r.err, 'менеджер не повышает себя через функцию', r);
r = await as('anon', `select wb_set_user_role('${U.m1}','administrator')`); check(!!r.err, 'без входа функция недоступна', r);
r = await as('admin', `select wb_set_user_role('${U.m1}','superuser')`); check(!!r.err && /Недопустимая/.test(r.err), 'неизвестную роль назначить нельзя', r);
r = await as('admin', `select wb_set_user_role('${U.admin}','manager')`); check(!!r.err && /последнего администратора/.test(r.err), 'нельзя снять роль с последнего администратора', r);
r = await db.query(`select role from profiles where id='${U.admin}'`); check(r.rows[0].role==='administrator', 'администратор остался администратором', r.rows);
await as('admin', `select wb_set_user_role('${U.head}','administrator')`);
r = await as('admin', `select wb_set_user_role('${U.admin}','manager')`); check(!r.err, 'если есть второй администратор — можно', r);
await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); update profiles set role='administrator' where id='${U.admin}'; update profiles set role='user' where id='${U.head}'`);
// rollback
await ex(fs.readFileSync(new URL('../03_security_rollback.sql', import.meta.url),'utf8'),'rollback');
r = await as('m1', `update clients set name='x' where id=2`); check(r.n===1, 'после отката — поведение как было раньше', r);
r = await db.query(`select count(*)::int c from pg_trigger where tgname='trg_prevent_self_role_change'`); check(r.rows[0].c===1, 'откат вернул старое правило trg_prevent_self_role_change', r.rows);
r = await db.query(`select count(*)::int c from pg_policies where policyname like 'wb\\_%'`); check(r.rows[0].c===0, 'откат убрал все политики wb_*', r.rows);
r = await db.query(`select count(*)::int c from pg_proc where proname='wb_set_user_role'`); check(r.rows[0].c===0, 'откат убрал функцию смены ролей', r.rows);
await ex(fs.readFileSync(new URL('../02_security_hardening.sql', import.meta.url),'utf8'),'reapply'); console.log('повторное применение после отката — ok');
// Предохранитель: без администратора скрипт не применяется
{ const db2 = new PGlite();
  await db2.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.profiles(id uuid primary key, role text); insert into public.profiles values ('00000000-0000-0000-0000-000000000001','manager');`);
  let e2 = null; try { await db2.exec(fs.readFileSync(new URL('../02_security_hardening.sql', import.meta.url),'utf8')); } catch (e) { e2 = e.message; }
  check(e2 && /администратора/.test(e2), 'без администратора скрипт останавливается с понятной ошибкой', e2);
}
console.log(fails ? 'ИТОГ: ПРОВАЛОВ ' + fails : 'ИТОГ: все проверки прошли'); process.exit(fails?1:0);
