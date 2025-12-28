import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

admin.initializeApp();

// ====== PUT YOUR VALUES HERE ======
const DOCAI_LOCATION = "us"; // "us" or "eu" (must match your processor location)
const DOCAI_PROCESSOR_ID = "de93e913f38aafe3"; // your Processor ID
// ==================================

type LineItem = {
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
};

function pickEntity(entities: any[], types: string[]) {
  const lower = new Set(types.map((t) => t.toLowerCase()));
  return entities.find((e) => lower.has(String(e.type || "").toLowerCase()));
}

function entityText(e: any): string | null {
  if (!e) return null;
  return e.normalizedValue?.text ?? e.mentionText ?? null;
}

function toNumberLoose(s: string): number | null {
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function entityMoneyToNumber(e: any): number | null {
  if (!e) return null;

  // Normalized money
  const mv = e.normalizedValue?.moneyValue;
  if (mv && (typeof mv.units !== "undefined" || typeof mv.nanos !== "undefined")) {
    const units = Number(mv.units || 0);
    const nanos = Number(mv.nanos || 0);
    return units + nanos / 1e9;
  }

  // Fallback parse from text
  const t = entityText(e);
  if (!t) return null;
  return toNumberLoose(t);
}

function entityDateToTimestamp(e: any): admin.firestore.Timestamp | null {
  if (!e) return null;

  const dv = e.normalizedValue?.dateValue;
  if (dv && dv.year && dv.month && dv.day) {
    const d = new Date(dv.year, dv.month - 1, dv.day);
    return admin.firestore.Timestamp.fromDate(d);
  }

  return null;
}

/**
 * Fallback parser when Document AI returns line_item entities but no structured properties.
 * Tries to infer: description / qty / unitPrice / amount from mentionText.
 */
function parseLineItemFromMentionText(text: string): LineItem {
  const mt = String(text || "").replace(/\s+/g, " ").trim();
  if (!mt) return { description: null, quantity: null, unitPrice: null, amount: null };

  // Money-like numbers with 2 decimals
  const moneyRegex = /\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g;
  const moneyMatches: { value: number; start: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = moneyRegex.exec(mt)) !== null) {
    const raw = m[0];
    const value = toNumberLoose(raw);
    if (value == null) continue;
    moneyMatches.push({ value, start: m.index });
  }

  let unitPrice: number | null = null;
  let amount: number | null = null;
  let quantity: number | null = null;

  if (moneyMatches.length >= 2) {
    unitPrice = moneyMatches[moneyMatches.length - 2].value;
    amount = moneyMatches[moneyMatches.length - 1].value;
  } else if (moneyMatches.length === 1) {
    amount = moneyMatches[0].value;
  }

  const firstMoneyStart = moneyMatches.length > 0 ? moneyMatches[0].start : mt.length;
  const beforeMoney = mt.slice(0, firstMoneyStart).trim();

  // Quantity: last integer before money
  const qtyRegex = /\b\d+\b/g;
  const qtyMatches = [...beforeMoney.matchAll(qtyRegex)];
  if (qtyMatches.length > 0) {
    const lastQtyRaw = qtyMatches[qtyMatches.length - 1][0];
    const q = Number(lastQtyRaw);
    if (Number.isFinite(q)) quantity = q;
  }

  // Description: everything before money, remove trailing qty if present
  let description = beforeMoney;
  if (quantity != null) {
    description = description.replace(new RegExp(`\\b${quantity}\\b\\s*$`), "").trim();
  }
  if (!description) description = mt;

  // Compute missing fields when possible
  if (amount == null && quantity != null && unitPrice != null) {
    amount = Math.round(quantity * unitPrice * 100) / 100;
  }
  if (unitPrice == null && quantity != null && amount != null && quantity !== 0) {
    unitPrice = Math.round((amount / quantity) * 100) / 100;
  }

  return {
    description: description || null,
    quantity,
    unitPrice,
    amount,
  };
}

function parseLineItems(entities: any[]): LineItem[] {
  const lineItemEntities = entities.filter((e) => String(e.type || "").toLowerCase() === "line_item");

  return lineItemEntities.map((li: any) => {
    const props = Array.isArray(li.properties) ? li.properties : [];

    // Prefer structured properties when present
    const descriptionProp = entityText(
      pickEntity(props, ["description", "item_description", "product_description", "name"])
    );
    const quantityText = entityText(pickEntity(props, ["quantity", "qty"]));
    const unitPriceProp = entityMoneyToNumber(pickEntity(props, ["unit_price", "price", "unit_cost"]));
    const amountProp = entityMoneyToNumber(pickEntity(props, ["amount", "line_item_amount", "total_price"]));

    const quantityProp = quantityText ? toNumberLoose(quantityText) : null;

    let item: LineItem = {
      description: descriptionProp ?? null,
      quantity: quantityProp ?? null,
      unitPrice: unitPriceProp ?? null,
      amount: amountProp ?? null,
    };

    // Fallback to mentionText parsing if props are missing/empty or everything is null
    const mt = li.mentionText ? String(li.mentionText) : "";
    const needsFallback =
      props.length === 0 ||
      ((!item.description && item.quantity == null && item.unitPrice == null && item.amount == null) && !!mt);

    if (needsFallback && mt) {
      const fb = parseLineItemFromMentionText(mt);
      item = {
        description: item.description ?? fb.description,
        quantity: item.quantity ?? fb.quantity,
        unitPrice: item.unitPrice ?? fb.unitPrice,
        amount: item.amount ?? fb.amount,
      };
    }

    return item;
  });
}

export const processInvoiceOnCreateV2 = onDocumentCreated(
  { document: "invoices/{invoiceId}", region: "us-central1" },
  async (event) => {
  const snap = event.data;
  if (!snap) return;

  const data = snap.data() as any;

  // Only act on newly created uploads
  if (!data || data.status !== "uploaded" || data.skipProcessing) return;

  const docRef = snap.ref;
  await processInvoiceDocument(docRef, data, { clearError: true });
  }
);

async function processInvoiceDocument(
  docRef: admin.firestore.DocumentReference,
  data: any,
  options?: { clearError?: boolean }
) {
  await docRef.update({
    status: "processing",
    ...(options?.clearError ? { errorMessage: null } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    const storagePath = data.storagePath;
    if (!storagePath) throw new Error("Missing storagePath on invoice document.");

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    const [meta] = await file.getMetadata();
    const mimeType = data.contentType || meta.contentType || "application/pdf";
    const [buf] = await file.download();

    const projectId = process.env.GCLOUD_PROJECT;
    if (!projectId) throw new Error("Missing GCLOUD_PROJECT env var (project id).");
    if (!DOCAI_PROCESSOR_ID) throw new Error("Missing DOCAI_PROCESSOR_ID");

    const client = new DocumentProcessorServiceClient({
      apiEndpoint: `${DOCAI_LOCATION}-documentai.googleapis.com`,
    });

    const name = `projects/${projectId}/locations/${DOCAI_LOCATION}/processors/${DOCAI_PROCESSOR_ID}`;

    const request = {
      name,
      rawDocument: {
        content: buf.toString("base64"),
        mimeType,
      },
    };

    const [result] = await client.processDocument(request as any);
    const doc = result.document;
    const entities = doc?.entities || [];

    // Header fields (best effort)
    const supplierName = entityText(pickEntity(entities, ["supplier_name", "supplier", "vendor_name", "vendor"]));
    const supplierAddress = entityText(pickEntity(entities, ["supplier_address", "vendor_address", "address"]));
    const invoiceNumber = entityText(pickEntity(entities, ["invoice_id", "invoice_number", "invoice_no"]));
    const purchaseOrderNumber = entityText(
      pickEntity(entities, ["purchase_order", "purchase_order_number", "po_number", "po"])
    );

    const invoiceDate = entityDateToTimestamp(pickEntity(entities, ["invoice_date", "date"]));
    const dueDate = entityDateToTimestamp(pickEntity(entities, ["due_date"]));

    const subtotal = entityMoneyToNumber(pickEntity(entities, ["subtotal_amount", "subtotal"]));
    const tax = entityMoneyToNumber(pickEntity(entities, ["total_tax_amount", "tax_amount", "tax"]));
    const total = entityMoneyToNumber(pickEntity(entities, ["total_amount", "invoice_total", "amount_due", "total"]));

    const lineItems = parseLineItems(entities);

    // Debug payload (optional)
    const rawEntities = entities.slice(0, 200).map((e: any) => ({
      type: e.type ?? null,
      mentionText: e.mentionText ?? null,
      normalizedText: e.normalizedValue?.text ?? null,
      confidence: e.confidence ?? null,
    }));

    await docRef.update({
      supplierName: supplierName ?? null,
      supplierAddress: supplierAddress ?? null,
      invoiceNumber: invoiceNumber ?? null,
      purchaseOrderNumber: purchaseOrderNumber ?? null,
      invoiceDate: invoiceDate ?? null,
      dueDate: dueDate ?? null,
      subtotal: subtotal ?? null,
      tax: tax ?? null,
      total: total ?? null,
      lineItems,
      rawEntities,
      status: "needs_review",
      extractedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    await docRef.update({
      status: "error",
      errorMessage: String(err?.message || err),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

export const deleteInvoiceV2 = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const invoiceId = String(request.data?.invoiceId || "").trim();
  if (!invoiceId) throw new HttpsError("invalid-argument", "Missing invoiceId.");

  const invoiceRef = admin.firestore().collection("invoices").doc(invoiceId);
  const snap = await invoiceRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Invoice not found.");

  const data = snap.data() as any;
  if (data.userId !== request.auth.uid) throw new HttpsError("permission-denied", "Not allowed.");

  // Delete storage file if present
  const storagePath = data.storagePath;
  if (storagePath) {
    await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true } as any);
  }

  await invoiceRef.delete();
  return { ok: true };
});

export const reprocessInvoiceV2 = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const invoiceId = String(request.data?.invoiceId || "").trim();
  if (!invoiceId) throw new HttpsError("invalid-argument", "Missing invoiceId.");

  const invoiceRef = admin.firestore().collection("invoices").doc(invoiceId);
  const snap = await invoiceRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Invoice not found.");

  const data = snap.data() as any;
  if (data.userId !== request.auth.uid) throw new HttpsError("permission-denied", "Not allowed.");
  if (data.status === "finalized") {
    throw new HttpsError("failed-precondition", "Finalized invoices cannot be reprocessed.");
  }
  if (!data.storagePath) {
    throw new HttpsError("failed-precondition", "No storage file available for reprocessing.");
  }

  await processInvoiceDocument(invoiceRef, data, { clearError: true });
  return { ok: true };
});
