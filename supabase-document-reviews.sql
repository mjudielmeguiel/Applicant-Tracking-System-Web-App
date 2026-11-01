begin;
alter table ats_private.applicant_documents drop constraint if exists applicant_documents_document_type_check;
alter table ats_private.applicant_documents add constraint applicant_documents_document_type_check check(document_type in('NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO'));
create table if not exists ats_private.document_reviews(
 document_id uuid primary key references ats_private.applicant_documents(id) on delete cascade,
 status text not null default 'Submitted' check(status in('Submitted','Accepted','Rejected')),
 comment text not null default '' check(length(comment)<=2000),
 automated boolean not null default false,quality jsonb,reviewer jsonb,reviewed_at timestamptz not null default clock_timestamp()
);
create table if not exists ats_private.document_review_history(
 id bigint generated always as identity primary key,
 document_id uuid not null references ats_private.applicant_documents(id) on delete cascade,
 status text not null,comment text not null,automated boolean not null,reviewer jsonb,created_at timestamptz not null default clock_timestamp()
);
create table if not exists ats_private.applicant_id_photos(
 document_id uuid primary key references ats_private.applicant_documents(id) on delete cascade,
 applicant_id bigint not null references public."Applicant_Masterlist"("ApplicantID") on delete cascade,
 admin_id integer not null references public.admins("AdminID"),
 width integer not null,height integer not null,created_at timestamptz not null default clock_timestamp()
);
alter table ats_private.document_reviews enable row level security;
alter table ats_private.document_review_history enable row level security;
alter table ats_private.applicant_id_photos enable row level security;
revoke all on ats_private.document_reviews,ats_private.document_review_history,ats_private.applicant_id_photos from public,anon,authenticated;
create index if not exists ats_document_latest_type on ats_private.applicant_documents(admin_id,applicant_id,document_type,created_at desc,id desc);
update ats_private.applicant_invitations set required_documents=array_append(required_documents,'ID PHOTO') where not required_documents @> array['ID PHOTO'];
alter table ats_private.applicant_invitations alter column required_documents set default array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO'];

create or replace function ats_private.requirements_ready(p_applicant bigint,p_owner integer,p_required text[]) returns boolean language sql stable set search_path='' as $fn$
 select not exists(select 1 from unnest(p_required) kind where not coalesce((
   select coalesce(r.status,'Submitted')<>'Rejected' and exists(select 1 from storage.objects o where o.bucket_id='applicant-documents' and o.name=d.storage_path and (o.metadata->>'size')::bigint=d.byte_size)
   from ats_private.applicant_documents d left join ats_private.document_reviews r on r.document_id=d.id
   where d.applicant_id=p_applicant and d.admin_id=p_owner and d.document_type=kind order by d.created_at desc,d.id desc limit 1
 ),false));
$fn$;
create or replace function ats_private.requirement_documents(p_applicant bigint,p_owner integer) returns jsonb language sql stable set search_path='' as $fn$
 with docs as(
 select d.*,coalesce(r.status,'Submitted') review_status,coalesce(r.comment,'') review_comment,coalesce(r.automated,false) automated,r.quality,
 row_number() over(partition by d.document_type order by d.created_at desc,d.id desc)=1 latest
 from ats_private.applicant_documents d left join ats_private.document_reviews r on r.document_id=d.id where d.applicant_id=p_applicant and d.admin_id=p_owner
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',document_type,'document_type',document_type,'filename',filename,'mime_type',mime_type,'size',byte_size,'byte_size',byte_size,'created_at',created_at,'review_status',review_status,'review_comment',review_comment,'automated',automated,'quality',quality,'latest',latest,'file_available',exists(select 1 from storage.objects o where o.bucket_id='applicant-documents' and o.name=docs.storage_path)) order by created_at desc,id desc),'[]') from docs;
$fn$;
create or replace function ats_private.refresh_requirements(p_applicant bigint,p_owner integer) returns void language plpgsql set search_path='' as $fn$
declare item record;ready boolean;rejected text;all_ready boolean;
begin
 for item in select * from ats_private.applicant_invitations where applicant_id=p_applicant and admin_id=p_owner and revoked_at is null for update loop
 ready:=ats_private.requirements_ready(p_applicant,p_owner,item.required_documents);
 update ats_private.applicant_invitations set requirements_completed_at=case when ready then coalesce(requirements_completed_at,clock_timestamp()) else null end where id=item.id;
 end loop;
 select string_agg(d->>'type',', ') into rejected from jsonb_array_elements(ats_private.requirement_documents(p_applicant,p_owner)) d where (d->>'latest')::boolean and d->>'review_status'='Rejected';
 all_ready:=ats_private.requirements_ready(p_applicant,p_owner,array['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO']);
 update public."Applicant_Masterlist" set "Ongoing Requirements Status"=case when rejected is not null then 'Rejected: '||rejected||' — upload replacements' when all_ready then 'All documents submitted — pending review' else 'Requirements in progress' end,
 "REQUIREMENTS COMPLETION DATE"=case when all_ready then coalesce("REQUIREMENTS COMPLETION DATE",(clock_timestamp() at time zone 'Asia/Manila')::date) else null end
 where "ApplicantID"=p_applicant and "AdminID"=p_owner;
end $fn$;

create or replace function public.ats_applicant_documents(p_session_token text,p_applicant_id bigint) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);perform public.ats_document_access(p_session_token,p_applicant_id,null);
 return ats_private.requirement_documents(p_applicant_id,owner_id);
end $fn$;
create or replace function public.ats_document_review(p_session_token text,p_document_id uuid,p_status text,p_comment text default '') returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;item jsonb;actor jsonb;comment text:=btrim(coalesce(p_comment,''));
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 item:=public.ats_document_access(p_session_token,null,p_document_id);
 if p_status not in('Submitted','Accepted','Rejected') or length(comment)>2000 or p_status='Rejected' and comment='' then raise exception 'Select a review status and enter a comment for rejected files (maximum 2000 characters).';end if;
 perform 1 from ats_private.applicant_invitations where applicant_id=(item->>'applicant_id')::bigint and admin_id=owner_id order by id for update;
 perform 1 from ats_private.applicant_documents where id=p_document_id for update;
 if p_document_id is distinct from (select id from ats_private.applicant_documents where applicant_id=(item->>'applicant_id')::bigint and admin_id=owner_id and document_type=item->>'document_type' order by created_at desc,id desc limit 1) then raise exception 'Review the latest upload for this requirement.';end if;
 actor:=jsonb_build_object('type',account->>'accountType','id',account->>'id','name',account->>'name');
 insert into ats_private.document_reviews(document_id,status,comment,automated,reviewer) values(p_document_id,p_status,comment,false,actor)
 on conflict(document_id) do update set status=excluded.status,comment=excluded.comment,automated=false,reviewer=excluded.reviewer,reviewed_at=clock_timestamp();
 insert into ats_private.document_review_history(document_id,status,comment,automated,reviewer) values(p_document_id,p_status,comment,false,actor);
 if item->>'document_type'<>'ID PHOTO' then execute format('update public."Applicant_Masterlist" set %I=$1 where "ApplicantID"=$2 and "AdminID"=$3',item->>'document_type') using p_status,(item->>'applicant_id')::bigint,owner_id;end if;
 perform ats_private.refresh_requirements((item->>'applicant_id')::bigint,owner_id);
 insert into ats_private.activity(admin_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,entity_label) values(owner_id,account->>'accountType',(account->>'id')::integer,account->>'name','updated','applicant',item->>'applicant_id',(item->>'document_type')||' '||p_status);
 return jsonb_build_object('saved',true,'status',p_status);
end $fn$;

-- Re-evaluate completion on every opening so rejected/missing requirements reopen.
do $upgrade$ declare definition text;
begin
 select pg_get_functiondef('public.ats_application_open(text)'::regprocedure) into definition;
 if definition not like '%requirements_ready(inv.applicant_id%' then
 definition:=replace(definition,'if inv.requirements_completed_at is not null then return jsonb_build_object(''closed'',true);end if;','');
 definition:=replace(definition,'select coalesce(jsonb_agg(jsonb_build_object(''id'',d.id,''type'',d.document_type,''filename'',d.filename,''size'',d.byte_size) order by d.created_at),''[]'') into documents from ats_private.applicant_documents d where d.applicant_id=inv.applicant_id and d.admin_id=inv.admin_id;','documents:=ats_private.requirement_documents(inv.applicant_id,inv.admin_id);');
 definition:=replace(definition,'select not exists(select 1 from unnest(inv.required_documents) k where not exists(select 1 from ats_private.applicant_documents d where d.applicant_id=inv.applicant_id and d.admin_id=inv.admin_id and d.document_type=k)) into complete;','complete:=ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents);');
 definition:=replace(definition,'if complete then update','if not complete then update ats_private.applicant_invitations set requirements_completed_at=null where id=inv.id;end if; if complete then update');
 execute definition;
 end if;
 select pg_get_functiondef('public.ats_document_remove(text,uuid)'::regprocedure) into definition;
 if definition not like '%refresh_requirements%' then definition:=replace(definition,'end $function$', 'perform ats_private.refresh_requirements((item->>''applicant_id'')::bigint,(item->>''admin_id'')::integer);end $function$');execute definition;end if;
end $upgrade$;

create or replace function public.ats_application_upload_access(p_token text) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare inv ats_private.applicant_invitations%rowtype;allowed jsonb;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception using errcode='28000',message='This requirements link is unavailable';end if;
 select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token) for update;
 if not found or inv.revoked_at is not null or inv.applicant_id is null or inv.finished_at is null then raise exception using errcode='28000',message='This requirements link is unavailable';end if;
 perform 1 from public.admins where "AdminID"=inv.admin_id and "Status"='Active' and "RoleID" in(1,2);
 if not found then raise exception using errcode='28000',message='This requirements link is unavailable';end if;
 if ats_private.requirements_ready(inv.applicant_id,inv.admin_id,inv.required_documents) then raise exception using errcode='28000',message='All requirements are submitted. This link is complete.';end if;
 select coalesce(jsonb_agg(k),'[]') into allowed from unnest(inv.required_documents) k
 where not coalesce((select coalesce(r.status,'Submitted')<>'Rejected' and exists(select 1 from storage.objects o where o.bucket_id='applicant-documents' and o.name=d.storage_path)
 from ats_private.applicant_documents d left join ats_private.document_reviews r on r.document_id=d.id where d.applicant_id=inv.applicant_id and d.admin_id=inv.admin_id and d.document_type=k order by d.created_at desc,d.id desc limit 1),false);
 return jsonb_build_object('admin_id',inv.admin_id,'applicant_id',inv.applicant_id,'required',inv.required_documents,'can_upload',allowed);
end $fn$;
create or replace function public.ats_application_document_access(p_token text,p_document_id uuid) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare access jsonb;item jsonb;
begin
 access:=public.ats_application_upload_access(p_token);
 select to_jsonb(d) into item from ats_private.applicant_documents d where d.id=p_document_id and d.admin_id=(access->>'admin_id')::integer and d.applicant_id=(access->>'applicant_id')::bigint;
 if item is null then raise exception using errcode='42501',message='Document is unavailable for this invitation';end if;return item;
end $fn$;

create or replace function public.ats_document_upload_record(p_session_token text,p_token text,p_applicant_id bigint,p_id uuid,p_document_type text,p_filename text,p_mime_type text,p_byte_size integer,p_storage_path text,p_quality jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;applicant bigint;access jsonb;account jsonb;status text;comment text;closed boolean:=false;inv ats_private.applicant_invitations%rowtype;
begin
 if p_token is not null then
 access:=public.ats_application_upload_access(p_token);owner_id:=(access->>'admin_id')::integer;applicant:=(access->>'applicant_id')::bigint;
 if not (access->'can_upload')?p_document_type then raise exception 'This requirement is already submitted. A recruiter must reject it before replacement.';end if;
 account:=jsonb_build_object('accountType','system','name','Applicant requirements portal');
 else
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);applicant:=p_applicant_id;
 perform public.ats_document_access(p_session_token,applicant,null);
 end if;
 if p_document_type not in('NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO') then raise exception 'Invalid requirement category';end if;
 if p_storage_path not like owner_id||'/'||applicant||'/'||p_id||'.%' then raise exception 'Invalid document storage path';end if;
 if p_byte_size not between 1 and 10485760 or not exists(select 1 from storage.objects where bucket_id='applicant-documents' and name=p_storage_path and (metadata->>'size')::bigint=p_byte_size and metadata->>'mimetype'=p_mime_type) then raise exception 'The uploaded file could not be verified';end if;
 if p_mime_type not in('image/png','image/jpeg','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document') then raise exception 'Unsupported document format';end if;
 if p_document_type='ID PHOTO' and p_mime_type not in('image/png','image/jpeg') then raise exception 'ID pictures must be JPG or PNG';end if;
 status:=case when coalesce((p_quality->>'rejected')::boolean,false) then 'Rejected' else 'Submitted' end;
 comment:=case when status='Rejected' then left(coalesce(nullif(p_quality->>'comment',''),'Image is unclear. Please upload a clearer image.'),2000) else '' end;
 insert into ats_private.applicant_documents(id,admin_id,applicant_id,document_type,filename,mime_type,byte_size,storage_path) values(p_id,owner_id,applicant,p_document_type,left(p_filename,180),p_mime_type,p_byte_size,p_storage_path);
 insert into ats_private.document_reviews(document_id,status,comment,automated,quality,reviewer) values(p_id,status,comment,status='Rejected',p_quality,jsonb_build_object('type','system','name','Automatic image quality check'));
 insert into ats_private.document_review_history(document_id,status,comment,automated,reviewer) values(p_id,status,comment,status='Rejected',jsonb_build_object('type','system','name','Automatic image quality check'));
 if p_document_type='ID PHOTO' then
 insert into ats_private.applicant_id_photos(document_id,applicant_id,admin_id,width,height) values(p_id,applicant,owner_id,coalesce((p_quality->>'width')::integer,0),coalesce((p_quality->>'height')::integer,0));
 else execute format('update public."Applicant_Masterlist" set %I=$1 where "ApplicantID"=$2 and "AdminID"=$3',p_document_type) using status,applicant,owner_id;end if;
 perform ats_private.refresh_requirements(applicant,owner_id);
 if p_token is not null then select * into inv from ats_private.applicant_invitations where token_hash=ats_private.token_digest(p_token);closed:=inv.requirements_completed_at is not null;end if;
 insert into ats_private.activity(admin_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,entity_label) values(owner_id,account->>'accountType',(account->>'id')::integer,account->>'name','updated','applicant',applicant::text,p_document_type||' uploaded · '||status);
 return jsonb_build_object('saved',true,'id',p_id,'closed',closed,'review_status',status,'review_comment',comment);
end $fn$;

-- Existing completed invitations reopen when the newly required ID photo is missing.
update ats_private.applicant_invitations i set requirements_completed_at=null where i.applicant_id is not null and not ats_private.requirements_ready(i.applicant_id,i.admin_id,i.required_documents);
revoke all on function ats_private.requirements_ready(bigint,integer,text[]),ats_private.requirement_documents(bigint,integer),ats_private.refresh_requirements(bigint,integer) from public,anon,authenticated;
revoke all on function public.ats_document_upload_record(text,text,bigint,uuid,text,text,text,integer,text,jsonb),public.ats_application_document_access(text,uuid) from public,anon,authenticated;
grant execute on function public.ats_document_upload_record(text,text,bigint,uuid,text,text,text,integer,text,jsonb),public.ats_application_document_access(text,uuid) to service_role;
revoke all on function public.ats_document_register(text,bigint,uuid,text,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.ats_document_review(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ats_document_review(text,uuid,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
