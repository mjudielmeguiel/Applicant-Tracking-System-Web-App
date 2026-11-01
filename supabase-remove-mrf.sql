-- Explicitly requested removal of all MRF records and the MRF table.
-- Applicant records, job openings and shared catalog/history remain intact.
begin;
do $cleanup$ declare definition text;first_at integer;last_at integer;
begin
 if to_regprocedure('ats_private.apply_workbook_import(uuid,integer)') is not null then
 select pg_get_functiondef('ats_private.apply_workbook_import(uuid,integer)'::regprocedure) into definition;
 first_at:=strpos(definition,E'  else\n   target_table:=');
 last_at:=strpos(definition,E'  if old_id is not null then');
 if definition like '%MRF_Monitoring%' then
 if first_at=0 or last_at<=first_at then raise exception 'Import cleanup requires inspection';end if;
 definition:=substr(definition,1,first_at-1)||E'  else\n   raise exception ''Only applicant imports are supported. MRF imports have been removed.'';\n  end if;\n'||substr(definition,last_at);
 execute definition;
 end if;
 end if;
end $cleanup$;
drop function if exists public.ats_mrf_list(text,integer,integer);
drop function if exists public.ats_mrf_save(text,jsonb,bigint);
drop function if exists public.ats_mrf_context(text);
drop table if exists public."MRF_Monitoring";
delete from ats_private.workbook_import_rows where workbook=0;
update ats_private.workbook_imports i set
 files=(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements(i.files) f where coalesce(f->>'name','') not ilike '%MRF%'),
 sheets=(select coalesce(jsonb_agg(s),'[]') from jsonb_array_elements(i.sheets) s where s->>'workbook'<>'0');
delete from ats_private.activity where lower(entity_type) in('mrf','mrf_monitoring');
notify pgrst,'reload schema';
commit;
