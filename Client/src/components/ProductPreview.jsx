import PerformanceChart from "./charts/PerformanceChart";
import SubjectPerformanceChart from "./charts/SubjectPerformanceChart";

const ProductPreview = () => {
    return (
        <section
            id="product"
            className="mx-auto w-full max-w-7xl px-6 pb-24"
        >
            <div className="overflow-hidden rounded-2xl border border-(--border) bg-(--surface) shadow-[0_30px_100px_rgba(0,0,0,0.12)]">

                {/* Window header */}
                <div className="flex h-11 items-center border-b border-(--border) px-4">
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
                <div className="grid md:grid-cols-[180px_1fr]">
                    {/* Sidebar */}
                    <aside className="hidden border-r border-(--border) p-4 md:block">
                        <div className="mb-8">
                            <p className="text-sm font-semibold text-(--foreground)">
                                Gradia
                            </p>
                            <p className="mt-0.5 text-[9px] text-(--muted-foreground)">
                                Academic Suite
                            </p>
                        </div>
                        <nav className="space-y-1">
                            <div className="rounded-lg bg-(--surface-secondary) px-3 py-2 text-xs font-medium text-(--foreground)">
                                Overview
                            </div>
                            <div className="px-3 py-2 text-xs text-(--muted)">
                                Students
                            </div>
                            <div className="px-3 py-2 text-xs text-(--muted)">
                                Results
                            </div>
                            <div className="px-3 py-2 text-xs text-(--muted)">
                                Subjects
                            </div>
                            <div className="px-3 py-2 text-xs text-(--muted)">
                                Reports
                            </div>
                        </nav>
                        <div className="mt-10 border-t border-(--border) pt-4">
                            <p className="px-3 text-[9px] uppercase tracking-[0.12em] text-(--muted-foreground)">
                                Administration
                            </p>
                            <p className="mt-2 px-3 py-2 text-xs text-(--muted)">
                                Settings
                            </p>
                        </div>
                    </aside>
                    {/* Main dashboard */}
                    <div className="min-w-0 p-5 md:p-7">
                        {/* Header */}
                        <div className="flex items-end justify-between">
                            <div>
                                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-(--muted-foreground)">
                                    Overview
                                </p>
                                <h2 className="mt-1 font-editorial text-2xl text-(--foreground) md:text-3xl">
                                    Academic performance
                                </h2>
                            </div>
                            <div className="hidden text-right sm:block">
                                <p className="text-[10px] text-(--muted-foreground)">
                                    Academic year
                                </p>
                                <p className="mt-1 text-xs font-medium text-(--foreground)">
                                    2025 — 2026
                                </p>
                            </div>
                        </div>
                        {/* Stats */}
                        <div className="mt-6 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-xl border border-(--border) p-4">
                                <p className="text-[10px] text-(--muted)">
                                    Students
                                </p>
                                <p className="mt-2 text-xl font-semibold tabular text-(--foreground)">
                                    1,248
                                </p>
                            </div>
                            <div className="rounded-xl border border-(--border) p-4">
                                <p className="text-[10px] text-(--muted)">
                                    Published Results
                                </p>
                                <p className="mt-2 text-xl font-semibold tabular text-(--foreground)">
                                    984
                                </p>
                            </div>
                            <div className="rounded-xl border border-(--border) p-4">
                                <p className="text-[10px] text-(--muted)">
                                    Average Score
                                </p>
                                <p className="mt-2 text-xl font-semibold tabular text-(--foreground)">
                                    78.4%
                                </p>
                            </div>
                        </div>
                        {/* Charts */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                            <div className="min-w-0 rounded-xl border border-(--border) p-4 md:p-5">
                                <div className="mb-3">
                                    <p className="text-xs font-medium text-(--foreground)">
                                        Student performance
                                    </p>
                                    <p className="mt-1 text-[10px] text-(--muted-foreground)">
                                        Average score over time
                                    </p>
                                </div>
                                <PerformanceChart />
                            </div>
                            <div className="min-w-0 rounded-xl border border-(--border) p-4 md:p-5">
                                <div className="mb-3">
                                    <p className="text-xs font-medium text-(--foreground)">
                                        Subject performance
                                    </p>
                                    <p className="mt-1 text-[10px] text-(--muted-foreground)">
                                        Average score by subject
                                    </p>
                                </div>
                                <SubjectPerformanceChart />
                            </div>
                        </div>
                        {/* Recent results */}
                        <div className="mt-4 rounded-xl border border-(--border) p-4 md:p-5">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-medium text-(--foreground)">
                                        Recent results
                                    </p>
                                    <p className="mt-1 text-[10px] text-(--muted-foreground)">
                                        Latest published academic results
                                    </p>
                                </div>
                                <button className="text-[10px] font-medium text-(--primary) hover:text-(--primary-deep)">
                                    View all
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-137.5 text-left">
                                    <thead>
                                        <tr className="border-b border-(--border)">
                                            <th className="pb-3 text-[9px] font-medium uppercase tracking-widest text-(--muted-foreground)">
                                                Student
                                            </th>
                                            <th className="pb-3 text-[9px] font-medium uppercase tracking-widest text-(--muted-foreground)">
                                                Course
                                            </th>
                                            <th className="pb-3 text-[9px] font-medium uppercase tracking-widest text-(--muted-foreground)">
                                                Score
                                            </th>
                                            <th className="pb-3 text-[9px] font-medium uppercase tracking-widest text-(--muted-foreground)">
                                                Status
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b border-(--border-subtle)">
                                            <td className="py-3 text-xs text-(--foreground)">
                                                Ayaan Khan
                                            </td>
                                            <td className="py-3 text-xs text-(--muted)">
                                                Computer Science
                                            </td>
                                            <td className="py-3 text-xs font-medium tabular text-(--foreground)">
                                                92%
                                            </td>
                                            <td className="py-3">
                                                <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[9px] text-emerald-400">
                                                    Published
                                                </span>
                                            </td>
                                        </tr>
                                        <tr className="border-b border-(--border-subtle)">
                                            <td className="py-3 text-xs text-(--foreground)">
                                                Sara Ahmed
                                            </td>
                                            <td className="py-3 text-xs text-(--muted)">
                                                Information Technology
                                            </td>
                                            <td className="py-3 text-xs font-medium tabular text-(--foreground)">
                                                87%
                                            </td>
                                            <td className="py-3">
                                                <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[9px] text-emerald-400">
                                                    Published
                                                </span>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td className="pt-3 text-xs text-(--foreground)">
                                                Rayyan Ali
                                            </td>
                                            <td className="pt-3 text-xs text-(--muted)">
                                                Computer Science
                                            </td>
                                            <td className="pt-3 text-xs font-medium tabular text-(--foreground)">
                                                81%
                                            </td>
                                            <td className="pt-3">
                                                <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[9px] text-amber-400">
                                                    Pending
                                                </span>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ProductPreview;