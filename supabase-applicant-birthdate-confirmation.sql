alter table public."Applicant_Masterlist" add column if not exists "Birthdate" date,add column if not exists "ApplicationConfirmedAt" timestamptz;
create or replace function ats_private.validate_applicant_birthdate() returns trigger language plpgsql set search_path='' as $$ begin
if new."Birthdate" is not null and new."Birthdate">(clock_timestamp() at time zone 'Asia/Manila')::date then raise exception using errcode='22023',message='Birthdate cannot be in the future.';end if;return new;end $$;
revoke all on function ats_private.validate_applicant_birthdate() from public,anon,authenticated;
drop trigger if exists ats_applicant_birthdate on public."Applicant_Masterlist";
create trigger ats_applicant_birthdate before insert or update of "Birthdate" on public."Applicant_Masterlist" for each row execute function ats_private.validate_applicant_birthdate();
CREATE OR REPLACE FUNCTION public.ats_public_jobs_submit(p_token text, p_job_id uuid, p_basic jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare post ats_private.job_posts%rowtype;job public."Job_Opening"%rowtype;previous ats_private.job_post_applications%rowtype;fingerprint text;person bigint;company uuid;field text;value jsonb;person_name text;email text;phone text;available integer;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' or p_request_id is null or p_job_id is null then raise exception using errcode='28000',message='This job post is unavailable.';end if;
 if p_basic is null or jsonb_typeof(p_basic)<>'object' then raise exception 'Invalid applicant information.';end if;
 for field,value in select * from jsonb_each(p_basic) loop
 if field not in('name','email','phone','address','gender','birthdate') or jsonb_typeof(value)<>'string' or length(p_basic->>field)>(case field when 'name' then 120 when 'email' then 254 when 'phone' then 25 when 'address' then 2000 else 20 end) then raise exception using errcode='22023',message='Use basic applicant fields only.';end if;
 end loop;
 select p.* into post from ats_private.job_posts p join public.admins a on a."AdminID"=p.admin_id and a."Status"='Active' and a."RoleID" in(1,2) where p.token=p_token;
 if not found then raise exception using errcode='28000',message='This job post is unavailable.';end if;
 perform pg_advisory_xact_lock(1096045397,post.admin_id);
 select * into post from ats_private.job_posts where id=post.id for update;
 fingerprint:=encode(extensions.digest(convert_to(p_job_id::text||p_basic::text,'UTF8'),'sha256'),'hex');
 select * into previous from ats_private.job_post_applications where post_id=post.id and request_id=p_request_id;
 if found then
 if previous.fingerprint<>fingerprint then raise exception 'This submission reference has already been used. Reload the form.';end if;
 return jsonb_build_object('saved',true,'applicantId',previous.applicant_id,'alreadySubmitted',true);
 end if;
 if post.revoked_at is not null or post.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='This job post is closed or expired. Your earlier submissions are retained by HR.';end if;
 if (select count(*) from ats_private.job_post_applications where post_id=post.id)>=post.applicant_limit then raise exception using errcode='22023',message='The applicant limit has been reached. No more applications can be accepted.';end if;
 select * into job from public."Job_Opening" where id=p_job_id and admin_id=post.admin_id for update;
 if not found then raise exception 'Choose an available job opening.';end if;
 select (j->>'remaining_slots')::integer into available from jsonb_array_elements(ats_private.job_rows(post.admin_id)) j where j->>'id'=job.id::text;
 if coalesce(available,0)<=0 then raise exception 'This job opening no longer has available slots. Choose another opening.';end if;
 person_name:=nullif(btrim(p_basic->>'name'),'');email:=nullif(lower(btrim(p_basic->>'email')),'');phone:=nullif(btrim(p_basic->>'phone'),'');
 if person_name is not null and length(person_name)<2 then raise exception 'Enter at least two characters for the name, or leave it blank.';end if;
 if email is not null and email!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'Enter a valid email address.';end if;
 if phone is not null and phone!~'^[+()0-9 .-]{7,25}$' then raise exception 'Enter a valid contact number.';end if;
 if nullif(p_basic->>'gender','') is not null and p_basic->>'gender' not in('Male','Female') then raise exception 'Choose Male or Female for gender.';end if;
 if email is not null and exists(select 1 from public."Applicant_Masterlist" where "AdminID"=post.admin_id and lower(btrim(coalesce(nullif(btrim("Email"),''),"Email Address")))=email) then raise exception using errcode='23505',message='This email address is already registered with this recruitment team.';end if;
 if phone is not null and exists(select 1 from public."Applicant_Masterlist" where "AdminID"=post.admin_id and ats_private.contact_key(coalesce(nullif(btrim("ContactNumber"),''),"Contact Number"))=ats_private.contact_key(phone)) then raise exception using errcode='23505',message='This contact number is already registered with this recruitment team.';end if;
 person_name:=coalesce(person_name,'Applicant (details not provided)');
 select "CompanyID" into company from public.admins where "AdminID"=post.admin_id;
 if post.expires_at<=clock_timestamp() then raise exception 'This job post has expired.';end if;
 perform set_config('ats.activity.actor',jsonb_build_object('type','system','name','Public job application','AdminID',post.admin_id)::text,true);
 insert into public."Applicant_Masterlist"("AdminID","CompanyID","JobOpeningID","Name","FullName","Position","PositionApplied","Site","Source","Email","Email Address","ContactNumber","Contact Number","Current Address","Gender","Birthdate","Remarks","Date","Submission Date","Status","StatusChangedAt")
 values(post.admin_id,company,job.id,person_name,person_name,job.position_title,job.position_title,job.site,'Social Media',email,email,phone,phone,nullif(btrim(p_basic->>'address'),''),nullif(p_basic->>'gender',''),nullif(p_basic->>'birthdate','')::date,'Public job post: '||post.label,(clock_timestamp() at time zone 'Asia/Manila')::date,(clock_timestamp() at time zone 'Asia/Manila')::date,'For Pooling',clock_timestamp()) returning "ApplicantID" into person;
 insert into ats_private.job_post_applications(post_id,admin_id,request_id,fingerprint,applicant_id) values(post.id,post.admin_id,p_request_id,fingerprint,person);
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(post.admin_id,'system','Public job application','created','applicant',person::text,person_name);
 return jsonb_build_object('saved',true,'applicantId',person);
end $function$;
CREATE OR REPLACE FUNCTION public.ats_job_post_list(p_session_token text, p_post_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner_id integer;account jsonb;result jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 if p_post_id is not null then
 perform 1 from ats_private.job_posts p where p.id=p_post_id and p.admin_id=owner_id and (account->>'accountType'='admin' or p.creator_type=account->>'accountType' and p.creator_id=(account->>'id')::integer);
 if not found then raise exception using errcode='42501',message='This job post is unavailable for your account.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a."ApplicantID",'name',a."FullName",'position',a."PositionApplied",'site',a."Site",'email',a."Email",'contact',a."ContactNumber",'gender',a."Gender",'birthdate',a."Birthdate",'age',extract(year from age((clock_timestamp() at time zone 'Asia/Manila')::date,a."Birthdate"))::integer,'confirmed_at',a."ApplicationConfirmedAt",'status',a."Status",'submitted_at',s.created_at) order by s.created_at desc),'[]') into result
 from ats_private.job_post_applications s join public."Applicant_Masterlist" a on a."ApplicantID"=s.applicant_id and a."AdminID"=owner_id where s.post_id=p_post_id and s.admin_id=owner_id;
 return result;
 end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]') into result from (
 select j.id,j.token,j.label,j.created_at,j.expires_at,j.applicant_limit,j.inviter,count(s.applicant_id)::integer submitted_count,
 case when j.revoked_at is not null then 'Closed' when j.expires_at<=clock_timestamp() then 'Expired' when count(s.applicant_id)>=j.applicant_limit then 'Limit reached' else 'Open' end state
 from ats_private.job_posts j left join ats_private.job_post_applications s on s.post_id=j.id
 where j.admin_id=owner_id and (account->>'accountType'='admin' or j.creator_type=account->>'accountType' and j.creator_id=(account->>'id')::integer)
 group by j.id order by j.created_at desc limit 100) p;
 return result;
end $function$;
CREATE OR REPLACE FUNCTION public.ats_applicant_save(p_session_token text, p_changes jsonb, p_applicant_id bigint DEFAULT NULL::bigint, p_client_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner_id integer;company_id uuid;payload jsonb;columns_sql text;field_name text;target_id bigint;result jsonb;account jsonb;is_new boolean; old_row jsonb; candidate jsonb; email_key text; phone_key text; date_field text;job public."Job_Opening"%rowtype;available integer;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 if p_changes is null or jsonb_typeof(p_changes)<>'object' or p_changes='{}'::jsonb then raise exception using errcode='22023',message='Enter the applicant details.';end if;
 -- Discard retired fields from an older open browser tab; none are stored.
 p_changes:=p_changes-array['Notes','ExcelSheet','ExcelRow','No.','LOCATION AND ACCOUNTS','DateApplied'];
 for field_name in select jsonb_object_keys(p_changes) loop if field_name='ExpectedStageVersion' then continue;end if;
  if field_name in('ApplicationConfirmedAt','ApplicationInvitationID','StageVersion','FollowUpProcessedAt','WorkbookImportID','ApplicantID','AdminID','CompanyID','ExcelData','ClientRecordID','StatusChangedAt') or not exists(select 1 from pg_attribute where attrelid='public."Applicant_Masterlist"'::regclass and attname=field_name and attnum>0 and not attisdropped) then raise exception using errcode='42501',message='Unknown or read-only applicant field: '||field_name;end if;
 end loop;
 if p_client_id is not null and char_length(p_client_id)>100 then raise exception using errcode='22023',message='Invalid applicant client reference.';end if;
 select "CompanyID" into company_id from public.admins where "AdminID"=owner_id;
 perform pg_advisory_xact_lock(1096045397,owner_id);
 target_id:=p_applicant_id;
 if target_id is null and p_client_id is not null then select "ApplicantID" into target_id from public."Applicant_Masterlist" where "AdminID"=owner_id and "ClientRecordID"=p_client_id;end if;
 is_new:=target_id is null;
 if (is_new or p_changes?'Status') and (p_changes->>'Status' is null or p_changes->>'Status' not in('For Orientation','For Final Interview','Rejected','Backout','No Show','No Answer','For F2F Interview','Deployed','For Pooling','For Exam','For Job Offer','For Phone Interview','For Online Interview','Hired','RESIGNED')) then
 raise exception using errcode='22023',message='Choose one of the approved applicant statuses.';
 end if;
 if not is_new then perform 1 from public."Applicant_Masterlist" where "ApplicantID"=target_id and "AdminID"=owner_id for update;if not found then raise exception using errcode='42501',message='This applicant is unavailable for your AdminID.';end if;end if;
 
 if p_changes?'AutoOutcome' then perform ats_private.require_admin(p_session_token);end if;
 perform set_config('ats.followup.processing','false',true); perform set_config('ats.followup.policy_explicit',case when p_changes?'AutoOutcome' and p_changes->>'AutoOutcome' is not null then 'true' else 'false' end,true);
 payload:=(p_changes-'ExpectedStageVersion')||jsonb_build_object('AdminID',owner_id,'CompanyID',company_id);
 if p_client_id is not null then payload:=payload||jsonb_build_object('ClientRecordID',p_client_id);end if;
 -- Keep the workbook names and the normalized integration columns in sync.
 if payload?'Name' then payload:=payload||jsonb_build_object('FullName',payload->'Name');end if;
 if payload?'Position' then payload:=payload||jsonb_build_object('PositionApplied',payload->'Position');end if;
 if payload?'Contact Number' then payload:=payload||jsonb_build_object('ContactNumber',payload->'Contact Number');end if;
 if payload?'Email Address' then payload:=payload||jsonb_build_object('Email',payload->'Email Address');end if;
 if is_new then payload:=jsonb_build_object('Date',(clock_timestamp() at time zone 'Asia/Manila')::date)||payload;end if;
 if nullif(btrim(payload->>'Name'),'') is null and is_new then raise exception using errcode='22023',message='Applicant full name is required.';end if;
 if payload?'Email' and nullif(payload->>'Email','') is not null and (payload->>'Email')!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using errcode='22023',message='Enter a valid applicant email.';end if;
 if not is_new then select to_jsonb(a) into old_row from public."Applicant_Masterlist" a where a."ApplicantID"=target_id and a."AdminID"=owner_id;end if;
 -- Older clients can still submit a valid existing position/site pair during rollout.
 if not payload?'JobOpeningID' and (is_new or (coalesce(payload->>'Position',old_row->>'Position'),coalesce(payload->>'Site',old_row->>'Site')) is distinct from (old_row->>'Position',old_row->>'Site')) then
 select j.* into job from public."Job_Opening" j where j.admin_id=owner_id and lower(btrim(j.position_title))=lower(btrim(payload->>'Position')) and lower(btrim(j.site))=lower(btrim(payload->>'Site')) and exists(select 1 from jsonb_array_elements(ats_private.job_rows(owner_id)) counts where counts->>'id'=j.id::text and (counts->>'remaining_slots')::integer>0) limit 1;
 if found then payload:=payload||jsonb_build_object('JobOpeningID',job.id);end if;
 end if;
 if payload?'Gender' and nullif(payload->>'Gender','') is not null and payload->>'Gender' not in('Male','Female') then raise exception using errcode='22023',message='Choose Male or Female for gender.';end if;
 if payload?'JobOpeningID' then
 if coalesce(payload->>'JobOpeningID','')!~'^[a-f0-9-]{36}$' then raise exception using errcode='22023',message='Choose an available job and site.';end if;
 select * into job from public."Job_Opening" where id=(payload->>'JobOpeningID')::uuid and admin_id=owner_id for update;
 if not found then raise exception using errcode='42501',message='This job belongs to another workspace or is unavailable.';end if;
 select (j->>'remaining_slots')::integer into available from jsonb_array_elements(ats_private.job_rows(owner_id)) j where j->>'id'=job.id::text;
 if coalesce(available,0)<=0 and (is_new or old_row->>'JobOpeningID' is distinct from job.id::text and (old_row->>'JobOpeningID' is not null or (old_row->>'Position',old_row->>'Site') is distinct from (job.position_title,job.site))) then raise exception using errcode='22023',message='Choose a job and site with available slots.';end if;
 payload:=payload||jsonb_build_object('Position',job.position_title,'PositionApplied',job.position_title,'Site',job.site);
 elsif is_new or (coalesce(payload->>'Position',old_row->>'Position'),coalesce(payload->>'Site',old_row->>'Site')) is distinct from (old_row->>'Position',old_row->>'Site') then
 raise exception using errcode='22023',message='Choose the job and site together from available openings.';
 elsif old_row->>'JobOpeningID' is not null then
 payload:=payload||jsonb_build_object('Position',old_row->>'Position','PositionApplied',old_row->>'Position','Site',old_row->>'Site');
 end if;

 
 if not is_new and (payload?'ScheduleDate' and payload->>'ScheduleDate' is distinct from old_row->>'ScheduleDate' or payload?'Status' and payload->>'Status' is distinct from old_row->>'Status') and not p_changes?'ScheduleResponse' then
 payload:=payload||jsonb_build_object('ScheduleResponse','Pending');
 end if;
 if not is_new and p_changes?'ExpectedStageVersion' and (p_changes->>'ExpectedStageVersion')::bigint is distinct from (old_row->>'StageVersion')::bigint then raise exception using errcode='40001',message='This applicant stage changed while the form was open. Close and refresh the record before saving.';end if;candidate:=coalesce(old_row,'{}'::jsonb)||payload;
 email_key:=nullif(lower(btrim(coalesce(nullif(btrim(candidate->>'Email'),''),candidate->>'Email Address'))),'');
 phone_key:=ats_private.contact_key(coalesce(nullif(btrim(candidate->>'ContactNumber'),''),candidate->>'Contact Number'));
 if email_key is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=owner_id and (target_id is null or a."ApplicantID"<>target_id) and nullif(lower(btrim(coalesce(nullif(btrim(a."Email"),''),a."Email Address"))),'')=email_key) then
  raise exception using errcode='23505',message='An applicant with this email address already exists in your AdminID.';
 end if;
 if phone_key is not null and exists(select 1 from public."Applicant_Masterlist" a where a."AdminID"=owner_id and (target_id is null or a."ApplicantID"<>target_id) and ats_private.contact_key(coalesce(nullif(btrim(a."ContactNumber"),''),a."Contact Number"))=phone_key) then
  raise exception using errcode='23505',message='An applicant with this contact number already exists in your AdminID.';
 end if;
 if is_new or candidate->>'Status' is distinct from old_row->>'Status' then
  payload:=payload||jsonb_build_object('StatusChangedAt',clock_timestamp());
  date_field:=case candidate->>'Status' when 'Screened' then 'DATE SCREENED' when 'Hired' then 'DATE HIRED' when 'Deployed' then 'Date of Deployment' when 'Rejected' then 'REJECTED DATE' when 'Backout' then 'BACKOUT DATE' else null end;
  if date_field is not null and nullif(candidate->>date_field,'') is null then payload:=payload||jsonb_build_object(date_field,(now() at time zone 'Asia/Manila')::date);end if;
 end if;

 select string_agg(quote_ident(key),',' order by key) into columns_sql from jsonb_object_keys(payload) as keys(key);
 if is_new then execute format('insert into public."Applicant_Masterlist" as a (%s) select %s from jsonb_populate_record(null::public."Applicant_Masterlist",$1) returning to_jsonb(a)',columns_sql,columns_sql) into result using payload;
 else execute format('update public."Applicant_Masterlist" as a set (%s)=(select %s from jsonb_populate_record(null::public."Applicant_Masterlist",$1)) where "ApplicantID"=$2 and "AdminID"=$3 returning to_jsonb(a)',columns_sql,columns_sql) into result using payload,target_id,owner_id;end if;
 if result is null then raise exception 'Supabase did not confirm saving the applicant.';end if;
 insert into ats_private.activity(admin_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,entity_label) values(owner_id,account->>'accountType',(account->>'id')::integer,account->>'name',case when is_new then 'created' else 'updated' end,'applicant',result->>'ApplicantID',coalesce(result->>'FullName',result->>'Name','Applicant'));
 return result;
end $function$;
create or replace function public.ats_job_post_confirm_applicant(p_session_token text,p_post_id uuid,p_applicant_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id integer;account jsonb;person_name text;confirmed timestamptz;begin
owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
perform 1 from ats_private.job_posts p join ats_private.job_post_applications s on s.post_id=p.id and s.admin_id=p.admin_id where p.id=p_post_id and p.admin_id=owner_id and s.applicant_id=p_applicant_id and (account->>'accountType'='admin' or p.creator_type=account->>'accountType' and p.creator_id=(account->>'id')::integer);
if not found then raise exception using errcode='42501',message='This applicant is unavailable for your account.';end if;
select "FullName","ApplicationConfirmedAt" into person_name,confirmed from public."Applicant_Masterlist" where "ApplicantID"=p_applicant_id and "AdminID"=owner_id for update;
if not found then raise exception 'Applicant not found.';end if;
if confirmed is null then
update public."Applicant_Masterlist" set "ApplicationConfirmedAt"=clock_timestamp() where "ApplicantID"=p_applicant_id and "AdminID"=owner_id returning "ApplicationConfirmedAt" into confirmed;
insert into ats_private.activity(admin_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,entity_label) values(owner_id,account->>'accountType',(account->>'id')::integer,account->>'name','updated','applicant',p_applicant_id::text,coalesce(person_name,'Applicant')||' — application confirmed');
end if;
return jsonb_build_object('saved',true,'applicantId',p_applicant_id,'confirmedAt',confirmed);
end $$;
revoke all on function public.ats_job_post_confirm_applicant(text,uuid,bigint) from public;
grant execute on function public.ats_job_post_confirm_applicant(text,uuid,bigint) to anon,authenticated;
