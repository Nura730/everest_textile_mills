import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { TrendingUp, Activity, CheckCircle, ShieldAlert, Cpu } from 'lucide-react';
import { defectTrendData, machineUtilizationData, weeklyOutputData } from '../data/mockData';

export default function Analytics() {
  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Operations Analytics</h1>
          <p className="erp-page-subtitle">
            Long-term production efficiency, quality defect trends, and fleet uptime metrics
          </p>
        </div>
      </div>

      {/* Top Cards */}
      <div className="erp-tall-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Average Defect Rate</span>
            <Activity size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">1.8%</div>
          <div className="tall-kpi-change">-0.3% vs previous month (Improving)</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Fleet Overall Equipment Effectiveness (OEE)</span>
            <Cpu size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">84.2%</div>
          <div className="tall-kpi-change">+2.4% year-to-date</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">First-Time Pass Yield</span>
            <CheckCircle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">96.2%</div>
          <div className="tall-kpi-subtext">Rolls passing on first inspection</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Mean Time Between Failures</span>
            <Activity size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">184 hrs</div>
          <div className="tall-kpi-subtext">Loom fleet MTBF benchmark</div>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="erp-charts-grid">
        <div className="erp-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Defect Rate Trend (May - Oct)</h3>
              <p className="card-subtitle">Defects per 100 meters (Industry tolerance: ≤ 2.5)</p>
            </div>
            <span className="card-metric-tag">Current: 1.8</span>
          </div>
          <div style={{ height: 260, width: '100%', marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={defectTrendData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                <XAxis dataKey="month" stroke="#737373" fontSize={12} tickLine={false} />
                <YAxis stroke="#737373" fontSize={12} tickLine={false} domain={[0, 4]} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="erp-chart-tooltip">
                          <div style={{ fontWeight: 600 }}>{label}</div>
                          <div>{payload[0].value} defects / 100m</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke="#171717"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#171717' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="erp-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Machine Uptime Comparison</h3>
              <p className="card-subtitle">Fleet availability percentage over current shift cycle</p>
            </div>
          </div>
          <div style={{ height: 260, width: '100%', marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={machineUtilizationData}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke="#737373" fontSize={11} unit="%" />
                <YAxis type="category" dataKey="name" stroke="#737373" fontSize={11} width={80} tickLine={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="erp-chart-tooltip">
                          <div>{payload[0].payload.name}</div>
                          <div style={{ fontWeight: 600 }}>{payload[0].value}% Uptime</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="utilization" fill="#262626" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
