"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../lib/firebase";
import { useAuth } from "../../lib/useAuth";

export default function UploadPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  const prettyName = useMemo(() => {
    if (!file) return "No file selected";
    const kb = Math.round(file.size / 1024);
    return `${file.name} • ${kb.toLocaleString()} KB`;
  }, [file]);

  async function upload() {
    setError(null);
    if (!user) return;

    if (!file) {
      setError("Please choose a file first.");
      return;
    }

    setBusy(true);
    try {
      const safeName = file.name.replaceAll(" ", "_");
      const storagePath = `invoices/${user.uid}/${Date.now()}_${safeName}`;

      // 1) upload file to Firebase Storage
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);

      // 2) create Firestore record (we’ll fill extracted fields later)
      await addDoc(collection(db, "invoices"), {
        userId: user.uid,
        storagePath,
        originalFileName: file.name,
        contentType: file.type || null,
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
      });

      router.push("/");
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  function clearFile() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (!user) return null;

  return (
    <main style={{ maxWidth: 700, margin: "30px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Upload invoice</h1>
      <p style={{ opacity: 0.8, marginTop: 6 }}>
        Upload a PDF or image. Next we’ll connect Document AI to auto-extract fields.
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
        {/* Hidden real input */}
        <input
          ref={inputRef}
          id="invoiceFile"
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => {
            setError(null);
            setFile(e.target.files?.[0] || null);
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

        {/* Big obvious chooser */}
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
          Tap to choose an invoice file
          <div style={{ marginTop: 6, fontWeight: 600, fontSize: 13, opacity: 0.75 }}>
            PDF or photo (JPG/PNG)
          </div>
        </label>

        {/* Filename box */}
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px dashed #3a3a3a",
            fontSize: 14,
            opacity: file ? 0.95 : 0.7,
            wordBreak: "break-word",
          }}
        >
          {prettyName}
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={upload}
            disabled={busy || !file}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              cursor: busy || !file ? "not-allowed" : "pointer",
              opacity: busy || !file ? 0.6 : 1,
            }}
          >
            {busy ? "Uploading..." : "Upload"}
          </button>

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

          {file && (
            <button
              onClick={clearFile}
              disabled={busy}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              Clear file
            </button>
          )}
        </div>

        {error && <div style={{ marginTop: 10, color: "crimson" }}>{error}</div>}
      </div>
    </main>
  );
}

