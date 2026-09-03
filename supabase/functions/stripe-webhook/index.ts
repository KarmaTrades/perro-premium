// Chewawa MX — Stripe webhook → Telegram + tabla `orders` en Supabase
// (Evolución del webhook "Perro Premium" del 26-ago-2026: mismos eventos y mismo aviso a Telegram;
//  ahora además guarda cada checkout.session.completed en public.orders y marca el checkout_intent como pagado.)
import Stripe from "npm:stripe@17";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-02-24.acacia" });
const WHSEC = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? firstKey(Deno.env.get("SUPABASE_SECRET_KEYS"));

function firstKey(json: string | undefined): string {
  try { const o = JSON.parse(json ?? ""); const v = Object.values(o)[0]; return typeof v === "string" ? v : ""; } catch { return ""; }
}
const money = (a: number | null | undefined, c: string | null | undefined) => `${((a ?? 0) / 100).toFixed(2)} ${(c ?? "").toUpperCase()}`;

async function tg(text: string) {
  if (!BOT || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML" }),
  });
}

async function sb(path: string, init: RequestInit) {
  if (!SB_SERVICE) throw new Error("no service key");
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`supabase ${path} → ${r.status} ${await r.text()}`);
}

function parseItems(s: unknown) { try { return typeof s === "string" ? JSON.parse(s) : null; } catch { return null; } }

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event;
  try {
    event = WHSEC
      ? await stripe.webhooks.constructEventAsync(body, sig, WHSEC)
      : JSON.parse(body); // test only — always set WHSEC in prod
  } catch (e) {
    return new Response(`Bad signature: ${e}`, { status: 400 });
  }

  const o = event.data.object;

  // ---- 1) Guardar el pedido en Supabase (no depende de Telegram) ----
  if (event.type === "checkout.session.completed") {
    try {
      const intentId = typeof o.client_reference_id === "string" && /^[0-9a-f-]{36}$/i.test(o.client_reference_id) ? o.client_reference_id : null;
      await sb("orders?on_conflict=stripe_session_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          stripe_session_id: o.id,
          mode: o.mode,
          livemode: o.livemode === true,
          amount_total_mxn: (o.amount_total ?? 0) / 100,
          currency: o.currency,
          customer_name: o.customer_details?.name ?? null,
          customer_email: o.customer_details?.email ?? null,
          customer_phone: o.customer_details?.phone ?? null,
          shipping: o.shipping_details ?? o.collected_information?.shipping_details ?? null,
          items: parseItems(o.metadata?.items),
          intent_id: intentId,
          status: o.payment_status === "paid" ? "pagado" : (o.payment_status ?? "pagado"),
          raw: o,
        }),
      });
      if (intentId) {
        await sb(`checkout_intents?id=eq.${intentId}`, { method: "PATCH", body: JSON.stringify({ status: "paid", stripe_session_id: o.id }) });
      }
    } catch (e) {
      console.error("orders insert failed", e);
    }
  }

  // ---- 2) Aviso a Telegram (igual que antes, con texto Chewawa) ----
  try {
    if (event.type === "checkout.session.completed") {
      const modo = o.mode === "subscription" ? "suscripción mensual" : "compra única";
      const ship = o.shipping_details?.address ?? o.collected_information?.shipping_details?.address;
      await tg(`🐶 <b>¡Nuevo pedido Chewawa!</b> (${modo}${o.livemode ? "" : " · PRUEBA"})\nCliente: ${o.customer_details?.name ?? "?"} (${o.customer_details?.email ?? "?"})\nTel: ${o.customer_details?.phone ?? "?"}\nTotal: ${money(o.amount_total, o.currency)}\nEnvío: ${ship ? `${ship.city ?? ""}, ${ship.state ?? ""} ${ship.postal_code ?? ""}` : "?"}\nArtículos: ${o.metadata?.items ?? "?"}\nSesión: ${o.id}`);
    } else if (event.type === "invoice.paid") {
      await tg(`💰 <b>Pago de suscripción recibido</b>\nCliente: ${o.customer_email ?? "?"}\nMonto: ${money(o.amount_paid, o.currency)}\nFactura: ${o.number ?? o.id}`);
    } else if (event.type === "invoice.payment_failed") {
      await tg(`⚠️ <b>Pago fallido</b> — ${o.customer_email ?? "?"} · ${money(o.amount_due, o.currency)} (Stripe reintentará)`);
    }
  } catch (e) {
    console.error("telegram send failed", e);
  }

  return new Response("ok", { status: 200 });
});
