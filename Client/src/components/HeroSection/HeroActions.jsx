import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
    revealVariant,
    buttonTap,
    microTransition,
} from "../../animations/variants";

const HeroActions = () => {
    const navigate = useNavigate();
    return (
        <div className="flex flex-col items-center">
            <motion.div
                className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
                variants={revealVariant}
                initial="hidden"
                animate="visible"
                custom={0.3}
            >
                <motion.a
                    onClick={(e) => {
                        e.preventDefault();
                        navigate("/login");
                    }}
                    href="#request-demo"
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-(--primary) px-5 py-2.5 text-sm font-medium text-(--background) shadow-[0_8px_30px_rgba(14,116,144,0.22)] transition-colors hover:bg-(--primary-hover)"
                    whileHover={{
                        scale: 1.04,
                        backgroundColor: "var(--primary)",
                        boxShadow: "0 10px 35px rgba(14,116,144,0.28)",
                    }}
                    whileTap={buttonTap}
                    transition={microTransition}
                >
                    Get started
                </motion.a>
                <motion.a
                    href="#how-it-works"
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-(--border) bg-(--surface)/20 px-5 py-2.5 text-sm font-medium text-(--foreground) backdrop-blur-md"
                    whileHover={{
                        scale: 1.04,
                        borderColor: "var(--primary)",
                    }}
                    whileTap={buttonTap}
                    transition={microTransition}
                >
                    See how it works
                </motion.a>
            </motion.div>
            <motion.p
                className="mt-5 text-xs text-(--muted)"
                variants={revealVariant}
                initial="hidden"
                animate="visible"
                custom={0.45}
            >
                Built for students, faculty, and academic administrators.
            </motion.p>
        </div>
    );
};

export default HeroActions;