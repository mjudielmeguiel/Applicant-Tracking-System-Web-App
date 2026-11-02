do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.ats_public_jobs_open(text)'::regprocedure);
 if position('''creator_photo''' in definition)=0 then
  if position('''creator_name'',j->>''creator_name''' in definition)=0 then raise exception 'Creator name mapping missing';end if;
  definition:=replace(definition,'''creator_name'',j->>''creator_name''','''creator_name'',j->>''creator_name'',''creator_photo'',j->>''creator_photo''');
  execute definition;
 end if;
end $migration$;
notify pgrst,'reload schema';
