begin;
create table if not exists ats_private.job_openings(
 id uuid primary key default gen_random_uuid(),admin_id integer not null references public.admins("AdminID"),
 position_title text not null references public.positions(position_title) on update cascade,
 site text not null references public.location("Site") on update cascade,
 description text not null check(length(description) between 1 and 5000),
 total_slots integer not null check(total_slots between 0 and 999999),
 state text not null default 'Open' check(state in('Open','Occupied')),
 required_documents text[] not null default array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO'],
 creator_type text not null,creator_id integer not null,creator_name text not null,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(id,admin_id),check(cardinality(required_documents)>0 and required_documents <@ array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO'])
);
create unique index if not exists ats_job_position_site_unique on ats_private.job_openings(admin_id,lower(btrim(position_title)),lower(btrim(site)));
alter table ats_private.job_openings enable row level security;
revoke all on ats_private.job_openings from public,anon,authenticated;
alter table public."Applicant_Masterlist" add column if not exists "JobOpeningID" uuid;
do $ddl$ declare definition text;begin
 if not exists(select 1 from pg_constraint where conrelid='public."Applicant_Masterlist"'::regclass and conname='ats_applicant_job_owner') then
 alter table public."Applicant_Masterlist" add constraint ats_applicant_job_owner foreign key("JobOpeningID","AdminID") references ats_private.job_openings(id,admin_id);
 end if;
 select pg_get_functiondef('public.ats_applicant_save(text,jsonb,bigint,text)'::regprocedure) into definition;
 if definition not like '%''JobOpeningID''%' then definition:=replace(definition,'field_name in(''ApplicationInvitationID''','field_name in(''JobOpeningID'',''ApplicationInvitationID''');execute definition;end if;
end $ddl$;
create index if not exists ats_applicant_job on public."Applicant_Masterlist"("AdminID","JobOpeningID");

create or replace function ats_private.job_rows(p_owner integer) returns jsonb language sql stable set search_path='' as $fn$
 with jobs as(
 select j.*,c.applicant_count,c.filled_count,
 case when j.state='Occupied' then 0 else greatest(j.total_slots-c.filled_count,0) end remaining_slots
 from ats_private.job_openings j
 cross join lateral(
 select count(*)::integer applicant_count,(count(*) filter(where lower(btrim(a."Status")) in('hired','deployed')))::integer filled_count
 from public."Applicant_Masterlist" a where a."AdminID"=p_owner and
 (a."JobOpeningID"=j.id or a."JobOpeningID" is null and lower(btrim(coalesce(nullif(btrim(a."PositionApplied"),''),a."Position")))=lower(btrim(j.position_title)) and lower(btrim(a."Site"))=lower(btrim(j.site)))
 ) c where j.admin_id=p_owner
 ) select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object('status',case when remaining_slots>0 then 'Open' else 'Occupied' end) order by position_title,site),'[]') from jobs j;
$fn$;
create or replace function public.ats_jobs_list(p_session_token text) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;data jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 select coalesce(jsonb_agg(j||jsonb_build_object('can_edit',account->>'accountType'='admin' or j->>'creator_type'=account->>'accountType' and j->>'creator_id'=account->>'id')),'[]') into data from jsonb_array_elements(ats_private.job_rows(owner_id)) j;
 return jsonb_build_object('AdminID',owner_id,'jobs',data);
end $fn$;
create or replace function public.ats_job_save(p_session_token text,p_job jsonb,p_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;existing ats_private.job_openings%rowtype;title text:=btrim(p_job->>'position_title');location text:=btrim(p_job->>'site');job_description text:=btrim(p_job->>'description');capacity integer:=(p_job->>'total_slots')::integer;job_state text:=p_job->>'state';required text[];position_id integer;location_id integer;counted jsonb;target uuid;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 if title is null or length(title) not between 2 and 120 or location is null or length(location) not between 1 and 120 or job_description is null or length(job_description) not between 1 and 5000 or capacity is null or capacity not between 0 and 999999 or job_state is null or job_state not in('Open','Occupied') then raise exception using errcode='22023',message='Enter a position, location, description, slots and status.';end if;
 select array_agg(value) into required from jsonb_array_elements_text(p_job->'required_documents');
 if required is null or cardinality(required)=0 or not required <@ array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO'] then raise exception using errcode='22023',message='Check at least one supported requirement.';end if;
 perform pg_advisory_xact_lock(1096045397,owner_id);
 if p_id is not null then
 select * into existing from ats_private.job_openings where id=p_id and admin_id=owner_id for update;
 if not found or not(account->>'accountType'='admin' or existing.creator_type=account->>'accountType' and existing.creator_id=(account->>'id')::integer) then raise exception using errcode='42501',message='Only the posting HR user or your admin can edit this opening.';end if;
 select j into counted from jsonb_array_elements(ats_private.job_rows(owner_id)) j where j->>'id'=p_id::text;
 if (counted->>'applicant_count')::integer>0 and (lower(title)<>lower(existing.position_title) or lower(location)<>lower(existing.site)) then raise exception using errcode='22023',message='This opening already has applicants. Create a new opening to change its position or location; historical counts are preserved.';end if;
 if capacity<(counted->>'filled_count')::integer then raise exception using errcode='22023',message='Total slots cannot be lower than recorded hired/deployed applicants.';end if;
 end if;
 select p.position_id,p.position_title into position_id,title from public.positions p where lower(btrim(p.position_title))=lower(title) order by p.position_id limit 1;
 if not found then title:=btrim(p_job->>'position_title');insert into public.positions(position_title) values(title) returning positions.position_id into position_id;end if;
 select l."LocationID",l."Site" into location_id,location from public.location l where lower(btrim(l."Site"))=lower(location) order by l."LocationID" limit 1;
 if not found then location:=btrim(p_job->>'site');insert into public.location("Site") values(location) returning "LocationID" into location_id;end if;
 insert into ats_private.catalog_settings(admin_id,kind,entry_id) values(owner_id,'position',position_id),(owner_id,'location',location_id) on conflict do nothing;
 if exists(select 1 from ats_private.job_openings j where j.admin_id=owner_id and lower(btrim(j.position_title))=lower(title) and lower(btrim(j.site))=lower(location) and (p_id is null or j.id<>p_id)) then raise exception using errcode='23505',message='This position and location already have an opening. Search for it and edit it.';end if;
 if p_id is null then
 insert into ats_private.job_openings(admin_id,position_title,site,description,total_slots,state,required_documents,creator_type,creator_id,creator_name) values(owner_id,title,location,job_description,capacity,job_state,required,account->>'accountType',(account->>'id')::integer,account->>'name') returning id into target;
 else update ats_private.job_openings set position_title=title,site=location,description=job_description,total_slots=capacity,state=job_state,required_documents=required,updated_at=clock_timestamp() where id=p_id;target:=p_id;end if;
 return jsonb_build_object('saved',true,'id',target,'AdminID',owner_id);
end $fn$;

create or replace function ats_private.applicant_job_rules() returns trigger language plpgsql set search_path='' as $fn$
declare job ats_private.job_openings%rowtype;already_filled boolean:=false;filled integer;
begin
 if new."JobOpeningID" is null then return new;end if;
 if tg_op='UPDATE' then
 if new."JobOpeningID"=old."JobOpeningID" and (new."Position",new."Site",new."Status") is not distinct from (old."Position",old."Site",old."Status") then return new;end if;
 end if;
 select * into job from ats_private.job_openings where id=new."JobOpeningID" and admin_id=new."AdminID" for update;
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
end $fn$;
drop trigger if exists ats_applicant_job_rules on public."Applicant_Masterlist";
create trigger ats_applicant_job_rules before insert or update on public."Applicant_Masterlist" for each row execute function ats_private.applicant_job_rules();

create table if not exists ats_private.requirement_events(
 id bigint generated always as identity primary key,admin_id integer not null references public.admins("AdminID"),
 applicant_id bigint not null references public."Applicant_Masterlist"("ApplicantID") on delete cascade,
 document_id uuid references ats_private.applicant_documents(id) on delete set null,
 document_type text not null,action text not null,actor_name text,created_at timestamptz not null default clock_timestamp(),source_key text unique
);
alter table ats_private.requirement_events enable row level security;
revoke all on ats_private.requirement_events from public,anon,authenticated;
create index if not exists ats_requirement_events_owner on ats_private.requirement_events(admin_id,created_at desc,id desc);
create or replace function ats_private.requirement_event_record() returns trigger language plpgsql set search_path='' as $fn$
declare doc ats_private.applicant_documents%rowtype;
begin
 if tg_op='UPDATE' and new.status=old.status and new.comment=old.comment then return new;end if;
 select * into doc from ats_private.applicant_documents where id=new.document_id;
 insert into ats_private.requirement_events(admin_id,applicant_id,document_id,document_type,action,actor_name,created_at,source_key)
 values(doc.admin_id,doc.applicant_id,doc.id,doc.document_type,new.status,coalesce(new.reviewer->>'name','Recruitment team'),new.reviewed_at,doc.id||':'||new.reviewed_at||':'||new.status) on conflict(source_key) do nothing;
 return new;
end $fn$;
drop trigger if exists ats_requirement_event_record on ats_private.document_reviews;
create trigger ats_requirement_event_record after insert or update on ats_private.document_reviews for each row execute function ats_private.requirement_event_record();
insert into ats_private.requirement_events(admin_id,applicant_id,document_id,document_type,action,actor_name,created_at,source_key)
select d.admin_id,d.applicant_id,d.id,d.document_type,coalesce(r.status,'Submitted'),coalesce(r.reviewer->>'name','Applicant'),coalesce(r.reviewed_at,d.created_at),d.id||':'||coalesce(r.reviewed_at,d.created_at)||':'||coalesce(r.status,'Submitted')
from ats_private.applicant_documents d left join ats_private.document_reviews r on r.document_id=d.id on conflict(source_key) do nothing;
create or replace function public.ats_requirement_activity(p_session_token text,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;output jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);
 select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]') into output from
 (select r.id,r.applicant_id,coalesce(nullif(a."FullName",''),nullif(a."Name",''),'Incomplete application') applicant_name,r.document_type,r.action,r.actor_name,r.created_at
 from ats_private.requirement_events r join public."Applicant_Masterlist" a on a."ApplicantID"=r.applicant_id and a."AdminID"=r.admin_id
 where r.admin_id=owner_id order by r.created_at desc,r.id desc limit least(greatest(coalesce(p_limit,20),1),50)) e;
 return output;
end $fn$;

-- Explicitly requested starter openings for AdminID 2. Existing records and
-- historical counts are not deleted or reset; only unoccupied capacity is added.
do $seed$ declare item record;hired integer;owner_name text;
begin
 perform pg_advisory_xact_lock(1096045397,2);
 if not exists(select 1 from ats_private.job_openings where admin_id=2) then
 select "FullName" into owner_name from public.admins where "AdminID"=2;
 for item in select * from (values
 ('Driver','ALABANG','Transport goods safely, check delivery documents, inspect the assigned vehicle and coordinate with the site team.','Open'),
 ('Picker','PARAÑAQUE','Pick and prepare orders accurately, verify item quantities and help maintain an organized warehouse.','Open'),
 ('Checker','PASIG','Check inbound and outbound items, reconcile quantities and report inventory discrepancies to the site team.','Open'),
 ('Encoder','QUEZON - OLEO FATS','Encode operational records accurately, verify source documents and keep site reports up to date.','Open'),
 ('Safety Officer','PARAÑAQUE - PINNACLE','Support workplace safety checks, maintain safety documentation and coordinate corrective actions at the site.','Open'),
 ('Reach Truck / Forklift Operator','PASIG - SHELL','Operate material-handling equipment according to site procedures and complete routine equipment checks.','Occupied'),
 ('Inventory Analyst','ZABARTE','Monitor inventory records, investigate discrepancies and prepare accurate stock reports.','Occupied'),
 ('Site Engineer','NAVOTAS','Coordinate site work, review progress and maintain the project records required by the site team.','Occupied')
 ) v(title,site,description,state) loop
 select count(*)::integer into hired from public."Applicant_Masterlist" a where a."AdminID"=2 and lower(btrim(coalesce(nullif(btrim(a."PositionApplied"),''),a."Position")))=lower(item.title) and lower(btrim(a."Site"))=lower(item.site) and lower(btrim(a."Status")) in('hired','deployed');
 insert into ats_private.job_openings(admin_id,position_title,site,description,total_slots,state,creator_type,creator_id,creator_name)
 values(2,item.title,item.site,item.description,hired+case when item.state='Open' then 1 else 0 end,item.state,'admin',2,coalesce(owner_name,'Administrator'));
 end loop;
 end if;
end $seed$;
revoke all on function ats_private.job_rows(integer),ats_private.applicant_job_rules(),ats_private.requirement_event_record() from public,anon,authenticated;
revoke all on function public.ats_jobs_list(text),public.ats_job_save(text,jsonb,uuid),public.ats_requirement_activity(text,integer) from public,anon,authenticated;
grant execute on function public.ats_jobs_list(text),public.ats_job_save(text,jsonb,uuid),public.ats_requirement_activity(text,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
