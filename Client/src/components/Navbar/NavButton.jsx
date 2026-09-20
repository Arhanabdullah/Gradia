import { motion } from "framer-motion";

const NavButton = ({ children, variant = "primary", onClick }) => {
    const isPrimary = variant === "primary";

    return (
        <motion.button
            onClick={onClick}
            className={
                isPrimary
                    ? "rounded-lg bg-(--primary) px-3.5 py-2 text-xs font-semibold"
                    : "rounded-lg border glass-panel px-3 py-2 text-xs"
            }
            style={{
                color: isPrimary
                    ? "var(--background)"
                    : "var(--foreground)",
            }}
            whileHover={{
                scale: 1.05,
                ...(isPrimary
                    ? {
                        backgroundColor: "var(--primary-deep)",
                    }
                    : {
                        borderColor: "var(--primary)",
                        color: "var(--foreground)",
                    }),
            }}
            whileTap={{
                scale: 0.92,
            }}
            transition={{
                duration: 0.2,
                ease: "easeOut",
            }}
        >
            {children}
        </motion.button>
    );
};

export default NavButton;