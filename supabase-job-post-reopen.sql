create or replace function public.ats_job_post_reopen(p_session_token text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;post ats_private.job_posts%rowtype;submitted integer;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 select * into post from ats_private.job_posts where id=p_id and admin_id=owner_id for update;
 if not found or not(account->>'accountType'='admin' or post.creator_type=account->>'accountType' and post.creator_id=(account->>'id')::integer) then raise exception using errcode='42501',message='This job post is unavailable for your account.';end if;
 select count(*) into submitted from ats_private.job_post_applications where post_id=p_id;
 if submitted>=post.applicant_limit then raise exception using errcode='22023',message='The applicant limit has been reached. Create a new public post link.';end if;
 update ats_private.job_posts set revoked_at=null,expires_at=case when expires_at<=clock_timestamp() then clock_timestamp()+interval '7 days' else expires_at end where id=p_id;
 return jsonb_build_object('saved',true);
end $fn$;
revoke all on function public.ats_job_post_reopen(text,uuid) from public;
grant execute on function public.ats_job_post_reopen(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
