import { useState } from "react";
import { motion } from "framer-motion";
import { LogOut, Moon, Sun } from "lucide-react";
import { microTransition } from "../../animations/variants";
import { useAuth } from "../../context/AuthContext";
import { setTheme, getTheme } from "../../lib/theme";

const DashboardHeader = ({ title, subtitle }) => {
  const { profile, signOut } = useAuth();
  const [theme, setThemeState] = useState(getTheme());

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  };

  return (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">
          Dashboard
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-(--foreground)">{title ?? "Overview"}</h2>
        {subtitle ? <p className="mt-1 text-xs text-(--muted)">{subtitle}</p> : null}
      </div>
      {profile ? (
        <div className="flex items-center gap-2">
          <motion.button
            onClick={toggleTheme}
            className="hidden rounded-lg border border-(--border) bg-(--surface-secondary) p-2.5 text-(--muted) sm:block"
            whileHover={{ y: -1, borderColor: "var(--primary)", color: "var(--foreground)" }}
            transition={microTransition}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </motion.button>
          <div className="hidden rounded-lg border border-(--border) bg-(--surface-secondary) px-3 py-2 sm:block">
            <p className="text-[9px] text-(--muted-foreground)">Signed in</p>
            <p className="mt-0.5 max-w-40 truncate text-xs font-medium text-(--foreground)" title={profile.email}>
              {profile.name || profile.email}
            </p>
          </div>
          <motion.button
            onClick={signOut}
            className="rounded-lg border border-(--border) bg-(--surface-secondary) p-2.5 text-(--muted)"
            whileHover={{ y: -1, borderColor: "var(--primary)", color: "var(--foreground)" }}
            transition={microTransition}
            title="Sign out"
          >
            <LogOut size={16} />
          </motion.button>
        </div>
      ) : (
        // decorative chip for the landing-page ProductPreview mockup
        <motion.div
          className="hidden rounded-lg border border-(--border) bg-(--surface-secondary) px-3 py-2 sm:block"
          whileHover={{ y: -1, borderColor: "var(--primary)" }}
          transition={microTransition}
        >
          <p className="text-[9px] text-(--muted-foreground)">Academic Year</p>
          <p className="mt-0.5 text-xs font-medium text-(--foreground)">2025–26</p>
        </motion.div>
      )}
    </div>
  );
};

export default DashboardHeader;
