import { motion } from "framer-motion";
import { microTransition } from "../../animations/variants";

const navItems = [
    { label: "Overview", active: true },
    { label: "Students" },
    { label: "Results" },
    { label: "Subjects" },
    { label: "Reports" },
];

const DashboardSidebar = () => {
    return (
        <aside className="border-r border-(--border) bg-black/2.5 p-4 dark:bg-black/10">
            <div className="mb-8">
                <p className="text-sm font-semibold text-(--foreground)">
                    Gradia
                </p>
                <p className="mt-0.5 text-[9px] text-(--muted-foreground)">
                    Academic Suite
                </p>
            </div>
            <nav className="space-y-1">
                {navItems.map((item) => (
                    <motion.div
                        key={item.label}
                        className={
                            item.active
                                ? "rounded-lg bg-(--sidebar-active) px-4 py-2.5 text-sm font-medium text-(--foreground)"
                                : "rounded-lg px-4 py-2.5 text-sm font-medium text-(--muted)"
                        }
                        whileHover={
                            item.active
                                ? undefined
                                : {
                                    x: 2,
                                    color: "var(--foreground)",
                                    backgroundColor: "var(--sidebar-hover)",
                                }
                        }
                        transition={microTransition}
                    >
                        {item.label}
                    </motion.div>
                ))}
            </nav>
            <div className="mt-10 border-t border-(--border) pt-4">
                <p className="px-3 text-[9px] uppercase tracking-[0.12em] text-(--muted-foreground)">
                    Administration
                </p>
                <motion.p
                    className="mt-2 rounded-lg px-3 py-2 text-xs text-(--muted)"
                    whileHover={{
                        x: 2,
                        color: "var(--foreground)",
                        backgroundColor: "var(--surface-secondary)",
                    }}
                    transition={microTransition}
                >
                    Settings
                </motion.p>
            </div>
        </aside>
    );
};

export default DashboardSidebar;