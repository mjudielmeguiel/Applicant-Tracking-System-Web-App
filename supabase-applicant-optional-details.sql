begin;
alter table ats_private.invitation_policy alter column required_fields set default '{}'::text[];
update ats_private.invitation_policy set required_fields='{}'::text[];
update ats_private.applicant_invitations set required_fields='{}'::text[] where finished_at is null;
create or replace function public.ats_invitation_settings(p_session_token text,p_settings jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;policy ats_private.invitation_policy%rowtype;fields text[];
begin
 owner_id:=ats_private.require_admin(p_session_token);
 insert into ats_private.invitation_policy(admin_id) values(owner_id) on conflict do nothing;
 if p_settings is not null then
 fields:='{}'::text[];
 if length(p_settings->>'instructions') not between 1 and 4000 then raise exception 'Enter applicant instructions (maximum 4000 characters).';end if;
 update ats_private.invitation_policy set applicant_minutes=coalesce((p_settings->>'applicant_minutes')::integer,applicant_minutes),user_minutes=(p_settings->>'user_minutes')::integer,admin_minutes=(p_settings->>'admin_minutes')::integer,requirements_days=coalesce((p_settings->>'requirements_days')::integer,requirements_days),required_fields=fields,instructions=p_settings->>'instructions' where admin_id=owner_id;
 end if;
 select * into policy from ats_private.invitation_policy where admin_id=owner_id;
 return to_jsonb(policy)||jsonb_build_object('applicant_mode','jobs','deadline_start','first_opening','deadline_outcome','Overdue');
end $fn$;

create or replace function public.ats_applicant_invite_create_v2(p_session_token text,p_label text default null,p_days integer default null,p_job_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;policy ats_private.invitation_policy%rowtype;raw_token text;inv ats_private.applicant_invitations%rowtype;catalog jsonb;choices jsonb;job jsonb;available jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 insert into ats_private.invitation_policy(admin_id) values(owner_id) on conflict do nothing;
 select * into policy from ats_private.invitation_policy where admin_id=owner_id;
 if length(coalesce(p_label,''))>200 or coalesce(p_days,policy.requirements_days) not between 1 and 7 then raise exception using errcode='22023',message='Choose a requirements limit of 1–7 days.';end if;
 select coalesce(jsonb_agg(j),'[]') into available from jsonb_array_elements(ats_private.job_rows(owner_id)) j where (j->>'remaining_slots')::integer>0;
 if jsonb_array_length(available)=0 then raise exception 'No job openings have available slots. Post or update a job opening first.';end if;
 if p_job_id is not null then select j into job from jsonb_array_elements(available) j where j->>'id'=p_job_id::text;if job is null then raise exception 'This job opening is occupied or unavailable.';end if;end if;
 catalog:=public.ats_catalog_list(p_session_token);
 choices:=jsonb_build_object('Source',(select coalesce(jsonb_agg(v->>'name'),'[]') from jsonb_array_elements(catalog->'sources') v),'Gender',jsonb_build_array('Male','Female'));
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into ats_private.applicant_invitations(admin_id,token_hash,label,minutes,required_fields,instructions,choices,creator_type,creator_id,inviter,requirements_days,job_opening_id)
 values(owner_id,ats_private.token_digest(raw_token),coalesce(nullif(btrim(p_label),''),'Applicant invitation'),60,'{}'::text[],policy.instructions,choices,account->>'accountType',(account->>'id')::integer,ats_private.application_inviter(account->>'accountType',(account->>'id')::integer,owner_id),coalesce(p_days,policy.requirements_days),p_job_id) returning * into inv;
 return jsonb_build_object('id',inv.id,'token',raw_token,'AdminID',owner_id,'requirements_days',inv.requirements_days,'mode','jobs','inviter',inv.inviter);
end $fn$;

create or replace function ats_private.application_issues(inv ats_private.applicant_invitations,data jsonb) returns text[] language plpgsql set search_path='' as $fn$
declare issues text[]:='{}';field text;job jsonb;
begin
 -- Personal details are optional. Supplied values still receive format and duplicate checks.
 if nullif(btrim(data->>'Name'),'') is not null and length(btrim(data->>'Name')) not between 2 and 120 then issues:=array_append(issues,'Name: use 2–120 characters');end if;
 if nullif(data->>'Email Address','') is not null and (data->>'Email Address')!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then issues:=array_append(issues,'Email Address: invalid');end if;
 if nullif(data->>'Contact Number','') is not null and (data->>'Contact Number')!~'^[+()0-9 .-]{7,25}$' then issues:=array_append(issues,'Contact Number: invalid');end if;
 if nullif(data->>'Gender','') is not null and data->>'Gender' not in('Male','Female') then issues:=array_append(issues,'Gender: choose Male or Female');end if;
 if nullif(data->>'Source','') is not null and (not (inv.choices->'Source')?(data->>'Source') or length(data->>'Source')>80) then issues:=array_append(issues,'Source: choose an available source');end if;
 select j into job from jsonb_array_elements(ats_private.job_rows(inv.admin_id)) j where j->>'id'=data->>'JobOpeningID';
 if job is null or (job->>'remaining_slots')::integer<=0 or inv.job_opening_id is not null and inv.job_opening_id::text<>data->>'JobOpeningID' then issues:=array_append(issues,'Job opening: choose an available position and location');end if;
 if nullif(data->>'Email Address','') is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=inv.admin_id and nullif(lower(btrim(coalesce(nullif(btrim(a."Email"),''),a."Email Address"))),'')=lower(btrim(data->>'Email Address'))) then issues:=array_append(issues,'Email Address: already registered');end if;
 if nullif(data->>'Contact Number','') is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=inv.admin_id and ats_private.contact_key(coalesce(nullif(btrim(a."ContactNumber"),''),a."Contact Number"))=ats_private.contact_key(data->>'Contact Number')) then issues:=array_append(issues,'Contact Number: already registered');end if;
 return issues;
end $fn$;

create or replace function ats_private.application_finish(p_id uuid) returns jsonb language plpgsql set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;data jsonb;problems text[];job ats_private.job_openings%rowtype;current_job jsonb;target bigint;company uuid;
begin
 select * into inv from ats_private.applicant_invitations where id=p_id for update;
 if not found or inv.revoked_at is not null then return jsonb_build_object('closed',true);end if;
 if ats_private.expire_requirements(inv.id) then return jsonb_build_object('closed',true,'expired',true);end if;
 if inv.finished_at is not null then return jsonb_build_object('closed',false,'phase','requirements');end if;
 if inv.started_at is null then raise exception 'Open the application link first.';end if;
 data:=inv.draft;
 if coalesce(data->>'JobOpeningID','')!~'^[a-f0-9-]{36}$' then raise exception using errcode='22023',message='Choose a job opening with an available position and location.';end if;
 perform pg_advisory_xact_lock(1096045397,inv.admin_id);
 select * into job from ats_private.job_openings where id=(data->>'JobOpeningID')::uuid and admin_id=inv.admin_id for update;
 if not found then raise exception using errcode='42501',message='This job opening is unavailable for your invitation.';end if;
 data:=data||jsonb_build_object('Position',job.position_title,'Site',job.site);
 problems:=ats_private.application_issues(inv,data);
 if cardinality(problems)>0 then raise exception using errcode='22023',message='Correct the application information: '||array_to_string(problems,'; ');end if;
 select "CompanyID" into company from public.admins where "AdminID"=inv.admin_id;
 perform set_config('ats.activity.actor',jsonb_build_object('type','system','name','Applicant invitation','AdminID',inv.admin_id)::text,true);
 insert into public."Applicant_Masterlist"("AdminID","CompanyID","ApplicationInvitationID","JobOpeningID","Name","FullName","Position","PositionApplied","Source","Site","Email Address","Email","Contact Number","ContactNumber","Current Address","Gender","Notes","Remarks","Date","DateApplied","Submission Date","Status","StatusChangedAt")
 values(inv.admin_id,company,inv.id,job.id,coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'),coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'),job.position_title,job.position_title,data->>'Source',job.site,nullif(lower(btrim(data->>'Email Address')),''),nullif(lower(btrim(data->>'Email Address')),''),nullif(btrim(data->>'Contact Number'),''),nullif(btrim(data->>'Contact Number'),''),nullif(data->>'Current Address',''),nullif(data->>'Gender',''),left(coalesce(data->>'Notes',''),2000),'Job opening application submitted',(clock_timestamp() at time zone 'Asia/Manila')::date,clock_timestamp(),(clock_timestamp() at time zone 'Asia/Manila')::date,'For Pooling',clock_timestamp()) returning "ApplicantID" into target;
 update ats_private.applicant_invitations set finished_at=clock_timestamp(),applicant_id=target,result='For Pooling',draft=data,issues='{}',job_opening_id=job.id,job_snapshot=jsonb_build_object('id',job.id,'position_title',job.position_title,'site',job.site,'description',job.description,'required_documents',job.required_documents),required_documents=job.required_documents where id=inv.id;
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(inv.admin_id,'system','Applicant invitation','created','applicant',target::text,coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'));
 return jsonb_build_object('closed',false,'phase','requirements','saved',true,'status','For Pooling');
end $fn$;


create or replace function public.ats_application_save(p_token text,p_draft jsonb,p_revision integer,p_submit boolean default false) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;field text;value jsonb;data jsonb:=p_draft;job jsonb;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This application link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null then raise exception using errcode='28000',message='This application link is unavailable';end if;
 perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);if not found then raise exception using errcode='28000',message='This application link is unavailable';end if;
 if ats_private.expire_requirements(inv.id) then return public.ats_application_open(p_token);end if;
 if inv.finished_at is not null then return public.ats_application_open(p_token);end if;
 if inv.requirements_started_at is null then raise exception 'Open the application link first';end if;
 if inv.revision is distinct from p_revision then raise exception using errcode='40001',message='This form changed in another tab. Reload before continuing.';end if;
 if data is null or jsonb_typeof(data)<>'object' then raise exception 'Invalid application draft';end if;
 for field,value in select * from jsonb_each(data) loop
 if field not in('Name','JobOpeningID','Position','Source','Site','Email Address','Contact Number','Current Address','Gender','Notes') or jsonb_typeof(value)<>'string' or length(data->>field)>(case when field in('Notes','Current Address') then 2000 when field='Email Address' then 254 when field='Contact Number' then 25 else 120 end) then raise exception 'Unsupported or oversized application field';end if;
 end loop;
 select j into job from jsonb_array_elements(ats_private.job_rows(inv.admin_id)) j where j->>'id'=coalesce(nullif(data->>'JobOpeningID',''),inv.job_opening_id::text);
 if job is not null then data:=data||jsonb_build_object('JobOpeningID',job->>'id','Position',job->>'position_title','Site',job->>'site');else data:=data-'Position'-'Site';end if;
 update ats_private.applicant_invitations set draft=data,revision=revision+1 where id=inv.id returning * into inv;
 if p_submit then return ats_private.application_finish(inv.id);end if;
 return jsonb_build_object('saved',true,'revision',inv.revision,'issues',ats_private.application_issues(inv,inv.draft));
end $fn$;


do $fix$ declare definition text;begin select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public."Applicant_Masterlist"'::regclass and conname='ats_applicant_fields';definition:=replace(definition,'"Source" IS NOT NULL','("Source" IS NOT NULL OR "ApplicationInvitationID" IS NOT NULL)');alter table public."Applicant_Masterlist" drop constraint ats_applicant_fields;execute 'alter table public."Applicant_Masterlist" add constraint ats_applicant_fields '||definition;end $fix$;
notify pgrst,'reload schema';
commit;
