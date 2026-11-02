// Gradia — create-user Edge Function (plain JS)
// Lets an authenticated admin create accounts (auth user + auto profile via
// the on_auth_user_created trigger). Deploy with:
//   npx supabase functions deploy create-user --project-ref <ref>
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Caller verification: use their session token against the anon pool.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_ANON_KEY"),
    );
    const token = (req.headers.get("Authorization") ?? "").replace(
      "Bearer ",
      "",
    );
    const { data: caller, error: callerError } = await supabase.auth.getUser(
      token,
    );
    if (callerError || !caller?.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Verify the caller is an admin using the service-role pool.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.user.id)
      .single();
    if (profile?.role !== "admin") {
      return json({ error: "Only admins can create accounts" }, 403);
    }

    const {
      email,
      password,
      name,
      username,
      role = "student",
      department = "",
      class_id = "",
    } = await req.json();

    if (!email || !password) {
      return json({ error: "Email and password are required" }, 400);
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, username, role, department, class_id },
    });
    if (error) return json({ error: error.message }, 400);

    return json({ id: data.user.id }, 200);
  } catch (err) {
    return json({ error: err.message ?? "Unexpected error" }, 500);
  }
});

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
