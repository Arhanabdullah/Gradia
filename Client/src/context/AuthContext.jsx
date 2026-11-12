import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Flips true once the initial getSession() check has completed. The
  // [session] effect runs on mount before that, sees the initial null
  // session, and must not treat it as "signed out" — otherwise every
  // cold load of a protected route redirects through /login.
  const checkedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      checkedRef.current = true;
      setSession(session);
      // A null session after the initial check is definitively signed out.
      if (!session) setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // supabase-js can emit a null session mid-init even while a stored
      // session is being revalidated; trusting it bounces signed-in users
      // through /login. Real sign-out clears storage before the event, so
      // the token check disambiguates the two cases.
      if (!session && localStorage.getItem(supabase.auth.storageKey)) return;
      setSession(session);
    });
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
    } else if (checkedRef.current) {
      // A later null session (sign-out), not the initial mount pass.
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
