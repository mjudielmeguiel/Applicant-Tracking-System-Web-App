create table ats_private.job_posts(
 id uuid primary key default gen_random_uuid(),admin_id integer not null references public.admins("AdminID"),
 token text not null unique default encode(extensions.gen_random_bytes(32),'hex'),label text not null check(length(label) between 1 and 200),
 applicant_limit integer not null check(applicant_limit between 1 and 100000),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,revoked_at timestamptz,creator_type text not null,creator_id integer not null,inviter jsonb not null,
 unique(id,admin_id),check(expires_at>created_at and expires_at<=created_at+interval '7 days')
);
create table ats_private.job_post_applications(
 post_id uuid not null,admin_id integer not null,request_id uuid not null,fingerprint text not null,
 applicant_id bigint not null unique references public."Applicant_Masterlist"("ApplicantID"),created_at timestamptz not null default clock_timestamp(),
 primary key(post_id,request_id),foreign key(post_id,admin_id) references ats_private.job_posts(id,admin_id)
);
create index ats_job_posts_owner on ats_private.job_posts(admin_id,created_at desc);
alter table ats_private.job_posts enable row level security;
alter table ats_private.job_post_applications enable row level security;
revoke all on ats_private.job_posts,ats_private.job_post_applications from public,anon,authenticated;

create function public.ats_job_post_create(p_session_token text,p_label text,p_limit integer,p_expires_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;post ats_private.job_posts%rowtype;source_id integer;created timestamptz:=clock_timestamp();
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 if nullif(btrim(p_label),'') is null or length(btrim(p_label))>200 or p_limit is null or p_limit not between 1 and 100000 or p_expires_at is null or p_expires_at<=created or p_expires_at>created+interval '7 days' then raise exception using errcode='22023',message='Enter a title, applicant limit and future expiry no more than 7 days from now.';end if;
 if not exists(select 1 from jsonb_array_elements(ats_private.job_rows(owner_id)) j where (j->>'remaining_slots')::integer>0) then raise exception 'Post a job with available slots before creating a public link.';end if;
 perform pg_advisory_xact_lock(1096045397,owner_id);
 insert into public.sources("SourceName") values('Social Media') on conflict("SourceName") do nothing;
 select "SourceID" into source_id from public.sources where "SourceName"='Social Media';
 insert into ats_private.catalog_settings(admin_id,kind,entry_id) values(owner_id,'source',source_id) on conflict do nothing;
 insert into ats_private.job_posts(admin_id,label,applicant_limit,created_at,expires_at,creator_type,creator_id,inviter)
 values(owner_id,btrim(p_label),p_limit,created,p_expires_at,account->>'accountType',(account->>'id')::integer,ats_private.application_inviter(account->>'accountType',(account->>'id')::integer,owner_id)) returning * into post;
 return jsonb_build_object('id',post.id,'token',post.token,'AdminID',owner_id,'expires_at',post.expires_at,'applicant_limit',post.applicant_limit);
end $fn$;

create function public.ats_job_post_list(p_session_token text,p_post_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;result jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 if p_post_id is not null then
 perform 1 from ats_private.job_posts p where p.id=p_post_id and p.admin_id=owner_id and (account->>'accountType'='admin' or p.creator_type=account->>'accountType' and p.creator_id=(account->>'id')::integer);
 if not found then raise exception using errcode='42501',message='This job post is unavailable for your account.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a."ApplicantID",'name',a."FullName",'position',a."PositionApplied",'site',a."Site",'email',a."Email",'contact',a."ContactNumber",'status',a."Status",'submitted_at',s.created_at) order by s.created_at desc),'[]') into result
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
end $fn$;
create function public.ats_job_post_close(p_session_token text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 update ats_private.job_posts set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id and admin_id=owner_id and (account->>'accountType'='admin' or creator_type=account->>'accountType' and creator_id=(account->>'id')::integer);
 if not found then raise exception using errcode='42501',message='This job post is unavailable for your account.';end if;
 return jsonb_build_object('saved',true);
end $fn$;

create function public.ats_public_jobs_open(p_token text) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare post ats_private.job_posts%rowtype;jobs jsonb;submitted integer;reason text;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This job post is unavailable.';end if;
 select p.* into post from ats_private.job_posts p join public.admins a on a."AdminID"=p.admin_id and a."Status"='Active' and a."RoleID" in(1,2) where p.token=p_token;
 if not found then raise exception using errcode='28000',message='This job post is unavailable.';end if;
 select count(*)::integer into submitted from ats_private.job_post_applications where post_id=post.id;
 reason:=case when post.revoked_at is not null then 'This job post is closed.' when post.expires_at<=clock_timestamp() then 'This job post has expired.' when submitted>=post.applicant_limit then 'The applicant limit has been reached.' end;
 if reason is null then
 select coalesce(jsonb_agg(jsonb_build_object('id',j->>'id','position_title',j->>'position_title','site',j->>'site','address',j->>'address','description',j->>'description','remaining_slots',(j->>'remaining_slots')::integer) order by j->>'position_title',j->>'site'),'[]') into jobs from jsonb_array_elements(ats_private.job_rows(post.admin_id)) j where (j->>'remaining_slots')::integer>0;
 else jobs:='[]';end if;
 return jsonb_build_object('closed',reason is not null,'reason',reason,'title',post.label,'company',ats_private.application_brand(post.admin_id),'contact',post.inviter,'jobs',jobs,'expiresAt',post.expires_at,'serverNow',clock_timestamp(),'applicantLimit',post.applicant_limit,'submittedCount',submitted);
end $fn$;

create function public.ats_public_jobs_submit(p_token text,p_job_id uuid,p_basic jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $fn$
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
 insert into public."Applicant_Masterlist"("AdminID","CompanyID","JobOpeningID","Name","FullName","Position","PositionApplied","Site","Source","Email","Email Address","ContactNumber","Contact Number","Current Address","Gender","Remarks","Date","DateApplied","Submission Date","Status","StatusChangedAt")
 values(post.admin_id,company,job.id,person_name,person_name,job.position_title,job.position_title,job.site,'Social Media',email,email,phone,phone,nullif(btrim(p_basic->>'address'),''),nullif(p_basic->>'gender',''),'Public job post: '||post.label,(clock_timestamp() at time zone 'Asia/Manila')::date,clock_timestamp(),(clock_timestamp() at time zone 'Asia/Manila')::date,'For Pooling',clock_timestamp()) returning "ApplicantID" into person;
 insert into ats_private.job_post_applications(post_id,admin_id,request_id,fingerprint,applicant_id) values(post.id,post.admin_id,p_request_id,fingerprint,person);
 insert into ats_private.activity(admin_id,actor_type,actor_name,action,entity_type,entity_id,entity_label) values(post.admin_id,'system','Public job application','created','applicant',person::text,person_name);
 return jsonb_build_object('saved',true,'applicantId',person);
end $fn$;
revoke all on function public.ats_job_post_create(text,text,integer,timestamptz),public.ats_job_post_list(text,uuid),public.ats_job_post_close(text,uuid),public.ats_public_jobs_open(text),public.ats_public_jobs_submit(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ats_job_post_create(text,text,integer,timestamptz),public.ats_job_post_list(text,uuid),public.ats_job_post_close(text,uuid),public.ats_public_jobs_open(text),public.ats_public_jobs_submit(text,uuid,jsonb,uuid) to anon,authenticated;
notify pgrst,'reload schema';
create function public.ats_public_jobs_receipt(p_token text,p_request_id uuid) returns jsonb language sql security definer set search_path='' as $fn$
select jsonb_build_object('saved',exists(select 1 from ats_private.job_posts p join ats_private.job_post_applications s on s.post_id=p.id where p.token=p_token and p_request_id=s.request_id and p_token~'^[a-f0-9]{64}$'));
$fn$;
revoke all on function public.ats_public_jobs_receipt(text,uuid) from public,anon,authenticated;
grant execute on function public.ats_public_jobs_receipt(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
