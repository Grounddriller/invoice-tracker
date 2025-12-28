"use client";

import { doc, onSnapshot, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref } from "firebase/storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db, functions, storage } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";

type LineItem = {
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
};

type InvoiceDoc = {
  userId?: string;
  status?: string;

  supplierName?: string | null;
  supplierAddress?: string | null;
  invoiceNumber?: string | null;
  purchaseOrderNumber?: string | null;

  invoiceDate?: any; // Firestore Timestamp
  dueDate?: any;

  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;

  lineItems?: LineItem[];

  storagePath?: string | null;
  originalFileName?: string | null;
  errorMessage?: string | null;
};

function tsToDateInput(ts: any): string {
  if (!ts) return "";
  const d = ts instanceof Timestamp ? ts.toDate() : ts.toDate?.() ?? null;
  if (!d || !(d instanceof Date)) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateInputToTimestamp(v: string): Timestamp | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

function numOrNull(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #333",
  background: "#0b0b0b",
  color: "#fff",
  boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #333",
  background: "#0b0b0b",
  color: "#fff",
  boxSizing: "border-box",
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.65,
  cursor: "not-allowed",
};

export default function InvoiceReviewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const invoiceId = params.id;

  const [inv, setInv] = useState<(InvoiceDoc & { id: string }) | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  // Local editable state
  const [supplierName, setSupplierName] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");

  const [invoiceDate, setInvoiceDate] = useState(""); // YYYY-MM-DD
  const [dueDate, setDueDate] = useState(""); // YYYY-MM-DD

  const [subtotal, setSubtotal] = useState<string>("");
  const [tax, setTax] = useState<string>("");
  const [total, setTotal] = useState<string>("");

  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // Track which fields the user has edited so snapshots don't overwrite them
  const dirty = useRef(new Set<string>());

  function markDirty(key: string) {
    dirty.current.add(key);
  }

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !invoiceId) return;

    const ref = doc(db, "invoices", invoiceId);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as InvoiceDoc | undefined;
      if (!data) return;

      setInv({ id: snap.id, ...data });

      // Apply extracted values ONLY to fields the user hasn't touched yet.
      if (!dirty.current.has("supplierName")) setSupplierName(data.supplierName ?? "");
      if (!dirty.current.has("supplierAddress")) setSupplierAddress(data.supplierAddress ?? "");
      if (!dirty.current.has("invoiceNumber")) setInvoiceNumber(data.invoiceNumber ?? "");
      if (!dirty.current.has("purchaseOrderNumber")) setPurchaseOrderNumber(data.purchaseOrderNumber ?? "");

      if (!dirty.current.has("invoiceDate")) setInvoiceDate(tsToDateInput(data.invoiceDate));
      if (!dirty.current.has("dueDate")) setDueDate(tsToDateInput(data.dueDate));

      if (!dirty.current.has("subtotal")) setSubtotal(data.subtotal != null ? String(data.subtotal) : "");
      if (!dirty.current.has("tax")) setTax(data.tax != null ? String(data.tax) : "");
      if (!dirty.current.has("total")) setTotal(data.total != null ? String(data.total) : "");

      // line items arrive AFTER extraction finishes.
      if (!dirty.current.has("lineItems")) {
        setLineItems(Array.isArray(data.lineItems) ? data.lineItems : []);
      }
    });

    return () => unsub();
  }, [user, invoiceId]);

  const canEdit = useMemo(() => {
    if (!inv || !user) return false;
    return inv.userId === user.uid;
  }, [inv, user]);

  const isFinalized = inv?.status === "finalized";
  const readOnly = isFinalized || saving || deleting; // no editing while finalized/saving/deleting

  async function save(status: "needs_review" | "finalized") {
    if (!canEdit || !invoiceId) return;

    // Hard stop: finalized invoices cannot be edited/finalized again from UI
    if (isFinalized) return;

    setSaving(true);
    try {
      const ref = doc(db, "invoices", invoiceId);
      await updateDoc(ref, {
        supplierName: supplierName || null,
        supplierAddress: supplierAddress || null,
        invoiceNumber: invoiceNumber || null,
        purchaseOrderNumber: purchaseOrderNumber || null,

        invoiceDate: dateInputToTimestamp(invoiceDate),
        dueDate: dateInputToTimestamp(dueDate),

        subtotal: numOrNull(subtotal),
        tax: numOrNull(tax),
        total: numOrNull(total),

        lineItems,
        status,
        updatedAt: serverTimestamp(),
        finalizedAt: status === "finalized" ? serverTimestamp() : null,
      });

      if (status === "finalized") router.push("/");
    } finally {
      setSaving(false);
    }
  }

  function updateLineItem(i: number, patch: Partial<LineItem>) {
    if (readOnly) return;
    markDirty("lineItems");
    setLineItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  function removeLineItem(i: number) {
    if (readOnly) return;
    markDirty("lineItems");
    setLineItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addLineItem() {
    if (readOnly) return;
    markDirty("lineItems");
    setLineItems((prev) => [...prev, { description: "", quantity: null, unitPrice: null, amount: null }]);
  }

  async function deleteInvoice() {
    if (!canEdit || !invoiceId) return;
    const ok = confirm("Delete this invoice? This cannot be undone.");
    if (!ok) return;

    setDeleting(true);
    try {
      const fn = httpsCallable(functions, "deleteInvoiceV2");
      await fn({ invoiceId });
      router.push("/");
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Delete failed. Check Functions logs.");
    } finally {
      setDeleting(false);
    }
  }

  async function retryExtraction() {
    if (!canEdit || !invoiceId) return;
    setReprocessing(true);
    try {
      const fn = httpsCallable(functions, "reprocessInvoiceV2");
      await fn({ invoiceId });
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Retry failed. Check Functions logs.");
    } finally {
      setReprocessing(false);
    }
  }

  async function downloadOriginal() {
    if (!inv?.storagePath) return;

    setDownloading(true);
    try {
      const storageRef = ref(storage, inv.storagePath);
      const url = await getDownloadURL(storageRef);

      const link = document.createElement("a");
      link.href = url;
      link.download = inv.originalFileName || "invoice.pdf";
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Download failed. The file may have been deleted.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (!user) return null;
  if (!inv) return <div style={{ padding: 16 }}>Loading invoice...</div>;
  if (!canEdit) return <div style={{ padding: 16 }}>Not authorized.</div>;

  return (
    <main style={{ maxWidth: 900, margin: "30px auto", padding: 16, color: "#fff" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>Review invoice</h1>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            Status: <b>{inv.status}</b>
            {isFinalized && (
              <span
                style={{
                  marginLeft: 10,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid #444",
                  background: "#111",
                  color: "#fff",
                  fontSize: 12,
                }}
              >
                Finalized (read-only)
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => router.push("/")}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #444",
              cursor: "pointer",
              background: "#111",
              color: "#fff",
            }}
          >
            Back
          </button>

          {inv.storagePath && (
            <button
              disabled={downloading}
              onClick={downloadOriginal}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #444",
                cursor: downloading ? "not-allowed" : "pointer",
                background: "#111",
                color: "#fff",
                opacity: downloading ? 0.7 : 1,
              }}
            >
              {downloading ? "Downloading..." : "Download Original"}
            </button>
          )}

          {/* Save/Finalize hidden once finalized */}
          {!isFinalized && (
            <>
              <button
                disabled={saving || deleting}
                onClick={() => save("needs_review")}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #444",
                  cursor: saving || deleting ? "not-allowed" : "pointer",
                  background: "#111",
                  color: "#fff",
                  opacity: saving || deleting ? 0.7 : 1,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>

              <button
                disabled={saving || deleting}
                onClick={() => save("finalized")}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #444",
                  cursor: saving || deleting ? "not-allowed" : "pointer",
                  background: "#111",
                  color: "#fff",
                  opacity: saving || deleting ? 0.7 : 1,
                }}
              >
                {saving ? "Finalizing..." : "Finalize"}
              </button>
            </>
          )}

          {inv.status === "error" && (
            <button
              disabled={reprocessing || saving || deleting}
              onClick={retryExtraction}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #2f4f7a",
                cursor: reprocessing || saving || deleting ? "not-allowed" : "pointer",
                background: "#0e1622",
                color: "#fff",
                opacity: reprocessing || saving || deleting ? 0.7 : 1,
              }}
            >
              {reprocessing ? "Retrying..." : "Retry extraction"}
            </button>
          )}

          <button
            disabled={deleting || saving}
            onClick={deleteInvoice}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #7a2a2a",
              cursor: deleting || saving ? "not-allowed" : "pointer",
              background: "#1a0f0f",
              color: "#fff",
              opacity: deleting || saving ? 0.7 : 1,
            }}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {inv.status === "error" && inv.errorMessage ? (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid #7a2a2a",
            borderRadius: 12,
            background: "#1a0f0f",
            color: "#fca5a5",
          }}
        >
          Extraction failed: {inv.errorMessage}
        </div>
      ) : null}

      {/* Header */}
      <section style={{ marginTop: 16, padding: 14, border: "1px solid #333", borderRadius: 12, background: "#0a0a0a" }}>
        <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>Header</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 12 }}>
          <Field
            label="Supplier name"
            value={supplierName}
            disabled={readOnly}
            onChange={(v) => (markDirty("supplierName"), setSupplierName(v))}
          />
          <Field
            label="Invoice #"
            value={invoiceNumber}
            disabled={readOnly}
            onChange={(v) => (markDirty("invoiceNumber"), setInvoiceNumber(v))}
          />
          <Field
            label="PO #"
            value={purchaseOrderNumber}
            disabled={readOnly}
            onChange={(v) => (markDirty("purchaseOrderNumber"), setPurchaseOrderNumber(v))}
          />

          <div>
            <label style={{ fontWeight: 800, display: "block", marginBottom: 6 }}>Invoice date</label>
            <input
              type="date"
              value={invoiceDate}
              disabled={readOnly}
              onChange={(e) => {
                markDirty("invoiceDate");
                setInvoiceDate(e.target.value);
              }}
              style={{ ...inputStyle, ...(readOnly ? disabledStyle : null) }}
            />
          </div>

          <div>
            <label style={{ fontWeight: 800, display: "block", marginBottom: 6 }}>Due date</label>
            <input
              type="date"
              value={dueDate}
              disabled={readOnly}
              onChange={(e) => {
                markDirty("dueDate");
                setDueDate(e.target.value);
              }}
              style={{ ...inputStyle, ...(readOnly ? disabledStyle : null) }}
            />
          </div>

          <Field label="Subtotal" value={subtotal} disabled={readOnly} onChange={(v) => (markDirty("subtotal"), setSubtotal(v))} />
          <Field label="Tax" value={tax} disabled={readOnly} onChange={(v) => (markDirty("tax"), setTax(v))} />
          <Field label="Total" value={total} disabled={readOnly} onChange={(v) => (markDirty("total"), setTotal(v))} />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ fontWeight: 800, display: "block", marginBottom: 6 }}>Supplier address</label>
          <textarea
            value={supplierAddress}
            disabled={readOnly}
            onChange={(e) => {
              markDirty("supplierAddress");
              setSupplierAddress(e.target.value);
            }}
            rows={3}
            style={{ ...textareaStyle, ...(readOnly ? disabledStyle : null) }}
          />
        </div>
      </section>

      {/* Line items */}
      <section style={{ marginTop: 16, padding: 14, border: "1px solid #333", borderRadius: 12, background: "#0a0a0a" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>Line items</h2>

          {/* Add hidden once finalized */}
          {!isFinalized && (
            <button
              onClick={addLineItem}
              disabled={readOnly}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #444",
                cursor: readOnly ? "not-allowed" : "pointer",
                background: "#111",
                color: "#fff",
                opacity: readOnly ? 0.7 : 1,
              }}
            >
              Add line item
            </button>
          )}
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {lineItems.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No line items.</div>
          ) : (
            lineItems.map((li, i) => (
              <div key={i} style={{ padding: 12, border: "1px solid #222", borderRadius: 12, background: "#070707" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    placeholder="Description"
                    value={li.description ?? ""}
                    disabled={readOnly}
                    onChange={(e) => updateLineItem(i, { description: e.target.value })}
                    style={{ ...inputStyle, flex: "2 1 280px", minWidth: 220, ...(readOnly ? disabledStyle : null) }}
                  />

                  <input
                    placeholder="Qty"
                    value={li.quantity ?? ""}
                    disabled={readOnly}
                    onChange={(e) => updateLineItem(i, { quantity: e.target.value ? Number(e.target.value) : null })}
                    style={{ ...inputStyle, flex: "1 1 90px", minWidth: 90, ...(readOnly ? disabledStyle : null) }}
                  />

                  <input
                    placeholder="Unit price"
                    value={li.unitPrice ?? ""}
                    disabled={readOnly}
                    onChange={(e) => updateLineItem(i, { unitPrice: e.target.value ? Number(e.target.value) : null })}
                    style={{ ...inputStyle, flex: "1 1 130px", minWidth: 120, ...(readOnly ? disabledStyle : null) }}
                  />

                  <input
                    placeholder="Amount"
                    value={li.amount ?? ""}
                    disabled={readOnly}
                    onChange={(e) => updateLineItem(i, { amount: e.target.value ? Number(e.target.value) : null })}
                    style={{ ...inputStyle, flex: "1 1 130px", minWidth: 120, ...(readOnly ? disabledStyle : null) }}
                  />

                  {/* Remove hidden once finalized */}
                  {!isFinalized && (
                    <button
                      onClick={() => removeLineItem(i)}
                      disabled={readOnly}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #444",
                        cursor: readOnly ? "not-allowed" : "pointer",
                        background: "#111",
                        color: "#fff",
                        flex: "0 0 40px",
                        height: 40,
                        opacity: readOnly ? 0.7 : 1,
                      }}
                      aria-label="Remove line item"
                      title="Remove"
                    >
                      X
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label style={{ fontWeight: 800, display: "block", marginBottom: 6 }}>{props.label}</label>
      <input
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ ...inputStyle, ...(props.disabled ? disabledStyle : null) }}
      />
    </div>
  );
}
