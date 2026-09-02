# Chewawa! — demo del sitio para México

Rama `chewawa-mx-demo`. Es una **demostración** de cómo puede verse la tienda de Chewawa para dominar el mercado mexicano de premios naturales. No es la tienda oficial ni toca `chewawa.dog`.

## Qué hay aquí

- `index.html` — todo el sitio en un solo archivo (HTML + CSS + JS, sin frameworks). Español (MX) por defecto, botón **EN** para inglés.
- `img-*.webp` — 12 imágenes sacadas del catálogo 2025 (bolsas, beagle, logo, sello, fotos de ingrediente). 516 KB en total.
- Abre `index.html?notas` (o activa el switch **Notas de diseño** abajo a la izquierda) para ver, sección por sección, la evidencia con números que justifica cada decisión de diseño.

## Cómo pasar de demo a producción

Todo lo que hay que cambiar vive en el bloque `CONFIG` al inicio del `<script>` de `index.html`:

| Clave | Qué es | Estado |
|---|---|---|
| `PRODUCTS[].price` | Precio por bolsa (MXN, IVA incl.) | **PLACEHOLDER** — referencia de anaquel MX: patas de pollo deshidratadas ~MXN 1,400–1,600/kg (Bregos), Dentastix MXN 407–567/kg y MXN 8.50–11.50 la pieza suelta (Walmart/Scorpion) |
| `bundle.price` | Precio del Pack Probador | **PLACEHOLDER** |
| `freeShipFrom` | Umbral de envío gratis | 599 |
| `subDiscount` | Descuento suscripción | 0.15 |
| `checkoutUrl` | Stripe Payment Link / Shopify checkout / Mercado Pago | vacío → muestra aviso demo |
| `b2bEndpoint` | Formulario de mayoreo (Formspree, Google Form, CRM) | vacío |
| `newsletterEndpoint` | Klaviyo / Mailchimp | vacío |
| `whatsapp` | Número con lada (52…) | 525661118591 (del sitio actual) |

Otros pendientes marcados en el HTML:

- Reseñas: las tres tarjetas dicen **ejemplo**. Sustituir por reseñas reales verificadas por compra (nunca inventadas).
- FAQ "¿Tienen registro sanitario?": colocar número de registro SENASICA/SADER.
- Sello FDA del catálogo no se usa en la versión MX; agregar el sello mexicano que aplique.
- Fotos de clientes / TikTok en la sección de opiniones.
- Las bolsas vienen del PDF a 234×360 px (escaladas 3×). Para producción pedir renders en alta.

## Para publicar

GitHub Pages sirve la rama `main`. Cuando el demo esté aprobado: `git merge chewawa-mx-demo` en `main` (o cambiar la rama de Pages a `chewawa-mx-demo` en *Settings → Pages*).

## Análisis garantizado y porciones

Los porcentajes de proteína/grasa y la guía de porciones por peso vienen tal cual del **Catálogo Chewawa 2025**. La comparación con Dentastix usa la etiqueta publicada por PetSmart (2026).
