begin;
select plan(1);
select has_function('public', 'apply_squad_changes', 'apply_squad_changes exists');
select * from finish();
rollback;
