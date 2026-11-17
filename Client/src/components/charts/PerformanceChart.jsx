import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

import { chartAxis, chartTooltip } from "./ChartsConfig";

const data = [
    { month: "Jan", score: 68 },
    { month: "Feb", score: 72 },
    { month: "Mar", score: 70 },
    { month: "Apr", score: 76 },
    { month: "May", score: 81 },
    { month: "Jun", score: 84 },
];

const PerformanceChart = () => {
    return (
        <div className="h-55 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart
                    data={data}
                    margin={{
                        top: 8,
                        right: 8,
                        left: 0,
                        bottom: 0,
                    }}
                >
                    <CartesianGrid
                        stroke="var(--border-subtle)"
                        strokeDasharray="2 4"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="month"
                        {...chartAxis}
                        dy={8}
                    />
                    <YAxis
                        {...chartAxis}
                        domain={[50, 100]}
                        ticks={[50, 60, 70, 80, 90, 100]}
                        width={35}
                    />
                    <Tooltip
                        cursor={{
                            stroke: "var(--muted-foreground)",
                            strokeOpacity: 0.5,
                            strokeDasharray: "3 3",
                        }}
                        {...chartTooltip}
                    />
                    <Line
                        type="monotone"
                        dataKey="score"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                            r: 4,
                            fill: "var(--primary)",
                            stroke: "var(--surface-secondary)",
                            strokeWidth: 2,
                        }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default PerformanceChart;