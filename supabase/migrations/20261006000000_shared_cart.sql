-- One row per signed-in customer and product. A quantity of zero is a
-- tombstone so Realtime can stream removals as UPDATE events without using
-- unfiltered DELETE events.
create table if not exists public.shopping_cart_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity between 0 and 30),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create or replace function public.set_shopping_cart_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_shopping_cart_item_updated_at on public.shopping_cart_items;
create trigger set_shopping_cart_item_updated_at
  before update on public.shopping_cart_items
  for each row execute function public.set_shopping_cart_item_updated_at();

alter table public.shopping_cart_items enable row level security;

drop policy if exists "Customers read their own bag" on public.shopping_cart_items;
create policy "Customers read their own bag"
  on public.shopping_cart_items for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Customers add items to their own bag" on public.shopping_cart_items;
create policy "Customers add items to their own bag"
  on public.shopping_cart_items for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Customers update their own bag" on public.shopping_cart_items;
create policy "Customers update their own bag"
  on public.shopping_cart_items for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Customers remove items from their own bag" on public.shopping_cart_items;
create policy "Customers remove items from their own bag"
  on public.shopping_cart_items for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.shopping_cart_items to authenticated;
revoke all on public.shopping_cart_items from public, anon;

-- Add the table without resetting the existing Supabase Realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_cart_items'
  ) then
    alter publication supabase_realtime add table public.shopping_cart_items;
  end if;
end;
$$;
