// Chewawa MX · Edge Function `shipping-quote`
// Cotiza el envío del carrito con Skydropx (API PRO) a partir del código postal del cliente.
//
// POST { cp: "64000", items: { "patas": 1, "sticks@l": 2, "bundle@m": 1 }, lang: "es" }
// → { quote_id: "<uuid>", cp: "64000", weight_g: 420, rates: [ { rate_id, carrier, service, days, amount } ] }
//
// Seguridad / diseño:
// - El navegador solo manda C.P. + carrito. El peso sale del catálogo en Supabase, nunca del cliente.
// - Las tarifas se guardan en `shipping_quotes` (sin políticas públicas) y el sitio recibe un quote_id.
//   Al pagar, la Edge Function `checkout` lee el monto de esa fila: el cliente no puede inventar un envío de $0.
// - Secretos (los pone Wero en Supabase → Edge Functions → Secrets; nunca en el repo):
//     SKYDROPX_CLIENT_ID, SKYDROPX_CLIENT_SECRET            → Skydropx PRO → Conexiones → API
//     SKYDROPX_ENV = "sandbox" | "production"                  (default sandbox)
//     SKYDROPX_BASE_URL (opcional) → si Skydropx cambia de host (docs: pro.skydropx.com / sb-pro.skydropx.com)
// - Sin credenciales responde 503 { error: "not_configured" } y el sitio aplica la tarifa estándar al pagar.
// - Origen y empaque: site_config.ship_origin (JSON { postal_code, area_level1, area_level2 }) y site_config.ship_packaging_g.
// Docs Skydropx PRO: https://pro.skydropx.com/es-MX/api-docs (OAuth client_credentials, POST /api/v1/quotations, GET /api/v1/quotations/{id})

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? firstKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? firstKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
const SKY_ID = Deno.env.get("SKYDROPX_CLIENT_ID") ?? "";
const SKY_SECRET = Deno.env.get("SKYDROPX_CLIENT_SECRET") ?? "";
const SKY_ENV = (Deno.env.get("SKYDROPX_ENV") ?? "sandbox").toLowerCase();
const SKY_BASE = (Deno.env.get("SKYDROPX_BASE_URL") ?? (SKY_ENV === "production" ? "https://pro.skydropx.com" : "https://sb-pro.skydropx.com")).replace(/\/$/, "");

const ALLOWED_ORIGINS = ["https://karmatrades.github.io", "https://chewawa.dog", "https://www.chewawa.dog"];
const DEFAULT_ORIGIN = "https://karmatrades.github.io";
const MAX_RATES = 4;            // las más baratas
const QUOTE_TTL_H = 24;         // Skydropx: tarifas válidas 24 h
const POLL_MS = 700, POLL_MAX = 7;

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
async function sb(path: string, key: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`supabase ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
const json = (H: Record<string, string>, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: H });

// ---- token OAuth (client_credentials), cacheado en memoria mientras viva la instancia (expira a las 2 h) ----
let tokenCache: { token: string; exp: number } | null = null;
async function skyToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const r = await fetch(`${SKY_BASE}/api/v1/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: SKY_ID, client_secret: SKY_SECRET, grant_type: "client_credentials" }),
  });
  const j = await r.json().catch(() => ({}));
  const token = j.access_token ?? j.token ?? j.data?.access_token;
  if (!r.ok || !token) throw new Error(`skydropx oauth → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  tokenCache = { token, exp: Date.now() + Math.min(Number(j.expires_in ?? 7200), 7200) * 1000 };
  return token;
}
async function skyFetch(path: string, init: RequestInit = {}) {
  const t = await skyToken();
  const r = await fetch(`${SKY_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`skydropx ${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}
// La respuesta puede venir como { id, rates } o { data: { id, rates } } según la versión de la API
const unwrap = (j: Record<string, unknown>) => (j && typeof j.data === "object" && j.data ? j.data as Record<string, unknown> : j);

// Caja según peso (cm): las bolsas van en caja de cartón; cifras conservadoras para no sub-cotizar
function parcelFor(weightG: number) {
  const kg = Math.max(0.1, Math.ceil(weightG / 10) / 100);   // kg con 2 decimales, mínimo 100 g
  const dims = weightG <= 500 ? [20, 15, 8] : weightG <= 1500 ? [25, 20, 12] : weightG <= 3000 ? [30, 25, 15] : [40, 30, 20];
  return { weight: kg, length: dims[0], width: dims[1], height: dims[2] };
}

Deno.serve(async (req) => {
  const H = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return json(H, 405, { error: "POST only" });
  try {
    const body = await req.json().catch(() => ({}));
    const cp = String(body.cp ?? "").trim();
    if (!/^\d{5}$/.test(cp)) return json(H, 400, { error: "bad_cp" });
    const items: Record<string, number> = body.items && typeof body.items === "object" ? body.items : {};
    if (!SKY_ID || !SKY_SECRET) return json(H, 503, { error: "not_configured" });

    // ---- peso del carrito desde el catálogo real ----
    const [products, variants, bundles, cfgRows] = await Promise.all([
      sb("products?select=id,grams&active=is.true", SB_ANON),
      sb("product_variants?select=product_id,key,grams,is_default&active=is.true", SB_ANON).catch(() => []),
      sb("bundles?select=id,size_key,product_ids&active=is.true", SB_ANON).catch(() => []),
      sb("site_config?select=key,value", SB_ANON),
    ]);
    const cfg = Object.fromEntries((cfgRows as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
    const gramsOf: Record<string, number> = Object.create(null);            // sin prototipo: "constructor" en el carrito no encuentra nada
    for (const p of products as { id: string; grams: number }[]) gramsOf[p.id] = Number(p.grams) || 0;
    const varsOf: Record<string, { key: string; grams: number; is_default: boolean }[]> = Object.create(null);
    for (const v of variants as { product_id: string; key: string; grams: number; is_default: boolean }[]) (varsOf[v.product_id] ??= []).push(v);
    const gramsFor = (pid: string, key?: string): number | null => {           // null = tamaño inexistente (misma regla que `checkout`: se ignora la línea)
      const vs = varsOf[pid] ?? [];
      const v = key ? vs.find((x) => x.key === key) : (vs.find((x) => x.is_default) ?? vs[0]);
      if (key && vs.length && !v) return null;
      return Number(v?.grams) || gramsOf[pid] || 0;
    };
    let weight = 0, lines = 0;
    for (const [rawId, rawQty] of Object.entries(items)) {
      const qty = Math.min(20, Math.max(0, Math.floor(Number(rawQty) || 0)));
      if (!qty) continue;
      const m = rawId.match(/^([a-z0-9]+)(?:@([a-z0-9]+))?(-sub)?$/i);
      if (!m) continue;
      if (m[1] === "bundle") {
        const bs = bundles as { size_key: string | null; product_ids: string[] }[];
        const b = bs.find((x) => (x.size_key ?? "m") === (m[2] ?? "m")) ?? bs[0];
        const ids = b?.product_ids?.length ? b.product_ids : Object.keys(gramsOf);
        weight += qty * ids.reduce((s, pid) => s + (gramsFor(pid, b?.size_key ?? m[2]) ?? gramsFor(pid) ?? 0), 0); lines += qty; continue;
      }
      if (!(m[1] in gramsOf)) continue;
      const g = gramsFor(m[1], m[2]); if (g === null) continue;
      weight += qty * g; lines += qty;
    }
    if (!lines) return json(H, 400, { error: "empty_cart" });
    const packaging = Number(cfg.ship_packaging_g ?? 80);
    const weightG = Math.round(weight + packaging);
    const sandbox = SKY_ENV !== "production";

    // ---- misma cotización reciente (mismo C.P., peso y entorno) → se reutiliza: menos llamadas a Skydropx (límite 2 req/s) ----
    if (SB_SERVICE) {
      try {
        const prev = await sb(`shipping_quotes?cp=eq.${cp}&weight_g=eq.${weightG}&sandbox=is.${sandbox}&expires_at=gt.${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}&order=created_at.desc&limit=1&select=id,rates`, SB_SERVICE) as { id: string; rates: unknown[] }[];
        if (prev?.[0]?.rates?.length) return json(H, 200, { quote_id: prev[0].id, cp, weight_g: weightG, rates: prev[0].rates, sandbox, cached: true });
      } catch (e) { console.error("quote cache lookup", e); }
    }

    // ---- cotización Skydropx ----
    const origin = (cfg.ship_origin && typeof cfg.ship_origin === "object" ? cfg.ship_origin : {}) as Record<string, string>;
    if (!/^\d{5}$/.test(String(origin.postal_code ?? ""))) return json(H, 503, { error: "not_configured", detail: "site_config.ship_origin.postal_code" });
    const parcel = parcelFor(weightG);
    const payload = {
      address_from: { country_code: "MX", postal_code: String(origin.postal_code), ...(origin.area_level1 ? { area_level1: origin.area_level1 } : {}), ...(origin.area_level2 ? { area_level2: origin.area_level2 } : {}), ...(origin.area_level3 ? { area_level3: origin.area_level3 } : {}) },
      address_to: { country_code: "MX", postal_code: cp },
      parcels: [parcel],
    };
    let q = unwrap(await skyFetch("/api/v1/quotations", { method: "POST", body: JSON.stringify(payload) }));
    const qid = String(q.id ?? "");
    let rates = Array.isArray(q.rates) ? q.rates as Record<string, unknown>[] : [];
    // La cotización es asíncrona: se consulta hasta que is_completed (o hasta agotar el tiempo con lo que haya)
    for (let i = 0; i < POLL_MAX && qid && (q.is_completed === false || !rates.length); i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      q = unwrap(await skyFetch(`/api/v1/quotations/${encodeURIComponent(qid)}`));
      rates = Array.isArray(q.rates) ? q.rates as Record<string, unknown>[] : [];
    }
    const clean = rates
      .filter((r) => r.success !== false)
      .map((r) => ({ rate_id: String(r.id), carrier: String(r.provider_name ?? r.provider ?? "").slice(0, 60), service: String(r.provider_service_name ?? r.service_level_name ?? "").slice(0, 60), days: Number(r.days ?? r.estimated_days ?? 0) || null, amount: Math.round(Number(r.total) * 100) / 100, currency: String(r.currency_code ?? "MXN").toUpperCase() }))
      .filter((r) => r.rate_id && r.amount > 0 && r.currency === "MXN")       // nunca $0 ni otra moneda (se cobra en MXN tal cual)
      .sort((a, b) => a.amount - b.amount)
      .slice(0, MAX_RATES);
    if (!clean.length) return json(H, 200, { quote_id: null, cp, weight_g: weightG, rates: [], quotation_id: qid || null });

    // ---- guardar (service role) para que `checkout` valide el monto ----
    let quoteId: string | null = null;
    if (SB_SERVICE) {
      try {
        const rows = await sb("shipping_quotes", SB_SERVICE, {
          method: "POST", headers: { Prefer: "return=representation" },
          body: JSON.stringify({ cp, weight_g: weightG, quotation_id: qid || null, rates: clean, sandbox, expires_at: new Date(Date.now() + QUOTE_TTL_H * 3600_000).toISOString() }),
        });
        quoteId = rows?.[0]?.id ?? null;
      } catch (e) { console.error("shipping_quotes insert", e); }
    }
    return json(H, 200, { quote_id: quoteId, cp, weight_g: weightG, rates: clean, sandbox });
  } catch (e) {
    console.error(e);
    return json(H, 502, { error: "skydropx_error", detail: String(e).slice(0, 300) });
  }
});
