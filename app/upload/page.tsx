"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "../../lib/firebase";
import { useAuth } from "../../lib/useAuth";

type UploadStatus = "queued" | "uploading" | "success" | "error";

type UploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string | null;
  storagePath?: string | null;
  uploaded?: boolean;
};

const MAX_CONCURRENT_UPLOADS = 3;
const TEST_UPLOAD_COUNT = 25;

export default function UploadPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const inflight = useRef(0);

  const [items, setItems] = useState<UploadItem[]>([]);
  const [queueTick, setQueueTick] = useState(0);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testNotice, setTestNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  const stats = useMemo(() => {
    const total = items.length;
    const queued = items.filter((item) => item.status === "queued").length;
    const uploading = items.filter((item) => item.status === "uploading").length;
    const success = items.filter((item) => item.status === "success").length;
    const error = items.filter((item) => item.status === "error").length;
    return { total, queued, uploading, success, error };
  }, [items]);

  useEffect(() => {
    if (!user) return;
    if (inflight.current >= MAX_CONCURRENT_UPLOADS) return;

    const pending = items.filter((item) => item.status === "queued");
    if (pending.length === 0) return;

    const available = MAX_CONCURRENT_UPLOADS - inflight.current;
    pending.slice(0, available).forEach((item) => {
      inflight.current += 1;
      void startUpload(item).finally(() => {
        inflight.current -= 1;
        setQueueTick((tick) => tick + 1);
      });
    });
  }, [items, user, queueTick]);

  function makeId(file: File) {
    const base = `${file.name}-${file.size}-${file.lastModified}-${Date.now()}`;
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `${base}-${crypto.randomUUID()}`
      : `${base}-${Math.random().toString(36).slice(2)}`;
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const newItems = Array.from(fileList).map((file) => ({
      id: makeId(file),
      file,
      status: "queued" as const,
      progress: 0,
      error: null,
      storagePath: null,
      uploaded: false,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function createInvoiceDoc(item: UploadItem, storagePath: string) {
    if (!user) return;
    await addDoc(collection(db, "invoices"), {
      userId: user.uid,
      storagePath,
      originalFileName: item.file.name,
      contentType: item.file.type || null,
      status: "uploaded",
      supplierName: null,
      supplierAddress: null,
      invoiceNumber: null,
      purchaseOrderNumber: null,
      invoiceDate: null,
      dueDate: null,
      subtotal: null,
      tax: null,
      total: null,
      currency: null,
      lineItems: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: "upload",
    });
  }

  async function startUpload(item: UploadItem) {
    if (!user) return;

    updateItem(item.id, { status: "uploading", error: null });

    try {
      let storagePath = item.storagePath || null;
      let uploaded = item.uploaded || false;

      if (!storagePath || !uploaded) {
        const safeName = item.file.name.replaceAll(" ", "_");
        storagePath = `invoices/${user.uid}/${Date.now()}_${safeName}`;
        const storageRef = ref(storage, storagePath);
        const task = uploadBytesResumable(storageRef, item.file);

        await new Promise<void>((resolve, reject) => {
          task.on(
            "state_changed",
            (snap) => {
              const progress = snap.totalBytes
                ? (snap.bytesTransferred / snap.totalBytes) * 100
                : 0;
              updateItem(item.id, { progress });
            },
            (err) => reject(err),
            () => resolve()
          );
        });

        uploaded = true;
      }

      updateItem(item.id, {
        progress: 100,
        storagePath,
        uploaded,
      });

      await createInvoiceDoc(item, storagePath ?? "");
      updateItem(item.id, { status: "success" });
    } catch (e: any) {
      updateItem(item.id, {
        status: "error",
        error: e?.message || "Upload failed.",
      });
    }
  }

  function retryUpload(id: string) {
    updateItem(id, { status: "queued", error: null });
  }

  function removeUpload(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function clearAll() {
    setItems([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function simulateTestUploads() {
    if (!user || testBusy) return;

    setTestBusy(true);
    setTestError(null);
    setTestNotice(null);

    try {
      const batch = writeBatch(db);
      const col = collection(db, "invoices");
      const batchId = `test-${Date.now()}`;
      const suppliers = [
        "Acme Supplies",
        "Northwind Traders",
        "Bluebird Shipping",
        "Globex Corp",
        "Sunrise Logistics",
      ];

      for (let i = 0; i < TEST_UPLOAD_COUNT; i += 1) {
        const ref = doc(col);
        const total = Math.round((Math.random() * 4500 + 120) * 100) / 100;
        const invoiceDate = new Date(Date.now() - Math.floor(Math.random() * 30) * 86400000);
        batch.set(ref, {
          userId: user.uid,
          storagePath: null,
          originalFileName: `Simulated_${i + 1}.pdf`,
          contentType: "application/pdf",
          status: "needs_review",
          supplierName: suppliers[i % suppliers.length],
          supplierAddress: null,
          invoiceNumber: `SIM-${Math.floor(Math.random() * 9000 + 1000)}`,
          purchaseOrderNumber: null,
          invoiceDate: Timestamp.fromDate(invoiceDate),
          dueDate: null,
          subtotal: total * 0.9,
          tax: total * 0.1,
          total,
          currency: "USD",
          lineItems: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          skipProcessing: true,
          isTest: true,
          testBatchId: batchId,
          source: "simulated",
        });
      }

      await batch.commit();
      setTestNotice(`Created ${TEST_UPLOAD_COUNT} simulated invoices.`);
    } catch (e: any) {
      setTestError(e?.message || "Test upload failed.");
    } finally {
      setTestBusy(false);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (!user) return null;

  return (
    <main style={{ maxWidth: 900, margin: "30px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Upload invoices</h1>
      <p style={{ opacity: 0.8, marginTop: 6 }}>
        Upload PDFs or images in bulk. We’ll process them in the background.
      </p>

      <div
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #2a2a2a",
          borderRadius: 12,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <input
          ref={inputRef}
          id="invoiceFile"
          type="file"
          multiple
          accept="application/pdf,image/*"
          onChange={(e) => {
            addFiles(e.target.files);
            if (inputRef.current) inputRef.current.value = "";
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            border: 0,
          }}
        />

        <label
          htmlFor="invoiceFile"
          style={{
            display: "block",
            width: "100%",
            padding: "14px 12px",
            borderRadius: 12,
            border: "1px solid #3a3a3a",
            cursor: "pointer",
            userSelect: "none",
            textAlign: "center",
            fontWeight: 900,
            fontSize: 16,
            background: "rgba(255,255,255,0.04)",
          }}
        >
          Tap to choose invoice files
          <div style={{ marginTop: 6, fontWeight: 600, fontSize: 13, opacity: 0.75 }}>
            PDF or photo (JPG/PNG) — multi-select supported
          </div>
        </label>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => router.push("/")}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              cursor: "pointer",
            }}
          >
            Back
          </button>

          <button
            onClick={clearAll}
            disabled={items.length === 0}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              cursor: items.length === 0 ? "not-allowed" : "pointer",
              opacity: items.length === 0 ? 0.6 : 1,
            }}
          >
            Clear list
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
          {stats.total === 0
            ? "No files queued yet."
            : `${stats.total} total · ${stats.uploading} uploading · ${stats.queued} queued · ${stats.success} complete · ${stats.error} failed`}
        </div>

        {items.length > 0 && (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {items.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: 12,
                  border: "1px solid #2a2a2a",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.file.name}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {Math.round(item.file.size / 1024).toLocaleString()} KB
                    </div>
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {item.status === "queued" && "Queued"}
                    {item.status === "uploading" && `Uploading ${Math.round(item.progress)}%`}
                    {item.status === "success" && "Uploaded"}
                    {item.status === "error" && "Failed"}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 8,
                    height: 6,
                    borderRadius: 999,
                    background: "#1b1b1b",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${item.progress}%`,
                      height: "100%",
                      background:
                        item.status === "error" ? "#b91c1c" : item.status === "success" ? "#16a34a" : "#2563eb",
                      transition: "width 120ms ease",
                    }}
                  />
                </div>

                {item.error ? (
                  <div style={{ marginTop: 8, color: "crimson", fontSize: 12 }}>{item.error}</div>
                ) : null}

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {item.status === "error" && (
                    <button
                      onClick={() => retryUpload(item.id)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                        cursor: "pointer",
                      }}
                    >
                      Retry
                    </button>
                  )}

                  <button
                    onClick={() => removeUpload(item.id)}
                    disabled={item.status === "uploading"}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      cursor: item.status === "uploading" ? "not-allowed" : "pointer",
                      opacity: item.status === "uploading" ? 0.6 : 1,
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <section
        style={{
          marginTop: 18,
          padding: 14,
          border: "1px solid #2a2a2a",
          borderRadius: 12,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Simulated test uploads</h2>
        <p style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
          Instantly create {TEST_UPLOAD_COUNT} fake invoices for demos or stress testing.
        </p>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={simulateTestUploads}
            disabled={testBusy}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              cursor: testBusy ? "not-allowed" : "pointer",
              opacity: testBusy ? 0.6 : 1,
            }}
          >
            {testBusy ? "Creating..." : "Create simulated invoices"}
          </button>
        </div>

        {testNotice ? <div style={{ marginTop: 10, color: "#16a34a" }}>{testNotice}</div> : null}
        {testError ? <div style={{ marginTop: 10, color: "crimson" }}>{testError}</div> : null}
      </section>
    </main>
  );
}
