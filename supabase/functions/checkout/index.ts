// Chewawa MX · Edge Function `checkout`
// Recibe el carrito del sitio, toma los precios REALES de Supabase (nunca del navegador),
// crea una Stripe Checkout Session en MXN y devuelve la URL a la que hay que mandar al cliente.
//
// POST { items: { "patas": 1, "sticks@l": 1, "pechuga-sub": 1, "bundle@m": 1 }, lang: "es", intent_id: "<uuid>", return_path: "/perro-premium/",
//        shipping: { quote_id: "<uuid de shipping_quotes>", rate_id: "<id de tarifa Skydropx>" } | null }
// → { url: "https://checkout.stripe.com/c/pay/cs_test_…", id: "cs_test_…" }
// Envío: si llega una cotización válida (fila en shipping_quotes, no vencida) se cobra ESA tarifa (monto leído de la base,
// nunca del navegador); si no, la tarifa estándar site_config.shipping_mxn. Envío gratis SOLO si el negocio lo activa:
// site_config.free_ship_from > 0 (umbral) o bundles.free_shipping = true (pack). Desde el 23-sep ambos están apagados: el cliente paga el envío cotizado.
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
    const returnPath = typeof body.return_path === "string" && body.return_path.length <= 200 && /^\/(?!\/)[\w\-./]*$/.test(body.return_path) ? body.return_path : DEFAULT_PATH;
    const shipReq = body.shipping && typeof body.shipping === "object" ? body.shipping : null;
    const quoteId = shipReq && typeof shipReq.quote_id === "string" && /^[0-9a-f-]{36}$/i.test(shipReq.quote_id) ? shipReq.quote_id : null;
    const rateId = shipReq && typeof shipReq.rate_id === "string" && /^[\w-]{1,64}$/.test(shipReq.rate_id) ? shipReq.rate_id : null;
    const siteOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ORIGIN;

    // ---- catálogo y configuración reales ----
    const [products, bundles, cfgRows, variants] = await Promise.all([
      sb("products?select=id,name_es,name_en,qty_es,qty_en,price_mxn,img,grams&active=is.true", SB_ANON),
      sb("bundles?select=id,name_es,name_en,price_mxn,size_key,sort,product_ids,free_shipping&active=is.true&order=sort,updated_at.desc", SB_ANON),
      sb("site_config?select=key,value", SB_ANON),
      sb("product_variants?select=product_id,key,label_es,label_en,price_mxn,grams,is_default&active=is.true", SB_ANON).catch(() => []),   // presentaciones (opcional)
    ]);
    const cfg = Object.fromEntries((cfgRows as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
    if (cfg.payments !== "stripe") return new Response(JSON.stringify({ error: "payments disabled" }), { status: 503, headers: H });

    const isTestKey = /^(sk|rk)_test_/.test(STRIPE_KEY);
    if (!STRIPE_KEY) return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY missing" }), { status: 500, headers: H });
    if (cfg.stripe_mode !== "live" && !isTestKey) {
      return new Response(JSON.stringify({ error: "stripe_mode is test but the configured key is not a test key — refusing" }), { status: 500, headers: H });
    }

    const subDiscount = Number(cfg.sub_discount ?? 0.15);
    const freeShipFrom = Number(cfg.free_ship_from ?? 0);          // 0 = sin umbral de envío gratis
    const shippingMxn = Number(cfg.shipping_mxn ?? 99);
    // Mapas sin prototipo: una llave "constructor" / "toString" en el carrito no debe encontrar nada
    const byId: Record<string, Record<string, unknown>> = Object.create(null);
    for (const p of products as Record<string, unknown>[]) byId[p.id as string] = p;
    // presentaciones: "sticks@l" → variante l; sin "@" → la variante por defecto (o el producto tal cual si no hay variantes)
    const varsOf: Record<string, Record<string, unknown>[]> = Object.create(null);
    for (const v of variants as Record<string, unknown>[]) (varsOf[v.product_id as string] ??= []).push(v);
    const pickVariant = (pid: string, key: string | undefined) => {
      const vs = varsOf[pid] ?? [];
      if (key) return vs.find((v) => v.key === key) ?? null;
      return vs.find((v) => v.is_default) ?? vs[0] ?? null;
    };
    // peso del carrito (misma regla que `shipping-quote`) para atar la cotización al carrito que se paga
    const gramsFor = (pid: string, key?: string): number | null => {
      const vs = varsOf[pid] ?? [];
      const v = key ? vs.find((x) => x.key === key) : (vs.find((x) => x.is_default) ?? vs[0]);
      if (key && vs.length && !v) return null;
      return Number(v?.grams) || Number(byId[pid]?.grams) || 0;
    };
    let cartGrams = 0;
    // Pack Descubre por tamaño: "bundle@m" → fila con size_key m; "bundle" (carritos viejos) → m o la primera
    const bundleRows = bundles as Record<string, unknown>[];
    const pickBundle = (key: string | undefined) => bundleRows.find((b) => String(b.size_key ?? "m") === (key ?? "m")) ?? (key ? null : bundleRows[0] ?? null);
    const cents = (n: number) => Math.round(n * 100) / 100;
    const T = (es: string, en: string) => (lang === "es" ? es : en);

    // ---- envío cotizado (Skydropx) leído de la base, si el sitio mandó quote_id + rate_id ----
    let quoted: { carrier: string; service: string; days: number | null; amount: number; cp: string; weight_g: number } | null = null;
    if (quoteId && rateId && SB_SERVICE) {
      try {
        const rows = await sb(`shipping_quotes?id=eq.${quoteId}&select=rates,expires_at,cp,weight_g,sandbox`, SB_SERVICE) as { rates: Record<string, unknown>[]; expires_at: string; cp: string; weight_g: number; sandbox: boolean }[];
        const row = rows?.[0];
        if (row && new Date(row.expires_at).getTime() > Date.now() && !(row.sandbox && cfg.stripe_mode === "live")) {   // cotización de sandbox nunca en cobros reales
          const r = (row.rates ?? []).find((x) => String(x.rate_id) === rateId);
          if (r && Number(r.amount) > 0 && String(r.currency ?? "MXN") === "MXN") quoted = { carrier: String(r.carrier ?? ""), service: String(r.service ?? ""), days: Number(r.days) || null, amount: cents(Number(r.amount)), cp: String(row.cp), weight_g: Number(row.weight_g) };
        }
      } catch (e) { console.error("shipping quote lookup", e); }
    }

    // ---- líneas ----
    const lineItems: unknown[] = [];
    let subtotal = 0, hasSub = false, hasBundle = false, bundleFree = false;
    for (const [rawId, rawQty] of Object.entries(items)) {
      const qty = Math.min(20, Math.max(0, Math.floor(Number(rawQty) || 0)));
      if (!qty) continue;
      const bm = rawId.match(/^bundle(?:@([a-z0-9]+))?$/i);
      if (bm) {
        const bundle = pickBundle(bm[1]);
        if (!bundle) continue;                                                // tamaño de pack inexistente: se ignora la línea
        hasBundle = true; if (bundle.free_shipping === true) bundleFree = true;
        const bids = Array.isArray(bundle.product_ids) && bundle.product_ids.length ? bundle.product_ids as string[] : Object.keys(byId);
        cartGrams += qty * bids.reduce((s, pid) => s + (gramsFor(pid, String(bundle.size_key ?? "m")) ?? gramsFor(pid) ?? 0), 0);
        const price = Number(bundle.price_mxn);
        subtotal += price * qty;
        lineItems.push({
          quantity: qty,
          price_data: {
            currency: "mxn", unit_amount: Math.round(price * 100),
            product_data: { name: T(bundle.name_es as string, bundle.name_en as string), description: T("Una bolsa de cada premio", "One bag of each treat"), metadata: { chewawa_id: rawId } },
          },
        });
        continue;
      }
      const m = rawId.match(/^([a-z0-9]+)(?:@([a-z0-9]+))?(-sub)?$/i);
      if (!m) continue;
      const isSub = !!m[3];
      const p = byId[m[1]];
      if (!p) continue;
      const v = pickVariant(m[1], m[2]);
      if (m[2] && !v) continue;                                             // tamaño inexistente: se ignora la línea
      cartGrams += qty * (gramsFor(m[1], m[2]) ?? 0);
      const base = Number(v ? v.price_mxn : p.price_mxn);
      const qtyLabel = v ? T(v.label_es as string, v.label_en as string) : T(p.qty_es as string, p.qty_en as string);
      const price = isSub ? cents(base * (1 - subDiscount)) : base;       // redondeo a centavos, misma fórmula que el sitio
      subtotal += price * qty;
      if (isSub) hasSub = true;
      lineItems.push({
        quantity: qty,
        price_data: {
          currency: "mxn", unit_amount: Math.round(price * 100),
          ...(isSub ? { recurring: { interval: "month" } } : {}),
          product_data: {
            name: `${T(p.name_es as string, p.name_en as string)} · ${qtyLabel}${isSub ? T(" · cada mes", " · monthly") : ""}`,
            images: [`${siteOrigin}${returnPath.replace(/[^/]*$/, "")}${p.img}`],
            metadata: { chewawa_id: rawId },
          },
        },
      });
    }
    if (!lineItems.length) return new Response(JSON.stringify({ error: "empty cart" }), { status: 400, headers: H });
    if (quoted) {   // la cotización vale solo para el peso con el que se pidió (+ empaque); si el carrito cambió, tarifa estándar
      const packaging = Number(cfg.ship_packaging_g ?? 80);
      if (Math.abs(Math.round(cartGrams + packaging) - quoted.weight_g) > 5) { console.warn("quote weight mismatch", quoted.weight_g, cartGrams + packaging); quoted = null; }
    }

    const mode = hasSub ? "subscription" : "payment";
    const freeShip = (hasBundle && bundleFree) || (freeShipFrom > 0 && subtotal >= freeShipFrom);
    const returnBase = `${siteOrigin}${returnPath}`;
    const shipAmount = freeShip ? 0 : (quoted ? quoted.amount : shippingMxn);
    const shipName = freeShip ? T("Envío gratis", "Free shipping")
      : quoted ? `${quoted.carrier}${quoted.service ? " · " + quoted.service : ""}${quoted.days ? T(` (${quoted.days} día${quoted.days > 1 ? "s" : ""} hábil${quoted.days > 1 ? "es" : ""})`, ` (${quoted.days} business day${quoted.days > 1 ? "s" : ""})`) : ""}`.slice(0, 100).toWellFormed()
      : T("Envío estándar (2–5 días)", "Standard shipping (2–5 days)");
    const shipDays = quoted?.days ? { minimum: { unit: "business_day", value: Math.max(1, quoted.days) }, maximum: { unit: "business_day", value: Math.max(1, quoted.days) + 2 } }
      : { minimum: { unit: "business_day", value: 2 }, maximum: { unit: "business_day", value: 5 } };

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
      metadata: { source: "chewawa-mx-demo", lang, intent_id: intentId ?? "", items: JSON.stringify(items).slice(0, 490).toWellFormed(), shipping: `${shipName} · ${shipAmount}`.slice(0, 200).toWellFormed(), ...(quoted ? { quote_id: quoteId, rate_id: rateId, quote_cp: quoted.cp } : {}) },
      ...(intentId ? { client_reference_id: intentId } : {}),
    };
    if (mode === "payment") {
      session.customer_creation = "always";
      session.shipping_options = [{
        shipping_rate_data: {
          type: "fixed_amount", display_name: shipName,
          fixed_amount: { amount: Math.round(shipAmount * 100), currency: "mxn" },
          delivery_estimate: shipDays,
        },
      }];
    } else if (!freeShip) {
      // En modo suscripción el envío va como cargo único en la primera factura.
      lineItems.push({ quantity: 1, price_data: { currency: "mxn", unit_amount: Math.round(shipAmount * 100), product_data: { name: `${T("Envío (primer pedido)", "Shipping (first order)")} · ${shipName}`.slice(0, 100).toWellFormed() } } });
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
      sb(`checkout_intents?id=eq.${intentId}&status=eq.created`, SB_SERVICE, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "redirected", stripe_session_id: s.id }) }).catch((e) => console.error("intent patch", e));   // solo intentos nuevos: no se puede re-marcar uno ajeno
    }

    return new Response(JSON.stringify({ url: s.url, id: s.id, mode, livemode: s.livemode === true }), { headers: H });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: H });
  }
});
