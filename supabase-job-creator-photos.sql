-- Add the creator's current profile photo to workspace job rows.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('ats_private.job_rows(integer)'::regprocedure);
 if position('''creator_photo''' in definition)=0 then
  if position('to_jsonb(j)||' in definition)=0 then raise exception 'Unexpected job_rows definition';end if;
  definition:=replace(definition,'to_jsonb(j)||',$replacement$to_jsonb(j)||jsonb_build_object('creator_photo',ats_private.profile_data(case
   when j.creator_type='admin' then (select a."ProfilePicture" from public.admins a where a."AdminID"=j.creator_id and a."AdminID"=p_owner)
   when j.creator_type='user' then (select u."ProfilePicture" from public.users u where u."UserID"=j.creator_id and u."AdminID"=p_owner)
   else null end))||$replacement$);
  execute definition;
 end if;
end $migration$;
notify pgrst,'reload schema';
