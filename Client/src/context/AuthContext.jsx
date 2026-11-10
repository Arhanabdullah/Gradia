import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    if (session?.user) {
      const loadProfile = async () => {
        // two FKs exist between profiles and classes (class_id / hod_id),
        // so the embed MUST name the relationship or PostgREST errors PGRST201
        const baseSelect = "*, classes!profiles_class_fkey ( name ), departments ( name ), courses ( name )";
        const fetchProfile = (columns) =>
          supabase.from("profiles").select(columns).eq("id", session.user.id).single();
        let result = await fetchProfile(`${baseSelect}, degrees ( name )`);
        // The degree migration may not be applied on this deployment yet. In
        // that case the profile must still load without the degree embed.
        if (result.error && /degrees|relationship|schema cache/i.test(result.error.message ?? "")) {
          result = await fetchProfile(baseSelect);
        }
        if (active) {
          setProfile(result.error ? null : (result.data ?? null));
          setLoading(false);
        }
      };
      loadProfile();
    } else {
      setProfile(null);
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, [session]);

  const value = {
    session,
    profile,
    loading,
    signOut: () => supabase.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
