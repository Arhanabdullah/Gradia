import { useState } from "react";
import Reveal from "./Reveal";
import { motion } from "framer-motion";
import DashboardHeader from "./dashboard/DashboardHeader";
import DashboardStats from "./dashboard/DashboardStats";
import RecentResults from "./dashboard/RecentResults";
import PerformanceChart from "./charts/PerformanceChart";
import SubjectPerformanceChart from "./charts/SubjectPerformanceChart";

// Preview-only tabs for the landing-page mockup. Pure mock content, stylized
// figures in the same family as the existing preview stats (e.g. 1,248).
const PREVIEW_TABS = ["Overview", "Students", "Results", "Subjects", "Reports"];

const mockStudents = [
    { name: "Aarav Sharma", className: "Class 10 A", average: "86%" },
    { name: "Riya Mehta", className: "Class 10 A", average: "78%" },
    { name: "Kabir Khan", className: "Class 10 B", average: "82%" },
    { name: "Ananya Das", className: "Class 10 B", average: "74%" },
    { name: "Vivaan Nair", className: "Class 9 A", average: "81%" },
];

const mockResults = [
    { subject: "Data Structures", className: "Class 10 A", status: "Published" },
    { subject: "Database Systems", className: "Class 10 B", status: "Awaiting HOD review" },
    { subject: "Operating Systems", className: "Class 10 A", status: "Published" },
    { subject: "Computer Networks", className: "Class 10 B", status: "Ready to publish" },
];

const mockSubjects = [
    { subject: "Data Structures", average: "84%" },
    { subject: "Database Systems", average: "79%" },
    { subject: "Operating Systems", average: "82%" },
    { subject: "Computer Networks", average: "76%" },
    { subject: "Software Engineering", average: "81%" },
];

const mockReports = [
    { label: "Students covered", value: "1,248" },
    { label: "Subjects tracked", value: "12" },
    { label: "Average score", value: "78.4%" },
    { label: "Reports generated", value: "312" },
];

const resultStatusClass = {
    Published: "bg-(--success-subtle) text-(--success)",
    "Awaiting HOD review": "bg-(--primary)/10 text-(--primary)",
    "Ready to publish": "bg-(--primary)/10 text-(--primary)",
};

const sidebarIdleClass =
    "w-full cursor-pointer whitespace-nowrap rounded-lg px-4 py-2.5 text-left text-sm font-medium text-(--muted) transition-colors hover:bg-(--sidebar-hover) hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-(--primary)";
const sidebarActiveClass =
    "w-full cursor-pointer whitespace-nowrap rounded-lg bg-(--sidebar-active) px-4 py-2.5 text-left text-sm font-medium text-(--foreground) focus-visible:outline-2 focus-visible:outline-(--primary)";

// Mock sidebar for the mockup. Renders the same visual recipe as the
// dashboard sidebar, but its items are preview tabs (no navigation).
const PreviewSidebar = ({ tab, onSelect }) => (
    <aside className="glass-floating flex w-full shrink-0 flex-col p-4 md:w-56">
        <div className="mb-8">
            <p className="text-sm font-semibold text-(--foreground)">Gradia</p>
            <p className="mt-0.5 text-xs text-(--muted)">Academic suite</p>
        </div>
        <nav className="space-y-1" aria-label="Preview sections">
            {PREVIEW_TABS.map((label) => {
                const active = label === tab;
                return (
                    <button
                        key={label}
                        type="button"
                        onClick={() => onSelect(label)}
                        aria-pressed={active}
                        className={active ? sidebarActiveClass : sidebarIdleClass}
                    >
                        {label}
                    </button>
                );
            })}
        </nav>
        <div className="mt-auto border-t border-(--border) pt-4">
        </div>
    </aside>
);

const PanelHeader = ({ title, caption }) => (
    <div>
        <p className="text-xs font-medium text-(--foreground)">{title}</p>
        <p className="mt-0.5 text-xs text-(--muted)">{caption}</p>
    </div>
);

const StudentPanel = () => (
    <div className="glass-inner rounded-xl p-4">
        <PanelHeader title="Students" caption="Enrolled students by class, with yearly average" />
        <div className="mt-3 divide-y divide-(--border)">
            {mockStudents.map((student) => (
                <div key={student.name} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-(--foreground)">{student.name}</p>
                        <p className="mt-0.5 text-xs text-(--muted)">{student.className}</p>
                    </div>
                    <p className="text-xs font-semibold text-(--foreground) tabular-nums">
                        {student.average}
                    </p>
                </div>
            ))}
        </div>
    </div>
);

const ResultsPanel = () => (
    <div className="glass-inner rounded-xl p-4">
        <PanelHeader title="Results" caption="Result sheets and where they sit in the workflow" />
        <div className="mt-3 divide-y divide-(--border)">
            {mockResults.map((sheet) => (
                <div key={sheet.subject} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-(--foreground)">{sheet.subject}</p>
                        <p className="mt-0.5 text-xs text-(--muted)">{sheet.className}</p>
                    </div>
                    <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                            resultStatusClass[sheet.status]
                        }`}
                    >
                        {sheet.status}
                    </span>
                </div>
            ))}
        </div>
    </div>
);

const SubjectsPanel = () => (
    <div className="glass-inner rounded-xl p-4">
        <PanelHeader title="Subjects" caption="Class average by subject for the current term" />
        <div className="mt-3 divide-y divide-(--border)">
            {mockSubjects.map((subject) => (
                <div key={subject.subject} className="flex items-center justify-between gap-3 py-2.5">
                    <p className="min-w-0 truncate text-xs font-medium text-(--foreground)">
                        {subject.subject}
                    </p>
                    <p className="text-xs font-semibold text-(--foreground) tabular-nums">
                        {subject.average}
                    </p>
                </div>
            ))}
        </div>
    </div>
);

const ReportsPanel = () => (
    <div className="glass-inner rounded-xl p-4">
        <PanelHeader title="Reports" caption="Term report summary across all classes" />
        <div className="mt-3 divide-y divide-(--border)">
            {mockReports.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 py-2.5">
                    <p className="min-w-0 truncate text-xs text-(--muted)">{row.label}</p>
                    <p className="text-xs font-semibold text-(--foreground) tabular-nums">{row.value}</p>
                </div>
            ))}
        </div>
    </div>
);

const ProductPreview = () => {
    const [tab, setTab] = useState("Overview");

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
                            <p className="text-xs text-(--muted)">
                                app.gradia.academy/dashboard
                            </p>
                        </div>
                        <div className="w-11.5" />
                    </div>
                    {/* Dashboard */}
                    <div className="grid md:grid-cols-[224px_1fr]">
                        <PreviewSidebar tab={tab} onSelect={setTab} />
                        <div className="min-w-0 p-4 sm:p-5 md:p-7">
                            <DashboardHeader title={tab} />
                            {tab === "Overview" ? (
                                <>
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
                                                <p className="mt-0.5 text-xs text-(--muted)">
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
                                                <p className="mt-0.5 text-xs text-(--muted)">
                                                    Average score by subject
                                                </p>
                                            </div>
                                            <SubjectPerformanceChart />
                                        </motion.div>
                                    </div>
                                    <RecentResults />
                                </>
                            ) : tab === "Students" ? (
                                <div className="mt-6">
                                    <StudentPanel />
                                </div>
                            ) : tab === "Results" ? (
                                <div className="mt-6">
                                    <ResultsPanel />
                                </div>
                            ) : tab === "Subjects" ? (
                                <div className="mt-6">
                                    <SubjectsPanel />
                                </div>
                            ) : (
                                <div className="mt-6">
                                    <ReportsPanel />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </Reveal>
        </section>
    );
};

export default ProductPreview;
