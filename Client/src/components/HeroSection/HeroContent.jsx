import { motion } from "framer-motion";

const HeroContent = () => {
    return (
        <div className="flex flex-col items-center text-center">
            <motion.h1
                className="max-w-4xl font-editorial text-5xl leading-[1.02] tracking-[-0.035em] text-(--foreground) sm:text-6xl md:text-7xl lg:text-[5.25rem]"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                    duration: 0.65,
                    delay: 0.1,
                    ease: [0.22, 1, 0.36, 1],
                }}
            >
                Academic results,
                <br />
                <span className="italic text-(--primary)">
                    without the complexity.
                </span>
            </motion.h1>

            <motion.p
                className="mt-7 max-w-2xl text-sm leading-7 text-(--muted) sm:text-base"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                    duration: 0.6,
                    delay: 0.2,
                    ease: [0.22, 1, 0.36, 1],
                }}
            >
                Gradia brings students, teachers, and academic administrators
                together in one streamlined platform for managing, reviewing,
                and publishing academic results.
            </motion.p>
        </div>
    );
};

export default HeroContent;