-- WiseBase 29.2.4. Выполнить после 04_reports.sql. Не изменяет public.reports.
-- Перед запуском: резервная копия БД. Повторное выполнение безопасно.
begin;
create table if not exists public.report_plans (
 year integer not null check (year between 2000 and 2100),
 quarter integer not null check (quarter between 1 and 4),
 rows jsonb not null check (jsonb_typeof(rows)='array'),
 revision integer not null default 1,
 file_name text,
 uploaded_at timestamptz not null default now(),
 uploaded_by uuid not null default auth.uid(),
 uploaded_by_name text,
 primary key(year,quarter)
);
create or replace function public.wb_validate_report_plans()
returns trigger language plpgsql set search_path=public as $$
declare r jsonb; k text; keys text[] := '{}'; field text;
begin
 if jsonb_typeof(new.rows)<>'array' or jsonb_array_length(new.rows) not between 1 and 600 then
  raise exception 'Invalid monthly plan rows';
 end if;
 for r in select value from jsonb_array_elements(new.rows) loop
  if jsonb_typeof(r)<>'object' then raise exception 'Invalid plan row'; end if;
  if exists(select 1 from jsonb_object_keys(r) as x(key) where x.key not in ('month','name','dir','planShip','planReceipts','source')) then
   raise exception 'Only monthly plans are allowed; no actuals or margin';
  end if;
  if not (r ?& array['month','name','dir','planShip','planReceipts','source']) then raise exception 'Missing plan fields'; end if;
  if jsonb_typeof(r->'month')<>'number' or (r->>'month') !~ '^(1[012]|[1-9])$' then raise exception 'Invalid month';end if;
  if (((r->>'month')::integer-1)/3+1)<>new.quarter then raise exception 'Month outside quarter';end if;
  if jsonb_typeof(r->'name')<>'string' or length(trim(r->>'name')) not between 1 and 120 or
     jsonb_typeof(r->'dir')<>'string' or length(trim(r->>'dir')) not between 1 and 120 then raise exception 'Invalid manager identity';end if;
  if lower(trim(r->>'name')) ~ '^(итог|урал$|стариков([[:space:].]|$))' then raise exception 'Subtotal or fictitious row not permitted';end if;
  if jsonb_typeof(r->'source')<>'string' or length(r->>'source')>160 then raise exception 'Invalid source';end if;
  foreach field in array array['planShip','planReceipts'] loop
   if jsonb_typeof(r->field) not in ('null','number') then raise exception 'Plan must be a number or null';end if;
   if jsonb_typeof(r->field)='number' and ((r->>field)::numeric<0 or (r->>field)::numeric>1e15) then raise exception 'Invalid plan amount';end if;
  end loop;
  k=(r->>'month')||'|'||regexp_replace(replace(lower(trim(r->>'dir')),'ё','е'),'[[:space:].]+',' ','g')||'|'||regexp_replace(replace(lower(trim(r->>'name')),'ё','е'),'[[:space:].]+',' ','g');
  if k=any(keys) then raise exception 'Duplicate monthly manager';end if;keys=array_append(keys,k);
 end loop;
 if auth.uid() is null then raise exception 'Authentication required';end if;
 new.uploaded_at=clock_timestamp();new.uploaded_by=auth.uid();
 new.uploaded_by_name=left(coalesce((select full_name from public.profiles where id=auth.uid()),''),120);
 new.file_name=left(new.file_name,120);
 if tg_op='UPDATE' then
  if new.year<>old.year or new.quarter<>old.quarter then raise exception 'Cannot change quarter key';end if;
  new.revision=old.revision+1;
 else new.revision=1;end if;
 return new;
end $$;
revoke all on function public.wb_validate_report_plans() from public,anon;
drop trigger if exists wb_report_plans_validate on public.report_plans;
create trigger wb_report_plans_validate before insert or update on public.report_plans for each row execute function public.wb_validate_report_plans();
alter table public.report_plans enable row level security;
revoke all on public.report_plans from public,anon,authenticated;
grant select,insert,update on public.report_plans to authenticated;
drop policy if exists report_plans_select on public.report_plans;
create policy report_plans_select on public.report_plans for select to authenticated using (public.wb_reports_role() is not null);
drop policy if exists report_plans_insert on public.report_plans;
create policy report_plans_insert on public.report_plans for insert to authenticated with check (public.wb_reports_can_edit());
drop policy if exists report_plans_update on public.report_plans;
create policy report_plans_update on public.report_plans for update to authenticated using (public.wb_reports_can_edit()) with check (public.wb_reports_can_edit());
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='report_plans') then
  alter publication supabase_realtime add table public.report_plans;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
select tablename,policyname,cmd from pg_policies where schemaname='public' and tablename='report_plans';
