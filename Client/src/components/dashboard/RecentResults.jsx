import { motion } from "framer-motion";
import { microTransition } from "../../animations/variants";
const results = [
    {
        student: "Aarav Sharma",
        subject: "Data Structures",
        score: "86",
        grade: "A",
    },
    {
        student: "Riya Mehta",
        subject: "Database Systems",
        score: "78",
        grade: "B+",
    },
    {
        student: "Kabir Khan",
        subject: "Operating Systems",
        score: "82",
        grade: "A-",
    },
    {
        student: "Ananya Das",
        subject: "Computer Networks",
        score: "74",
        grade: "B",
    },
];

const RecentResults = () => {
    return (
        <div className="mt-6 overflow-hidden rounded-xl border border-(--border)">
            <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
                <div>
                    <p className="text-xs font-medium text-(--foreground)">
                        Recent Results
                    </p>
                    <p className="mt-0.5 text-[9px] text-(--muted-foreground)">
                        Latest published academic results
                    </p>
                </div>
                <button className="text-[10px] font-medium text-(--primary)">
                    View all
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-130 text-left">
                    <thead>
                        <tr className="border-b border-(--border) bg-(--surface-secondary)">
                            <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-wider text-(--muted-foreground)">
                                Student
                            </th>
                            <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-wider text-(--muted-foreground)">
                                Subject
                            </th>
                            <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-wider text-(--muted-foreground)">
                                Score
                            </th>
                            <th className="px-4 py-2.5 text-[9px] font-medium uppercase tracking-wider text-(--muted-foreground)">
                                Grade
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.map((result) => (
                            <motion.tr
                                key={`${result.student}-${result.subject}`}
                                className="border-b border-(--border) last:border-0"
                                whileHover={{
                                    backgroundColor: "var(--surface-secondary)",
                                }}
                                transition={microTransition}
                            >
                                <td className="px-4 py-3 text-xs font-medium text-(--foreground)">
                                    {result.student}
                                </td>
                                <td className="px-4 py-3 text-xs text-(--muted)">
                                    {result.subject}
                                </td>
                                <td className="px-4 py-3 text-xs text-(--foreground)">
                                    {result.score}
                                </td>
                                <td className="px-4 py-3">
                                    <span className="rounded-md bg-(--surface-secondary) px-2 py-1 text-[9px] font-medium text-(--foreground)">
                                        {result.grade}
                                    </span>
                                </td>
                            </motion.tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RecentResults;