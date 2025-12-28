"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";

type InvoiceRow = {
  id: string;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  originalFileName?: string | null;
  total?: number | null;
  status?: string | null;
  createdAt?: any;
};

const UI = {
  bg: "#000000",
  panel: "#0b0b0b",
  panel2: "#111111",
  border: "#2a2a2a",
  text: "#f5f5f5",
  muted: "#bdbdbd",
  buttonBg: "#0f0f0f",
};

function tsToMillis(ts: any) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function formatDate(ts: any) {
  const ms = tsToMillis(ts);
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString();
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [indexHint, setIndexHint] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created_desc");
  const [minTotal, setMinTotal] = useState("");
  const [maxTotal, setMaxTotal] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;

    const qAll = query(
      collection(db, "invoices"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      qAll,
      (snap) => {
        setInvoices(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setIndexHint(null);
      },
      (error: any) => {
        console.error("Invoices listener error:", error);
        if (error?.code === "failed-precondition") {
          setIndexHint(
            "Firestore needs an index for the invoices query. Check the console error link and click Create Index."
          );
        }
      }
    );

    return () => unsub();
  }, [user]);

  const filteredInvoices = useMemo(() => {
    let rows = [...invoices];

    if (statusFilter !== "all") {
      if (statusFilter === "active") {
        rows = rows.filter((inv) => inv.status !== "finalized");
      } else {
        rows = rows.filter((inv) => (inv.status || "uploaded") === statusFilter);
      }
    }

    const searchValue = search.trim().toLowerCase();
    if (searchValue) {
      rows = rows.filter((inv) => {
        const fields = [inv.supplierName, inv.invoiceNumber, inv.originalFileName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return fields.includes(searchValue);
      });
    }

    const min = Number(minTotal);
    if (Number.isFinite(min) && minTotal !== "") {
      rows = rows.filter((inv) => typeof inv.total === "number" && inv.total >= min);
    }

    const max = Number(maxTotal);
    if (Number.isFinite(max) && maxTotal !== "") {
      rows = rows.filter((inv) => typeof inv.total === "number" && inv.total <= max);
    }

    rows.sort((a, b) => {
      switch (sortBy) {
        case "created_asc":
          return tsToMillis(a.createdAt) - tsToMillis(b.createdAt);
        case "total_desc":
          return (b.total ?? 0) - (a.total ?? 0);
        case "total_asc":
          return (a.total ?? 0) - (b.total ?? 0);
        case "supplier_asc":
          return String(a.supplierName || "").localeCompare(String(b.supplierName || ""));
        case "created_desc":
        default:
          return tsToMillis(b.createdAt) - tsToMillis(a.createdAt);
      }
    });

    return rows;
  }, [invoices, statusFilter, search, minTotal, maxTotal, sortBy]);

  const activeCount = useMemo(
    () => invoices.filter((inv) => inv.status !== "finalized").length,
    [invoices]
  );
  const finalizedCount = useMemo(
    () => invoices.filter((inv) => inv.status === "finalized").length,
    [invoices]
  );
  const selectedCount = selectedIds.size;

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filteredInvoices.map((inv) => inv.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    if (selectedCount === 0 || bulkDeleting) return;
    const ok = confirm(`Delete ${selectedCount} invoice${selectedCount === 1 ? "" : "s"}? This cannot be undone.`);
    if (!ok) return;

    setBulkDeleting(true);
    try {
      const fn = httpsCallable(functions, "bulkDeleteInvoicesV2");
      await fn({ invoiceIds: Array.from(selectedIds) });
      setSelectedIds(new Set());
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Bulk delete failed. Check Functions logs.");
    } finally {
      setBulkDeleting(false);
    }
  }

  if (loading) return <div style={{ padding: 16, color: UI.text }}>Loading...</div>;
  if (!user) return null;

  return (
    <main style={{ maxWidth: 980, margin: "30px auto", padding: 16, color: UI.text }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>Invoice Tracker</h1>
          <div style={{ opacity: 0.85, marginTop: 6, color: UI.muted }}>{user.email}</div>
          <div style={{ marginTop: 8, color: UI.muted }}>
            Active: <b style={{ color: UI.text }}>{activeCount}</b> · Finalized:{" "}
            <b style={{ color: UI.text }}>{finalizedCount}</b>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn onClick={() => router.push("/upload")}>Upload invoices</Btn>
          <Btn onClick={() => signOut(auth)}>Sign out</Btn>
        </div>
      </header>

      {indexHint ? (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: `1px solid ${UI.border}`,
            borderRadius: 12,
            background: UI.panel,
            color: UI.muted,
          }}
        >
          {indexHint}
        </div>
      ) : null}

      <section
        style={{
          marginTop: 18,
          border: `1px solid ${UI.border}`,
          borderRadius: 12,
          background: UI.panel,
          padding: 14,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier, invoice #, filename"
            style={{
              flex: "2 1 260px",
              minWidth: 220,
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panel2,
              color: UI.text,
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              flex: "1 1 160px",
              minWidth: 150,
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panel2,
              color: UI.text,
            }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active (non-finalized)</option>
            <option value="uploaded">Uploaded</option>
            <option value="processing">Processing</option>
            <option value="needs_review">Needs review</option>
            <option value="error">Error</option>
            <option value="finalized">Finalized</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              flex: "1 1 160px",
              minWidth: 150,
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panel2,
              color: UI.text,
            }}
          >
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="total_desc">Highest total</option>
            <option value="total_asc">Lowest total</option>
            <option value="supplier_asc">Supplier (A-Z)</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={minTotal}
            onChange={(e) => setMinTotal(e.target.value)}
            placeholder="Min total"
            inputMode="decimal"
            style={{
              flex: "1 1 140px",
              minWidth: 120,
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panel2,
              color: UI.text,
            }}
          />
          <input
            value={maxTotal}
            onChange={(e) => setMaxTotal(e.target.value)}
            placeholder="Max total"
            inputMode="decimal"
            style={{
              flex: "1 1 140px",
              minWidth: 120,
              padding: "8px 10px",
              borderRadius: 10,
              border: `1px solid ${UI.border}`,
              background: UI.panel2,
              color: UI.text,
            }}
          />
          <div style={{ alignSelf: "center", color: UI.muted, fontSize: 13 }}>
            {filteredInvoices.length} result{filteredInvoices.length === 1 ? "" : "s"}
          </div>
        </div>
      </section>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={selectAllFiltered}
          disabled={filteredInvoices.length === 0}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: `1px solid ${UI.border}`,
            cursor: filteredInvoices.length === 0 ? "not-allowed" : "pointer",
            opacity: filteredInvoices.length === 0 ? 0.6 : 1,
            background: UI.buttonBg,
            color: UI.text,
          }}
        >
          Select all filtered
        </button>
        <button
          onClick={clearSelection}
          disabled={selectedCount === 0}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: `1px solid ${UI.border}`,
            cursor: selectedCount === 0 ? "not-allowed" : "pointer",
            opacity: selectedCount === 0 ? 0.6 : 1,
            background: UI.buttonBg,
            color: UI.text,
          }}
        >
          Clear selection
        </button>
        <button
          onClick={bulkDelete}
          disabled={selectedCount === 0 || bulkDeleting}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #7a2a2a",
            cursor: selectedCount === 0 || bulkDeleting ? "not-allowed" : "pointer",
            opacity: selectedCount === 0 || bulkDeleting ? 0.6 : 1,
            background: "#1a0f0f",
            color: "#fff",
          }}
        >
          {bulkDeleting ? "Deleting..." : "Delete selected"}
        </button>
        <div style={{ color: UI.muted, fontSize: 13 }}>
          {selectedCount} selected
        </div>
      </div>

      <Section title="Invoices" subtitle="Sorted and filtered by metadata">
        {filteredInvoices.length === 0 ? (
          <EmptyState text="No invoices match the current filters." />
        ) : (
          filteredInvoices.map((inv) => (
            <InvoiceRowCard
              key={inv.id}
              inv={inv}
              selected={selectedIds.has(inv.id)}
              onToggleSelect={() => toggleSelection(inv.id)}
              onClick={() => router.push(`/invoices/${inv.id}`)}
            />
          ))
        )}
      </Section>
    </main>
  );
}

/* ---------- Components ---------- */

function Section(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        marginTop: 18,
        border: `1px solid ${UI.border}`,
        borderRadius: 12,
        overflow: "hidden",
        background: UI.panel,
      }}
    >
      <div style={{ padding: 14, borderBottom: `1px solid ${UI.border}` }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>{props.title}</div>
        {props.subtitle ? (
          <div style={{ marginTop: 6, color: UI.muted, fontSize: 13 }}>{props.subtitle}</div>
        ) : null}
      </div>

      <div style={{ display: "grid" }}>{props.children}</div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: 14, color: UI.muted }}>{text}</div>;
}

function InvoiceRowCard({
  inv,
  onClick,
  selected,
  onToggleSelect,
}: {
  inv: any;
  onClick: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: 14,
        border: "none",
        background: UI.panel2,
        color: UI.text,
        cursor: "pointer",
        borderTop: `1px solid ${UI.border}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 16, height: 16 }}
            />
            <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {inv.supplierName || "Unknown vendor"}{" "}
              {inv.invoiceNumber ? <span style={{ color: UI.muted }}>• #{inv.invoiceNumber}</span> : null}
            </div>
          </div>
          <div style={{ marginTop: 6, color: UI.muted }}>
            Status: <b style={{ color: UI.text }}>{inv.status || "uploaded"}</b>
            {inv.createdAt ? (
              <span style={{ marginLeft: 8 }}>· {formatDate(inv.createdAt)}</span>
            ) : null}
          </div>
        </div>

        <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>
          {typeof inv.total === "number" ? `$${inv.total.toFixed(2)}` : ""}
        </div>
      </div>
    </button>
  );
}

function Btn(props: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: `1px solid ${UI.border}`,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.6 : 1,
        background: UI.buttonBg,
        color: UI.text,
      }}
    >
      {props.children}
    </button>
  );
}

