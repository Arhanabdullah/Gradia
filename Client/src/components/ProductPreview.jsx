import Reveal from "./Reveal";
import { motion } from "framer-motion";
import DashboardHeader from "./dashboard/DashboardHeader";
import DashboardSidebar from "./dashboard/DashboardSidebar";
import DashboardStats from "./dashboard/DashboardStats";
import RecentResults from "./dashboard/RecentResults";
import PerformanceChart from "./charts/PerformanceChart";
import SubjectPerformanceChart from "./charts/SubjectPerformanceChart";

const ProductPreview = () => {
    return (
        <section
            id="product"
            className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-6 md:pb-24"
        >
            <Reveal>
                <div className="glass-floating overflow-hidden rounded-2xl">
                    {/* Browser Bar */}
                    <div className="flex items-center gap-2 border-b border-(--border) bg-black/5 px-4 py-3 dark:bg-white/2">
                        <div className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
                            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/60" />
                            <span className="h-2.5 w-2.5 rounded-full bg-green-400/60" />
                        </div>
                        <div className="mx-auto hidden rounded-md border border-(--border-subtle) bg-(--surface-secondary) px-4 py-1 sm:block">
                            <p className="text-[9px] text-(--muted-foreground)">
                                app.gradia.academy/dashboard
                            </p>
                        </div>
                        <div className="w-11.5" />
                    </div>
                    {/* Dashboard */}
                    <div className="grid md:grid-cols-[180px_1fr]">
                        <DashboardSidebar />
                        <div className="min-w-0 p-4 sm:p-5 md:p-7">
                            <DashboardHeader />
                            <DashboardStats />
                            {/* Charts */}
                            <div className="mt-6 grid gap-4 lg:grid-cols-2">
                                <motion.div
                                    className="glass-inner rounded-xl p-4"
                                    whileHover={{
                                        y: -3,
                                        borderColor: "var(--primary)",
                                    }}
                                    transition={{
                                        duration: 0.25,
                                        ease: "easeOut",
                                    }}
                                >
                                    <div className="mb-4">
                                        <p className="text-xs font-medium text-(--foreground)">
                                            Performance Overview
                                        </p>
                                        <p className="mt-0.5 text-[9px] text-(--muted-foreground)">
                                            Average score over the academic year
                                        </p>
                                    </div>
                                    <PerformanceChart />
                                </motion.div>
                                <motion.div
                                    className="glass-inner rounded-xl p-4"
                                    whileHover={{
                                        y: -3,
                                        borderColor: "var(--primary)",
                                    }}
                                    transition={{
                                        duration: 0.25,
                                        ease: "easeOut",
                                    }}
                                >
                                    <div className="my-4">
                                        <p className="text-xs font-medium text-(--foreground)">
                                            Subject Performance
                                        </p>
                                        <p className="mt-0.5 text-[9px] text-(--muted-foreground)">
                                            Average score by subject
                                        </p>
                                    </div>
                                    <SubjectPerformanceChart />
                                </motion.div>
                            </div>
                            <RecentResults />
                        </div>
                    </div>
                </div>
            </Reveal>
        </section>
    );
};

export default ProductPreview;