-- Consolidate recruitment positions and sites into one staff-managed table.
alter table public."Applicant_Masterlist" drop constraint "Applicant_Masterlist_Position_fkey";
alter table public."Applicant_Masterlist" drop constraint "Applicant_Masterlist_Site_fkey";
alter table ats_private.job_openings drop constraint job_openings_position_title_fkey;
alter table ats_private.job_openings drop constraint job_openings_site_fkey;
alter table ats_private.job_openings set schema public;
alter table public.job_openings rename to "Job_Opening";
alter table public."Job_Opening" enable row level security;
revoke all on public."Job_Opening" from public,anon,authenticated;
grant all on public."Job_Opening" to service_role;
CREATE OR REPLACE FUNCTION ats_private.apply_workbook_import(p_import uuid, p_limit integer DEFAULT 250)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare src record; owner_id integer; company_id uuid; p jsonb; target_table regclass; target_pk text; cols text; saved_id bigint; old_id bigint; field_name text; entry_id integer; entry_name text; category text; total integer:=0; failures integer:=0;
begin
 select admin_id into owner_id from ats_private.workbook_imports where id=p_import;
 if owner_id is null then raise exception 'Unknown import.';end if;
 perform pg_advisory_xact_lock(1096045397,owner_id);
 select "CompanyID" into company_id from public.admins where "AdminID"=owner_id and "Status"='Active';
 if not found then raise exception 'Import owner is unavailable.';end if;
 for src in select * from ats_private.workbook_import_rows where import_id=p_import and disposition='candidate' order by workbook desc,sheet,row_number limit least(p_limit,500) for update loop
 begin
  p:=src.payload; old_id:=null;
  if src.workbook=1 then
   target_table:='public."Applicant_Masterlist"'::regclass;target_pk:='ApplicantID';
   select a."ApplicantID" into old_id from public."Applicant_Masterlist" a where a."AdminID"=owner_id and (
    a."ClientRecordID"=p->>'ClientRecordID'
    or (nullif(lower(btrim(p->>'Email')),'') is not null and nullif(lower(btrim(coalesce(nullif(btrim(a."Email"),''),a."Email Address"))),'')=lower(btrim(p->>'Email')))
    or (ats_private.contact_key(p->>'ContactNumber') is not null and ats_private.contact_key(coalesce(nullif(btrim(a."ContactNumber"),''),a."Contact Number"))=ats_private.contact_key(p->>'ContactNumber'))
   ) order by a."ApplicantID" limit 1;
  else
   raise exception 'Only applicant imports are supported. MRF imports have been removed.';
  end if;
  if old_id is not null then
   update ats_private.workbook_import_rows set disposition='matched_existing',target_id=old_id,issue='Existing record preserved without overwriting.' where import_id=p_import and workbook=src.workbook and sheet=src.sheet and row_number=src.row_number;
   continue;
  end if;
  -- Reuse existing reference names case-insensitively. Original cell values remain archived.
  foreach field_name in array case when src.workbook=1 then array['Position','Site','Source'] else array['POSITION','Site'] end loop
   entry_name:=nullif(btrim(p->>field_name),'');if entry_name is null then continue;end if;entry_id:=null;
   category:=case field_name when 'Source' then 'source' when 'Site' then 'location' else 'position' end;
   if category='position' then
    select coalesce((select j.position_title from public."Job_Opening" j where j.admin_id=owner_id and lower(btrim(j.position_title))=lower(entry_name) limit 1),entry_name) into entry_name;
   elsif category='location' then
    select coalesce((select j.site from public."Job_Opening" j where j.admin_id=owner_id and lower(btrim(j.site))=lower(entry_name) limit 1),entry_name) into entry_name;
   else
    select "SourceID","SourceName" into entry_id,entry_name from public.sources where lower(btrim("SourceName"))=lower(entry_name) order by "SourceID" limit 1;
    if entry_id is null then entry_name:=btrim(p->>field_name);insert into public.sources("SourceName") values(entry_name) returning "SourceID" into entry_id;end if;
   end if;
   if category='source' then insert into ats_private.catalog_settings(admin_id,kind,entry_id) values(owner_id,category,entry_id) on conflict do nothing;end if;
   p:=p||jsonb_build_object(field_name,entry_name);
   if category='position' then p:=p||jsonb_build_object(case when src.workbook=1 then 'PositionApplied' else 'Position' end,entry_name);end if;
  end loop;
  p:=p||jsonb_build_object('AdminID',owner_id,'CompanyID',company_id,'WorkbookImportID',p_import,'ExcelSheet','AdminID '||owner_id||' / '||(p->>'ExcelSheet'));
  select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(p) keys(key) where exists(select 1 from pg_attribute where attrelid=target_table and attname=key and attnum>0 and not attisdropped) and key<>target_pk;
  execute format('insert into %s as t (%s) select %s from jsonb_populate_record(null::%s,$1) returning t.%I',target_table,cols,cols,target_table,target_pk) into saved_id using p;
  update ats_private.workbook_import_rows set disposition='imported',target_id=saved_id where import_id=p_import and workbook=src.workbook and sheet=src.sheet and row_number=src.row_number;
  total:=total+1;
 exception when others then
  update ats_private.workbook_import_rows set disposition='review_database_validation',issue=SQLSTATE||': '||SQLERRM where import_id=p_import and workbook=src.workbook and sheet=src.sheet and row_number=src.row_number;failures:=failures+1;
 end;
 end loop;
 return jsonb_build_object('imported',total,'held_for_review',failures);
end $function$;

CREATE OR REPLACE FUNCTION ats_private.job_rows(p_owner integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with jobs as(
 select j.*,c.applicant_count,c.filled_count,
 case when j.state='Occupied' then 0 else greatest(j.total_slots-c.filled_count,0) end remaining_slots
 from public."Job_Opening" j
 cross join lateral(
 select count(*)::integer applicant_count,(count(*) filter(where lower(btrim(a."Status")) in('hired','deployed')))::integer filled_count
 from public."Applicant_Masterlist" a where a."AdminID"=p_owner and
 (a."JobOpeningID"=j.id or a."JobOpeningID" is null and lower(btrim(coalesce(nullif(btrim(a."PositionApplied"),''),a."Position")))=lower(btrim(j.position_title)) and lower(btrim(a."Site"))=lower(btrim(j.site)))
 ) c where j.admin_id=p_owner
 ) select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object('status',case when remaining_slots>0 then 'Open' else 'Occupied' end) order by position_title,site),'[]') from jobs j;
$function$;

CREATE OR REPLACE FUNCTION public.ats_job_save(p_session_token text, p_job jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner_id integer;account jsonb;existing public."Job_Opening"%rowtype;title text:=btrim(p_job->>'position_title');location text:=btrim(p_job->>'site');job_description text:=btrim(p_job->>'description');capacity integer:=(p_job->>'total_slots')::integer;job_state text:=p_job->>'state';required text[];position_id integer;location_id integer;counted jsonb;target uuid;
begin
 if p_job ? 'address' and (jsonb_typeof(p_job->'address')<>'string' or length(p_job->>'address')>1000) then raise exception using errcode='22023',message='Unsupported job address (maximum 1000 characters).';end if;owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 if title is null or length(title) not between 2 and 120 or location is null or length(location) not between 1 and 120 or job_description is null or length(job_description) not between 1 and 5000 or capacity is null or capacity not between 0 and 999999 or job_state is null or job_state not in('Open','Occupied') then raise exception using errcode='22023',message='Enter a position, location, description, slots and status.';end if;
 select array_agg(value) into required from jsonb_array_elements_text(p_job->'required_documents');
 if required is null or cardinality(required)=0 or not required <@ array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO'] then raise exception using errcode='22023',message='Check at least one supported requirement.';end if;
 perform pg_advisory_xact_lock(1096045397,owner_id);
 if p_id is not null then
 select * into existing from public."Job_Opening" where id=p_id and admin_id=owner_id for update;
 if not found or not(account->>'accountType'='admin' or existing.creator_type=account->>'accountType' and existing.creator_id=(account->>'id')::integer) then raise exception using errcode='42501',message='Only the posting HR user or your admin can edit this opening.';end if;
 select j into counted from jsonb_array_elements(ats_private.job_rows(owner_id)) j where j->>'id'=p_id::text;
 if (counted->>'applicant_count')::integer>0 and (lower(title)<>lower(existing.position_title) or lower(location)<>lower(existing.site)) then raise exception using errcode='22023',message='This opening already has applicants. Create a new opening to change its position or location; historical counts are preserved.';end if;
 if capacity<(counted->>'filled_count')::integer then raise exception using errcode='22023',message='Total slots cannot be lower than recorded hired/deployed applicants.';end if;
 end if;
 select coalesce((select j.position_title from public."Job_Opening" j where j.admin_id=owner_id and lower(btrim(j.position_title))=lower(title) order by j.created_at limit 1),title) into title;
 select coalesce((select j.site from public."Job_Opening" j where j.admin_id=owner_id and lower(btrim(j.site))=lower(location) order by j.created_at limit 1),location) into location;
 if exists(select 1 from public."Job_Opening" j where j.admin_id=owner_id and lower(btrim(j.position_title))=lower(title) and lower(btrim(j.site))=lower(location) and (p_id is null or j.id<>p_id)) then raise exception using errcode='23505',message='This position and location already have an opening. Search for it and edit it.';end if;
 if p_id is null then
 insert into public."Job_Opening"(admin_id,position_title,site,description,total_slots,state,required_documents,creator_type,creator_id,creator_name) values(owner_id,title,location,job_description,capacity,job_state,required,account->>'accountType',(account->>'id')::integer,account->>'name') returning id into target;
 else update public."Job_Opening" set position_title=title,site=location,description=job_description,total_slots=capacity,state=job_state,required_documents=required,updated_at=clock_timestamp() where id=p_id;target:=p_id;end if;
 if p_job ? 'address' then update public."Job_Opening" set address=btrim(p_job->>'address') where id=target and admin_id=owner_id;end if;return jsonb_build_object('saved',true,'id',target,'AdminID',owner_id);
end $function$;

CREATE OR REPLACE FUNCTION ats_private.application_finish(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare inv ats_private.applicant_invitations%rowtype;data jsonb;problems text[];job public."Job_Opening"%rowtype;current_job jsonb;target bigint;company uuid;
begin
 select * into inv from ats_private.applicant_invitations where id=p_id for update;
 if not found or inv.revoked_at is not null then return jsonb_build_object('closed',true);end if;
 if ats_private.expire_requirements(inv.id) then return jsonb_build_object('closed',true,'expired',true);end if;
 if inv.finished_at is not null then return jsonb_build_object('closed',false,'phase','requirements');end if;
 if inv.started_at is null then raise exception 'Open the application link first.';end if;
 data:=inv.draft;
 if coalesce(data->>'JobOpeningID','')!~'^[a-f0-9-]{36}$' then raise exception using errcode='22023',message='Choose a job opening with an available position and location.';end if;
 perform pg_advisory_xact_lock(1096045397,inv.admin_id);
 select * into job from public."Job_Opening" where id=(data->>'JobOpeningID')::uuid and admin_id=inv.admin_id for update;
 if not found then raise exception using errcode='42501',message='This job opening is unavailable for your invitation.';end if;
 data:=data||jsonb_build_object('Position',job.position_title,'Site',job.site);
 problems:=ats_private.application_issues(inv,data);
 if cardinality(problems)>0 then raise exception using errcode='22023',message='Correct the application information: '||array_to_string(problems,'; ');end if;
 select "CompanyID" into company from public.admins where "AdminID"=inv.admin_id;
 perform set_config('ats.activity.actor',jsonb_build_object('type','system','name','Applicant invitation','AdminID',inv.admin_id)::text,true);
 insert into public."Applicant_Masterlist"("AdminID","CompanyID","ApplicationInvitationID","JobOpeningID","Name","FullName","Position","PositionApplied","Source","Site","Email Address","Email","Contact Number","ContactNumber","Current Address","Gender","Notes","Remarks","Date","DateApplied","Submission Date","Status","StatusChangedAt")
 values(inv.admin_id,company,inv.id,job.id,coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'),coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'),job.position_title,job.position_title,data->>'Source',job.site,nullif(lower(btrim(data->>'Email Address')),''),nullif(lower(btrim(data->>'Email Address')),''),nullif(btrim(data->>'Contact Number'),''),nullif(btrim(data->>'Contact Number'),''),nullif(data->>'Current Address',''),nullif(data->>'Gender',''),left(coalesce(data->>'Notes',''),2000),'Job opening application submitted',(clock_timestamp() at time zone 'Asia/Manila')::date,clock_timestamp(),(clock_timestamp() at time zone 'Asia/Manila')::date,'For Pooling',clock_timestamp()) returning "ApplicantID" into target;
 update ats_private.applicant_invitations set finished_at=clock_timestamp(),applicant_id=target,result='For Pooling',draft=data,issues='{}',job_opening_id=job.id,job_snapshot=jsonb_build_object('id',job.id,'position_title',job.position_title,'site',job.site,'description',job.description,'address',job.address,'required_documents',job.required_documents),required_documents=job.required_documents where id=inv.id;
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(inv.admin_id,'system','Applicant invitation','created','applicant',target::text,coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'));
 return jsonb_build_object('closed',false,'phase','requirements','saved',true,'status','For Pooling');
end $function$;

CREATE OR REPLACE FUNCTION ats_private.applicant_job_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare job public."Job_Opening"%rowtype;already_filled boolean:=false;filled integer;
begin
 if new."JobOpeningID" is null then return new;end if;
 if tg_op='UPDATE' then
 if new."JobOpeningID"=old."JobOpeningID" and (new."Position",new."Site",new."Status") is not distinct from (old."Position",old."Site",old."Status") then return new;end if;
 end if;
 select * into job from public."Job_Opening" where id=new."JobOpeningID" and admin_id=new."AdminID" for update;
 if not found then raise exception using errcode='42501',message='Job opening belongs to another AdminID.';end if;
 if tg_op='UPDATE' then
 already_filled:=lower(btrim(old."Status")) in('hired','deployed') and new."JobOpeningID"=old."JobOpeningID";
 if new."JobOpeningID"=old."JobOpeningID" and (new."Position" is distinct from old."Position" or new."Site" is distinct from old."Site") then new."JobOpeningID":=null;return new;end if;
 end if;
 if lower(btrim(new."Status")) in('hired','deployed') and not already_filled then
 select (j->>'filled_count')::integer into filled from jsonb_array_elements(ats_private.job_rows(new."AdminID")) j where j->>'id'=job.id::text;
 if job.state<>'Open' or filled>=job.total_slots then raise exception using errcode='22023',message='This job opening has no available slots.';end if;
 end if;
 new."Position":=job.position_title;new."PositionApplied":=job.position_title;new."Site":=job.site;return new;
end $function$;


create or replace function ats_private.application_positions(p_owner integer) returns jsonb language sql stable set search_path='' as $fn$
 select coalesce(jsonb_agg(to_jsonb(p) order by name),'[]') from (
 select j->>'position_title' name,sum((j->>'remaining_slots')::integer)::integer remaining_slots from jsonb_array_elements(ats_private.job_rows(p_owner)) j group by 1 having sum((j->>'remaining_slots')::integer)>0
 ) p;
$fn$;
create or replace function public.ats_catalog_list(p_session_token text) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;result jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);
 with source_rows as (
 select 'source'::text kind,s."SourceID" id,s."SourceName" name,0 slots_available,0 hired_count
 from public.sources s where exists(select 1 from ats_private.catalog_defaults d where d.kind='source' and d.entry_id=s."SourceID") or exists(select 1 from ats_private.catalog_settings c where c.admin_id=owner_id and c.kind='source' and c.entry_id=s."SourceID")
 ), names as (
 select position_title name,'position'::text kind from public."Job_Opening" where admin_id=owner_id
 union select site,'location' from public."Job_Opening" where admin_id=owner_id
 union select coalesce(nullif(btrim("PositionApplied"),''),"Position"),'position' from public."Applicant_Masterlist" where "AdminID"=owner_id
 union select "Site",'location' from public."Applicant_Masterlist" where "AdminID"=owner_id
 ), job_totals as (
 select j->>'position_title' name,sum((j->>'total_slots')::integer)::integer capacity,sum((j->>'remaining_slots')::integer)::integer remaining
 from jsonb_array_elements(ats_private.job_rows(owner_id)) j group by 1
 ), counts as (
 select lower(btrim(coalesce(nullif(btrim("PositionApplied"),''),"Position"))) name,count(*)::integer applicants,(count(*) filter(where lower(btrim("Status")) in('hired','deployed')))::integer filled
 from public."Applicant_Masterlist" where "AdminID"=owner_id group by 1
 ), positions as (
 select (row_number() over(order by n.name))::integer id,n.name,'position'::text kind,coalesce(t.capacity,0) slots_available,coalesce(c.filled,0) hired_count,coalesce(c.filled,0) filled_count,coalesce(c.applicants,0) applicant_count,coalesce(t.remaining,0) remaining_slots
 from names n left join job_totals t on t.name=n.name left join counts c on c.name=lower(btrim(n.name)) where n.kind='position' and nullif(btrim(n.name),'') is not null
 ), locations as (
 select (row_number() over(order by name))::integer id,name,'location'::text kind,0 slots_available,0 hired_count from names where kind='location' and nullif(btrim(name),'') is not null
 )
 select jsonb_build_object('AdminID',owner_id,
 'sources',(select coalesce(jsonb_agg(to_jsonb(s) order by name),'[]') from source_rows s),
 'positions',(select coalesce(jsonb_agg(to_jsonb(p) order by name),'[]') from positions p),
 'locations',(select coalesce(jsonb_agg(to_jsonb(l) order by name),'[]') from locations l)) into result;
 return result;
end $fn$;
create or replace function public.ats_catalog_save(p_session_token text,p_kind text,p_name text,p_slots integer default 0,p_entry_id integer default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;entry integer;existing_name text;actor jsonb;was_existing boolean;
begin
 owner_id:=ats_private.require_admin(p_session_token);actor:=ats_private.session_account(p_session_token);
 if p_kind is distinct from 'source' then raise exception using errcode='22023',message='Add the position and location together in Job Openings.';end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'Enter a source name (maximum 80 characters).';end if;
 perform pg_advisory_xact_lock(1096045397,owner_id);
 if p_entry_id is not null then
 select s."SourceName" into existing_name from public.sources s where s."SourceID"=p_entry_id and (exists(select 1 from ats_private.catalog_defaults d where d.kind='source' and d.entry_id=s."SourceID") or exists(select 1 from ats_private.catalog_settings c where c.admin_id=owner_id and c.kind='source' and c.entry_id=s."SourceID"));
 if not found or existing_name is distinct from btrim(p_name) then raise exception 'Existing source names cannot be changed.';end if;entry:=p_entry_id;
 else
 select "SourceID" into entry from public.sources where lower(btrim("SourceName"))=lower(btrim(p_name)) order by "SourceID" limit 1;
 if entry is null then insert into public.sources("SourceName") values(btrim(p_name)) returning "SourceID" into entry;end if;
 end if;
 select exists(select 1 from ats_private.catalog_settings where admin_id=owner_id and kind='source' and entry_id=entry) into was_existing;
 insert into ats_private.catalog_settings(admin_id,kind,entry_id) values(owner_id,'source',entry) on conflict do nothing;
 insert into ats_private.activity(admin_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,entity_label) values(owner_id,'admin',(actor->>'id')::integer,actor->>'name',case when was_existing then 'updated' else 'created' end,'setting','source:'||entry,'source: '||btrim(p_name));
 return jsonb_build_object('saved',true,'id',entry,'AdminID',owner_id,'kind','source');
end $fn$;
delete from ats_private.catalog_defaults where kind in('position','location');
delete from ats_private.catalog_settings where kind in('position','location');
drop table public.positions;
drop table public.location;
notify pgrst,'reload schema';

