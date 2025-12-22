# Invoice Tracker (Firebase + Google Document AI)

Invoice Tracker is a full-stack invoice management app built with **Next.js (App Router)** and **Firebase**, with automatic invoice extraction powered by **Google Cloud Document AI (Invoice Parser)**.

It lets users:
- Sign in with Google
- Upload invoices (PDF or image)
- Auto-extract invoice header fields + line items using **Google Document AI**
- Review and edit extracted fields
- Finalize invoices (locked from edits)
- Delete invoices (removes both Firestore doc + Storage file)

---

## Live App

Your Firebase **App Hosting** deployment URL is shown in:

**Firebase Console → App Hosting → (your backend)**  
Look for the “Live app” / URL on that page.

---

## Features

### Authentication
- Google Sign-In using Firebase Auth
- Each invoice is tied to a `userId`
- Users only see and manage their own invoices

### Upload
- Accepts: `application/pdf` and `image/*`
- Stores files under a path like:
  `invoices/{userId}/{timestamp}_{filename}`

### Extraction (Google Document AI)
Best-effort extraction:
- supplierName
- supplierAddress
- invoiceNumber
- purchaseOrderNumber
- invoiceDate, dueDate
- subtotal, tax, total
- **lineItems[]** with:
  - description
  - quantity
  - unitPrice
  - amount

### Review + Finalize
- User can manually change extracted fields before finalizing
- Finalized invoices should be read-only (UI + Firestore rules)

### Delete
- Deletes invoice document and original uploaded file
- Uses an HTTPS callable function (recommended so Storage cleanup is reliable)

---

## Tech Stack

- **Next.js** (App Router) + TypeScript
- **Firebase Auth** (Google sign-in)
- **Firestore** (invoice documents)
- **Firebase Storage** (uploaded invoice files)
- **Cloud Functions (2nd Gen)**
  - Firestore trigger: runs extraction after upload
  - Callable function: deletes invoice + storage file
- **Google Cloud Document AI** (Invoice Parser Processor)

---

## How It Works (Architecture)

1. User signs in
2. User uploads an invoice file (PDF or image)
3. File uploads to **Firebase Storage**
4. App creates/updates a Firestore doc in `invoices` with `status: "uploaded"` (and stores `storagePath`, etc.)
5. A Firestore-triggered Cloud Function runs:
   - downloads the file from Storage
   - sends it to **Document AI Invoice Parser**
   - writes extracted fields + `lineItems[]` back into Firestore
   - sets `status: "needs_review"` (or `error`)
6. User reviews/edits and then finalizes:
   - `status: "finalized"`
   - editing is blocked after finalization
7. Optional: user deletes invoice:
   - callable function deletes Firestore doc + Storage file

---

## Typical Project Layout

Your repo may differ slightly, but a common structure looks like:

```
invoice-tracker/
  app/
    invoices/
      [id]/
        page.tsx            # invoice detail page (realtime listener + edit UI)
  lib/
    firebase.ts             # firebase client init (db, auth, storage, functions)
    useAuth.ts              # auth hook/context
  functions/
    src/
      index.ts              # cloud functions (extract + delete)
    package.json
    tsconfig.json
  firebase.json
  .firebaserc
  .env.local                # Next.js env vars (do not commit)
```

---

## Firestore Data Model

### Collection: `invoices`

Example document:

```js
{
  userId: string,

  status: "uploaded" | "processing" | "needs_review" | "finalized" | "error",

  supplierName: string|null,
  supplierAddress: string|null,
  invoiceNumber: string|null,
  purchaseOrderNumber: string|null,

  invoiceDate: Timestamp|null,
  dueDate: Timestamp|null,

  subtotal: number|null,
  tax: number|null,
  total: number|null,

  lineItems: [
    { description: string|null, quantity: number|null, unitPrice: number|null, amount: number|null }
  ],

  storagePath: string,          // path in Firebase Storage
  originalFileName: string|null,
  contentType: string|null,

  createdAt: Timestamp,
  updatedAt: Timestamp,
  extractedAt: Timestamp|null,
  finalizedAt: Timestamp|null,

  // optional debugging
  rawEntities: Array<any>       // optional; remove later
}
```

---

## Prerequisites

- Node.js 18+ recommended
- Firebase CLI installed globally:
  ```bash
  npm i -g firebase-tools
  ```
- A Firebase project (same underlying Google Cloud project is fine)
- Firebase services enabled:
  - Authentication (Google provider)
  - Firestore
  - Storage
  - Cloud Functions
  - App Hosting / Hosting
- A Google Cloud Document AI **Invoice Parser** processor created in the same project (recommended)

---

## Setup (Local)

### 1) Install Dependencies

From the project root:

```bash
npm install
```

Install Cloud Functions dependencies:

```bash
cd functions
npm install
cd ..
```

### 2) Create Firebase Project + Enable Services

In Firebase Console:

1. Create a Firebase project
2. Enable **Authentication** → Sign-in method → **Google**
3. Create **Firestore Database**
4. Enable **Storage**
5. Enable **Cloud Functions**
6. Enable **App Hosting** (or Hosting, depending on your setup)

### 3) Configure Firebase CLI for this repo

```bash
firebase login
firebase use --add
```

This creates/updates `.firebaserc` with your project alias.

### 4) Create the Document AI Invoice Parser Processor

In Google Cloud Console (same project):

1. Enable the **Document AI API**
2. Go to **Document AI** → **Processors**
3. Create a processor:
   - Type: **Invoice Parser**
   - Choose a location (common choices: `us` or `eu`)
4. Copy the values you’ll need:
   - `DOCUMENTAI_PROJECT_ID` (your GCP project id)
   - `DOCUMENTAI_LOCATION` (e.g. `us`)
   - `DOCUMENTAI_PROCESSOR_ID` (the processor id)

### 5) Grant permissions for Document AI calls

Your Cloud Functions runtime service account must be allowed to call Document AI.

Recommended approach:
- Use the default service account that Cloud Functions runs as (or a dedicated one)
- Grant it:
  - **Document AI API User** (or equivalent permission to call processors)
  - Storage access is usually already handled for Firebase buckets, but ensure it can read the invoice objects in Storage

If you’re unsure, start by granting:
- `roles/documentai.apiUser` to the Functions service account

### 6) Add Environment Variables

#### Frontend: `.env.local` (Next.js)

Create `.env.local` in the project root:

```bash
touch .env.local
```

Add your Firebase web config (Firebase Console → Project settings → Your apps → Web app):

```env
NEXT_PUBLIC_FIREBASE_API_KEY=xxxx
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=xxxx.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=xxxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=xxxx.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=xxxx
NEXT_PUBLIC_FIREBASE_APP_ID=xxxx

# Optional (only if you use callable functions and want explicit region)
NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION=us-central1
```

Do NOT commit `.env.local`.

#### Backend: Functions environment variables

You can store these as environment variables or secrets for Cloud Functions. At minimum:

- `DOCUMENTAI_PROJECT_ID`
- `DOCUMENTAI_LOCATION`
- `DOCUMENTAI_PROCESSOR_ID`

If your function uses Application Default Credentials (recommended when Functions + Document AI are in the same project), you do NOT need to ship a service account JSON. The function will authenticate as its runtime service account, as long as permissions are correct.

Example values (names may vary in your code):
- `DOCUMENTAI_PROJECT_ID=your-gcp-project-id`
- `DOCUMENTAI_LOCATION=us`
- `DOCUMENTAI_PROCESSOR_ID=xxxxxxxxxxxxxxxx`

### 7) Firestore & Storage Security Rules (Production Baseline)

If you started your database/storage in **test mode**, replace permissive rules before going live.

#### Firestore Rules (only allow users to access their own invoices, and block edits after finalization)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /invoices/{invoiceId} {

      // Read allowed only for owner
      allow read: if request.auth != null
        && resource.data.userId == request.auth.uid;

      // Create allowed only if userId matches caller
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;

      // Update allowed only for owner AND only if not finalized
      allow update: if request.auth != null
        && resource.data.userId == request.auth.uid
        && resource.data.status != "finalized";

      // Delete allowed only for owner (recommended: do deletes via callable function)
      allow delete: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }
  }
}
```

Notes:
- The rule above blocks ALL client updates once status is `"finalized"`.
- Your Cloud Function writes still work because Admin SDK bypasses security rules.

#### Storage Rules (only allow users to access their own invoice files)

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /invoices/{uid}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

These rules assume your uploads go under:
- `invoices/{uid}/...`

If your file paths differ, update rules accordingly.

---

## Running Locally

From project root:

```bash
npm run dev
```

Open:
- http://localhost:3000

---

## Cloud Functions (2nd Gen)

This project commonly includes two Functions:

1) **Firestore trigger**: runs extraction after upload  
2) **Callable function**: deletes invoice doc + storage file reliably

### Status flow (recommended)

- `"uploaded"`: file exists, extraction not started
- `"processing"`: extraction in progress
- `"needs_review"`: extracted fields written; user can edit
- `"finalized"`: invoice locked (no more edits)
- `"error"`: extraction failed (store error message if helpful)

### Deploy Functions

```bash
firebase deploy --only functions
```

---

## UI Notes (Realtime Invoice Page)

The invoice detail page typically:
- Subscribes to the invoice doc via Firestore `onSnapshot()`
- Renders extracted fields + line items as soon as Functions write them
- Allows edits only when `status !== "finalized"`

If line items stop appearing after extraction, the most common cause is **state overwrite**:
- A Firestore snapshot updates `lineItems`, but local React state or a save handler overwrites the doc with an old object that does not include the new `lineItems`.

Best practice:
- Treat Firestore snapshot as the source of truth
- Keep local state only for “draft edits”
- When saving, update only the changed fields (don’t write a stale full invoice object)

Debug checklist:
- Confirm Firestore invoice doc actually contains `lineItems[]`
- Confirm the UI listens to the correct invoice doc id
- Confirm `onSnapshot()` fires after the function writes
- Confirm your state merge logic does not discard `lineItems`

---

## Deploying (Firebase App Hosting / Hosting)

### App Hosting (where your live URL is shown)
Firebase Console → App Hosting → (your backend) → “Live app” URL

### Deploy
If your project is already configured, deploy with:

```bash
firebase deploy
```

You can also deploy specific targets:
```bash
firebase deploy --only functions
firebase deploy --only hosting
```

---

## Switching Firebase “Test Mode” → “Production Mode”

If Firestore/Storage were created in test mode:

1. Replace Firestore rules with the production rules above
2. Replace Storage rules with the production rules above
3. Ensure every invoice doc includes `userId: auth.uid`
4. Ensure the UI blocks edits after finalization
5. Ensure Functions validate ownership before writing (recommended even if rules exist)
6. Consider enabling **App Check** to reduce abuse

Go-live checklist:
- [ ] Signed-out users cannot read/write invoices
- [ ] Users cannot access invoices they don’t own
- [ ] Users cannot read/write Storage files outside `invoices/{uid}/...`
- [ ] Finalized invoices cannot be edited from client
- [ ] Delete operation removes both Firestore doc and Storage object

---

## Common Commands

Root (Next.js):
```bash
npm run dev
npm run build
npm run start
npm run lint
```

Functions:
```bash
cd functions
npm run build
npm run lint
firebase deploy --only functions
cd ..
```

Full deploy:
```bash
firebase deploy
```

---

## Troubleshooting

### Extraction never runs
- Confirm the Firestore trigger is deployed
- Confirm the trigger listens to the correct collection (`invoices`)
- Confirm the document write sets a status/state that the trigger expects (e.g. `"uploaded"`)
- Check Cloud Functions logs in Firebase Console → Functions

### Document AI permission errors
- Ensure the Functions runtime service account has `roles/documentai.apiUser`
- Ensure the Document AI API is enabled
- Ensure your location/processor id values match the created processor

### Line items missing or disappear after briefly showing
- Confirm the function writes to the same invoice doc the UI displays
- Confirm the UI doesn’t overwrite `lineItems` during save
- Prefer patch updates (`updateDoc` with specific fields) instead of writing a full invoice object

---

## Author

Gokhan Yerdelen
