CREATE OR REPLACE FUNCTION public.ats_public_jobs_open(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare post ats_private.job_posts%rowtype;jobs jsonb;submitted integer;reason text;
begin
 if p_token is null or p_token!~'^[a-f0-9]{64}$' then return jsonb_build_object('unavailable',true,'closed',true,'reason','This job post is unavailable. Please request a current link from the recruitment team.','title','Job post unavailable','company',jsonb_build_object('name','Job openings'),'jobs','[]'::jsonb,'expiresAt',null,'serverNow',clock_timestamp(),'applicantLimit',0,'submittedCount',0);end if;
 select p.* into post from ats_private.job_posts p join public.admins a on a."AdminID"=p.admin_id and a."Status"='Active' and a."RoleID" in(1,2) where p.token=p_token;
 if not found then return jsonb_build_object('unavailable',true,'closed',true,'reason','This job post is unavailable. Please request a current link from the recruitment team.','title','Job post unavailable','company',jsonb_build_object('name','Job openings'),'jobs','[]'::jsonb,'expiresAt',null,'serverNow',clock_timestamp(),'applicantLimit',0,'submittedCount',0);end if;
 select count(*)::integer into submitted from ats_private.job_post_applications where post_id=post.id;
 reason:=case when post.revoked_at is not null then 'This job post is closed.' when post.expires_at<=clock_timestamp() then 'This job post has expired.' when submitted>=post.applicant_limit then 'The applicant limit has been reached.' end;
 if reason is null then
 select coalesce(jsonb_agg(jsonb_build_object('id',j->>'id','position_title',j->>'position_title','site',j->>'site','address',j->>'address','description',j->>'description','remaining_slots',(j->>'remaining_slots')::integer) order by j->>'position_title',j->>'site'),'[]') into jobs from jsonb_array_elements(ats_private.job_rows(post.admin_id)) j where (j->>'remaining_slots')::integer>0;
 else jobs:='[]';end if;
 return jsonb_build_object('closed',reason is not null,'reason',reason,'title',post.label,'company',ats_private.application_brand(post.admin_id),'contact',post.inviter,'jobs',jobs,'expiresAt',post.expires_at,'serverNow',clock_timestamp(),'applicantLimit',post.applicant_limit,'submittedCount',submitted);
end $function$

