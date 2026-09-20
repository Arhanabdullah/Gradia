import { motion } from "framer-motion";

const HeroActions = () => {
    return (
        <div className="flex flex-col items-center">
            <motion.div
                className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                    duration: 0.6,
                    delay: 0.3,
                    ease: [0.22, 1, 0.36, 1],
                }}
            >
                <motion.button
                    className="rounded-lg bg-(--primary) px-5 py-3 text-sm font-semibold text-(--background)"
                    whileHover={{
                        scale: 1.04,
                        backgroundColor: "var(--primary-deep)",
                    }}
                    whileTap={{
                        scale: 0.96,
                    }}
                    transition={{
                        duration: 0.2,
                        ease: "easeOut",
                    }}
                >
                    Get started
                </motion.button>

                <motion.a
                    href="#how-it-works"
                    className="rounded-lg border border-(--border) bg-(--surface)/70 px-5 py-3 text-sm font-medium text-(--foreground) backdrop-blur-sm"
                    whileHover={{
                        scale: 1.04,
                        borderColor: "var(--primary)",
                    }}
                    whileTap={{
                        scale: 0.96,
                    }}
                    transition={{
                        duration: 0.2,
                        ease: "easeOut",
                    }}
                >
                    See how it works
                </motion.a>
            </motion.div>

            <motion.p
                className="mt-5 text-[10px] tracking-wide text-(--muted-foreground)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                    duration: 0.5,
                    delay: 0.45,
                    ease: "easeOut",
                }}
            >
                Built for students, faculty, and academic administrators.
            </motion.p>
        </div>
    );
};

export default HeroActions;