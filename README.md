# ImpactLens

**From field photos to verified impact stories.**

ImpactLens helps sustainability and community-project teams turn a folder of field photos into a searchable, verifiable record of their work. Upload a photo, and AI tags it, captions it, and files it — so a project's story can be found, compared, and trusted later, not just left in a camera roll.

**Live demo:** https://impactlens-gamma.vercel.app

---

## What it does

- **Upload evidence photos** for a project, tagged with phase (before / during / after), location, and date.
- **Automatic AI analysis** on upload — Gemini captions each photo, detects the activity (tree planting, cleanup, solar install, road repair, water supply, waste segregation, community event), the scene, visible issues, and a confidence score.
- **Retry failed analysis** — if the AI call fails (e.g. the model is overloaded), a "Retry analysis" button appears on the photo's card so it can be fixed with one click, with an automatic fallback to a second Gemini model if the primary one is unavailable.
- **Gallery with filters** — filter by phase, tag, verified status, and date range.
- **Search** — keyword and semantic search across captions, tags, and visible issues.
- **Before/after comparison** — pick any two photos and get a slider comparison plus an AI-generated summary of what changed between them.
- **Suggested before/after pairs** — the app proposes likely before/after matches automatically, based on location and date.
- **Manual verification** — a human can mark any photo "Verified" to distinguish confirmed evidence from raw AI output.
- **Provenance panel** — every photo has a full audit trail (upload, analysis, retries, verification, mirroring) plus its Cloudinary IDs, transformations, and original untouched URL.
- **Cloudinary sync** — analysis results (tags, phase, location) are mirrored into Cloudinary as searchable context and tags.
- **Impact reports** — a per-project report page, exportable, summarizing verified evidence for that project.

## Stack

- **Frontend:** Next.js (App Router), React, TypeScript
- **Database:** Supabase (Postgres)
- **Image storage & delivery:** Cloudinary
- **AI:** Google Gemini (`gemini-3.1-flash-lite`, with automatic fallback to `gemini-3.8-flash` on overload)
- **Hosting:** Vercel

## Running locally

1. **Clone the repo**
   ```bash
   git clone https://github.com/<your-username>/impactlens.git
   cd impactlens
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables** — create a `.env.local` file in the project root with:
   ```
   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud_name
   NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your_upload_preset
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   GEMINI_API_KEY=your_gemini_api_key
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Run the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
app/
  page.tsx                        # Main gallery, upload, search, compare UI
  api/
    projects/                     # Create/list projects
    assets/
      ingest/route.ts             # Upload + AI analysis pipeline
      [id]/reanalyze/route.ts     # Retry failed analysis
      [id]/verify/route.ts        # Toggle verified status
    search/route.ts               # Keyword + semantic search
    compare/route.ts              # Before/after AI comparison
    audit/route.ts                # Audit trail lookup
  report/[slug]/                  # Per-project impact report
lib/
  gemini.ts                       # Gemini analysis + fallback logic
  cloudinary-mirror.ts            # Syncs tags/context to Cloudinary
  retry.ts                        # Generic retry-with-backoff helper
  supabase.ts                     # Supabase client
```

## Known limitations

- "Verified" status is independent of analysis success — a photo can be marked verified before its AI analysis has completed. This is intentional (a human can confirm a photo's authenticity without waiting on AI), but it means "Verified" is not a signal that analysis succeeded.
- Location and captured-date are entered manually at upload time rather than extracted from image metadata.
- The compare feature works between any two photos, not only ones tagged as a genuine before/after pair for the same location.

## Roadmap

- Campaign cards with automatic face-blurring for privacy-sensitive photos.
- Map view and timeline view of project evidence.
- Duplicate photo detection.
- CSV export of project data.
- Video support alongside photos.
