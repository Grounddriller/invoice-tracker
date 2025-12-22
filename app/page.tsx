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
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";

type InvoiceRow = {
  id: string;
  supplierName?: string | null;
  invoiceNumber?: string | null;
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

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [activeInvoices, setActiveInvoices] = useState<InvoiceRow[]>([]);
  const [finalizedInvoices, setFinalizedInvoices] = useState<InvoiceRow[]>([]);
  const [indexHint, setIndexHint] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  // ACTIVE = not finalized
  useEffect(() => {
    if (!user) return;

    const qActive = query(
      collection(db, "invoices"),
      where("userId", "==", user.uid),
      where("status", "!=", "finalized"),
      orderBy("status"), // required for "!=" queries
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      qActive,
      (snap) => {
        setActiveInvoices(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        );
        setIndexHint(null);
      },
      (error: any) => {
        console.error("Active invoices listener error:", error);
        if (error?.code === "failed-precondition") {
          setIndexHint(
            "Firestore needs an index for the Active invoices query. Check the console error link and click Create Index."
          );
        }
      }
    );

    return () => unsub();
  }, [user]);

  // FINALIZED
  useEffect(() => {
    if (!user) return;

    const qFinal = query(
      collection(db, "invoices"),
      where("userId", "==", user.uid),
      where("status", "==", "finalized"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      qFinal,
      (snap) => {
        setFinalizedInvoices(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
        );
        setIndexHint(null);
      },
      (error: any) => {
        console.error("Finalized invoices listener error:", error);
        if (error?.code === "failed-precondition") {
          setIndexHint(
            "Firestore needs an index for the Finalized invoices query. Check the console error link and click Create Index."
          );
        }
      }
    );

    return () => unsub();
  }, [user]);

  const activeCount = useMemo(() => activeInvoices.length, [activeInvoices]);
  const finalizedCount = useMemo(
    () => finalizedInvoices.length,
    [finalizedInvoices]
  );

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
          <Btn onClick={() => router.push("/upload")}>Upload invoice</Btn>
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

      {/* ACTIVE SECTION */}
      <Section
        title="Active invoices"
        subtitle="Uploaded / Processing / Needs review"
      >
        {activeInvoices.length === 0 ? (
          <EmptyState text="No active invoices yet. Click “Upload invoice”." />
        ) : (
          activeInvoices.map((inv) => (
            <InvoiceRowCard
              key={inv.id}
              inv={inv}
              onClick={() => router.push(`/invoices/${inv.id}`)}
            />
          ))
        )}
      </Section>

      {/* FINALIZED SECTION */}
      <Section
        title="Finalized invoices"
        subtitle="Read-only invoices you’ve completed"
      >
        {finalizedInvoices.length === 0 ? (
          <EmptyState text="No finalized invoices yet." />
        ) : (
          finalizedInvoices.map((inv) => (
            <InvoiceRowCard
              key={inv.id}
              inv={inv}
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

function InvoiceRowCard({ inv, onClick }: { inv: any; onClick: () => void }) {
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
          <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {inv.supplierName || "Unknown vendor"}{" "}
            {inv.invoiceNumber ? <span style={{ color: UI.muted }}>• #{inv.invoiceNumber}</span> : null}
          </div>
          <div style={{ marginTop: 6, color: UI.muted }}>
            Status: <b style={{ color: UI.text }}>{inv.status || "uploaded"}</b>
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

