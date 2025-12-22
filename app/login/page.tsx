"use client";

import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  async function signIn() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    router.push("/");
  }

  return (
    <main style={{ maxWidth: 520, margin: "60px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Invoice Tracker</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Sign in to upload invoices and extract fields.
      </p>

      <button
        onClick={signIn}
        style={{
          marginTop: 18,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ccc",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Sign in with Google
      </button>
    </main>
  );
}
