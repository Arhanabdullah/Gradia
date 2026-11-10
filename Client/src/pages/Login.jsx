import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { Button, Field, inputClass } from "../components/ui";

const Login = () => {
  const navigate = useNavigate();
  const { profile, session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session && profile) navigate("/app", { replace: true });
  }, [loading, session, profile, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    navigate("/app", { replace: true });
  };

  return (
    <div className="grid-background flex min-h-screen items-center justify-center bg-(--background) p-6 text-(--foreground)">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="glass-panel w-full max-w-sm rounded-2xl p-8"
      >
        <p className="text-sm font-semibold">Gradia</p>
        <h1 className="mt-6 font-editorial text-3xl tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-xs text-(--muted)">
          Accounts are created by your administrator.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="Email">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} h-11`}
              placeholder="you@college.edu"
            />
          </Field>
          <div>
            <label htmlFor="login-password" className="text-xs font-medium text-(--muted)">Password</label>
            <div className="relative mt-1.5">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} h-11 pr-11`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-(--muted-foreground) transition-colors hover:text-(--foreground)"
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {error ? <p className="text-xs text-(--danger)">{error}</p> : null}
          <Button type="submit" disabled={busy} className="w-full h-11">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-(--muted)">
          <Link to="/" className="hover:text-(--foreground)">
            Back to home
          </Link>
        </p>
      </motion.div>
    </div>
  );
};

export default Login;
