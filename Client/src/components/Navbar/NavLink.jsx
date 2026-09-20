import { useState } from "react";
import { motion } from "framer-motion";

const NavLink = ({ label, href }) => {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <a
            href={href}
            className="relative py-1 text-xs text-(--muted)"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <motion.span
                animate={{
                    color: isHovered
                        ? "var(--foreground)"
                        : "var(--muted)",
                }}
                transition={{ duration: 0.2 }}
            >
                {label}
            </motion.span>

            <motion.span
                className="absolute left-0 -bottom-1 h-px"
                style={{
                    backgroundColor: "var(--primary)",
                }}
                animate={{
                    width: isHovered ? "100%" : "0%",
                }}
                transition={{
                    duration: 0.25,
                    ease: "easeOut",
                }}
            />
        </a>
    );
};

export default NavLink;