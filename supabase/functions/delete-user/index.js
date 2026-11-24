// Gradia — secure admin-only account deletion.
// Deploy: npx supabase functions deploy delete-user --project-ref <project-ref>
//
// Deleting an Auth user cascades to public.profiles and the academic records
// that reference it. This function keeps that dangerous operation server-side,
// requires an explicit email confirmation from the UI, and protects the
// caller's own account and the last active administrator.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: caller, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("role, is_active")
      .eq("id", caller.user.id)
      .maybeSingle();
    if (callerProfileError) {
      console.error("delete-user: caller profile lookup failed", callerProfileError.message);
      return json({ error: "Could not verify your account" }, 500);
    }
    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.is_active) {
      return json({ error: "Only active admins can delete accounts" }, 403);
    }

    const body = await req.json();
    const userId = String(body.user_id ?? "").trim();
    const confirmation = String(body.confirm_email ?? "").trim().toLowerCase();
    if (!uuidPattern.test(userId)) return json({ error: "A valid user id is required" }, 400);

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, email, role, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) {
      console.error("delete-user: target lookup failed", targetError.message);
      return json({ error: "Could not load the account" }, 500);
    }
    if (!target) return json({ error: "Account not found" }, 404);
    if (confirmation !== String(target.email ?? "").toLowerCase()) {
      return json({ error: "The confirmation email does not match this account" }, 400);
    }
    if (userId === caller.user.id) {
      return json({ error: "You cannot delete your own account" }, 400);
    }

    if (target.role === "admin" && target.is_active) {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true)
        .neq("id", userId);
      if (countError) {
        console.error("delete-user: admin count failed", countError.message);
        return json({ error: "Could not check administrator coverage" }, 500);
      }
      if (!count) return json({ error: "The last active administrator cannot be deleted" }, 400);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError && !/not found|does not exist/i.test(deleteError.message ?? "")) {
      console.error("delete-user: auth deletion failed", deleteError.message);
      return json({ error: "Could not delete the account" }, 500);
    }

    // The profiles FK normally cascades from auth.users. This explicit delete
    // covers older databases where that cascade was not present.
    const { error: profileError } = await admin.from("profiles").delete().eq("id", userId);
    if (profileError) {
      console.error("delete-user: profile cleanup failed", profileError.message);
      return json({ error: "Account removed, but the profile could not be cleaned up" }, 500);
    }

    return json({ id: userId }, 200);
  } catch (error) {
    console.error("delete-user: unexpected failure", error?.message);
    return json({ error: "Unexpected error" }, 500);
  }
});

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
