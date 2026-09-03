// Chewawa MX · Edge Function `checkout`
// Recibe el carrito del sitio, toma los precios REALES de Supabase (nunca del navegador),
// crea una Stripe Checkout Session en MXN y devuelve la URL a la que hay que mandar al cliente.
//
// POST { items: { "patas": 1, "pechuga-sub": 1, "bundle": 1 }, lang: "es", intent_id: "<uuid>", return_path: "/perro-premium/" }
// → { url: "https://checkout.stripe.com/c/pay/cs_test_…", id: "cs_test_…" }
//
// Secretos que usa (ya existen en el proyecto): STRIPE_SECRET_KEY. Los SUPABASE_* los inyecta Supabase.
// Seguridad: mientras site_config.stripe_mode = "test", se niega a trabajar con una llave que no sea de prueba.

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? firstKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? firstKey(Deno.env.get("SUPABASE_SECRET_KEYS"));

const ALLOWED_ORIGINS = [
  "https://karmatrades.github.io",
  "https://chewawa.dog",
  "https://www.chewawa.dog",
];
const DEFAULT_ORIGIN = "https://karmatrades.github.io";
const DEFAULT_PATH = "/perro-premium/";

function firstKey(json: string | undefined): string {
  try { const o = JSON.parse(json ?? ""); const v = Object.values(o)[0]; return typeof v === "string" ? v : ""; } catch { return ""; }
}

function cors(origin: string | null) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

// Codifica objetos anidados como los espera la API de Stripe: line_items[0][price_data][currency]=mxn
function form(obj: unknown, prefix = "", out: string[] = []): string {
  if (obj === null || obj === undefined) return out.join("&");
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      form(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(obj))}`);
  }
  return out.join("&");
}

async function sb(path: string, key: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`supabase ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const H = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: H });

  try {
    const body = await req.json().catch(() => ({}));
    const items: Record<string, number> = body.items && typeof body.items === "object" ? body.items : {};
    const lang = body.lang === "en" ? "en" : "es";
    const intentId = typeof body.intent_id === "string" && /^[0-9a-f-]{36}$/i.test(body.intent_id) ? body.intent_id : null;
    const returnPath = typeof body.return_path === "string" && /^\/[\w\-./]*$/.test(body.return_path) ? body.return_path : DEFAULT_PATH;
    const siteOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ORIGIN;

    // ---- catálogo y configuración reales ----
    const [products, bundles, cfgRows] = await Promise.all([
      sb("products?select=id,name_es,name_en,qty_es,qty_en,price_mxn,img&active=is.true", SB_ANON),
      sb("bundles?select=id,name_es,name_en,price_mxn&active=is.true&order=updated_at.desc&limit=1", SB_ANON),
      sb("site_config?select=key,value", SB_ANON),
    ]);
    const cfg = Object.fromEntries((cfgRows as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
    if (cfg.payments !== "stripe") return new Response(JSON.stringify({ error: "payments disabled" }), { status: 503, headers: H });

    const isTestKey = /^(sk|rk)_test_/.test(STRIPE_KEY);
    if (!STRIPE_KEY) return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY missing" }), { status: 500, headers: H });
    if (cfg.stripe_mode !== "live" && !isTestKey) {
      return new Response(JSON.stringify({ error: "stripe_mode is test but the configured key is not a test key — refusing" }), { status: 500, headers: H });
    }

    const subDiscount = Number(cfg.sub_discount ?? 0.15);
    const freeShipFrom = Number(cfg.free_ship_from ?? 599);
    const shippingMxn = Number(cfg.shipping_mxn ?? 99);
    const byId = Object.fromEntries((products as Record<string, unknown>[]).map((p) => [p.id as string, p]));
    const bundle = (bundles as Record<string, unknown>[])[0];
    const T = (es: string, en: string) => (lang === "es" ? es : en);

    // ---- líneas ----
    const lineItems: unknown[] = [];
    let subtotal = 0, hasSub = false, hasBundle = false;
    for (const [rawId, rawQty] of Object.entries(items)) {
      const qty = Math.min(20, Math.max(0, Math.floor(Number(rawQty) || 0)));
      if (!qty) continue;
      if (rawId === "bundle") {
        if (!bundle) continue;
        hasBundle = true;
        const price = Number(bundle.price_mxn);
        subtotal += price * qty;
        lineItems.push({
          quantity: qty,
          price_data: {
            currency: "mxn", unit_amount: Math.round(price * 100),
            product_data: { name: T(bundle.name_es as string, bundle.name_en as string), description: T("Las 4 bolsas · envío gratis", "All 4 bags · free shipping"), metadata: { chewawa_id: "bundle" } },
          },
        });
        continue;
      }
      const isSub = rawId.endsWith("-sub");
      const p = byId[rawId.replace(/-sub$/, "")];
      if (!p) continue;
      const base = Number(p.price_mxn);
      const price = isSub ? Math.round(base * (1 - subDiscount)) : base;   // pesos enteros, igual que el sitio
      subtotal += price * qty;
      if (isSub) hasSub = true;
      lineItems.push({
        quantity: qty,
        price_data: {
          currency: "mxn", unit_amount: Math.round(price * 100),
          ...(isSub ? { recurring: { interval: "month" } } : {}),
          product_data: {
            name: `${T(p.name_es as string, p.name_en as string)} · ${T(p.qty_es as string, p.qty_en as string)}${isSub ? T(" · cada mes", " · monthly") : ""}`,
            images: [`${siteOrigin}${returnPath.replace(/[^/]*$/, "")}${p.img}`],
            metadata: { chewawa_id: rawId },
          },
        },
      });
    }
    if (!lineItems.length) return new Response(JSON.stringify({ error: "empty cart" }), { status: 400, headers: H });

    const mode = hasSub ? "subscription" : "payment";
    const freeShip = hasBundle || subtotal >= freeShipFrom;
    const returnBase = `${siteOrigin}${returnPath}`;

    const session: Record<string, unknown> = {
      mode,
      line_items: lineItems,
      locale: lang === "es" ? "es-419" : "en",
      success_url: `${returnBase}?pago=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnBase}?pago=cancelado`,
      allow_promotion_codes: "true",
      billing_address_collection: "auto",
      shipping_address_collection: { allowed_countries: ["MX"] },
      phone_number_collection: { enabled: "true" },
      metadata: { source: "chewawa-mx-demo", lang, intent_id: intentId ?? "", items: JSON.stringify(items).slice(0, 490) },
      ...(intentId ? { client_reference_id: intentId } : {}),
    };
    if (mode === "payment") {
      session.customer_creation = "always";
      session.shipping_options = [{
        shipping_rate_data: {
          type: "fixed_amount", display_name: freeShip ? T("Envío gratis", "Free shipping") : T("Envío estándar (2–5 días)", "Standard shipping (2–5 days)"),
          fixed_amount: { amount: freeShip ? 0 : Math.round(shippingMxn * 100), currency: "mxn" },
          delivery_estimate: { minimum: { unit: "business_day", value: 2 }, maximum: { unit: "business_day", value: 5 } },
        },
      }];
    } else if (!freeShip) {
      // En modo suscripción el envío va como cargo único en la primera factura.
      lineItems.push({ quantity: 1, price_data: { currency: "mxn", unit_amount: Math.round(shippingMxn * 100), product_data: { name: T("Envío (primer pedido)", "Shipping (first order)") } } });
      session.subscription_data = { metadata: { source: "chewawa-mx-demo" } };
    }

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form(session),
    });
    const s = await r.json();
    if (!r.ok) {
      console.error("stripe error", s);
      return new Response(JSON.stringify({ error: s.error?.message ?? "stripe error" }), { status: 502, headers: H });
    }

    // Marca el intento como redirigido (service role; si no hay llave, se omite sin romper nada)
    if (intentId && SB_SERVICE) {
      sb(`checkout_intents?id=eq.${intentId}`, SB_SERVICE, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "redirected", stripe_session_id: s.id }) }).catch((e) => console.error("intent patch", e));
    }

    return new Response(JSON.stringify({ url: s.url, id: s.id, mode, livemode: s.livemode === true }), { headers: H });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: H });
  }
});
