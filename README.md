# Chewawa! — demo del sitio para México

Rama `chewawa-mx-demo`. Es una **demostración** de cómo puede verse la tienda de Chewawa para dominar el mercado mexicano de premios naturales. No es la tienda oficial ni toca `chewawa.dog`.

## Qué hay aquí

- `index.html` — todo el sitio en un solo archivo (HTML + CSS + JS, sin frameworks). Español (MX) por defecto, botón **EN** para inglés.
- `img-*.webp` — 12 imágenes sacadas del catálogo 2025 (bolsas, beagle, logo, sello, fotos de ingrediente). 516 KB en total.
- `supabase/schema.sql` — el backend: tablas, políticas de seguridad (RLS) y datos iniciales del proyecto Supabase **perro-premium**. Idempotente: se puede volver a correr sin romper nada.
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

## Cómo pasar de demo a producción

Todo lo que hay que cambiar vive en el bloque `CONFIG` al inicio del `<script>` de `index.html` (y, para lo que ya está en Supabase, en `site_config`):

| Clave | Qué es | Estado |
|---|---|---|
| `products.price_mxn` (Supabase) | Precio por bolsa (MXN, IVA incl.) | **PLACEHOLDER** — referencia de anaquel MX: patas de pollo deshidratadas ~MXN 1,400–1,600/kg (Bregos), Dentastix MXN 407–567/kg y MXN 8.50–11.50 la pieza suelta (Walmart/Scorpion) |
| `bundles.price_mxn` (Supabase) | Precio del Pack Probador | **PLACEHOLDER** |
| `site_config.free_ship_from` | Umbral de envío gratis | 599 |
| `site_config.sub_discount` | Descuento suscripción | 0.15 |
| `site_config.checkout_url` | Stripe Payment Link / Shopify checkout / Mercado Pago | vacío → muestra aviso demo y registra el intento en `checkout_intents` |
| `site_config.whatsapp` | Número con lada (52…) | 525661118591 (del sitio actual) |
| `CONFIG.b2bEndpoint` / `newsletterEndpoint` | Webhooks opcionales (CRM, Klaviyo) además de Supabase | vacíos |

Otros pendientes marcados en el HTML:

- Reseñas: las tres tarjetas dicen **ejemplo**. Cargar reseñas reales verificadas por compra en la tabla `reviews` con `approved = true` (nunca inventadas).
- FAQ "¿Tienen registro sanitario?": colocar número de registro SENASICA/SADER.
- Sello FDA del catálogo no se usa en la versión MX; agregar el sello mexicano que aplique.
- Fotos de clientes / TikTok en la sección de opiniones.
- Las bolsas (`img-bag-*.webp`) y el beagle son renders generados con IA a partir de las imágenes del catálogo (234×360 px; fuentes en `src-*.png`): diseño, colores, logo y textos principales son fieles, pero la letra chica (bullets, sello redondo) es inventada por el modelo y no debe usarse como referencia. Para producción, pedir los renders originales en alta resolución al diseñador del catálogo.
- Avisar a los leads: hoy solo se guardan en `b2b_leads`. Para recibir un WhatsApp/correo por cada lead, agregar un Database Webhook o una Edge Function en Supabase.

## Para publicar

GitHub Pages sirve la rama `main`. Cuando el demo esté aprobado: `git merge chewawa-mx-demo` en `main` (o cambiar la rama de Pages a `chewawa-mx-demo` en *Settings → Pages*).

## Análisis garantizado y porciones

Los porcentajes de proteína/grasa y la guía de porciones por peso vienen tal cual del **Catálogo Chewawa 2025**. La comparación con Dentastix usa la etiqueta publicada por PetSmart (2026).
