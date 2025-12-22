"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../lib/firebase";
import { useAuth } from "../../lib/useAuth";

export default function UploadPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

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

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (!user) return null;

  return (
    <main style={{ maxWidth: 700, margin: "30px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Upload invoice</h1>
      <p style={{ opacity: 0.8, marginTop: 6 }}>
        Upload a PDF or image. Next we’ll connect Document AI to auto-extract fields.
      </p>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #e5e5e5", borderRadius: 12 }}>
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />

        <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
          <button
            onClick={upload}
            disabled={busy}
            style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}
          >
            {busy ? "Uploading..." : "Upload"}
          </button>

          <button
            onClick={() => router.push("/")}
            style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ccc", cursor: "pointer" }}
          >
            Back
          </button>
        </div>

        {error && <div style={{ marginTop: 10, color: "crimson" }}>{error}</div>}
      </div>
    </main>
  );
}
