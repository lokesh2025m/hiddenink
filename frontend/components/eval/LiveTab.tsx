"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CATEGORY_LABELS, LiveStats, TECHNIQUE_LABELS, Verdict } from "@/lib/types";
import {
  axisProps, C, ChartCard, DECISION_LABEL, EmptyState, Icon, Kpi, MiniBar, NoData, num, pct, relTime, shortDate,
  tooltipProps, VERDICT_COLOR, VerdictBadge,
} from "./ui";

const VERDICTS: Verdict[] = ["Clean", "Suspicious", "Poisoned"];
const share = (n: number, total: number) => (total ? n / total : 0);

// Risk buckets run from green (0-9) through amber to red (90-100).
function riskColor(i: number) {
  const stops = [[16, 185, 129], [245, 158, 11], [225, 29, 72]];
  const t = i / 9, seg = t < 0.5 ? 0 : 1, f = (t - seg * 0.5) * 2;
  const [a, b] = [stops[seg], stops[seg + 1]];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

export default function LiveTab({ data, now }: { data: LiveStats; now: number }) {
  const router = useRouter();
  const t = data.totals;
  if (t.scans === 0) {
    return (
      <EmptyState icon={Icon.file} title="No scans yet"
        body="Scan a resume and this dashboard fills in live: verdicts, hiding techniques, risk scores and your reviewers' decisions."
        href="/" cta="Scan a resume" />
    );
  }

  const flagged = t.suspicious + t.poisoned;
  const verdicts = VERDICTS.map((v) => ({ name: v, value: t[v.toLowerCase() as "clean"] }));
  const daily = data.daily.map((d) => ({ ...d, label: shortDate(d.date) }));
  const techniques = data.techniques.slice(0, 8).map((x) => ({ name: TECHNIQUE_LABELS[x.technique] || x.technique, count: x.count }));
  const categories = data.categories.map((x) => ({ name: CATEGORY_LABELS[x.category] || x.category, count: x.count }));
  const decisions = [
    { name: "Reject", count: data.reviews.reject, color: C.rose600 },
    { name: "Clear", count: data.reviews.clear, color: C.emerald500 },
    { name: "Needs review", count: data.reviews.needs_review, color: C.amber500 },
  ];
  const decided = decisions.reduce((s, d) => s + d.count, 0);
  const sc = data.screening;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Icon.file} label="Resumes scanned" value={num(t.scans)} sub={`${num(t.clean)} clean`} />
        <Kpi icon={Icon.flag} label="Flagged" value={pct(t.flag_rate)} sub={`${num(flagged)} of ${num(t.scans)} scans`} />
        <Kpi icon={Icon.check} label="Human-confirmed precision" value={pct(data.reviews.human_precision)}
          info="Of flagged resumes a reviewer decided on, the share they rejected rather than cleared."
          sub={data.reviews.human_precision === null ? "No reject or clear decisions yet" : `${num(data.reviews.reject)} rejected · ${num(data.reviews.clear)} cleared`} />
        <Kpi icon={Icon.gauge} label="Avg risk score" value={num(t.avg_risk, 1)} sub="0 = clean, 100 = clearly poisoned" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Verdicts" sub="Every scan in your organization">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="relative h-52 w-52 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={verdicts.filter((v) => v.value > 0)} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%"
                    stroke={C.surface} strokeWidth={2} isAnimationActive={false}>
                    {verdicts.filter((v) => v.value > 0).map((v) => <Cell key={v.name} fill={VERDICT_COLOR[v.name]} />)}
                  </Pie>
                  <Tooltip {...tooltipProps} formatter={(v, n) => [`${num(Number(v))} (${pct(share(Number(v), t.scans))})`, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div><p className="text-2xl font-bold tabular-nums text-ink-900">{num(t.scans)}</p><p className="text-xs text-gray-500">scans</p></div>
              </div>
            </div>
            <ul className="w-full space-y-2 text-sm">
              {verdicts.map((v) => (
                <li key={v.name} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ background: VERDICT_COLOR[v.name] }} aria-hidden />
                  <span className="flex-1">{v.name}</span>
                  <span className="tabular-nums font-medium">{num(v.value)}</span>
                  <span className="w-12 text-right tabular-nums text-gray-500">{pct(share(v.value, t.scans))}</span>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>

        <ChartCard title="Scans per day" sub="Last 14 days (UTC), by verdict">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="label" {...axisProps} minTickGap={12} />
                <YAxis {...axisProps} allowDecimals={false} axisLine={false} />
                <Tooltip {...tooltipProps} />
                <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                {VERDICTS.map((v, i) => (
                  <Bar key={v} dataKey={v.toLowerCase()} name={v} stackId="d" fill={VERDICT_COLOR[v]} stroke={C.surface} strokeWidth={1}
                    radius={i === VERDICTS.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-ink-600">Show as a table</summary>
            <div className="mt-2 max-h-56 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="py-1.5 font-medium">Day</th><th className="font-medium">Clean</th><th className="font-medium">Suspicious</th><th className="font-medium">Poisoned</th></tr></thead>
                <tbody>{[...daily].reverse().map((d) => (
                  <tr key={d.date} className="border-t border-gray-100 tabular-nums"><td className="py-1">{d.label}</td><td>{d.clean}</td><td>{d.suspicious}</td><td>{d.poisoned}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </ChartCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Hiding techniques found" sub="Findings per technique, top 8">
          {techniques.length ? <HBars data={techniques} color={C.ink500} unit="finding" /> : <NoData>No hidden content found yet.</NoData>}
        </ChartCard>
        <ChartCard title="Risk score distribution" sub="Number of scans per risk band">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.risk_histogram} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="bucket" {...axisProps} interval="preserveStartEnd" minTickGap={4} />
                <YAxis {...axisProps} allowDecimals={false} axisLine={false} />
                <Tooltip {...tooltipProps} labelFormatter={(l) => `Risk ${l}`}
                  formatter={(v) => [`${num(Number(v))} scans (${pct(share(Number(v), t.scans))})`, "Scans"]} />
                <Bar dataKey="count" name="Scans" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {data.risk_histogram.map((b, i) => <Cell key={b.bucket} fill={riskColor(i)} />)}
                  <LabelList dataKey="count" position="top" fill="#374151" fontSize={11} formatter={(v) => (Number(v) ? v : "")} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Intent of hidden text" sub="What the classifier says hidden findings try to do">
          {categories.length ? <HBars data={categories} color={C.ink600} unit="finding" /> : <NoData>No hidden content found yet.</NoData>}
        </ChartCard>
        <ChartCard title="Review decisions" sub="Every decision your reviewers saved">
          {decided ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={decisions} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} allowDecimals={false} axisLine={false} />
                  <Tooltip {...tooltipProps} formatter={(v) => [`${num(Number(v))} (${pct(share(Number(v), decided))})`, "Decisions"]} />
                  <Bar dataKey="count" name="Decisions" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                    {decisions.map((d) => <Cell key={d.name} fill={d.color} />)}
                    <LabelList dataKey="count" position="top" fill="#374151" fontSize={12} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <NoData>No review decisions yet. Flagged scans can be reviewed on the Scan page.</NoData>}
        </ChartCard>
      </div>

      {sc && sc.count > 0 && (
        <ChartCard title="Protected screener at work" sub={`Average scores across ${num(sc.count)} screening run${sc.count === 1 ? "" : "s"} (out of 10)`}>
          <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
                  data={[{ name: "Naive", score: sc.avg_naive_score, fill: C.red500 }, { name: "Protected", score: sc.avg_protected_score, fill: C.emerald500 }]}>
                  <CartesianGrid horizontal={false} stroke={C.grid} />
                  <XAxis type="number" domain={[0, 10]} {...axisProps} />
                  <YAxis type="category" dataKey="name" {...axisProps} width={72} axisLine={false} />
                  <Tooltip {...tooltipProps} formatter={(v) => [v == null ? "Not run" : `${Number(v).toFixed(1)} / 10`, "Avg score"]} />
                  <Bar dataKey="score" name="Avg score" radius={[0, 4, 4, 0]} barSize={22} isAnimationActive={false}>
                    <Cell fill={C.red500} /><Cell fill={C.emerald500} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <dl className="grid grid-cols-3 gap-4 text-center md:grid-cols-1 md:text-left">
              <div><dt className="text-xs text-gray-500">Naive avg</dt><dd className="text-lg font-semibold tabular-nums">{sc.avg_naive_score == null ? "Not run" : sc.avg_naive_score.toFixed(1)}</dd></div>
              <div><dt className="text-xs text-gray-500">Protected avg</dt><dd className="text-lg font-semibold tabular-nums">{num(sc.avg_protected_score, 1)}</dd></div>
              <div><dt className="text-xs text-gray-500">Tripwire fired</dt><dd className="text-lg font-semibold tabular-nums">{num(sc.tripwire_count)}</dd></div>
            </dl>
          </div>
        </ChartCard>
      )}

      <ChartCard title="Recently flagged" sub="The last 8 Suspicious or Poisoned scans" action={<Link href="/history" className="text-sm font-medium text-ink-600 hover:underline">Review log →</Link>}>
        {data.recent_flagged.length ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-5 py-2 font-medium">File</th><th className="font-medium">Verdict</th><th className="w-32 font-medium">Risk</th><th className="font-medium">Techniques</th><th className="font-medium">Decision</th><th className="px-5 text-right font-medium">When</th></tr>
              </thead>
              <tbody>
                {data.recent_flagged.map((s) => (
                  <tr key={s.id} onClick={() => router.push("/history")} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                    <td className="max-w-[220px] truncate px-5 py-2.5"><Link href="/history" className="font-medium text-gray-900 hover:text-ink-600" title={s.file_name}>{s.file_name}</Link></td>
                    <td><VerdictBadge verdict={s.verdict} /></td>
                    <td><div className="flex items-center gap-2 pr-4"><span className="w-7 tabular-nums">{s.risk_score}</span><MiniBar value={s.risk_score / 100} color={riskColor(Math.min(9, Math.floor(s.risk_score / 10)))} label={`Risk ${s.risk_score} of 100`} /></div></td>
                    <td><div className="flex flex-wrap gap-1 py-1">{s.techniques.slice(0, 3).map((x) => <span key={x} className="chip bg-ink-50 text-ink-700">{TECHNIQUE_LABELS[x] || x}</span>)}{s.techniques.length > 3 && <span className="chip bg-gray-100 text-gray-600">+{s.techniques.length - 3}</span>}</div></td>
                    <td className="text-gray-700">{s.latest_decision ? DECISION_LABEL[s.latest_decision] : <span className="text-gray-500">Not reviewed</span>}</td>
                    <td className="whitespace-nowrap px-5 text-right text-gray-500">{relTime(s.created_at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <NoData>Nothing flagged yet.</NoData>}
      </ChartCard>
    </div>
  );
}

/** Horizontal bars with category labels on the left; height grows with the number of rows. */
export function HBars({ data, color, unit }: { data: { name: string; count: number }[]; color: string; unit: string }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div style={{ height: Math.max(120, data.length * 34 + 16) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={data} margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={C.grid} />
          <XAxis type="number" {...axisProps} allowDecimals={false} hide />
          <YAxis type="category" dataKey="name" {...axisProps} width={140} axisLine={false} interval={0} />
          <Tooltip {...tooltipProps} formatter={(v) => [`${num(Number(v))} ${unit}${Number(v) === 1 ? "" : "s"} (${pct(share(Number(v), total))})`, "Count"]} />
          <Bar dataKey="count" name="Count" fill={color} radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}
            label={{ position: "right", fill: "#374151", fontSize: 11 }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
