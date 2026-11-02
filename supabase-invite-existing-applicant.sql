alter table ats_private.applicant_invitations add column if not exists linked_existing boolean not null default false;
CREATE OR REPLACE FUNCTION ats_private.application_issues(inv ats_private.applicant_invitations, data jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare issues text[]:='{}';field text;job jsonb;
begin
 -- Personal details are optional. Supplied values still receive format and duplicate checks.
 if nullif(btrim(data->>'Name'),'') is not null and length(btrim(data->>'Name')) not between 2 and 120 then issues:=array_append(issues,'Name: use 2–120 characters');end if;
 if nullif(data->>'Email Address','') is not null and (data->>'Email Address')!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then issues:=array_append(issues,'Email Address: invalid');end if;
 if nullif(data->>'Contact Number','') is not null and (data->>'Contact Number')!~'^[+()0-9 .-]{7,25}$' then issues:=array_append(issues,'Contact Number: invalid');end if;
 if nullif(data->>'Gender','') is not null and data->>'Gender' not in('Male','Female') then issues:=array_append(issues,'Gender: choose Male or Female');end if;
 if nullif(data->>'Source','') is not null and (not (inv.choices->'Source')?(data->>'Source') or length(data->>'Source')>80) then issues:=array_append(issues,'Source: choose an available source');end if;
 select j into job from jsonb_array_elements(ats_private.job_rows(inv.admin_id)) j where j->>'id'=data->>'JobOpeningID';
 if job is null or ((job->>'remaining_slots')::integer<=0 and not inv.linked_existing) or inv.job_opening_id is not null and inv.job_opening_id::text<>data->>'JobOpeningID' then issues:=array_append(issues,'Job opening: choose an available position and location');end if;
 if nullif(data->>'Email Address','') is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=inv.admin_id and (inv.applicant_id is null or a."ApplicantID"<>inv.applicant_id) and nullif(lower(btrim(coalesce(nullif(btrim(a."Email"),''),a."Email Address"))),'')=lower(btrim(data->>'Email Address'))) then issues:=array_append(issues,'Email Address: already registered');end if;
 if nullif(data->>'Contact Number','') is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=inv.admin_id and (inv.applicant_id is null or a."ApplicantID"<>inv.applicant_id) and ats_private.contact_key(coalesce(nullif(btrim(a."ContactNumber"),''),a."Contact Number"))=ats_private.contact_key(data->>'Contact Number')) then issues:=array_append(issues,'Contact Number: already registered');end if;
 if nullif(data->>'Birthdate','') is not null then begin
 if data->>'Birthdate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (data->>'Birthdate')::date>(clock_timestamp() at time zone 'Asia/Manila')::date then issues:=array_append(issues,'Birthdate: choose a valid date that is not in the future');end if;
 exception when invalid_datetime_format or datetime_field_overflow then issues:=array_append(issues,'Birthdate: invalid date');end;end if;
 return issues;
end $function$;
CREATE OR REPLACE FUNCTION public.ats_application_open(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv ats_private.applicant_invitations%rowtype;brand jsonb;jobs jsonb;documents jsonb;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This application link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null then raise exception using errcode='28000',message='This application link is unavailable';end if;
 perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);if not found then raise exception using errcode='28000',message='This application link is unavailable';end if;
 brand:=ats_private.application_brand(inv.admin_id);
 if inv.finished_at is not null and inv.applicant_id is not null and ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then
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
 select coalesce(jsonb_agg(jsonb_build_object('id',j->>'id','position_title',j->>'position_title','site',j->>'site','description',j->>'description','address',j->>'address','remaining_slots',(j->>'remaining_slots')::integer,'required_documents',j->'required_documents')),'[]') into jobs from jsonb_array_elements(ats_private.job_rows(inv.admin_id)) j where ((j->>'remaining_slots')::integer>0 or inv.linked_existing and j->>'id'=inv.job_opening_id::text) and (inv.job_opening_id is null or inv.job_opening_id::text=j->>'id');
 return jsonb_build_object('closed',false,'phase','application','existingApplicant',inv.linked_existing,'company',brand->>'name','companyInfo',brand,'inviter',coalesce(inv.inviter,ats_private.application_inviter('admin',inv.admin_id,inv.admin_id)),'jobs',jobs,'draft',inv.draft,'revision',inv.revision,'required',inv.required_fields,'choices',inv.choices,'instructions',inv.instructions,'fixedJob',inv.job_opening_id,'requirementsDays',inv.requirements_days,'requirementsDeadline',inv.requirements_deadline,'serverNow',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION public.ats_application_save(p_token text, p_draft jsonb, p_revision integer, p_submit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if field not in('Name','JobOpeningID','Position','Source','Site','Email Address','Contact Number','Current Address','Gender','Birthdate') or jsonb_typeof(value)<>'string' or length(data->>field)>(case when field in('Current Address') then 2000 when field='Email Address' then 254 when field='Contact Number' then 25 else 120 end) then raise exception 'Unsupported or oversized application field';end if;
 end loop;
 select j into job from jsonb_array_elements(ats_private.job_rows(inv.admin_id)) j where j->>'id'=coalesce(nullif(data->>'JobOpeningID',''),inv.job_opening_id::text);
 if job is not null then data:=data||jsonb_build_object('JobOpeningID',job->>'id','Position',job->>'position_title','Site',job->>'site');else data:=data-'Position'-'Site';end if;
 update ats_private.applicant_invitations set draft=data,revision=revision+1 where id=inv.id returning * into inv;
 if p_submit then return ats_private.application_finish(inv.id);end if;
 return jsonb_build_object('saved',true,'revision',inv.revision,'issues',ats_private.application_issues(inv,inv.draft));
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
 if inv.linked_existing then
 update public."Applicant_Masterlist" set "Name"=coalesce(nullif(btrim(data->>'Name'),''),"Name"),"FullName"=coalesce(nullif(btrim(data->>'Name'),''),"FullName"),"Email"=nullif(lower(btrim(data->>'Email Address')),''),"Email Address"=nullif(lower(btrim(data->>'Email Address')),''),"ContactNumber"=nullif(btrim(data->>'Contact Number'),''),"Contact Number"=nullif(btrim(data->>'Contact Number'),''),"Current Address"=nullif(data->>'Current Address',''),"Gender"=nullif(data->>'Gender',''),"Birthdate"=nullif(data->>'Birthdate','')::date,"ApplicationInvitationID"=inv.id where "ApplicantID"=inv.applicant_id and "AdminID"=inv.admin_id returning "ApplicantID" into target;
 if target is null then raise exception 'This applicant record is unavailable.';end if;
 else
 insert into public."Applicant_Masterlist"("AdminID","CompanyID","ApplicationInvitationID","JobOpeningID","Name","FullName","Position","PositionApplied","Source","Site","Email Address","Email","Contact Number","ContactNumber","Current Address","Gender","Birthdate","Remarks","Date","Submission Date","Status","StatusChangedAt")
 values(inv.admin_id,company,inv.id,job.id,coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'),coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'),job.position_title,job.position_title,data->>'Source',job.site,nullif(lower(btrim(data->>'Email Address')),''),nullif(lower(btrim(data->>'Email Address')),''),nullif(btrim(data->>'Contact Number'),''),nullif(btrim(data->>'Contact Number'),''),nullif(data->>'Current Address',''),nullif(data->>'Gender',''),nullif(data->>'Birthdate','')::date,'Job opening application submitted',(clock_timestamp() at time zone 'Asia/Manila')::date,(clock_timestamp() at time zone 'Asia/Manila')::date,'For Pooling',clock_timestamp()) returning "ApplicantID" into target;

 end if;
 update ats_private.applicant_invitations set finished_at=clock_timestamp(),applicant_id=target,result=(select "Status" from public."Applicant_Masterlist" where "ApplicantID"=target),draft=data,issues='{}',job_opening_id=job.id,job_snapshot=jsonb_build_object('id',job.id,'position_title',job.position_title,'site',job.site,'description',job.description,'address',job.address,'required_documents',job.required_documents),required_documents=job.required_documents where id=inv.id;
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(inv.admin_id,'system','Applicant invitation',case when inv.linked_existing then 'updated' else 'created' end,'applicant',target::text,coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'));
 return jsonb_build_object('closed',false,'phase','requirements','saved',true,'status','For Pooling');
end $function$;
create or replace function public.ats_applicant_invite_existing(p_session_token text,p_applicant_id bigint,p_days integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id integer;account jsonb;person public."Applicant_Masterlist"%rowtype;job public."Job_Opening"%rowtype;policy ats_private.invitation_policy%rowtype;inv ats_private.applicant_invitations%rowtype;raw_token text;choices jsonb;data jsonb;begin
owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
perform pg_advisory_xact_lock(1096045397,owner_id);
select * into person from public."Applicant_Masterlist" where "ApplicantID"=p_applicant_id and "AdminID"=owner_id for update;
if not found then raise exception using errcode='42501',message='This applicant is unavailable for your AdminID.';end if;
insert into ats_private.invitation_policy(admin_id) values(owner_id) on conflict do nothing;select * into policy from ats_private.invitation_policy where admin_id=owner_id;
if coalesce(p_days,policy.requirements_days) not between 1 and 7 then raise exception 'Choose a requirements limit of 1–7 days.';end if;
select * into job from public."Job_Opening" where admin_id=owner_id and (id=person."JobOpeningID" or person."JobOpeningID" is null and lower(btrim(position_title))=lower(btrim(person."PositionApplied")) and lower(btrim(site))=lower(btrim(person."Site"))) limit 1;
choices:=jsonb_build_object('Source',(select coalesce(jsonb_agg(name),'[]') from(select distinct value->>'name' as name from jsonb_array_elements(public.ats_catalog_list(p_session_token)->'sources') union select person."Source" where person."Source" is not null)s),'Gender',jsonb_build_array('Male','Female'));
data:=jsonb_build_object('Name',coalesce(person."FullName",person."Name",''),'Email Address',coalesce(person."Email",person."Email Address",''),'Contact Number',coalesce(person."ContactNumber",person."Contact Number",''),'Current Address',coalesce(person."Current Address",''),'Gender',case when person."Gender" in('Male','Female') then person."Gender" else '' end,'Birthdate',coalesce(person."Birthdate"::text,''),'Source',coalesce(person."Source",''));
if job.id is not null then data:=data||jsonb_build_object('JobOpeningID',job.id::text,'Position',job.position_title,'Site',job.site);end if;
update ats_private.applicant_invitations set revoked_at=clock_timestamp() where admin_id=owner_id and applicant_id=p_applicant_id and revoked_at is null;
raw_token:=encode(extensions.gen_random_bytes(32),'hex');
insert into ats_private.applicant_invitations(admin_id,token_hash,label,minutes,required_fields,instructions,choices,creator_type,creator_id,inviter,requirements_days,job_opening_id,job_snapshot,required_documents,applicant_id,linked_existing,draft)
values(owner_id,ats_private.token_digest(raw_token),coalesce(person."FullName",person."Name",'Applicant invitation'),60,'{}',policy.instructions,choices,account->>'accountType',(account->>'id')::integer,ats_private.application_inviter(account->>'accountType',(account->>'id')::integer,owner_id),coalesce(p_days,policy.requirements_days),job.id,case when job.id is not null then to_jsonb(job) else null end,coalesce(job.required_documents,array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO']),person."ApplicantID",true,data) returning * into inv;
return jsonb_build_object('id',inv.id,'token',raw_token,'AdminID',owner_id,'applicantId',person."ApplicantID",'requirements_days',inv.requirements_days);
end $$;
revoke all on function public.ats_applicant_invite_existing(text,bigint,integer) from public;
grant execute on function public.ats_applicant_invite_existing(text,bigint,integer) to anon,authenticated;
