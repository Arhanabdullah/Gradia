import { motion } from "framer-motion";
import { microTransition } from "../../animations/variants";

const DashboardHeader = () => {
    return (
        <div className="flex items-start justify-between">
            <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">
                    Dashboard
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-(--foreground)">
                    Overview
                </h2>
                <p className="mt-1 text-xs text-(--muted)">
                    Academic performance at a glance.
                </p>
            </div>
            <motion.div
                className="hidden rounded-lg border border-(--border) bg-(--surface-secondary) px-3 py-2 sm:block"
                whileHover={{
                    y: -1,
                    borderColor: "var(--primary)",
                }}
                transition={microTransition}
            >
                <p className="text-[9px] text-(--muted-foreground)">
                    Academic Year
                </p>
                <p className="mt-0.5 text-xs font-medium text-(--foreground)">
                    2025–26
                </p>
            </motion.div>
        </div>
    );
};

export default DashboardHeader;