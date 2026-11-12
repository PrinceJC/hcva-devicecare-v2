begin;

-- Update the existing inspection function while preserving
-- its validation, access checks, and inspection history logic.
do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef(
    'public.complete_inspection(uuid,uuid,date,jsonb,text)'::regprocedure
  );

  if position(
    'interval ''3 months''' in function_definition
  ) = 0 then
    raise exception
      'Expected three-month scheduling rule was not found. Migration stopped.';
  end if;

  function_definition := replace(
    function_definition,
    'interval ''3 months''',
    'interval ''6 months'''
  );

  execute function_definition;
end;
$$;

-- Move existing automatically scheduled three-month dates
-- to six months after the latest inspection.
-- Keep manually adjusted dates and first inspection dates.
update public.devices
set next_due_date =
  (last_inspected_on + interval '6 months')::date
where last_inspected_on is not null
  and not archived
  and next_due_date =
    (last_inspected_on + interval '3 months')::date;

commit;