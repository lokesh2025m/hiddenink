"use client";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { RedteamStats, TECHNIQUE_LABELS } from "@/lib/types";
import { axisProps, C, ChartCard, EmptyState, Icon, Kpi, NoData, num, pct, pretty, relTime, tooltipProps, VerdictBadge } from "./ui";

export default function RedteamTab({ data, now }: { data: RedteamStats; now: number }) {
  const t = data.totals;
  if (t.attacks === 0) {
    return (
      <EmptyState icon={Icon.lab} title="No Red-Team attacks yet"
        body="Fire a few attacks in the Red-Team Lab. Every attack that is verified invisible is scored here: what HiddenInk caught, what slipped through, and whether the screeners were fooled."
        href="/lab" cta="Open the Red-Team Lab" />
    );
  }
  const sc = data.screening;
  const perTechnique = data.per_technique.map((r) => ({ ...r, name: TECHNIQUE_LABELS[r.technique] || r.technique }));
  const fooled = [
    { name: "Naive screener", rate: sc.naive_fooled_rate, fill: C.red500 },
    { name: "Protected screener", rate: sc.protected_fooled_rate, fill: C.emerald500 },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Icon.bolt} label="Attacks fired" value={num(t.attacks)} sub="Verified invisible to a person" />
        <Kpi icon={Icon.target} label="Caught" value={pct(t.detection_rate)} sub={`${num(t.detected)} of ${num(t.attacks)} attacks`} />
        <Kpi icon={Icon.tag} label="Correct technique named" value={pct(t.technique_accuracy)} sub="Hiding technique identified" />
        <Kpi icon={Icon.shield} label="Protected screener fooled" value={pct(sc.protected_fooled_rate)} tone="good"
          sub={sc.screened ? <>vs naive <span className="font-medium text-red-600">{pct(sc.naive_fooled_rate)}</span> · {num(sc.screened)} screened</> : "No screened attacks yet"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Caught vs missed, by technique" sub="Each bar is every counted attack using that technique">
          <div style={{ height: Math.max(140, perTechnique.length * 34 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={perTechnique} margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={C.grid} />
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axisProps} width={140} axisLine={false} interval={0} />
                <Tooltip {...tooltipProps} formatter={(v, n, item) => {
                  const row = item?.payload as { attacks: number } | undefined;
                  return [`${num(Number(v))} (${pct(row?.attacks ? Number(v) / row.attacks : 0)})`, n];
                }} />
                <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="detected" name="Caught" stackId="t" fill={C.ink500} stroke={C.surface} strokeWidth={1} barSize={18} isAnimationActive={false} />
                <Bar dataKey="missed" name="Missed" stackId="t" fill={C.red500} stroke={C.surface} strokeWidth={1} radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Rolling detection rate"
          sub={`Share caught over the last 10 attacks, in the order they were fired. Now: ${pct(data.rolling.at(-1)?.detection_rate)}`}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.rolling} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="n" {...axisProps} allowDecimals={false} minTickGap={16}
                  label={{ value: "Attack #", position: "insideBottomRight", offset: -2, fill: C.axis, fontSize: 11 }} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => pct(v)} {...axisProps} axisLine={false} ticks={[0, 0.25, 0.5, 0.75, 1]} />
                <ReferenceLine y={0.9} stroke={C.axis} strokeDasharray="4 4"
                  label={{ value: "90% target", position: "insideTopLeft", fill: C.axis, fontSize: 11 }} />
                <Tooltip {...tooltipProps} labelFormatter={(l) => `After attack #${l}`} formatter={(v) => [pct(Number(v)), "Detection rate"]} />
                <Line type="monotone" dataKey="detection_rate" name="Detection rate" stroke={C.ink600} strokeWidth={2}
                  dot={data.rolling.length <= 30 ? { r: 4, fill: C.ink600, stroke: C.surface, strokeWidth: 2 } : false}
                  activeDot={{ r: 5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Screener fooled by the attack" sub="Lower is better. Fooled = the score jumped by 2+ points, the verdict flipped to shortlist, or the tripwire fired.">
        {sc.screened ? (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={fooled} margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={C.grid} />
                <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => pct(v)} {...axisProps} />
                <YAxis type="category" dataKey="name" {...axisProps} width={130} axisLine={false} />
                <Tooltip {...tooltipProps} formatter={(v) => [pct(Number(v), 1), "Fooled"]} />
                <Bar dataKey="rate" name="Fooled" radius={[0, 4, 4, 0]} barSize={24} isAnimationActive={false}>
                  {fooled.map((f) => <Cell key={f.name} fill={f.fill} />)}
                  <LabelList dataKey="rate" position="right" formatter={(v) => pct(Number(v))} fill="#374151" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <NoData>Turn on screening in the Red-Team Lab (needs an OpenAI key) to measure how often each screener is fooled.</NoData>}
      </ChartCard>

      <ChartCard title="Last 10 attacks" sub="Newest first">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-5 py-2 font-medium">Technique</th><th className="font-medium">Wording style</th><th className="font-medium">Goal</th><th className="font-medium">Result</th><th className="font-medium">Verdict</th><th className="font-medium">Risk</th><th className="px-5 text-right font-medium">When</th></tr>
            </thead>
            <tbody>
              {data.recent.map((r, i) => (
                <tr key={`${r.created_at}-${i}`} className="border-t border-gray-100">
                  <td className="px-5 py-2.5 font-medium">{TECHNIQUE_LABELS[r.technique] || r.technique}</td>
                  <td className="text-gray-700">{pretty(r.style)}</td>
                  <td className="text-gray-700">{pretty(r.goal)}</td>
                  <td>{r.detected
                    ? <span className="chip bg-ink-50 text-ink-700">✓ Caught</span>
                    : <span className="chip bg-red-100 text-red-700">✗ Missed</span>}</td>
                  <td><VerdictBadge verdict={r.verdict} /></td>
                  <td className="tabular-nums">{r.risk_score}</td>
                  <td className="whitespace-nowrap px-5 text-right text-gray-500">{relTime(r.created_at, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {data.per_style.length > 0 && (
        <ChartCard title="By wording style" sub="How the attack text was phrased">
          <ul className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            {data.per_style.map((s) => (
              <li key={s.style} className="flex items-center justify-between gap-3 border-b border-gray-100 py-1.5">
                <span>{pretty(s.style)}</span>
                <span className="tabular-nums text-gray-600">{num(s.detected)}/{num(s.attacks)} caught · <span className={s.missed ? "text-red-600" : ""}>{num(s.missed)} missed</span></span>
              </li>
            ))}
          </ul>
        </ChartCard>
      )}
    </div>
  );
}
