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

-- ---------- Pagos (Stripe Checkout) · agregado 2026-09-03 ----------
-- El sitio llama a la Edge Function `checkout`, que crea la sesión de Stripe con los precios
-- de estas tablas. El webhook `stripe-webhook` guarda el pedido en `orders` (solo service role).
alter table public.checkout_intents add column if not exists stripe_session_id text;
alter table public.checkout_intents add column if not exists status text not null default 'created';   -- created | redirected | paid

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  stripe_session_id text unique not null,
  mode text,                        -- payment | subscription
  livemode boolean not null default false,
  amount_total_mxn numeric(10,2),
  currency text,
  customer_name text, customer_email text, customer_phone text,
  shipping jsonb,                   -- dirección de envío tal cual la manda Stripe
  items jsonb,                      -- {product_or_bundle_id: qty} del intento
  intent_id uuid references public.checkout_intents(id),
  status text not null default 'pagado',
  raw jsonb                         -- objeto checkout.session completo (por si acaso)
);
alter table public.orders enable row level security;   -- sin políticas públicas: solo service role

insert into public.site_config (key,value) values
('payments','"stripe"'),            -- "stripe" | "none"
('stripe_mode','"test"'),           -- "test" mientras sea demo; "live" solo cuando Wero lo decida
('shipping_mxn','99')               -- PLACEHOLDER: costo de envío bajo el umbral de envío gratis
on conflict (key) do update set value=excluded.value, updated_at=now();

-- ---------- 5.º SKU: Pulmón de res (placeholder) · agregado 2026-09-07 ----------
-- Pedido por los cofundadores (nota de voz 3-sep): "faltó el pulmón, que es morado".
-- No está en el catálogo 2025: precio, gramos y análisis son PLACEHOLDER hasta que el equipo mande los datos.
insert into public.products (id,sort,name_es,name_en,sub_brand,code,qty_es,qty_en,grams,pieces,price_mxn,color,tint,img,tag_es,tag_en,hot,desc_es,desc_en,ingredient_es,ingredient_en,protein,fat,fiber,moisture,unit_es,unit_en,portions) values
('pulmon',5,'Pulmón de res','Beef Lung','Por confirmar','PT00XX','100 g','100 g',100,null,249,'#7B4FA3','#EBE1F4','img-bag-pulmon.webp','Nuevo · por confirmar','New · to be confirmed',false,
 'Pulmón de res deshidratado: ligero, aireado y fácil de partir. Bajo en grasa, ideal para premiar sin llenar.','Dehydrated beef lung: light, airy and easy to break. Low in fat, ideal for rewarding without filling them up.',
 'Pulmón de res','Beef lung',60,5,1,12,'trozos','pieces','[[1,2],[2,3],[3,4],[4,5]]')
on conflict (id) do nothing;

-- Pack Probador pasa a 5 bolsas (precio PLACEHOLDER: suma 1,345 → ~18 % menos)
update public.bundles set name_es='Pack Probador (5 bolsas)', name_en='Sampler Pack (5 bags)', price_mxn=1099,
  product_ids=array['patas','sticks','pechuga','jerky','pulmon'], updated_at=now() where id='pack-probador';

-- Sanity check
select 'products' as t, count(*) from public.products
union all select 'bundles', count(*) from public.bundles
union all select 'site_config', count(*) from public.site_config
union all select 'orders', count(*) from public.orders;

-- ---------- 10-sep-2026 · feedback de cofundadores ----------
-- 1) "Pack Probador" → "Pack Descubre" (la palabra "probador" sonaba rara a los usuarios)
update public.bundles set name_es = replace(name_es, 'Pack Probador', 'Pack Descubre'), updated_at = now() where name_es like 'Pack Probador%';

-- 2) Presentaciones (tamaños) por producto. Cada producto puede tener 1..n; el sitio muestra chips cuando hay 2+.
--    La fila is_default define precio/etiqueta base de la tarjeta y del Pack Descubre.
create table if not exists public.product_variants (
  id bigint generated always as identity primary key,
  product_id text not null references public.products(id) on delete cascade,
  key text not null,                       -- corto y estable: 's' | 'm' | 'l' (o '84g'); va en la llave del carrito "sticks@l"
  sort int not null default 1,
  label_es text not null, label_en text not null,   -- "96 g", "10 piezas"
  grams int, pieces int,
  price_mxn numeric(10,2) not null,
  code text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, key)
);
alter table public.product_variants enable row level security;
drop policy if exists "public read active variants" on public.product_variants;
create policy "public read active variants" on public.product_variants for select using (active);
-- Semilla: la presentación actual de cada producto como única (y por defecto). Al agregar más filas aparecen los chips.
insert into public.product_variants (product_id, key, sort, label_es, label_en, grams, pieces, price_mxn, code, is_default)
select id, 'std', 1, qty_es, qty_en, grams, pieces, price_mxn, code, true from public.products
on conflict (product_id, key) do nothing;

-- 3) Pulmón de res: datos reales de la bolsa (foto 7-sep): sub-marca Soft Bliss, 84 g (3.0 oz), 60 % proteína. Precio y código siguen PLACEHOLDER.
update public.products set sub_brand = 'Soft Bliss', qty_es = '84 g', qty_en = '84 g', grams = 84,
  tag_es = 'Nuevo', tag_en = 'New',
  desc_es = 'Pulmón de res deshidratado: ligero, aireado y fácil de partir. Bajo en calorías y grasa, rico en vitaminas B y minerales.',
  desc_en = 'Dehydrated beef lung: light, airy and easy to break. Low in calories and fat, rich in B vitamins and minerals.',
  updated_at = now() where id = 'pulmon';
update public.product_variants set label_es = '84 g', label_en = '84 g', grams = 84 where product_id = 'pulmon' and key = 'std';

-- 4) Salón de la Fama: perros reales con su humano. Fotos en el bucket público "fama" (o rutas relativas del sitio).
create table if not exists public.hall_of_fame (
  id bigint generated always as identity primary key,
  dog_name text not null,
  human_name text,
  city text,
  photo text not null,                      -- URL pública del bucket "fama" o nombre de archivo del sitio (img-fame-*.webp)
  caption text,
  approved boolean not null default false,  -- solo lo aprobado se muestra
  sort int not null default 100,
  created_at timestamptz not null default now(),
  unique (photo)
);
alter table public.hall_of_fame enable row level security;
drop policy if exists "public read approved fame" on public.hall_of_fame;
create policy "public read approved fame" on public.hall_of_fame for select using (approved);
insert into storage.buckets (id, name, public) values ('fama', 'fama', true) on conflict (id) do nothing;
drop policy if exists "public read fama" on storage.objects;
create policy "public read fama" on storage.objects for select using (bucket_id = 'fama');
insert into public.hall_of_fame (dog_name, human_name, photo, approved, sort) values
  ('Duque', null, 'img-fame-duque.webp', true, 1),
  ('Moka', 'Laura', 'img-fame-moka.webp', true, 2),
  ('Totó', 'Fernanda', 'img-fame-toto.webp', true, 3)
on conflict do nothing;

-- 5) Patitas de pollo: la bolsa real (foto 7-sep) dice "Patitas de Pollo" y "Contenido Neto 10 patas" (el catálogo 2025 decía 18 pz)
update public.products set name_es = 'Patitas de pollo', qty_es = '10 patas', qty_en = '10 feet', pieces = 10, updated_at = now() where id = 'patas';
update public.product_variants set label_es = '10 patas', label_en = '10 feet', pieces = 10 where product_id = 'patas' and key = 'std';

-- ---------- 23-sep-2026 · lista "Precios de Productos Chewawa ONLINE · septiembre 2026", Pack Descubre en 3 tamaños, Skydropx ----------
-- Precios = "Precio sugerido al Público" (MXN, IVA incluido). Los precios a distribuidor NO se cargan (son B2B, no van al sitio).
-- 1) "Sticks de res" → "Palitos de res" (nombre de la lista de precios; el id 'sticks' no cambia para no romper carritos)
update public.products set name_es = 'Palitos de res', unit_es = 'palitos', updated_at = now() where id = 'sticks';

-- 2) Presentaciones reales: chica (s) · mediana (m, la que abre la tarjeta) · grande (l). Reemplaza la semilla 'std' del 10-sep.
--    Gramos de las bolsas por pieza (patitas, palitos chicos) son aproximados: solo sirven para cotizar el envío.
delete from public.product_variants where key = 'std';
insert into public.product_variants (product_id, key, sort, label_es, label_en, grams, pieces, price_mxn, code, is_default) values
('patas',   's', 1, '4 piezas',  '4 pieces',  60,  4,    62.50,  null,     false),
('patas',   'm', 2, '10 piezas', '10 pieces', 150, 10,   112.50, 'PT0022', true),
('patas',   'l', 3, '18 piezas', '18 pieces', 270, 18,   225,    null,     false),
('sticks',  's', 1, '4 palitos', '4 sticks',  40,  4,    62.50,  null,     false),
('sticks',  'm', 2, '80 g',      '80 g',      80,  null, 112.50, null,     true),
('sticks',  'l', 3, '96 g',      '96 g',      96,  null, 150,    'PT0042', false),
('pechuga', 's', 1, '50 g',      '50 g',      50,  null, 67.50,  null,     false),
('pechuga', 'm', 2, '100 g',     '100 g',     100, null, 125,    null,     true),
('pechuga', 'l', 3, '255 g',     '255 g',     255, null, 300,    'PT0021', false),
('jerky',   's', 1, '50 g',      '50 g',      50,  null, 62.50,  null,     false),
('jerky',   'm', 2, '100 g',     '100 g',     100, null, 112.50, null,     true),
('jerky',   'l', 3, '255 g',     '255 g',     255, null, 300,    'PT0041', false),
('pulmon',  's', 1, '34 g',      '34 g',      34,  null, 62.50,  null,     false),
('pulmon',  'm', 2, '84 g',      '84 g',      84,  null, 112.50, 'PT00XX', true),
('pulmon',  'l', 3, '170 g',     '170 g',     170, null, 225,    null,     false)
on conflict (product_id, key) do update set sort = excluded.sort, label_es = excluded.label_es, label_en = excluded.label_en, grams = excluded.grams,
  pieces = excluded.pieces, price_mxn = excluded.price_mxn, code = excluded.code, is_default = excluded.is_default, active = true;

-- 3) products refleja la presentación por defecto (mediana): precio/etiqueta base de la tarjeta y de la Edge Function
update public.products p set qty_es = v.label_es, qty_en = v.label_en, grams = v.grams, pieces = v.pieces, price_mxn = v.price_mxn, updated_at = now()
from public.product_variants v where v.product_id = p.id and v.is_default;

-- 4) Pack Descubre en 3 tamaños: una bolsa de cada premio, todas del mismo tamaño. PROPUESTA de precio ≈ 10 % bajo la suma
--    de las 5 bolsas (chica 317.50 → 289 · mediana 575 → 519 · grande 1,200 → 1,079). Se edita aquí; el sitio y Stripe lo leen.
alter table public.bundles add column if not exists size_key text, add column if not exists sort int not null default 1;
update public.bundles set active = false, updated_at = now() where id = 'pack-probador';
insert into public.bundles (id, name_es, name_en, price_mxn, product_ids, free_shipping, size_key, sort) values
('pack-descubre-s', 'Pack Descubre · 5 bolsas chicas',   'Sampler Pack · 5 small bags',  289,  array['patas','sticks','pechuga','jerky','pulmon'], true, 's', 1),
('pack-descubre-m', 'Pack Descubre · 5 bolsas medianas', 'Sampler Pack · 5 medium bags', 519,  array['patas','sticks','pechuga','jerky','pulmon'], true, 'm', 2),
('pack-descubre-l', 'Pack Descubre · 5 bolsas grandes',  'Sampler Pack · 5 large bags',  1079, array['patas','sticks','pechuga','jerky','pulmon'], true, 'l', 3)
on conflict (id) do update set name_es = excluded.name_es, name_en = excluded.name_en, price_mxn = excluded.price_mxn, product_ids = excluded.product_ids,
  free_shipping = excluded.free_shipping, size_key = excluded.size_key, sort = excluded.sort, active = true, updated_at = now();

-- 5) Skydropx: cotizaciones que guarda la Edge Function `shipping-quote` (service role) y que `checkout` valida al cobrar.
--    Sin políticas públicas: el navegador solo recibe un quote_id. Origen del envío y empaque en site_config.
create table if not exists public.shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  cp text not null,                          -- C.P. destino
  weight_g int not null,                     -- peso calculado del carrito + empaque
  quotation_id text,                         -- id de la cotización en Skydropx
  rates jsonb not null,                      -- [{rate_id, carrier, service, days, amount, currency}]
  sandbox boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null            -- Skydropx: tarifas válidas 24 h
);
alter table public.shipping_quotes enable row level security;   -- sin políticas: solo service role
create index if not exists shipping_quotes_created_idx on public.shipping_quotes (created_at);
insert into public.site_config (key, value) values
('ship_origin', '{"postal_code":"76000","area_level1":"Querétaro","area_level2":"Querétaro"}'),   -- PLACEHOLDER: C.P. real de salida (planta Querétaro o bodega Monterrey)
('ship_packaging_g', '80')                                                                           -- gramos de caja/relleno que se suman al peso
on conflict (key) do nothing;                                                                        -- no pisar si el equipo ya lo editó
-- Secretos que faltan (Supabase → Edge Functions → Secrets, los pone Wero): SKYDROPX_CLIENT_ID, SKYDROPX_CLIENT_SECRET, SKYDROPX_ENV=sandbox

-- Verificación
select p.id, p.name_es, p.qty_es, p.price_mxn as default_mxn, count(v.*) as sizes, string_agg(v.key || '=' || v.price_mxn, ' ' order by v.sort) as prices
from public.products p left join public.product_variants v on v.product_id = p.id and v.active group by p.id, p.name_es, p.qty_es, p.price_mxn, p.sort order by p.sort;
select id, size_key, name_es, price_mxn, active from public.bundles order by sort;
select key, value from public.site_config where key in ('ship_origin','ship_packaging_g','shipping_mxn','free_ship_from');
