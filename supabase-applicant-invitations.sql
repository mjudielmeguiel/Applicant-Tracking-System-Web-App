begin;
create table if not exists ats_private.invitation_policy (
 admin_id integer primary key references public.admins("AdminID"),
 applicant_minutes integer not null default 60 check(applicant_minutes in(30,60,90,120,150,180,1440,2880,4320,10080)),
 user_minutes integer not null default 30 check(user_minutes in(30,60,90,120,150,180,1440,2880,4320,10080)),
 admin_minutes integer not null default 30 check(admin_minutes in(30,60,90,120,150,180,1440,2880,4320,10080)),
 required_fields text[] not null default array['Name','Position','Source','Email Address','Contact Number','Current Address','Site'],
 instructions text not null default 'Enter your own accurate information. Complete every field marked required. Your countdown starts when you open this link and does not restart if you leave. Changes are saved automatically while you are online. Submit before the deadline. When time expires, your last saved draft is submitted automatically; missing or invalid required information results in rejection. After submission this link cannot be used again.'
);
create table if not exists ats_private.applicant_invitations (
 id uuid primary key default gen_random_uuid(), admin_id integer not null references public.admins("AdminID"),
 token_hash text not null unique, label text not null default 'Applicant invitation',
 minutes integer not null check(minutes in(30,60,90,120,150,180,1440,2880,4320,10080)),
 required_fields text[] not null, instructions text not null, choices jsonb not null,
 created_at timestamptz not null default clock_timestamp(),started_at timestamptz,deadline timestamptz,
 draft jsonb not null default '{}', revision integer not null default 0,
 finished_at timestamptz,revoked_at timestamptz,applicant_id bigint,result text,issues text[],
 unique(id,admin_id),
 check((started_at is null and deadline is null) or (started_at is not null and deadline is not null))
);
alter table ats_private.invitation_policy enable row level security;
alter table ats_private.applicant_invitations enable row level security;
revoke all on ats_private.invitation_policy,ats_private.applicant_invitations from public,anon,authenticated;
create index if not exists ats_applicant_invites_due on ats_private.applicant_invitations(deadline) where finished_at is null and revoked_at is null and started_at is not null;
create index if not exists ats_applicant_invites_owner on ats_private.applicant_invitations(admin_id,created_at desc);
alter table public."Applicant_Masterlist" add column if not exists "ApplicationInvitationID" uuid;
create unique index if not exists ats_applicant_invitation_once on public."Applicant_Masterlist"("ApplicationInvitationID") where "ApplicationInvitationID" is not null;
do $ddl$ declare old_check text; definition text;
begin
 if not exists(select 1 from pg_constraint where conrelid='public."Applicant_Masterlist"'::regclass and conname='ats_applicant_invitation_owner') then
 alter table public."Applicant_Masterlist" add constraint ats_applicant_invitation_owner foreign key("ApplicationInvitationID","AdminID") references ats_private.applicant_invitations(id,admin_id);
 end if;
 select pg_get_expr(conbin,conrelid) into old_check from pg_constraint where conrelid='public."Applicant_Masterlist"'::regclass and conname='ats_applicant_fields';
 if old_check not like '%ApplicationInvitationID%' then
 execute 'alter table public."Applicant_Masterlist" drop constraint ats_applicant_fields';
 execute 'alter table public."Applicant_Masterlist" add constraint ats_applicant_fields check (('||old_check||') or ("ApplicationInvitationID" is not null and "AdminID" is not null and "Status"=''Rejected'')) not valid';
 end if;
 select pg_get_functiondef('public.ats_applicant_save(text,jsonb,bigint,text)'::regprocedure) into definition;
 if definition not like '%''ApplicationInvitationID''%' then
 definition:=replace(definition,'field_name in(''StageVersion''','field_name in(''ApplicationInvitationID'',''StageVersion''');
 if definition not like '%''ApplicationInvitationID''%' then raise exception 'Could not protect invitation marker';end if;
 execute definition;
 end if;
end $ddl$;

create or replace function public.ats_invitation_settings(p_session_token text,p_settings jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer; policy ats_private.invitation_policy%rowtype; fields text[];
begin
 owner_id:=ats_private.require_admin(p_session_token);
 insert into ats_private.invitation_policy(admin_id) values(owner_id) on conflict do nothing;
 if p_settings is not null then
 if jsonb_typeof(p_settings)<>'object' then raise exception 'Invalid settings';end if;
 select array_agg(value) into fields from jsonb_array_elements_text(p_settings->'required_fields');
 if fields is null or not fields @> array['Name','Position','Source'] or not fields <@ array['Name','Position','Source','Email Address','Contact Number','Current Address','Site','Gender'] then raise exception 'Name, position and source must be required; choose supported fields.';end if;
 if length(p_settings->>'instructions') not between 1 and 4000 then raise exception 'Instructions must contain 1–4000 characters';end if;
 update ats_private.invitation_policy set applicant_minutes=(p_settings->>'applicant_minutes')::integer,user_minutes=(p_settings->>'user_minutes')::integer,admin_minutes=(p_settings->>'admin_minutes')::integer,required_fields=fields,instructions=p_settings->>'instructions' where admin_id=owner_id;
 end if;
 select * into policy from ats_private.invitation_policy where admin_id=owner_id;
 return to_jsonb(policy);
end $fn$;
create or replace function ats_private.account_invitation_duration() returns trigger language plpgsql set search_path='' as $fn$
declare minutes integer;
begin
 select case when new.invite_type='admin_handover' then admin_minutes else user_minutes end into minutes from ats_private.invitation_policy where admin_id=new.admin_id;
 new.expires_at:=new.created_at+make_interval(mins=>coalesce(minutes,30));return new;
end $fn$;
drop trigger if exists ats_account_invitation_duration on ats_private.user_invitations;
create trigger ats_account_invitation_duration before insert on ats_private.user_invitations for each row execute function ats_private.account_invitation_duration();

create or replace function public.ats_applicant_invite_create(p_session_token text,p_label text default null,p_minutes integer default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer; policy ats_private.invitation_policy%rowtype; token text; invitation ats_private.applicant_invitations%rowtype; options jsonb;
begin
 owner_id:=ats_private.require_admin(p_session_token);
 perform public.ats_invitation_settings(p_session_token);
 select * into policy from ats_private.invitation_policy where admin_id=owner_id;
 if length(coalesce(p_label,''))>200 then raise exception 'Invitation label is too long';end if;
 with entries as (
 select 'source' kind,"SourceID" id,"SourceName" name from public.sources union all select 'position',position_id,position_title from public.positions union all select 'location',"LocationID","Site" from public.location
 ), visible as (
 select e.kind,e.name from entries e where exists(select 1 from ats_private.catalog_settings s where s.admin_id=owner_id and s.kind=e.kind and s.entry_id=e.id) or exists(select 1 from ats_private.catalog_defaults d where d.kind=e.kind and d.entry_id=e.id)
 ) select jsonb_build_object('Position',coalesce(jsonb_agg(name order by name) filter(where kind='position'),'[]'),'Source',coalesce(jsonb_agg(name order by name) filter(where kind='source'),'[]'),'Site',coalesce(jsonb_agg(name order by name) filter(where kind='location'),'[]')) into options from visible;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into ats_private.applicant_invitations(admin_id,token_hash,label,minutes,required_fields,instructions,choices)
 values(owner_id,ats_private.token_digest(token),coalesce(nullif(btrim(p_label),''),'Applicant invitation'),coalesce(p_minutes,policy.applicant_minutes),policy.required_fields,policy.instructions,options) returning * into invitation;
 return jsonb_build_object('id',invitation.id,'token',token,'AdminID',owner_id,'minutes',invitation.minutes);
end $fn$;

create or replace function ats_private.application_issues(inv ats_private.applicant_invitations,data jsonb)
returns text[] language plpgsql set search_path='' as $fn$
declare issues text[]:='{}';field text;value text;
begin
 foreach field in array inv.required_fields loop
 if nullif(btrim(data->>field),'') is null then issues:=array_append(issues,field||': required');end if;
 end loop;
 if nullif(btrim(data->>'Name'),'') is not null and length(btrim(data->>'Name')) not between 2 and 120 then issues:=array_append(issues,'Name: use 2–120 characters');end if;
 if nullif(data->>'Email Address','') is not null and (length(data->>'Email Address')>254 or (data->>'Email Address')!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$') then issues:=array_append(issues,'Email Address: invalid');end if;
 if nullif(data->>'Contact Number','') is not null and (data->>'Contact Number')!~'^[+()0-9 .-]{7,25}$' then issues:=array_append(issues,'Contact Number: invalid');end if;
 if nullif(data->>'Email Address','') is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=inv.admin_id and nullif(lower(btrim(coalesce(nullif(btrim(a."Email"),''),a."Email Address"))),'')=lower(btrim(data->>'Email Address'))) then issues:=array_append(issues,'Email Address: already registered');end if;
 if nullif(data->>'Contact Number','') is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=inv.admin_id and ats_private.contact_key(coalesce(nullif(btrim(a."ContactNumber"),''),a."Contact Number"))=ats_private.contact_key(data->>'Contact Number')) then issues:=array_append(issues,'Contact Number: already registered');end if;
 if nullif(data->>'Source','') is not null and length(data->>'Source')>80 then issues:=array_append(issues,'Source: too long');end if;
 foreach field in array array['Position','Source','Site'] loop
 value:=nullif(data->>field,'');
 if value is not null and not (inv.choices->field)?value then issues:=array_append(issues,field||': select an available option');end if;
 end loop;
 return issues;
end $fn$;

create or replace function ats_private.application_finish(p_id uuid)
returns jsonb language plpgsql set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype; data jsonb; problems text[];email text;phone text;position text;site text;source text;target bigint;status text;company uuid;reason text;
begin
 select * into inv from ats_private.applicant_invitations where id=p_id for update;
 if not found or inv.revoked_at is not null then return jsonb_build_object('closed',true);end if;
 if inv.finished_at is not null then return jsonb_build_object('closed',true,'status',inv.result);end if;
 if inv.started_at is null then raise exception 'Application has not started';end if;
 data:=inv.draft;problems:=ats_private.application_issues(inv,data);
 perform pg_advisory_xact_lock(1096045397,inv.admin_id);
 email:=nullif(lower(btrim(data->>'Email Address')),'');phone:=nullif(btrim(data->>'Contact Number'),'');
 if email is not null and (email!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=inv.admin_id and nullif(lower(btrim(coalesce(nullif(btrim(a."Email"),''),a."Email Address"))),'')=email)) then problems:=array_append(problems,'Email Address: invalid or already registered');email:=null;end if;
 if phone is not null and (phone!~'^[+()0-9 .-]{7,25}$' or exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=inv.admin_id and ats_private.contact_key(coalesce(nullif(btrim(a."ContactNumber"),''),a."Contact Number"))=ats_private.contact_key(phone))) then problems:=array_append(problems,'Contact Number: invalid or already registered');phone:=null;end if;
 position:=nullif(data->>'Position','');source:=nullif(data->>'Source','');site:=nullif(data->>'Site','');
 if position is not null and (not (inv.choices->'Position')?position or not exists(select 1 from public.positions where position_title=position)) then position:=null;problems:=array_append(problems,'Position: unavailable');end if;
 if source is not null and (not (inv.choices->'Source')?source or not exists(select 1 from public.sources where "SourceName"=source)) then source:=null;problems:=array_append(problems,'Source: unavailable');end if;
 if site is not null and (not (inv.choices->'Site')?site or not exists(select 1 from public.location where "Site"=site)) then site:=null;problems:=array_append(problems,'Site: unavailable');end if;
 status:=case when cardinality(problems)>0 then 'Rejected' else 'For Pooling' end;
 reason:=case when cardinality(problems)>0 then 'Application invitation: incomplete or invalid. '||array_to_string(problems,'; ') else 'Application invitation: completed.' end;
 select "CompanyID" into company from public.admins where "AdminID"=inv.admin_id;
 perform set_config('ats.activity.actor',jsonb_build_object('type','system','name','Applicant invitation','AdminID',inv.admin_id)::text,true);
 insert into public."Applicant_Masterlist"("AdminID","CompanyID","ApplicationInvitationID","Name","FullName","Position","PositionApplied","Source","Site","Email Address","Email","Contact Number","ContactNumber","Current Address","Gender","Notes","Remarks","Date","DateApplied","Submission Date","Status","StatusChangedAt","REJECTED DATE")
 values(inv.admin_id,company,inv.id,nullif(data->>'Name',''),nullif(data->>'Name',''),position,position,source,site,email,email,phone,phone,nullif(data->>'Current Address',''),nullif(data->>'Gender',''),left(coalesce(data->>'Notes',''),2000),reason,(clock_timestamp() at time zone 'Asia/Manila')::date,clock_timestamp(),(clock_timestamp() at time zone 'Asia/Manila')::date,status,clock_timestamp(),case when status='Rejected' then (clock_timestamp() at time zone 'Asia/Manila')::date end) returning "ApplicantID" into target;
 update ats_private.applicant_invitations set finished_at=clock_timestamp(),applicant_id=target,result=status,issues=problems where id=inv.id;
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(inv.admin_id,'system','Applicant invitation','created','applicant',target::text,coalesce(nullif(data->>'Name',''),'Incomplete application'));
 return jsonb_build_object('closed',true,'saved',true,'status',status);
end $fn$;

create or replace function public.ats_application_open(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;company text;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This application link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null then raise exception using errcode='28000',message='This application link is unavailable';end if;
 if inv.finished_at is not null then return jsonb_build_object('closed',true);end if;
 perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);
 if not found then raise exception using errcode='28000',message='This application link is unavailable';end if;
 if inv.started_at is null then
 update ats_private.applicant_invitations set started_at=clock_timestamp(),deadline=clock_timestamp()+make_interval(mins=>minutes) where id=inv.id returning * into inv;
 end if;
 if inv.deadline<=clock_timestamp() then return ats_private.application_finish(inv.id);end if;
 select details->>'name' into company from ats_private.company_branding where admin_id=inv.admin_id;
 return jsonb_build_object('closed',false,'company',coalesce(company,'Company'),'deadline',inv.deadline,'serverNow',clock_timestamp(),'draft',inv.draft,'revision',inv.revision,'required',inv.required_fields,'instructions',inv.instructions,'choices',inv.choices);
end $fn$;

create or replace function public.ats_application_save(p_token text,p_draft jsonb,p_revision integer,p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;field text;value jsonb;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This application link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null then raise exception using errcode='28000',message='This application link is unavailable';end if;
 if inv.finished_at is not null then return jsonb_build_object('closed',true);end if;
 if inv.started_at is null then raise exception 'Open the application link first';end if;
 if inv.deadline<=clock_timestamp() then return ats_private.application_finish(inv.id);end if;
 if inv.revision is distinct from p_revision then raise exception using errcode='40001',message='This application was edited in another tab. Reload before continuing.';end if;
 if p_draft is null or jsonb_typeof(p_draft)<>'object' then raise exception 'Invalid application draft';end if;
 for field,value in select * from jsonb_each(p_draft) loop
 if field not in('Name','Position','Source','Site','Email Address','Contact Number','Current Address','Gender','Notes') or jsonb_typeof(value)<>'string' or length(p_draft->>field)>(case when field in('Notes','Current Address') then 2000 when field='Email Address' then 254 when field='Name' then 120 when field='Contact Number' then 25 else 120 end) then raise exception 'Unsupported or oversized application field';end if;
 end loop;
 update ats_private.applicant_invitations set draft=p_draft,revision=revision+1 where id=inv.id returning * into inv;
 if p_submit then return ats_private.application_finish(inv.id);end if;
 return jsonb_build_object('saved',true,'revision',inv.revision,'issues',ats_private.application_issues(inv,inv.draft),'deadline',inv.deadline,'serverNow',clock_timestamp());
end $fn$;

create or replace function public.ats_applicant_invite_list(p_session_token text,p_revoke uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;output jsonb;
begin
 owner_id:=ats_private.require_admin(p_session_token);
 if p_revoke is not null then update ats_private.applicant_invitations set revoked_at=clock_timestamp() where id=p_revoke and admin_id=owner_id and finished_at is null;end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by created_at desc),'[]') into output from
 (select id,label,minutes,created_at,started_at,deadline,finished_at,applicant_id,result,issues,
 case when revoked_at is not null then 'Revoked' when finished_at is not null then 'Submitted' when started_at is null then 'Not started' else 'In progress' end state
 from ats_private.applicant_invitations where admin_id=owner_id order by created_at desc limit 100) i;
 return output;
end $fn$;
create or replace function ats_private.process_application_deadlines()
returns integer language plpgsql security definer set search_path='' as $fn$
declare item record;processed integer:=0;
begin
 for item in select id from ats_private.applicant_invitations where started_at is not null and deadline<=clock_timestamp() and finished_at is null and revoked_at is null order by deadline for update skip locked limit 500 loop
 perform ats_private.application_finish(item.id);processed:=processed+1;
 end loop;return processed;
end $fn$;
create or replace function public.ats_applicant_invite_detail(p_session_token text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;result jsonb;
begin
 owner_id:=ats_private.require_admin(p_session_token);
 select jsonb_build_object('draft',i.draft,'issues',i.issues,'result',i.result,'label',i.label) into result from ats_private.applicant_invitations i where i.id=p_id and i.admin_id=owner_id;
 if result is null then raise exception using errcode='42501',message='This application is unavailable for your AdminID';end if;
 return result;
end $fn$;
revoke all on function public.ats_applicant_invite_detail(text,uuid) from public,anon,authenticated;
grant execute on function public.ats_applicant_invite_detail(text,uuid) to anon,authenticated;
revoke all on function ats_private.application_issues(ats_private.applicant_invitations,jsonb),ats_private.application_finish(uuid),ats_private.process_application_deadlines(),ats_private.account_invitation_duration() from public,anon,authenticated;
revoke all on function public.ats_invitation_settings(text,jsonb),public.ats_applicant_invite_create(text,text,integer),public.ats_application_open(text),public.ats_application_save(text,jsonb,integer,boolean),public.ats_applicant_invite_list(text,uuid) from public,anon,authenticated;
grant execute on function public.ats_invitation_settings(text,jsonb),public.ats_applicant_invite_create(text,text,integer),public.ats_application_open(text),public.ats_application_save(text,jsonb,integer,boolean),public.ats_applicant_invite_list(text,uuid) to anon,authenticated;
do $cron$
begin
 if not exists(select 1 from cron.job where jobname='ats-application-invitation-deadlines') then
 perform cron.schedule('ats-application-invitation-deadlines','* * * * *','select ats_private.process_application_deadlines();');
 end if;
end $cron$;
notify pgrst,'reload schema';
commit;
