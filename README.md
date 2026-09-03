# Chewawa! — demo del sitio para México

Rama `chewawa-mx-demo`. Es una **demostración** de cómo puede verse la tienda de Chewawa para dominar el mercado mexicano de premios naturales. No es la tienda oficial ni toca `chewawa.dog`.

## Qué hay aquí

- `index.html` — todo el sitio en un solo archivo (HTML + CSS + JS, sin frameworks). Español (MX) por defecto, botón **EN** para inglés.
- `img-*.webp` — 12 imágenes sacadas del catálogo 2025 (bolsas, beagle, logo, sello, fotos de ingrediente). 516 KB en total.
- `supabase/schema.sql` — el backend: tablas, políticas de seguridad (RLS) y datos iniciales del proyecto Supabase **perro-premium**. Idempotente: se puede volver a correr sin romper nada.
- `supabase/functions/checkout/` y `supabase/functions/stripe-webhook/` — las dos Edge Functions de pagos (copia de lo desplegado en Supabase).
- Abre `index.html?notas` (o activa el switch **Notas de diseño** abajo a la izquierda) para ver, sección por sección, la evidencia con números que justifica cada decisión de diseño.

## Backend (Supabase)

Proyecto: `perro-premium` (org Genesis, plan gratuito) · `https://scifvxtcqmuyxrsowgeo.supabase.co`

Al cargar, el sitio lee de Supabase y, si no responde (sin internet o en la vista previa de claude.ai, que bloquea llamadas externas), usa los datos integrados en `index.html`. La etiqueta en el pie de página dice cuál está usando: **catálogo en vivo · Supabase** o **catálogo integrado**.

| Tabla | Qué guarda | Quién puede qué (con la llave pública) |
|---|---|---|
| `products` | Los 4 SKUs: nombres ES/EN, precio, gramos/piezas, color, imagen, análisis garantizado, porciones por talla | leer (solo `active = true`) |
| `bundles` | Pack Probador: precio y qué productos incluye | leer (solo activos) |
| `site_config` | `free_ship_from`, `sub_discount`, `msi_from`, `whatsapp`, `first_order_code`, `first_order_discount`, `checkout_url`, `prices_are_placeholders` | leer |
| `reviews` | Reseñas reales; el sitio reemplaza las tarjetas de ejemplo cuando hay reseñas con `approved = true` | leer (solo aprobadas) |
| `b2b_leads` | Formulario de mayoreo (negocio, ciudad, WhatsApp, tipo) | **solo insertar** — nadie puede leerlas desde el sitio |
| `newsletter_signups` | Club Chewawa (correo único, sin distinguir mayúsculas) | **solo insertar** |
| `checkout_intents` | Cada clic en "Pagar ahora": carrito, subtotal, modo (una vez / mensual) | **solo insertar** |

Para **cambiar un precio, el umbral de envío gratis o el código de descuento**: Supabase → Table Editor → `products` / `site_config`, edita y listo; el sitio lo toma al recargar. Para **ver leads y suscriptores**: Table Editor → `b2b_leads` / `newsletter_signups` (requiere estar logueado en el dashboard).

Seguridad: `index.html` solo contiene la llave **publishable** (`sb_publishable_…`), que es pública por diseño; todo lo que protege los datos son las políticas RLS de `schema.sql`. La llave **secret** (`sb_secret_…`) nunca va en el sitio ni en el repo.

## Pagos (Stripe) — conectado el 3 de septiembre de 2026, en **sandbox**

Cuenta Stripe **Hello Dog Treats**, entorno *sandbox* (pruebas). Nada de esto cobra dinero real hasta que se cambie a modo live (ver abajo).

Flujo: **Pagar ahora** → el sitio guarda el intento en `checkout_intents` → llama a la Edge Function `checkout` (`supabase/functions/checkout/index.ts`), que toma los precios de `products`/`bundles` (nunca del navegador), arma la Stripe Checkout Session en MXN (compra única o suscripción mensual con −15 %, dirección de envío solo México, teléfono, códigos de promoción) y devuelve la URL → el cliente paga en Stripe → vuelve al sitio con `?pago=ok` (carrito vacío + agradecimiento) o `?pago=cancelado` (carrito intacto) → Stripe manda `checkout.session.completed` a la Edge Function `stripe-webhook` (`supabase/functions/stripe-webhook/index.ts`), que guarda el pedido en la tabla **`orders`**, marca el intento como pagado y avisa por **Telegram**.

| Pieza | Dónde | Estado |
|---|---|---|
| Llaves de Stripe | Supabase → Edge Functions → Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) | ya existían (26-ago); son de **sandbox** |
| Función `checkout` | Supabase → Edge Functions (Verify JWT: OFF; valida sola su entrada) | desplegada y probada |
| Función `stripe-webhook` | Supabase → Edge Functions; endpoint registrado en Stripe Workbench → Webhooks (3 eventos) | desplegada y probada con `stripe trigger` |
| Código **CHEWAWA10** | Stripe → cupón 10 % (una vez) + código de promoción, solo primera compra | creado en sandbox |
| Envío | `site_config.shipping_mxn` (99, **PLACEHOLDER**) bajo el umbral `free_ship_from`; gratis con Pack Probador o desde $599 | inline en la función |
| Tarjetas de prueba | 4242 4242 4242 4242, cualquier fecha futura y CVC | sandbox |

Para **pasar a cobros reales** (cuando Wero lo decida): 1) en Stripe, salir del sandbox y crear el endpoint de webhook live apuntando a `https://scifvxtcqmuyxrsowgeo.supabase.co/functions/v1/stripe-webhook`; 2) en Supabase → Secrets, reemplazar `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` por los valores live; 3) crear el cupón/código CHEWAWA10 en live; 4) `site_config.stripe_mode` = `"live"` (mientras diga `"test"`, la función se niega a usar una llave que no sea de prueba). Para **apagar pagos** sin tocar código: `site_config.payments` = `"none"`.

## Cómo pasar de demo a producción

Todo lo que hay que cambiar vive en el bloque `CONFIG` al inicio del `<script>` de `index.html` (y, para lo que ya está en Supabase, en `site_config`):

| Clave | Qué es | Estado |
|---|---|---|
| `products.price_mxn` (Supabase) | Precio por bolsa (MXN, IVA incl.) | **PLACEHOLDER** — referencia de anaquel MX: patas de pollo deshidratadas ~MXN 1,400–1,600/kg (Bregos), Dentastix MXN 407–567/kg y MXN 8.50–11.50 la pieza suelta (Walmart/Scorpion) |
| `bundles.price_mxn` (Supabase) | Precio del Pack Probador | **PLACEHOLDER** |
| `site_config.free_ship_from` | Umbral de envío gratis | 599 |
| `site_config.sub_discount` | Descuento suscripción | 0.15 |
| `site_config.payments` | `"stripe"` (Checkout vía Edge Function) o `"none"` | stripe (sandbox) |
| `site_config.stripe_mode` | `"test"` / `"live"` | **test** |
| `site_config.shipping_mxn` | Costo de envío bajo el umbral de envío gratis | 99 **PLACEHOLDER** |
| `site_config.whatsapp` | Número con lada (52…) | 525661118591 (del sitio actual) |
| `CONFIG.b2bEndpoint` / `newsletterEndpoint` | Webhooks opcionales (CRM, Klaviyo) además de Supabase | vacíos |

Otros pendientes marcados en el HTML:

- Reseñas: las tres tarjetas dicen **ejemplo**. Cargar reseñas reales verificadas por compra en la tabla `reviews` con `approved = true` (nunca inventadas).
- FAQ "¿Tienen registro sanitario?": colocar número de registro SENASICA/SADER.
- Sello FDA del catálogo no se usa en la versión MX; agregar el sello mexicano que aplique.
- Fotos de clientes / TikTok en la sección de opiniones.
- Las bolsas (`img-bag-*.webp`) y el beagle son renders generados con IA a partir de las imágenes del catálogo (234×360 px; fuentes en `src-*.png`): diseño, colores, logo y textos principales son fieles, pero la letra chica (bullets, sello redondo) es inventada por el modelo y no debe usarse como referencia. Para producción, pedir los renders originales en alta resolución al diseñador del catálogo.
- Avisar a los leads: hoy solo se guardan en `b2b_leads`. Para recibir un WhatsApp/correo por cada lead, agregar un Database Webhook o una Edge Function en Supabase (los pedidos sí llegan a Telegram).
- OXXO / Mercado Pago: el anuncio del sitio los promete; en Stripe MX se activan OXXO y SPEI desde *Settings → Payment methods* cuando la cuenta esté en live. Mercado Pago no pasa por Stripe.

## Publicación

Desde el 3 de septiembre de 2026, GitHub Pages sirve **esta rama** (`chewawa-mx-demo`) en https://karmatrades.github.io/perro-premium/ (*Settings → Pages → Branch*). Cada commit a la rama se publica solo en ~1 minuto. `main` conserva el concepto anterior "Perro Premium" sin cambios; para volver a él basta con regresar la rama de Pages a `main`.

## Análisis garantizado y porciones

Los porcentajes de proteína/grasa y la guía de porciones por peso vienen tal cual del **Catálogo Chewawa 2025**. La comparación con Dentastix usa la etiqueta publicada por PetSmart (2026).
