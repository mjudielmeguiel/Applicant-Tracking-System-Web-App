create or replace function public.ats_job_post_delete(p_session_token text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare owner_id integer;account jsonb;post ats_private.job_posts%rowtype;
begin
 owner_id:=ats_private.mrf_owner(p_session_token);account:=ats_private.session_account(p_session_token);
 select * into post from ats_private.job_posts where id=p_id and admin_id=owner_id for update;
 if not found or not(account->>'accountType'='admin' or post.creator_type=account->>'accountType' and post.creator_id=(account->>'id')::integer) then raise exception using errcode='42501',message='This job post is unavailable for your account.';end if;
 delete from ats_private.job_post_applications where post_id=p_id and admin_id=owner_id;
 delete from ats_private.job_posts where id=p_id and admin_id=owner_id;
 return jsonb_build_object('deleted',true,'id',p_id,'AdminID',owner_id);
end $fn$;
revoke all on function public.ats_job_post_delete(text,uuid) from public;
grant execute on function public.ats_job_post_delete(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
