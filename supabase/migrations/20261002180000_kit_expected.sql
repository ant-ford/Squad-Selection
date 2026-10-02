-- When an order is expected (owner, 2 Oct 2026): the Kit Convenor sets the
-- delivery date the supplier gives, and players whose kit is on order see
-- it. Null when no date is known; ignored once the order has arrived.

alter table public.kit_orders add column expected_on date;

-- The same view as 20261001160000_kit_confirm, with expected_on added at the
-- end (create or replace view can only add columns there).
create or replace view public.kit_sets_v with (security_invoker = true) as
  select s.id, s.order_id, o.supplier, o.name as order_name, o.ordered_on, o.received_on,
         n.shirt_no, n.team_range, s.ordered_for_name,
         s.shirt, s.shorts, s.socks, s.goalie_smock, s.goalie_smock_style,
         owner.api_id as owner_id, public.kit_person_name(owner) as owner_name,
         holder.api_id as holder_id, public.kit_person_name(holder) as holder_name, s.held_since, s.updated_at,
         num.api_id as number_holder_id, public.kit_person_name(num) as number_holder_name,
         num.status as number_holder_status, num.active as number_holder_active,
         pend.api_id as pending_to_id, public.kit_person_name(pend) as pending_to_name, s.pending_since,
         o.expected_on
  from public.kit_sets s
  join public.kit_orders o on o.id = s.order_id
  join public.shirt_numbers n on n.id = s.shirt_number_id
  left join public.people num on num.shirt_number_id = s.shirt_number_id
  left join public.people owner on owner.id = num.id and owner.active
  left join public.people holder on holder.id = s.holder_id
  left join public.people pend on pend.id = s.pending_to_id;
