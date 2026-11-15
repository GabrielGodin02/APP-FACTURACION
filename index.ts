import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const WOMPI_API = "https://api.wompi.co/v1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  try {
    const { amount_in_cents, description, name, wompi_key } = await req.json();

    if (!amount_in_cents || !description) {
      return new Response(
        JSON.stringify({ error: "amount_in_cents y description son requeridos" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // Use per-user key from request body; fall back to env var for testing
    const wompiKey = wompi_key || Deno.env.get("WOMPI_PRIVATE_KEY");
    if (!wompiKey) {
      return new Response(
        JSON.stringify({ error: "Llave de Wompi no configurada. Configúrala en tu perfil." }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // Crear link de pago en Wompi
    const resp = await fetch(`${WOMPI_API}/payment_links`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${wompiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: name || description,
        description,
        single_use: true,
        collect_shipping: false,
        currency: "COP",
        amount_in_cents,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: resp.status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const linkId = data?.data?.id;
    const url = `https://checkout.wompi.co/l/${linkId}`;

    return new Response(JSON.stringify({ url, id: linkId }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
});