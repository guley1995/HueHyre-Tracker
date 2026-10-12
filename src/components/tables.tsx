"use client";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { PriorityBadge } from "@/components/ui/badge";
import { CANDIDATE_STAGE_LABELS, COMPANY_STAGE_LABELS } from "@/lib/constants";
import type { CandidateCard, CompanyCard } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

const red = (r: { missing_next_action: boolean; overdue: boolean }) =>
  r.missing_next_action || r.overdue ? "bg-red-50/60 dark:bg-red-950/30" : undefined;

const candidateColumns: ColumnDef<CandidateCard>[] = [
  { key: "k_nr", label: "K-Nr.", value: (r) => r.k_nr, className: "whitespace-nowrap" },
  { key: "name", label: "Name", value: (r) => r.full_name },
  { key: "stage", label: "Spalte", value: (r) => CANDIDATE_STAGE_LABELS[r.stage] ?? r.stage },
  { key: "prio", label: "Prio", value: (r) => r.priority, render: (r) => <PriorityBadge priority={r.priority} /> },
  { key: "category", label: "Kategorie", value: (r) => r.category },
  { key: "title", label: "Profil", value: (r) => r.profile_title },
  { key: "ort", label: "Ort", value: (r) => [r.plz, r.city].filter(Boolean).join(" ") },
  { key: "source", label: "Quelle", value: (r) => r.source },
  { key: "next", label: "Nächste Aktion", value: (r) => r.next_action },
  { key: "date", label: "Datum", value: (r) => r.next_action_date, render: (r) => fmtDate(r.next_action_date), className: "whitespace-nowrap" },
  { key: "days", label: "Tage still", value: (r) => r.days_since_activity },
  { key: "pres", label: "Vorst.", value: (r) => r.active_presentations },
  { key: "consent", label: "Einwilligung", value: (r) => r.consent_date, render: (r) => fmtDate(r.consent_date) },
];

export function CandidateTable({ rows }: { rows: CandidateCard[] }) {
  return <DataTable rows={rows} columns={candidateColumns} href={(r) => `/kandidaten/${r.id}`} rowClassName={red} />;
}

const companyColumns: ColumnDef<CompanyCard>[] = [
  { key: "name", label: "Firma", value: (r) => r.name },
  { key: "stage", label: "Spalte", value: (r) => COMPANY_STAGE_LABELS[r.stage] ?? r.stage },
  { key: "prio", label: "Prio", value: (r) => r.priority, render: (r) => <PriorityBadge priority={r.priority} /> },
  { key: "group", label: "Gruppe", value: (r) => r.group_name },
  { key: "ort", label: "Ort", value: (r) => [r.plz, r.city].filter(Boolean).join(" ") },
  { key: "industry", label: "Branche", value: (r) => r.industry },
  { key: "pays", label: "Zahlt Vermittler", value: (r) => r.pays_agencies },
  { key: "fee", label: "Honorar", value: (r) => r.fee_agreed },
  { key: "jobs", label: "Stellen", value: (r) => r.open_jobs },
  { key: "next", label: "Nächste Aktion", value: (r) => r.next_action },
  { key: "date", label: "Datum", value: (r) => r.next_action_date, render: (r) => fmtDate(r.next_action_date), className: "whitespace-nowrap" },
  { key: "days", label: "Tage still", value: (r) => r.days_since_activity },
  { key: "source", label: "Quelle", value: (r) => r.source },
];

export function CompanyTable({ rows }: { rows: CompanyCard[] }) {
  return <DataTable rows={rows} columns={companyColumns} href={(r) => `/firmen/${r.id}`} rowClassName={red} />;
}
