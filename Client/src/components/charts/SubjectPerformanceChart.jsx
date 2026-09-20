import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { chartAxis, chartTooltip } from "./ChartsConfig";
const subjectData = [
    { subject: "DSA", score: 86 },
    { subject: "DBMS", score: 78 },
    { subject: "OS", score: 82 },
    { subject: "CN", score: 74 },
    { subject: "Maths", score: 69 },
];

const SubjectPerformanceChart = () => {
    return (
        <div className="h-55 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    data={subjectData}
                    margin={{
                        top: 8,
                        right: 4,
                        left: -20,
                        bottom: 0,
                    }}
                >
                    <CartesianGrid
                        stroke="var(--border-subtle)"
                        strokeDasharray="2 4"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="subject"
                        {...chartAxis}
                        dy={8}
                    />
                    <YAxis
                        {...chartAxis}
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        width={35}
                    />
                    <Tooltip
                        cursor={{
                            fill: "var(--primary)",
                            opacity: 0.04,
                        }}
                        {...chartTooltip}
                    />
                    <Bar
                        dataKey="score"
                        fill="var(--primary)"
                        radius={[4, 4, 0, 0]}
                        barSize={16}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

export default SubjectPerformanceChart;