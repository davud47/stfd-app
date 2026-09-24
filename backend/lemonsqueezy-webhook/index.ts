// Supabase Edge Function — empfängt den Webhook von Lemon Squeezy nach
// erfolgreichem Kauf und schaltet Modul 2 für das passende Konto frei.
// Deployment: supabase functions deploy lemonsqueezy-webhook
//
// Nötige Umgebungsvariablen (Supabase Dashboard -> Edge Functions -> Secrets):
//   LEMON_SQUEEZY_WEBHOOK_SECRET  — aus deinen Lemon-Squeezy-Webhook-Einstellungen
//   SUPABASE_URL                 — automatisch vorhanden
//   SUPABASE_SERVICE_ROLE_KEY    — Dashboard -> Project Settings -> API

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(computed, signatureHeader);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-signature");
  const webhookSecret = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET") ?? "";

  const valid = await verifySignature(rawBody, signature, webhookSecret);
  if (!valid) {
    return new Response("Ungültige Signatur", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const eventName = payload?.meta?.event_name;

  // Nur auf erfolgreiche Bestellungen reagieren — Abo-Events bewusst ignoriert,
  // da wir Einmalzahlung nutzen, kein Abo.
  if (eventName !== "order_created") {
    return new Response("Ignoriert (kein order_created-Event)", { status: 200 });
  }

  const email = payload?.data?.attributes?.user_email;
  const status = payload?.data?.attributes?.status; // z.B. "paid"

  if (!email || status !== "paid") {
    return new Response("Keine bezahlte Bestellung", { status: 200 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Konto anhand der E-Mail-Adresse aus dem Kauf finden
  const { data: profile, error: findError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (findError || !profile) {
    // Kein passendes Konto gefunden — z.B. weil noch keins existiert.
    // Wird hier nur geloggt; ein vollständiges System würde die Bestellung
    // separat vormerken, bis sich die Person mit derselben E-Mail registriert.
    console.error("Kein Konto zu dieser E-Mail gefunden:", email);
    return new Response("Kein passendes Konto gefunden", { status: 200 });
  }

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ module2_unlocked: true, unlocked_at: new Date().toISOString() })
    .eq("id", profile.id);

  if (updateError) {
    console.error("Freischalten fehlgeschlagen:", updateError);
    return new Response("Fehler beim Freischalten", { status: 500 });
  }

  return new Response("Modul 2 freigeschaltet", { status: 200 });
});
