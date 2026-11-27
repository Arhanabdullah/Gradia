import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartAxis, chartTooltip } from "./ChartsConfig";
import { useChartMotion } from "./useChartMotion";

// Kept in its own module so the dashboard shell and Overview can paint before
// the charting library is downloaded.
const ResultPipelineChart = ({ data }) => {
  const chartMotion = useChartMotion();
  return (
    <div className="h-55 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" {...chartAxis} tick={{ ...chartAxis.tick, fontSize: 11 }} dy={8} />
          <YAxis {...chartAxis} tick={{ ...chartAxis.tick, fontSize: 11 }} allowDecimals={false} width={30} />
          <Tooltip cursor={{ fill: "var(--primary)", fillOpacity: 0.06 }} {...chartTooltip} />
          <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} barSize={26} {...chartMotion} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ResultPipelineChart;
