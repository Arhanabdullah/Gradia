// Gradia — public demo request submission with admin notification.
// Deploy: npx supabase functions deploy demo-request --project-ref <project-ref>
//
// Security model:
//   * Public endpoint (anon key) — inserts demo request into database
//   * Creates in-app notification for all active admins
//   * Sends admin email through Resend when RESEND_API_KEY is configured

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = new Set(["principal", "hod", "teacher", "admin", "other"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

    // Use service role for database operations (bypass RLS for admin notifications)
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const institution = String(body.institution ?? "").trim();
    const role = String(body.role ?? "").toLowerCase();
    const message = String(body.message ?? "").trim();

    // Validation
    if (!name) return json({ error: "Name is required" }, 400);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "A valid email address is required" }, 400);
    if (!institution) return json({ error: "Institution is required" }, 400);
    if (!role || !allowedRoles.has(role)) return json({ error: "Please select a valid role" }, 400);

    // Insert demo request
    const { data: request, error: insertError } = await admin
      .from("demo_requests")
      .insert({
        name,
        email,
        institution,
        role,
        message,
        status: "new",
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      console.error("demo-request: insert failed", insertError.message);
      return json({ error: "Could not submit request" }, 500);
    }

    // Get all active admin users to notify
    const { data: admins, error: adminError } = await admin
      .from("profiles")
      .select("id, email")
      .eq("role", "admin")
      .eq("is_active", true);

    if (adminError) {
      console.error("demo-request: admin lookup failed", adminError.message);
      // Don't fail the request if admin lookup fails
    } else if (admins && admins.length > 0) {
      // Create in-app notifications for all admins
      const notifications = admins.map((a) => ({
        user_id: a.id,
        title: "New demo request",
        body: `${name} from ${institution} (${role}) requested a demo. Email: ${email}`,
      }));

      const { error: notifyError } = await admin
        .from("notifications")
        .insert(notifications);

      if (notifyError) {
        console.error("demo-request: notification insert failed", notifyError.message);
      }

      // Email is best-effort; the in-app admin notification already succeeded.
      await sendAdminEmails(admins, { name, email, institution, role, message });
    }

    return json({ success: true, id: request?.id }, 200);
  } catch (error) {
    console.error("demo-request: unexpected failure", error?.message);
    return json({ error: "Unexpected error" }, 500);
  }
});

async function sendAdminEmails(admins, requestData) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.log("demo-request: RESEND_API_KEY is not set; email notifications skipped");
    return;
  }

  const recipients = admins.map((a) => a.email).filter(Boolean);
  if (!recipients.length) return;

  const siteUrl = Deno.env.get("SITE_URL");
  const from = Deno.env.get("RESEND_FROM") || "Gradia <demo@gradia.academy>";
  const name = escapeHtml(requestData.name);
  const email = escapeHtml(requestData.email);
  const institution = escapeHtml(requestData.institution);
  const role = escapeHtml(requestData.role);
  const message = escapeHtml(requestData.message);
  const dashboardLink = siteUrl
    ? `<p><a href="${escapeHtml(siteUrl)}/app/demo-requests">View in dashboard</a></p>`
    : "";

  const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#172033">
    <p><strong>${name}</strong> (${role}) from <strong>${institution}</strong> requested a demo.</p>
    <p>Email: <a href="mailto:${email}">${email}</a></p>
    ${message ? `<p>Message: ${message}</p>` : ""}
    ${dashboardLink}
  </div>`;

  const deliveries = await Promise.allSettled(
    recipients.map((to) =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          subject: `New demo request from ${requestData.institution}`,
          html,
        }),
      })
    ),
  );

  deliveries.forEach((delivery, index) => {
    if (delivery.status === "rejected") {
      console.error(`demo-request: email to ${recipients[index]} failed`, delivery.reason?.message);
      return;
    }
    if (!delivery.value.ok) {
      console.error(`demo-request: email to ${recipients[index]} returned ${delivery.value.status}`);
    }
  });
}

function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}