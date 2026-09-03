-- Chewawa MX · Supabase schema (project perro-premium / scifvxtcqmuyxrsowgeo)
-- Run in the SQL editor. Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ---------- Catalog ----------
create table if not exists public.products (
  id text primary key,
  sort int not null default 0,
  active boolean not null default true,
  name_es text not null,
  name_en text not null,
  sub_brand text,
  code text,
  qty_es text, qty_en text,
  grams int, pieces int,
  price_mxn numeric(10,2) not null,
  color text, tint text,
  img text,                       -- filename served by the site (or full URL)
  tag_es text, tag_en text, hot boolean default false,
  desc_es text, desc_en text,
  ingredient_es text, ingredient_en text,
  protein numeric(5,1), fat numeric(5,1), fiber numeric(5,1), moisture numeric(5,1),
  unit_es text, unit_en text,
  portions jsonb,                 -- [[min,max] x 4 dog sizes] from the 2025 catalog feeding guide
  updated_at timestamptz not null default now()
);

create table if not exists public.bundles (
  id text primary key,
  active boolean not null default true,
  name_es text not null, name_en text not null,
  price_mxn numeric(10,2) not null,
  product_ids text[] not null,
  free_shipping boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product_id text references public.products(id),
  author text not null,
  city text, breed text,
  rating int not null check (rating between 1 and 5),
  body text not null,
  verified boolean not null default false,
  approved boolean not null default false
);

-- ---------- Captures from the site (insert-only for the public key) ----------
create table if not exists public.b2b_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  negocio text not null, ciudad text, whatsapp text not null, tipo text,
  lang text, source text default 'web', user_agent text,
  status text not null default 'nuevo'
);

create table if not exists public.newsletter_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null, lang text, source text default 'web',
  code text default 'CHEWAWA10'
);
create unique index if not exists newsletter_signups_email_idx on public.newsletter_signups (lower(email));

create table if not exists public.checkout_intents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  items jsonb not null,           -- {product_or_bundle_id: qty}
  subtotal_mxn numeric(10,2), mode text, lang text, user_agent text
);

-- ---------- RLS ----------
alter table public.products enable row level security;
alter table public.bundles enable row level security;
alter table public.site_config enable row level security;
alter table public.reviews enable row level security;
alter table public.b2b_leads enable row level security;
alter table public.newsletter_signups enable row level security;
alter table public.checkout_intents enable row level security;

drop policy if exists "public read products" on public.products;
create policy "public read products" on public.products for select to anon, authenticated using (active);
drop policy if exists "public read bundles" on public.bundles;
create policy "public read bundles" on public.bundles for select to anon, authenticated using (active);
drop policy if exists "public read config" on public.site_config;
create policy "public read config" on public.site_config for select to anon, authenticated using (true);
drop policy if exists "public read approved reviews" on public.reviews;
create policy "public read approved reviews" on public.reviews for select to anon, authenticated using (approved);
drop policy if exists "public insert leads" on public.b2b_leads;
create policy "public insert leads" on public.b2b_leads for insert to anon, authenticated with check (true);
drop policy if exists "public insert signups" on public.newsletter_signups;
create policy "public insert signups" on public.newsletter_signups for insert to anon, authenticated with check (true);
drop policy if exists "public insert intents" on public.checkout_intents;
create policy "public insert intents" on public.checkout_intents for insert to anon, authenticated with check (true);

-- ---------- Seed: 4 SKUs from the 2025 catalog (prices are placeholders) ----------
insert into public.products (id,sort,name_es,name_en,sub_brand,code,qty_es,qty_en,grams,pieces,price_mxn,color,tint,img,tag_es,tag_en,hot,desc_es,desc_en,ingredient_es,ingredient_en,protein,fat,fiber,moisture,unit_es,unit_en,portions) values
('patas',1,'Patas de pollo','Chicken Feet','Heaven''s Crunchies','PT0022','18 pz','18 pcs',150,18,199,'#E9A93B','#FBEFD3','img-bag-patas.webp','Más vendido','Best seller',true,
 'Crujientes y con glucosamina natural para las articulaciones. Ideal para razas medianas y grandes.','Crunchy, with natural glucosamine for joints. Ideal for medium and large breeds.',
 'Patas de pollo','Chicken feet',58,3,1,12,'piezas','pieces','[[1,2],[2,3],[3,4],[4,5]]'),
('sticks',2,'Sticks de res','Beef Sticks','Healthy Crave','PT0042','96 g','96 g',96,null,199,'#7BAF2C','#E8F1D6','img-bag-sticks.webp','Dental','Dental',false,
 'Esófago de res deshidratado. Masticable largo que ayuda a limpiar los dientes sin harinas ni glicerina.','Dehydrated beef esophagus. A long chew that helps clean teeth — no flours, no glycerin.',
 'Esófago de res','Beef esophagus',54,6,1,12,'sticks','sticks','[[1,2],[2,3],[3,4],[4,5]]'),
('pechuga',3,'Tiras de pechuga de pollo','Chicken Breast Strips','Nutri Luxe','PT0021','255 g','255 g',255,null,349,'#D8463E','#F8DAD8','img-bag-pechuga.webp','Entrenamiento','Training',false,
 '65 % de proteína y textura suave. El premio que sí quieren ganarse en el entrenamiento. Apto para cachorros.','65% protein and a soft texture. The reward they actually work for. Puppy-friendly.',
 'Pechuga de pollo','Chicken breast',65,3,1,12,'tiras','strips','[[1,2],[2,3],[3,4],[4,5]]'),
('jerky',4,'Jerky de res','Beef Jerky','Vital Feast','PT0041','255 g','255 g',255,null,349,'#35A9BC','#D6EEF2','img-bag-jerky.webp','Alta proteína','High protein',false,
 'Carne de res 100 %, deshidratada lento. Para perros exigentes y perros grandes con hambre de verdad.','100% beef, slow-dehydrated. For picky eaters and big dogs with real appetite.',
 'Carne de res','Beef',55,8,1,12,'tiras','strips','[[1,2],[2,3],[3,4],[4,5]]')
on conflict (id) do update set
  sort=excluded.sort, name_es=excluded.name_es, name_en=excluded.name_en, sub_brand=excluded.sub_brand, code=excluded.code,
  qty_es=excluded.qty_es, qty_en=excluded.qty_en, grams=excluded.grams, pieces=excluded.pieces, price_mxn=excluded.price_mxn,
  color=excluded.color, tint=excluded.tint, img=excluded.img, tag_es=excluded.tag_es, tag_en=excluded.tag_en, hot=excluded.hot,
  desc_es=excluded.desc_es, desc_en=excluded.desc_en, ingredient_es=excluded.ingredient_es, ingredient_en=excluded.ingredient_en,
  protein=excluded.protein, fat=excluded.fat, fiber=excluded.fiber, moisture=excluded.moisture, unit_es=excluded.unit_es, unit_en=excluded.unit_en,
  portions=excluded.portions, updated_at=now();

insert into public.bundles (id,name_es,name_en,price_mxn,product_ids,free_shipping) values
('pack-probador','Pack Probador (4 bolsas)','Sampler Pack (4 bags)',899,array['patas','sticks','pechuga','jerky'],true)
on conflict (id) do update set name_es=excluded.name_es, name_en=excluded.name_en, price_mxn=excluded.price_mxn, product_ids=excluded.product_ids, free_shipping=excluded.free_shipping, updated_at=now();

insert into public.site_config (key,value) values
('free_ship_from','599'),
('sub_discount','0.15'),
('msi_from','299'),
('whatsapp','"525661118591"'),
('first_order_code','"CHEWAWA10"'),
('first_order_discount','0.10'),
('checkout_url','""'),
('prices_are_placeholders','true')
on conflict (key) do update set value=excluded.value, updated_at=now();

-- Sanity check
select 'products' as t, count(*) from public.products
union all select 'bundles', count(*) from public.bundles
union all select 'site_config', count(*) from public.site_config;
