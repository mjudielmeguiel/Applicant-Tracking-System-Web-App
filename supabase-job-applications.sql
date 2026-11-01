begin;
alter table ats_private.invitation_policy add column if not exists requirements_days integer not null default 3 check(requirements_days between 1 and 7);
alter table ats_private.applicant_invitations
 add column if not exists job_opening_id uuid,
 add column if not exists job_snapshot jsonb,
 add column if not exists requirements_days integer not null default 3 check(requirements_days between 1 and 7),
 add column if not exists requirements_started_at timestamptz,
 add column if not exists requirements_deadline timestamptz,
 add column if not exists requirements_expired_at timestamptz;
do $ddl$ begin
 if not exists(select 1 from pg_constraint where conrelid='ats_private.applicant_invitations'::regclass and conname='ats_invitation_job_owner') then
 alter table ats_private.applicant_invitations add constraint ats_invitation_job_owner foreign key(job_opening_id,admin_id) references ats_private.job_openings(id,admin_id);
 end if;
end $ddl$;
create index if not exists ats_requirements_deadline_due on ats_private.applicant_invitations(requirements_deadline) where requirements_expired_at is null and requirements_completed_at is null and revoked_at is null;
alter table ats_private.requirement_events alter column applicant_id drop not null;
alter table ats_private.requirement_events add column if not exists applicant_name text;

create or replace function ats_private.application_brand(p_owner integer) returns jsonb language plpgsql stable set search_path='' as $fn$
declare details jsonb;company text;logo text;
begin
 select b.details into details from ats_private.company_branding b where admin_id=p_owner;
 select "CompanyName" into company from public.admins where "AdminID"=p_owner;
 logo:=details->>'logo';
 if logo is null or logo!~'^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' or length(logo)>900000 then logo:=null;end if;
 return jsonb_build_object('name',coalesce(nullif(details->>'name',''),nullif(company,''),'Company'),'logo',logo,'address',left(coalesce(details->>'location',''),240));
end $fn$;
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
create or replace function public.ats_invitation_options(p_session_token text) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;output jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);
 select to_jsonb(p) into output from ats_private.invitation_policy p where admin_id=owner_id;
 return coalesce(output,jsonb_build_object('applicant_minutes',60,'requirements_days',3))||jsonb_build_object('applicant_mode','jobs','deadline_start','first_opening','deadline_outcome','Overdue');
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
create or replace function public.ats_applicant_invite_create(p_session_token text,p_label text default null,p_minutes integer default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
begin return public.ats_applicant_invite_create_v2(p_session_token,p_label,null,null);end $fn$;

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
create or replace function ats_private.expire_requirements(p_id uuid) returns boolean language plpgsql set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;
begin
 select * into inv from ats_private.applicant_invitations where id=p_id for update;
 if not found or inv.revoked_at is not null or inv.requirements_deadline is null or inv.requirements_deadline>clock_timestamp() then return false;end if;
 if inv.applicant_id is not null and ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then return false;end if;
 update ats_private.applicant_invitations set requirements_expired_at=coalesce(requirements_expired_at,clock_timestamp()),requirements_completed_at=null where id=inv.id;
 if inv.applicant_id is not null then update public."Applicant_Masterlist" set "Ongoing Requirements Status"='Requirements overdue — HR review',"REQUIREMENTS COMPLETION DATE"=null where "ApplicantID"=inv.applicant_id and "AdminID"=inv.admin_id;end if;
 insert into ats_private.requirement_events(admin_id,applicant_id,document_type,action,actor_name,applicant_name,source_key)
 values(inv.admin_id,inv.applicant_id,'Requirements','Overdue','System',coalesce(nullif(inv.draft->>'Name',''),inv.label),inv.id||':overdue:'||inv.requirements_deadline) on conflict(source_key) do nothing;
 return true;
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

create or replace function public.ats_application_open(p_token text) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;brand jsonb;jobs jsonb;documents jsonb;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This application link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null then raise exception using errcode='28000',message='This application link is unavailable';end if;
 perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);if not found then raise exception using errcode='28000',message='This application link is unavailable';end if;
 brand:=ats_private.application_brand(inv.admin_id);
 if inv.applicant_id is not null and ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then
 update ats_private.applicant_invitations set requirements_completed_at=coalesce(requirements_completed_at,clock_timestamp()),requirements_expired_at=null where id=inv.id;
 return jsonb_build_object('closed',true,'companyInfo',brand);
 end if;
 if inv.requirements_started_at is null then
 update ats_private.applicant_invitations set started_at=coalesce(started_at,clock_timestamp()),deadline=null,requirements_started_at=clock_timestamp(),requirements_deadline=clock_timestamp()+make_interval(days=>requirements_days) where id=inv.id returning * into inv;
 end if;
 if ats_private.expire_requirements(inv.id) then
 return jsonb_build_object('closed',true,'expired',true,'company',brand->>'name','companyInfo',brand,'requirementsDays',inv.requirements_days,'requirementsDeadline',inv.requirements_deadline,'serverNow',clock_timestamp(),'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)));
 end if;
 if inv.finished_at is not null then
 documents:=ats_private.requirement_documents(inv.applicant_id,inv.admin_id);
 return jsonb_build_object('closed',false,'phase','requirements','company',brand->>'name','companyInfo',brand,'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)),'requiredDocuments',inv.required_documents,'documents',documents,'status',inv.result,'job',inv.job_snapshot,'requirementsDays',inv.requirements_days,'requirementsDeadline',inv.requirements_deadline,'serverNow',clock_timestamp());
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j->>'id','position_title',j->>'position_title','site',j->>'site','description',j->>'description','remaining_slots',(j->>'remaining_slots')::integer,'required_documents',j->'required_documents')),'[]') into jobs from jsonb_array_elements(ats_private.job_rows(inv.admin_id)) j where (j->>'remaining_slots')::integer>0 and (inv.job_opening_id is null or inv.job_opening_id::text=j->>'id');
 return jsonb_build_object('closed',false,'phase','application','company',brand->>'name','companyInfo',brand,'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)),'jobs',jobs,'draft',inv.draft,'revision',inv.revision,'required',inv.required_fields,'choices',inv.choices,'instructions',inv.instructions,'fixedJob',inv.job_opening_id,'requirementsDays',inv.requirements_days,'requirementsDeadline',inv.requirements_deadline,'serverNow',clock_timestamp());
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

create or replace function ats_private.refresh_requirements(p_applicant bigint,p_owner integer) returns void language plpgsql set search_path='' as $fn$
declare item record;ready boolean;rejected text;all_ready boolean:=true;has_inv boolean:=false;overdue boolean:=false;
begin
 for item in select * from ats_private.applicant_invitations where applicant_id=p_applicant and admin_id=p_owner and revoked_at is null for update loop
 has_inv:=true;ready:=ats_private.requirements_ready(p_applicant,p_owner,item.required_documents);all_ready:=all_ready and ready;
 update ats_private.applicant_invitations set requirements_completed_at=case when ready then coalesce(requirements_completed_at,clock_timestamp()) else null end,requirements_expired_at=case when ready then null else requirements_expired_at end where id=item.id;
 if not ready and item.requirements_expired_at is not null then overdue:=true;end if;
 end loop;
 if not has_inv then all_ready:=ats_private.requirements_ready(p_applicant,p_owner,array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO']);end if;
 select string_agg(d->>'type',', ') into rejected from jsonb_array_elements(ats_private.requirement_documents(p_applicant,p_owner)) d where (d->>'latest')::boolean and d->>'review_status'='Rejected';
 update public."Applicant_Masterlist" set "Ongoing Requirements Status"=case when all_ready then 'All required documents submitted — pending review' when overdue then 'Requirements overdue — HR review' when rejected is not null then 'Rejected: '||rejected||' — upload replacements' else 'Requirements in progress' end,
 "REQUIREMENTS COMPLETION DATE"=case when all_ready then coalesce("REQUIREMENTS COMPLETION DATE",(clock_timestamp() at time zone 'Asia/Manila')::date) else null end where "ApplicantID"=p_applicant and "AdminID"=p_owner;
end $fn$;

-- Deadline gate returns an explicit result so its overdue state commits before
-- the upload service returns an error. File registration checks this gate again.
do $gate$ declare definition text;
begin
 select pg_get_functiondef('public.ats_application_upload_access(text)'::regprocedure) into definition;
 if definition not like '%expire_requirements%' then
 definition:=replace(definition,'if ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then','if inv.requirements_started_at is null then update ats_private.applicant_invitations set requirements_started_at=clock_timestamp(),requirements_deadline=clock_timestamp()+make_interval(days=>requirements_days) where id=inv.id returning * into inv;end if; if ats_private.expire_requirements(inv.id) then return jsonb_build_object(''expired'',true,''closed'',true);end if; if ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then');
 execute definition;end if;
 select pg_get_functiondef('public.ats_document_upload_record(text,text,bigint,uuid,text,text,text,integer,text,jsonb)'::regprocedure) into definition;
 if definition not like '%Requirements deadline has passed%' then
 definition:=replace(definition,'access:=public.ats_application_upload_access(p_token);owner_id:=','access:=public.ats_application_upload_access(p_token);if coalesce((access->>''expired'')::boolean,false) then return jsonb_build_object(''saved'',false,''expired'',true,''error'',''Requirements deadline has passed. Uploads are closed for HR review.'');end if;owner_id:=');
 execute definition;end if;
end $gate$;
create or replace function public.ats_requirements_extend(p_session_token text,p_id uuid,p_days integer) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;inv ats_private.applicant_invitations%rowtype;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 if p_days is null or p_days not between 1 and 7 then raise exception 'Choose a new limit of 1–7 days.';end if;
 select * into inv from ats_private.applicant_invitations where id=p_id and admin_id=owner_id for update;
 if not found or inv.revoked_at is not null or not(account->>'accountType'='admin' or inv.creator_type=account->>'accountType' and inv.creator_id=(account->>'id')::integer) then raise exception using errcode='42501',message='Only the inviting HR user or admin can change this deadline.';end if;
 if inv.applicant_id is not null and ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then raise exception 'All required files are already submitted.';end if;
 update ats_private.applicant_invitations set requirements_days=p_days,requirements_started_at=null,requirements_deadline=null,requirements_expired_at=null where id=inv.id returning * into inv;
 if inv.applicant_id is not null then perform ats_private.refresh_requirements(inv.applicant_id,owner_id);end if;
 insert into ats_private.requirement_events(admin_id,applicant_id,applicant_name,document_type,action,actor_name,source_key) values(owner_id,inv.applicant_id,coalesce(inv.draft->>'Name',inv.label),'Requirements','Extended',account->>'name',inv.id||':extended:'||clock_timestamp());
 return jsonb_build_object('saved',true,'deadline',inv.requirements_deadline,'days',p_days);
end $fn$;

-- A manual rejection of a previously completed/overdue file grants a fresh
-- replacement window. Automatic image rejection never restarts the timer.
create or replace function ats_private.requirement_event_record() returns trigger language plpgsql set search_path='' as $fn$
declare doc ats_private.applicant_documents%rowtype;
begin
 if tg_op='UPDATE' and new.status=old.status and new.comment=old.comment then return new;end if;
 select * into doc from ats_private.applicant_documents where id=new.document_id;
 if new.status='Rejected' and not new.automated then
 update ats_private.applicant_invitations set requirements_started_at=null,requirements_deadline=null,requirements_expired_at=null,requirements_completed_at=null
 where applicant_id=doc.applicant_id and admin_id=doc.admin_id and revoked_at is null and (requirements_completed_at is not null or requirements_expired_at is not null);
 end if;
 insert into ats_private.requirement_events(admin_id,applicant_id,document_id,document_type,action,actor_name,created_at,source_key) values(doc.admin_id,doc.applicant_id,doc.id,doc.document_type,new.status,coalesce(new.reviewer->>'name','Recruitment team'),new.reviewed_at,doc.id||':'||new.reviewed_at||':'||new.status) on conflict(source_key) do nothing;return new;
end $fn$;
create or replace function public.ats_requirement_activity(p_session_token text,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;output jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);
 select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]') into output from
 (select r.id,r.applicant_id,coalesce(nullif(a."FullName",''),nullif(a."Name",''),r.applicant_name,'Incomplete application') applicant_name,r.document_type,r.action,r.actor_name,r.created_at
 from ats_private.requirement_events r left join public."Applicant_Masterlist" a on a."ApplicantID"=r.applicant_id and a."AdminID"=r.admin_id where r.admin_id=owner_id order by r.created_at desc,r.id desc limit least(greatest(coalesce(p_limit,20),1),50)) e;return output;
end $fn$;
create or replace function public.ats_applicant_invite_list(p_session_token text,p_revoke uuid default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;output jsonb;is_admin boolean;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);is_admin:=account->>'accountType'='admin';
 if p_revoke is not null then update ats_private.applicant_invitations set revoked_at=clock_timestamp() where id=p_revoke and admin_id=owner_id and requirements_completed_at is null and (is_admin or creator_type=account->>'accountType' and creator_id=(account->>'id')::integer);end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by created_at desc),'[]') into output from
 (select id,label,created_at,started_at,finished_at,requirements_completed_at,applicant_id,result,issues,inviter,creator_type,creator_id,requirements_days,requirements_deadline,requirements_expired_at,
 case when revoked_at is not null then 'Revoked' when requirements_completed_at is not null then 'Complete' when requirements_expired_at is not null or requirements_deadline<=clock_timestamp() then 'Requirements overdue' when finished_at is not null then 'Requirements pending' when started_at is null then 'Not started' else 'In progress' end state
 from ats_private.applicant_invitations where admin_id=owner_id and (is_admin or creator_type=account->>'accountType' and creator_id=(account->>'id')::integer) order by created_at desc limit 100) i;return output;
end $fn$;
create or replace function ats_private.process_requirements_deadlines() returns integer language plpgsql security definer set search_path='' as $fn$
declare item record;n integer:=0;
begin
 for item in select id from ats_private.applicant_invitations where requirements_deadline<=clock_timestamp() and requirements_expired_at is null and requirements_completed_at is null and revoked_at is null order by requirements_deadline for update skip locked limit 500 loop
 if ats_private.expire_requirements(item.id) then n:=n+1;end if;end loop;return n;
end $fn$;
do $cron$ begin if not exists(select 1 from cron.job where jobname='ats-requirements-overdue') then perform cron.schedule('ats-requirements-overdue','* * * * *','select ats_private.process_requirements_deadlines();');end if;end $cron$;
revoke all on function ats_private.application_brand(integer),ats_private.expire_requirements(uuid),ats_private.process_requirements_deadlines() from public,anon,authenticated;
revoke all on function public.ats_applicant_invite_create_v2(text,text,integer,uuid),public.ats_requirements_extend(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.ats_applicant_invite_create_v2(text,text,integer,uuid),public.ats_requirements_extend(text,uuid,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
