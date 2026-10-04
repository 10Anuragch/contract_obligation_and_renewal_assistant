# Contract Obligation & Renewal Assistant

A web application for reviewing and managing important information found in contracts.

The application helps users identify contract parties, important dates, renewal and termination clauses, notice periods, obligations, and unclear terms. AI is used to suggest structured information from the document, while the final review is always controlled by the user.

> **Note:** This application is an information-management and review tool. It does not provide legal advice or determine legal rights or obligations. Extracted information should always be checked against the original contract.

## 1. What the application does

### Contract input
- Accepts text-based PDF files, DOCX files, or pasted text.
- OCR is not supported, so scanned PDFs are rejected.
- One contract can be uploaded at a time.
- Maximum upload size is 10 MB.
- An optional internal organization policy can also be provided as a file or pasted text.

### Contract information extraction
The application extracts:
- Contract parties
- Effective date
- Expiry or term information
- Renewal clauses
- Termination clauses
- Notice periods
- Contract obligations
- Responsible parties
- Deadlines and recurring dates
- Ambiguities and conflicts
- Questions that may need clarification

### Source citations
Every extracted item includes its source section and the exact text used to support the extraction.

The server checks that the quoted text actually exists in the uploaded document. If the AI provides an incorrect section label, the application attempts to correct it using the parsed document.

An item without a valid source citation cannot be marked as confirmed.

### Review and approval
Each extracted item starts in a pending state. The reviewer can:
- Approve an item
- Edit an item
- Reject an item
- Open the original source and view the relevant text

The original AI extraction is preserved. User corrections and review decisions are stored separately and included in the audit history.

### Dates and reminders
Important dates are calculated by the application rather than being left to the AI.

This includes:
- Notice deadlines
- Obligation reminders
- Derived expiry dates
- Recurring obligation dates
- Upcoming dates
- Due Soon items
- Overdue items

If a date cannot be calculated reliably, the application shows:

> "Reminder date cannot be calculated until this item is clarified."

Derived dates are clearly marked as requiring confirmation.

### Dashboard
The dashboard provides an overview of:
- Contracts
- Items waiting for review
- Upcoming obligations
- Renewal and notice deadlines
- Potentially stale items
- Overdue items

Users can also filter and sort extracted items.

Organization policy information is displayed separately from the contract terms.

### Contract versions
Every uploaded contract becomes a separate immutable version.

When a new version is analyzed, the application compares it with the previous version:
- Unchanged items can carry their previous review decision forward.
- Changed approved items are marked **Potentially Stale**.
- Removed items are also flagged.
- Previous and new values are shown along with the reason for the stale status.

### Source viewer
Clicking a citation opens the relevant contract section and highlights the exact quoted passage.

This also works with older contract versions and policy citations.

### Reviewed summary
The reviewed summary is generated from approved or edited items.

Rejected, uncertain, and unresolved items are shown separately so that they are not accidentally treated as confirmed information.

The summary can be downloaded as Markdown or printed.

### Audit history
The application records important actions, including:
- Document uploads
- Analysis
- Edits
- Approvals
- Rejections
- Stale-item detection
- Summary generation

For edits, the previous and updated values are recorded.

---

## 2. How the application works

The main workflow is:

```text
Upload / paste document
        |
        v
Parse PDF / DOCX / text
        |
        v
Normalize document and split into sections
        |
        v
AI structured extraction
        |
        v
Validate AI response
        |
        v
Verify source citations
        |
        v
Save extracted items as Pending Review
        |
        v
Human review
(Approve / Edit / Reject)
        |
        v
Deterministic date calculations
        |
        v
Dashboard / Upcoming / Renewal / Summary
```

When a new contract version is uploaded:

```text
New Version
     |
     v
Run the same extraction process
     |
     v
Compare with previous version
     |
     +---- Unchanged ----> Carry forward review decision
     |
     +---- Changed ------> Mark Potentially Stale
     |
     +---- Removed -----> Mark Potentially Stale
```

The AI only proposes information. It does not decide whether an item is approved, does not perform the final date calculations, and cannot bypass schema or citation validation.

Analysis runs as a background job. The UI displays the current status:

```text
Analyzing -> Saving -> Complete
                    |
                    -> Failed
```

---

## 3. Technology used

### Frontend
- React 19
- TypeScript
- Vite
- React Router
- Tailwind CSS v4
- Lucide icons

### Backend
- Node.js
- Express
- TypeScript
- Mongoose
- MongoDB
- OpenAI SDK
- Zod
- date-fns

### Document processing
- pdf-parse
- mammoth

### Testing
- Vitest
- Supertest

---

## 4. Project structure

```text
client/
  React application
  pages/
  components/
  lib/

server/
  src/
    ai/
      schema.ts
      prompts.ts
      openaiExtractor.ts
      demoExtractor.ts
      provider.ts

    services/
      documentParser
      sections
      citation
      extraction
      items
      dates
      deadlines
      review
      stale
      summary
      analysis
      portfolio
      audit

    models/
      Contract
      ContractVersion
      ExtractedItem
      AuditEvent

    routes/
      contracts.ts
      items.ts
      dashboard.ts

    middleware/
      upload.ts
      errors.ts

  tests/
    unit and API integration tests

fixtures/
  sample vendor agreement
  sample organization policy
  v1 and v2 contract samples
```

The fixtures are available in `.txt`, `.pdf`, and `.docx` formats where applicable.

---

## 5. Environment variables

First, copy the example environment file:

```bash
cp .env.example .env
```

Then update the values in `.env`.

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | API key used for OpenAI extraction | - |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/contract_assistant` |
| `PORT` | Backend API port | `5000` |
| `OPENAI_MODEL` | OpenAI model used for structured extraction | `gpt-4o-2024-08-06` |
| `AI_PROVIDER` | `openai` or `demo` | auto |
| `CLIENT_ORIGIN` | Frontend origin used by CORS | `http://localhost:5173` |
| `MAX_UPLOAD_MB` | Maximum document size | `10` |
| `MAX_DOCUMENT_CHARS` | Maximum document length | `150000` |
| `DUE_SOON_DAYS` | Number of days considered "Due Soon" | `30` |
| `UPCOMING_WINDOW_DAYS` | Dashboard upcoming window | `90` |
| `OBLIGATION_REMINDER_LEAD_DAYS` | Days before an obligation to show a reminder | `7` |
| `NOTICE_REMINDER_LEAD_DAYS` | Days before a notice deadline to show a reminder | `14` |

### Using Demo mode

If you do not want to use an OpenAI API key, set:

```env
AI_PROVIDER=demo
```

Demo mode uses the bundled offline extractor. It is useful for testing the application and its UI without making API calls.

The demo extractor is mainly tuned for the sample documents and is not intended to replace the real AI extraction.

### Using OpenAI

For real AI extraction, set:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
```

Create the API key through the OpenAI API platform and restart the application after changing `.env`.

**Never commit `.env` or expose your API key in the repository.**

---

## 6. Installing and running the project

### Requirements

You need:

- Node.js 20 or newer
- MongoDB

### Install dependencies

From the project root:

```bash
npm install
```

### Start the application

```bash
npm run dev
```

This starts:

- Backend API: `http://localhost:5000`
- Frontend: `http://localhost:5173`

You can also start the services separately:

```bash
npm run dev:server
```

and:

```bash
npm run dev:client
```

The frontend proxies `/api` requests to the backend.

### MongoDB

You can use any of the following:

#### Local MongoDB

```bash
mongod --dbpath ./data
```

#### Docker

```bash
docker run -d -p 27017:27017 --name mongo mongo:7
```

#### MongoDB Atlas

Set your Atlas connection string in:

```env
MONGODB_URI=your_mongodb_connection_string
```

The API displays a clear startup error if it cannot connect to MongoDB.

### Production build

Build the project with:

```bash
npm run build
```

Then:

```bash
npm start
```

The production command starts the API. The generated `client/dist` folder can be served through a static host with an `/api` proxy.

---

## 7. Example workflow

The repository contains sample files that can be used to test the complete application.

### Step 1: Upload the sample contract

Use:

```text
fixtures/sample-vendor-agreement.pdf
```

Optionally add:

```text
fixtures/sample-organization-policy.docx
```

Click **Upload**, check the document information, and then select **Analyze Contract**.

### Step 2: Review extracted information

On the contract page, review the extracted items.

For each item you can:
- View the original source
- Approve it
- Edit it
- Reject it

For ambiguous information, use **Edit** to provide the required clarification.

### Step 3: Check renewal and deadlines

The **Renewal & Deadlines** section displays:
- Contract expiry
- Renewal terms
- Notice period
- Calculated notice deadline

For the sample agreement, the 2-year term starting on 15 January 2026 ends on 14 January 2028. With a 60-day notice period, the calculated notice deadline is 15 November 2027.

### Step 4: Test versioning

Upload:

```text
fixtures/sample-vendor-agreement-v2.pdf
```

The sample V2 changes:
- Notice period from 60 to 90 days
- Payment terms from 30 to 45 days
- Clause 7.2

After analysis, affected previously approved items should appear as **Potentially Stale**, with the previous and current values available for comparison.

### Step 5: Generate the reviewed summary

Open **Reviewed Summary** and select **Generate**.

The summary is based on approved and edited information. It can then be downloaded or printed.

### Step 6: Check the audit history

The **Audit History** page shows the actions performed during the workflow.

---

## 8. Sample fixture generation

The sample PDF and DOCX files can be regenerated from their text sources using:

```bash
npm run sample -w server
```

---

## 9. Testing

Run the test suite with:

```bash
npm test
```

The current test suite contains 67 tests.

The API tests require MongoDB. You can provide the normal `MONGODB_URI` or a separate `TEST_MONGODB_URI`.

Also run:

```bash
npm run typecheck
```

and:

```bash
npm run build
```

The tests cover areas including:

- PDF and DOCX parsing
- Section splitting
- Citation verification
- AI response validation
- Corrective AI retry
- Obligation handling
- Notice and expiry date calculations
- Recurring dates
- Due Soon and Overdue status
- Approve, reject, and edit actions
- Duplicate/concurrent review actions
- Contract version creation
- Stale detection
- Carrying review decisions forward
- Reviewed summary generation
- Upload validation
- AI failure handling
- Dashboard API endpoints

The tests use the demo extractor, so they do not require an OpenAI API key or network access.

---

## 10. Important design decisions

### AI proposes, application code decides

The AI is responsible for identifying and proposing information from the contract.

The application handles:
- Schema validation
- Citation verification
- Persistence
- Review state
- Versioning
- Date calculations
- Reminders
- Dashboard status
- Audit history

This keeps important application logic deterministic.

### Citation verification

The application checks that an AI-provided quote actually exists in the uploaded document.

Incorrect section labels can be corrected using the parsed document.

### Stale detection

Stale detection compares the full text of the section containing an item, along with the item's structured values.

This prevents small changes in the AI's selected quote from being incorrectly treated as a contract change.

Text similarity is used when matching items between versions, so simple clause renumbering does not automatically create a completely new item.

### Original AI results are preserved

The original AI result is not overwritten.

The application keeps the original extraction, effective data, and user correction separately.

New contract versions are also stored as separate records.

### Renewal handling

For automatic renewals where the current term has already passed, the application rolls the term forward before calculating the next notice deadline.

### Business-day notice periods

Business-day notice periods are not automatically calculated because doing so would require a reliable holiday calendar.

Instead, these cases are flagged for clarification.

### Authentication

Authentication is not included because it was outside the scope of the assignment.

A single local reviewer identity is used for the audit trail.

---

## 11. AI responsibilities vs application responsibilities

| AI | Application |
|---|---|
| Identify parties and clauses | Parse and store uploaded documents |
| Identify dates stated in the contract | Split and store document sections |
| Extract obligations and responsible parties | Verify source citations |
| Extract periods and deadlines | Store review state |
| Identify ambiguities and conflicts | Handle versioning |
| Generate clarification questions | Compare contract versions |
| Propose source quotes | Calculate dates and reminders |
|  | Generate dashboard statuses |
|  | Maintain audit history |
|  | Build the reviewed summary |

---

## 12. Known limitations

- Scanned PDFs are not supported because OCR is not included.
- PDF tables and multi-column layouts may not always be preserved perfectly during text extraction.
- AI extraction quality depends on the selected model, so extracted information should always be reviewed.
- The demo extractor is intended for testing the application and bundled examples.
- Section detection mainly relies on numbering and paragraph structure. Unusual document formats may fall back to paragraph-based sections.
- Stale detection is intentionally conservative. A change anywhere in an item's containing section can cause the item to be marked for review.
- The application is currently designed for a single reviewer and does not include authentication.
- Analysis jobs run in-process. If the server is restarted while a job is running, the interrupted job is marked as failed and can be retried.
- Contract term-end dates use the "day before the anniversary" convention and are marked **derived — confirm**.
- Calendar integration and external notifications are not included. Reminder dates are displayed inside the application.

---

## 13. Legal and information-management disclaimer

This application is intended to help organize and review information contained in uploaded documents.

It does not:
- Provide legal advice
- Determine legal rights or obligations
- Assess legal validity or enforceability
- Replace professional legal review

AI-generated information can be incomplete or incorrect. Always compare extracted information with the original contract and consult a qualified professional for legal questions.
