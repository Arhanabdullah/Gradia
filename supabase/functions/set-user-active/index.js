// Gradia — server-side account deactivation / reactivation.
// Deploy: npx supabase functions deploy set-user-active --project-ref <project-ref>
//
// Why this exists:
//   Setting profiles.is_active = false is already enforced at the data
//   layer (every RLS policy and guarded RPC checks is_active_user()), but
//   the account can still obtain a JWT. This function additionally bans
//   the auth user so the login endpoint refuses new tokens.
//
// Safety rules:
//   * Caller must be an active admin.
//   * An admin cannot deactivate their own account.
//   * The last active admin cannot be deactivated.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const banDuration = "876000h"; // ~100 years: treated as "banned until reactivated"

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
      console.error("set-user-active: caller profile lookup failed", callerProfileError.message);
      return json({ error: "Could not verify your account" }, 500);
    }
    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.is_active) {
      return json({ error: "Only active admins can change account status" }, 403);
    }

    const body = await req.json();
    const userId = String(body.user_id ?? "").trim();
    const active = body.active;

    if (!uuidPattern.test(userId)) return json({ error: "A valid user id is required" }, 400);
    if (typeof active !== "boolean") return json({ error: "active must be true or false" }, 400);
    if (userId === caller.user.id) {
      return json({ error: "You cannot change the status of your own account" }, 400);
    }

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) {
      console.error("set-user-active: target lookup failed", targetError.message);
      return json({ error: "Could not load the account" }, 500);
    }
    if (!target) return json({ error: "Account not found" }, 404);

    if (!active && target.role === "admin") {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true)
        .neq("id", userId);
      if (countError) {
        console.error("set-user-active: admin count failed", countError.message);
        return json({ error: "Could not check administrator coverage" }, 500);
      }
      if (!count) return json({ error: "The last active administrator cannot be deactivated" }, 400);
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update({ is_active: active })
      .eq("id", userId);
    if (updateError) {
      console.error("set-user-active: profile update failed", updateError.message);
      return json({ error: "Could not update the account" }, 500);
    }

    // Ban/unban is defence-in-depth; data-layer enforcement already applies.
    let authBanned = null;
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: active ? "none" : banDuration,
    });
    if (authError) {
      console.error("set-user-active: auth ban update failed", authError.message);
      authBanned = !active ? false : null;
    } else {
      authBanned = !active;
    }

    return json({ id: userId, is_active: active, auth_banned: authBanned }, 200);
  } catch (error) {
    console.error("set-user-active: unexpected failure", error?.message);
    return json({ error: "Unexpected error" }, 500);
  }
});

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
