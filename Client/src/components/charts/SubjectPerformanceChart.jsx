import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

const subjectData = [
    { subject: "DSA", score: 86 },
    { subject: "DBMS", score: 78 },
    { subject: "OS", score: 82 },
    { subject: "CN", score: 74 },
    { subject: "Maths", score: 69 },
];

const StudentPerformanceChart = () => {
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
                        tick={{
                            fill: "var(--muted-foreground)",
                            fontSize: 9,
                        }}
                        axisLine={false}
                        tickLine={false}
                        dy={8}
                    />
                    <YAxis
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        tick={{
                            fill: "var(--muted-foreground)",
                            fontSize: 9,
                        }}
                        axisLine={false}
                        tickLine={false}
                        width={35}
                    />
                    <Tooltip
                        cursor={{
                            fill: "var(--primary)",
                            opacity: 0.04,
                        }}
                        contentStyle={{
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: "10px",
                            boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
                            fontSize: "11px",
                        }}
                        labelStyle={{
                            color: "var(--muted)",
                            marginBottom: "4px",
                        }}
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

export default StudentPerformanceChart;