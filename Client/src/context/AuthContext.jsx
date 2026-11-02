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
      supabase
        .from("profiles")
        // two FKs exist between profiles and classes (class_id / hod_id),
        // so the embed MUST name the relationship or PostgREST errors PGRST201
        .select("*, classes!profiles_class_fkey ( name )")
        .eq("id", session.user.id)
        .single()
        .then(({ data, error }) => {
          if (active) {
            setProfile(error ? null : (data ?? null));
            setLoading(false);
          }
        });
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
