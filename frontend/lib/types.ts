export type Finding = {
  id: string; page: number | null; bbox: number[] | null; text: string; techniques: string[]; detail: string;
  source: "forensics" | "vision" | "both"; category: string; severity: "low" | "medium" | "high";
  rationale: string; target_behavior: string; regex_hits: string[]; payload_matches: number;
};
export type PageInfo = { index: number; width: number; height: number; image_b64: string };
export type ScanReport = {
  scan_id: string; file_name: string; file_hash: string; file_type: "pdf" | "docx"; risk_score: number;
  verdict: "Clean" | "Suspicious" | "Poisoned"; score_breakdown: { finding_id: string; points: number; reasons: string[] }[];
  findings: Finding[]; pages: PageInfo[]; machine_text: string; sanitized_text: string;
  ai_layers: Record<string, string>; warnings: string[];
};
export type Criterion = { name: string; score: number; evidence: string[]; verified_evidence: string[]; grounded: boolean };
export type Protected = {
  criteria: Criterion[]; model_overall: number; overall_score: number; recommendation: string; summary: string;
  injection_attempt_noticed: boolean; dropped_claims: number; tripwire: string[]; masked: Record<string, number>;
};
export type Naive = { score: number; recommendation: string; summary: string };

export const TECHNIQUE_LABELS: Record<string, string> = {
  low_contrast: "Invisible colour", tiny_font: "Tiny font", off_page: "Off the page", invisible_render: "Invisible text mode",
  covered: "Covered by a shape", zero_width: "Zero-width characters", unicode_tags: "Unicode tag characters",
  bidi_override: "Bidirectional override", metadata: "Metadata", annotation: "Hidden annotation", form_field: "Form field",
  embedded_file: "Embedded file", docx_hidden_run: "Hidden Word text", docx_comment: "Word comment",
  visibility_gap: "Visibility Gap (vision)", transparent: "Transparent text", docx_white: "White Word text",
  docx_tiny: "Tiny Word text", docx_metadata: "Word properties",
};
export const CATEGORY_LABELS: Record<string, string> = {
  prompt_injection: "Prompt injection", data_exfiltration: "Data exfiltration", keyword_stuffing: "Keyword stuffing",
  benign_hidden: "Harmless", unclassified: "Unclassified",
};

// ---------- Evaluation page ----------
export type Verdict = ScanReport["verdict"];
export type Decision = "reject" | "clear" | "needs_review";

/** GET /api/eval/live: counts for the signed-in user's organization only. */
export type LiveStats = {
  totals: { scans: number; clean: number; suspicious: number; poisoned: number; flag_rate: number | null; avg_risk: number | null };
  reviews: { reject: number; clear: number; needs_review: number; human_precision: number | null };
  daily: { date: string; clean: number; suspicious: number; poisoned: number }[];
  techniques: { technique: string; count: number }[];
  categories: { category: string; count: number }[];
  risk_histogram: { bucket: string; min: number; count: number }[];
  /** Demo accounts only: real accounts never run the naive screener, so the API leaves this out for them. */
  screening?: { count: number; avg_naive_score: number | null; avg_protected_score: number | null; tripwire_count: number };
  recent_flagged: {
    id: string; file_name: string; verdict: Verdict; risk_score: number; created_at: string | null;
    techniques: string[]; latest_decision: Decision | null;
  }[];
  generated_at: string;
};

export type ScoreRow = { attacks: number; detected: number; missed: number };
export type RedteamRun = {
  created_at: string | null; technique: string; style: string; goal: string; detected: boolean;
  verdict: Verdict; risk_score: number; naive_fooled: boolean | null; protected_fooled: boolean | null;
};

/** GET /api/eval/redteam: Lab attacks that were verified invisible, for this organization. */
export type RedteamStats = {
  totals: { attacks: number; detected: number; detection_rate: number | null; flagged_rate: number | null; technique_accuracy: number | null };
  per_technique: (ScoreRow & { technique: string })[];
  per_style: (ScoreRow & { style: string })[];
  screening: { screened: number; naive_fooled_rate: number | null; protected_fooled_rate: number | null };
  rolling: { n: number; detection_rate: number | null }[];
  recent: RedteamRun[];
  generated_at: string;
};

export type BenchTechnique = { n: number; detected: number; identified: number; flagged: number };

/** A held-out benchmark result: from a run in the database, or (older) from the CLI's latest.json. */
export type BenchResult = {
  ai_layers: boolean; attacks: number; clean_files: number;
  detection_rate: number; false_positive_rate: number; technique_accuracy?: number; flag_rate?: number;
  false_positives: { file: string; verdict: Verdict }[];
  per_technique: Record<string, BenchTechnique>;
  avg_risk_attacks?: number | null; avg_risk_clean?: number | null; duration_s?: number; tokens_used?: number;
  // Present for runs started from the Evaluation page.
  run_id?: string; mode?: "quick" | "full"; created_at?: string; started_by?: string | null; source?: "run";
  // Present for CLI results.
  version?: string; date?: string;
};

export type BenchHistoryRow = {
  run_id?: string; created_at?: string; mode?: "quick" | "full"; version?: string; date?: string;
  detection_rate: number | null; false_positive_rate: number | null; technique_accuracy?: number | null;
};

export type EvalRun = {
  run_id: string; status: "running" | "done" | "error"; mode: "quick" | "full"; started_by: string | null;
  created_at: string | null; finished_at: string | null;
  progress: { done: number; total: number; label: string };
  result: BenchResult | null; error: string | null;
};

/** GET /api/eval */
export type EvalOverview = { latest: BenchResult | null; history: BenchHistoryRow[]; running: EvalRun | null; tokens_used_this_process: number };
