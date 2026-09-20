import { motion } from "framer-motion";
import { Sun, Moon } from "lucide-react";

const ThemeToggle = ({ theme, setTheme }) => {
    const isDark = theme === "dark";

    const toggleTheme = () => {
        setTheme(isDark ? "light" : "dark");
    };

    return (
        <motion.button
            onClick={toggleTheme}
            aria-label={
                isDark
                    ? "Switch to light mode"
                    : "Switch to dark mode"
            }
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--border) text-(--muted)"
            whileHover={{
                scale: 1.05,
                borderColor: "var(--primary)",
                color: "var(--foreground)",
            }}
            whileTap={{
                scale: 0.92,
            }}
            transition={{
                duration: 0.2,
                ease: "easeOut",
            }}
        >
            <motion.div
                key={theme}
                initial={{
                    opacity: 0,
                    rotate: -45,
                    scale: 0.7,
                }}
                animate={{
                    opacity: 1,
                    rotate: 0,
                    scale: 1,
                }}
                transition={{
                    duration: 0.25,
                    ease: "easeOut",
                }}
            >
                {isDark ? (
                    <Sun size={15} strokeWidth={1.8} />
                ) : (
                    <Moon size={15} strokeWidth={1.8} />
                )}
            </motion.div>
        </motion.button>
    );
};

export default ThemeToggle;