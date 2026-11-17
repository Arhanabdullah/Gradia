// Gradia — public demo request submission with admin notification.
// Deploy: npx supabase functions deploy demo-request --project-ref <project-ref>
//
// Security model:
//   * Public endpoint (anon key) — inserts demo request into database
//   * Creates in-app notification for all active admins
//   * Optionally sends email via Supabase Auth admin invite or external provider

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

      // TODO: Send email notifications to admins
      // Option 1: Use Supabase Auth admin invite (sends email with magic link)
      // Option 2: Use external email service (Resend, SendGrid, etc.)
      // Option 3: Supabase pg_notify + pg_cron for email queue
      // For now, in-app notification is created above
      await sendAdminEmails(admin, admins, { name, email, institution, role, message });
    }

    return json({ success: true, id: request?.id }, 200);
  } catch (error) {
    console.error("demo-request: unexpected failure", error?.message);
    return json({ error: "Unexpected error" }, 500);
  }
});

async function sendAdminEmails(admin, admins, requestData) {
  // Placeholder for email sending
  // To enable email notifications, uncomment and configure one of:

  // Option A: Use Supabase's built-in email (requires custom SMTP in project settings)
  // for (const a of admins) {
  //   await admin.auth.admin.inviteUserByEmail(a.email, {
  //     data: { demo_request: requestData },
  //     redirectTo: `${Deno.env.get("SITE_URL") || "http://localhost:5173"}/app/demo-requests`,
  //   });
  // }

  // Option B: External email API (e.g., Resend)
  // const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  // if (RESEND_API_KEY) {
  //   for (const a of admins) {
  //     await fetch("https://api.resend.com/emails", {
  //       method: "POST",
  //       headers: {
  //         "Authorization": `Bearer ${RESEND_API_KEY}`,
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify({
  //         from: "Gradia <demo@gradia.academy>",
  //         to: a.email,
  //         subject: `New demo request from ${requestData.institution}`,
  //         html: `<p>${requestData.name} (${requestData.role}) from ${requestData.institution} requested a demo.</p>
  //                <p>Email: ${requestData.email}</p>
  //                <p>Message: ${requestData.message || "—"}</p>
  //                <p><a href="${Deno.env.get("SITE_URL")}/app/demo-requests">View in dashboard</a></p>`,
  //       }),
  //     });
  //   }
  // }

  // Option C: Log for now (check Supabase logs)
  console.log("Demo request received:", requestData);
  console.log("Admins to notify:", admins.map(a => a.email).join(", "));
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}