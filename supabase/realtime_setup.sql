-- WiseBase CRM: включить обновления в реальном времени (Supabase Realtime)
-- Запустить ОДИН раз: Supabase → SQL Editor → New query → вставить → Run.
-- Скрипт безопасно запускать повторно: уже включённые таблицы пропускаются,
-- отсутствующие в базе — тоже.
do $$
declare t text;
begin
  foreach t in array array[
    'clients','tasks','offers','client_history',
    'links','staff_contacts','trips','access_delegations','profiles','reports'
  ] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t)
       and not exists (select 1 from pg_publication_tables
                       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Realtime включён для %', t;
    end if;
  end loop;
end $$;

-- Проверка: какие таблицы сейчас транслируют изменения в реальном времени
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
