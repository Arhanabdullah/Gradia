import { motion } from "framer-motion";

const NavButton = ({ children, variant = "primary", onClick }) => {
    const isPrimary = variant === "primary";

    return (
        <motion.button
            onClick={onClick}
            className={
                isPrimary
                    ? "whitespace-nowrap rounded-lg bg-(--primary-deep) px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-(--primary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
                    : "whitespace-nowrap rounded-lg border border-(--primary)/60 bg-(--primary)/10 px-3 py-2 text-xs font-semibold text-[color-mix(in_srgb,var(--primary)_60%,var(--foreground))] transition-colors hover:border-(--primary) hover:bg-(--surface) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
            }
            whileHover={{
                scale: 1.05,
                ...(isPrimary
                    ? {
                        backgroundColor: "var(--primary)",
                    }
                    : {
                        borderColor: "var(--primary)",
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