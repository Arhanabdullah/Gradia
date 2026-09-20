import { motion } from "framer-motion";
import {
    buttonHover,
    microTransition,
} from "../../animations/variants";
const stats = [
    {
        label: "Total Students",
        value: "1,248",
        change: "+12.5%",
    },
    {
        label: "Results Published",
        value: "984",
        change: "+8.2%",
    },
    {
        label: "Average Score",
        value: "78.4%",
        change: "+4.6%",
    },
];

const DashboardStats = () => {
    return (
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {stats.map((stat) => (
                <motion.div
                    key={stat.label}
                    className="glass-inner rounded-xl p-5"
                    whileHover={{
                        ...buttonHover,
                        borderColor: "var(--primary)",
                    }}
                    transition={microTransition}
                >
                    <p className="text-[10px] font-medium text-(--tertiary)/80">
                        {stat.label}
                    </p>
                    <div className="mt-2 flex items-end justify-between gap-2">
                        <p className="text-xl font-semibold tracking-tight text-(--foreground)">
                            {stat.value}
                        </p>
                        <span className="text-[9px] font-medium text-(--tertiary)/80">
                            {stat.change}
                        </span>
                    </div>
                </motion.div>
            ))}
        </div>
    );
};

export default DashboardStats;