"use client";

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";
import { getFunctions, Functions } from "firebase/functions";

function getFirebaseConfig() {
  const requiredEnvVars = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const envVarNames: Record<string, string> = {
    apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
    authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
  };

  const missingVars = Object.entries(requiredEnvVars)
    .filter(([_, value]) => !value)
    .map(([key]) => envVarNames[key]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required Firebase environment variables: ${missingVars.join(", ")}\n` +
        `Please create a .env.local file in the root directory with these variables.`
    );
  }

  return {
    apiKey: requiredEnvVars.apiKey!,
    authDomain: requiredEnvVars.authDomain!,
    projectId: requiredEnvVars.projectId!,
    storageBucket: requiredEnvVars.storageBucket!,
    messagingSenderId: requiredEnvVars.messagingSenderId!,
    appId: requiredEnvVars.appId!,
  };
}

let appInstance: FirebaseApp;
let authInstance: Auth;
let dbInstance: Firestore;
let storageInstance: FirebaseStorage;
let functionsInstance: Functions;

if (typeof window !== "undefined") {
  const firebaseConfig = getFirebaseConfig();
  appInstance = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

  authInstance = getAuth(appInstance);
  dbInstance = getFirestore(appInstance);
  storageInstance = getStorage(appInstance);

  // Must match where you deployed the callable
  functionsInstance = getFunctions(appInstance, "us-central1");
} else {
  appInstance = null as any;
  authInstance = null as any;
  dbInstance = null as any;
  storageInstance = null as any;
  functionsInstance = null as any;
}

export const app = appInstance;
export const auth = authInstance;
export const db = dbInstance;
export const storage = storageInstance;
export const functions = functionsInstance;
