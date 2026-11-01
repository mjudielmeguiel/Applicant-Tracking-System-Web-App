-- Retire applicant-only metadata fields and use Job_Opening as the assignment.
do $constraints$ declare definition text;
begin
select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public."Applicant_Masterlist"'::regclass and conname='ats_applicant_fields';
definition:=replace(definition,' AND (("Notes" IS NULL) OR (char_length("Notes") <= 2000))','');
definition:=replace(definition,'"DateApplied" IS NOT NULL','"Date" IS NOT NULL');
alter table public."Applicant_Masterlist" drop constraint ats_applicant_fields;
execute 'alter table public."Applicant_Masterlist" add constraint ats_applicant_fields '||definition;
end $constraints$;
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
 if field not in('name','email','phone','address','gender') or jsonb_typeof(value)<>'string' or length(p_basic->>field)>(case field when 'name' then 120 when 'email' then 254 when 'phone' then 25 when 'address' then 2000 else 20 end) then raise exception using errcode='22023',message='Use basic applicant fields only.';end if;
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
 insert into public."Applicant_Masterlist"("AdminID","CompanyID","JobOpeningID","Name","FullName","Position","PositionApplied","Site","Source","Email","Email Address","ContactNumber","Contact Number","Current Address","Gender","Remarks","Date","Submission Date","Status","StatusChangedAt")
 values(post.admin_id,company,job.id,person_name,person_name,job.position_title,job.position_title,job.site,'Social Media',email,email,phone,phone,nullif(btrim(p_basic->>'address'),''),nullif(p_basic->>'gender',''),'Public job post: '||post.label,(clock_timestamp() at time zone 'Asia/Manila')::date,(clock_timestamp() at time zone 'Asia/Manila')::date,'For Pooling',clock_timestamp()) returning "ApplicantID" into person;
 insert into ats_private.job_post_applications(post_id,admin_id,request_id,fingerprint,applicant_id) values(post.id,post.admin_id,p_request_id,fingerprint,person);
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(post.admin_id,'system','Public job application','created','applicant',person::text,person_name);
 return jsonb_build_object('saved',true,'applicantId',person);
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
 for field_name in select jsonb_object_keys(p_changes) loop if field_name='ExpectedStageVersion' then continue;end if;
  if field_name in('ApplicationInvitationID','StageVersion','FollowUpProcessedAt','WorkbookImportID','ApplicantID','AdminID','CompanyID','ExcelData','ClientRecordID','StatusChangedAt') or not exists(select 1 from pg_attribute where attrelid='public."Applicant_Masterlist"'::regclass and attname=field_name and attnum>0 and not attisdropped) then raise exception using errcode='42501',message='Unknown or read-only applicant field: '||field_name;end if;
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
CREATE OR REPLACE FUNCTION ats_private.automatic_submission_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op='INSERT' then
  if new."WorkbookImportID" is null then new."Submission Date":=(clock_timestamp() at time zone 'Asia/Manila')::date;
  else new."Submission Date":=coalesce(new."Submission Date",new."Date",(clock_timestamp() at time zone 'Asia/Manila')::date);end if;
 else
  new."Submission Date":=coalesce(old."Submission Date",old."Date",(clock_timestamp() at time zone 'Asia/Manila')::date);
 end if;
 return new;
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
 insert into public."Applicant_Masterlist"("AdminID","CompanyID","ApplicationInvitationID","JobOpeningID","Name","FullName","Position","PositionApplied","Source","Site","Email Address","Email","Contact Number","ContactNumber","Current Address","Gender","Remarks","Date","Submission Date","Status","StatusChangedAt")
 values(inv.admin_id,company,inv.id,job.id,coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'),coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'),job.position_title,job.position_title,data->>'Source',job.site,nullif(lower(btrim(data->>'Email Address')),''),nullif(lower(btrim(data->>'Email Address')),''),nullif(btrim(data->>'Contact Number'),''),nullif(btrim(data->>'Contact Number'),''),nullif(data->>'Current Address',''),nullif(data->>'Gender',''),'Job opening application submitted',(clock_timestamp() at time zone 'Asia/Manila')::date,(clock_timestamp() at time zone 'Asia/Manila')::date,'For Pooling',clock_timestamp()) returning "ApplicantID" into target;
 update ats_private.applicant_invitations set finished_at=clock_timestamp(),applicant_id=target,result='For Pooling',draft=data,issues='{}',job_opening_id=job.id,job_snapshot=jsonb_build_object('id',job.id,'position_title',job.position_title,'site',job.site,'description',job.description,'address',job.address,'required_documents',job.required_documents),required_documents=job.required_documents where id=inv.id;
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(inv.admin_id,'system','Applicant invitation','created','applicant',target::text,coalesce(nullif(btrim(data->>'Name'),''),'Applicant (details not provided)'));
 return jsonb_build_object('closed',false,'phase','requirements','saved',true,'status','For Pooling');
end $function$;
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
  p:=p||jsonb_build_object('AdminID',owner_id,'CompanyID',company_id,'WorkbookImportID',p_import);
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
 if field not in('Name','JobOpeningID','Position','Source','Site','Email Address','Contact Number','Current Address','Gender') or jsonb_typeof(value)<>'string' or length(data->>field)>(case when field in('Current Address') then 2000 when field='Email Address' then 254 when field='Contact Number' then 25 else 120 end) then raise exception 'Unsupported or oversized application field';end if;
 end loop;
 select j into job from jsonb_array_elements(ats_private.job_rows(inv.admin_id)) j where j->>'id'=coalesce(nullif(data->>'JobOpeningID',''),inv.job_opening_id::text);
 if job is not null then data:=data||jsonb_build_object('JobOpeningID',job->>'id','Position',job->>'position_title','Site',job->>'site');else data:=data-'Position'-'Site';end if;
 update ats_private.applicant_invitations set draft=data,revision=revision+1 where id=inv.id returning * into inv;
 if p_submit then return ats_private.application_finish(inv.id);end if;
 return jsonb_build_object('saved',true,'revision',inv.revision,'issues',ats_private.application_issues(inv,inv.draft));
end $function$;
do $link$ declare definition text;begin
select pg_get_functiondef('ats_private.applicant_job_rules()'::regprocedure) into definition;
definition:=replace(definition,'and new."JobOpeningID"=old."JobOpeningID";','and (new."JobOpeningID"=old."JobOpeningID" or old."JobOpeningID" is null and (old."Position",old."Site")=(job.position_title,job.site));');execute definition;
end $link$;
update ats_private.applicant_invitations set draft=draft-array['Notes','ExcelSheet','ExcelRow','No.','LOCATION AND ACCOUNTS','DateApplied'];
update ats_private.workbook_import_rows set payload=payload-array['Notes','ExcelSheet','ExcelRow','No.','LOCATION AND ACCOUNTS','DateApplied'];
update public."Applicant_Masterlist" set "ExcelData"="ExcelData"-array['Notes','ExcelSheet','ExcelRow','No.','LOCATION AND ACCOUNTS','DateApplied'] where jsonb_typeof("ExcelData")='object';
alter table public."Applicant_Masterlist"
 drop column "Notes",drop column "ExcelSheet",drop column "ExcelRow",drop column "No.",drop column "LOCATION AND ACCOUNTS",drop column "DateApplied";
notify pgrst,'reload schema';

