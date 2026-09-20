import { motion } from "framer-motion";

const HeroBadge = () => {
    return (
        <motion.div
            className="inline-flex items-center gap-2 rounded-full border border-(--border) bg-(--surface)/70 px-3.5 py-1.5 backdrop-blur-sm"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                duration: 0.5,
                ease: "easeOut",
            }}
        >
            <span className="h-1.5 w-1.5 rounded-full bg-(--tertiary)" />

            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted)">
                Academic results platform
            </span>
        </motion.div>
    );
};

export default HeroBadge;