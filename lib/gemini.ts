import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const MODEL_NAME = 'gemini-3.1-flash-lite';
export const FALLBACK_MODEL_NAME = 'gemini-3.8-flash'; // was gemini-3.5-flash — not on this key
export const PROMPT_VERSION = 'v2';

const ACTIVITIES = [
  'tree_planting',
  'cleanup',
  'solar_install',
  'road_repair',
  'water_supply',
  'waste_segregation',
  'community_event',
  'other',
];
const SCENES = ['lake', 'road', 'farm', 'school', 'village', 'urban', 'other'];
const PHASES = ['before', 'during', 'after', 'unknown'];

const PROMPT_V2 = `You analyze field photos from sustainability and community projects (plantations, cleanups, water, road and solar projects).

Return ONLY one valid JSON object. No markdown, no code fences, no text before or after.

{
  "caption": "one factual sentence describing what is visible; never guess identities or intentions of people",
  "activities": ["one to three values chosen ONLY from the list below"],
  "objects": ["short lowercase snake_case nouns for clearly visible objects, e.g. saplings, garbage, solar_panels, water_pipe"],
  "scene": "exactly one of: lake | road | farm | school | village | urban | other",
  "phase": "before | during | after | unknown",
  "visible_issues": ["short lowercase snake_case issues that are clearly visible, e.g. water_pollution, litter, flooding, potholes, dry_soil; empty list if none"],
  "people_visible": true,
  "estimated_counts": {"people": 0, "saplings": 0},
  "confidence": 0.0
}

Allowed activities and when to use them:
- tree_planting: saplings, seedlings, or trees being planted, watered, or fenced, or a newly planted area
- cleanup: litter, garbage or debris being collected or cleared, or a place that has visibly been cleaned
- solar_install: solar panels, inverters or batteries being installed or newly installed
- road_repair: roads, drains, potholes or bridges being repaired or newly repaired
- water_supply: wells, pumps, pipes, taps, tanks, ponds or lake restoration work
- waste_segregation: waste being sorted or separated into bins or categories
- community_event: a group gathering, training, awareness drive or meeting
- other: use ONLY if none of the activities above is visibly shown

Rules:
1. Choose the most specific activities that are visibly supported. Do not use "other" together with another activity.
2. Only describe what is visible. Do not infer a project, cause or outcome that is not shown.
3. If the image is a split-screen or side-by-side comparison, say so in the caption and describe both halves; set phase to "unknown".
4. "phase" describes the state of the site: before = problem or untouched, during = work in progress, after = finished or restored. Use "unknown" if you cannot tell.
5. Give estimated_counts only for things you can clearly count; otherwise use 0. These are estimates.
6. Lower "confidence" (0 to 1) when the image is blurry, dark, cropped or ambiguous.`;

// Ask Cloudinary for a 1024px JPEG version: smaller, faster, always image/jpeg.
function analysisUrl(url: string): string {
  if (!url.includes('/upload/')) return url;
  return url.replace('/upload/', '/upload/c_limit,w_1024,q_auto,f_jpg/');
}

async function fetchImageBase64(url: string) {
  const resp = await fetch(analysisUrl(url));
  if (!resp.ok) throw new Error(`Could not fetch image (${resp.status})`);
  const buf = await resp.arrayBuffer();
  return {
    data: Buffer.from(buf).toString('base64'),
    mimeType: resp.headers.get('content-type') || 'image/jpeg',
  };
}

function parseJson(text: string) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Model did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function clamp01(n: unknown): number {
  const x = typeof n === 'number' ? n : parseFloat(String(n));
  if (isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => (v as string).trim().toLowerCase().replace(/\s+/g, '_'));
}

function isOverloaded(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('503') || /overloaded|high demand/i.test(msg);
}

// Tries MODEL_NAME first; on a 503/overload error only, retries once against
// FALLBACK_MODEL_NAME instead of hammering the same overloaded model.
// Returns which model actually produced the result, so callers can record it.
async function generateWithFallback(
  parts: (string | { inlineData: { data: string; mimeType: string } })[],
  temperature = 0.2
): Promise<{ result: Awaited<ReturnType<ReturnType<typeof genAI.getGenerativeModel>['generateContent']>>; modelUsed: string }> {
  const tryModel = (modelName: string) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature },
    });
    return model.generateContent(parts);
  };

  try {
    const result = await tryModel(MODEL_NAME);
    return { result, modelUsed: MODEL_NAME };
  } catch (err) {
    if (!isOverloaded(err)) throw err;
    console.warn(`${MODEL_NAME} overloaded, falling back to ${FALLBACK_MODEL_NAME}`);
    const result = await tryModel(FALLBACK_MODEL_NAME);
    return { result, modelUsed: FALLBACK_MODEL_NAME };
  }
}

export async function analyzeImage(imageUrl: string) {
  const img = await fetchImageBase64(imageUrl);

  const { result, modelUsed } = await generateWithFallback([
    PROMPT_V2,
    { inlineData: { data: img.data, mimeType: img.mimeType } },
  ]);

  const raw = parseJson(result.response.text());

  // Validate and normalise so the database only ever holds allowed values
  let activities = cleanList(raw.activities).filter((a) => ACTIVITIES.includes(a));
  if (activities.length > 1) activities = activities.filter((a) => a !== 'other');
  if (activities.length === 0) activities = ['other'];

  const scene = SCENES.includes(String(raw.scene).toLowerCase())
    ? String(raw.scene).toLowerCase()
    : 'other';
  const phase = PHASES.includes(String(raw.phase).toLowerCase())
    ? String(raw.phase).toLowerCase()
    : 'unknown';

  const counts = raw.estimated_counts && typeof raw.estimated_counts === 'object' ? raw.estimated_counts : {};

  return {
    caption: typeof raw.caption === 'string' && raw.caption.trim() ? raw.caption.trim() : 'No caption produced',
    activities,
    objects: cleanList(raw.objects),
    scene,
    phase,
    visible_issues: cleanList(raw.visible_issues),
    people_visible: !!raw.people_visible,
    estimated_counts: {
      people: Number(counts.people) > 0 ? Math.round(Number(counts.people)) : 0,
      saplings: Number(counts.saplings) > 0 ? Math.round(Number(counts.saplings)) : 0,
    },
    confidence: clamp01(raw.confidence),
    model: modelUsed,
    prompt_version: PROMPT_VERSION,
  };
}

export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function compareImages(beforeUrl: string, afterUrl: string) {
  const [before, after] = await Promise.all([
    fetchImageBase64(beforeUrl),
    fetchImageBase64(afterUrl),
  ]);

  const prompt = `You are comparing a "before" photo (first image) and an "after" photo (second image) from a field project.
List 3 to 5 visible differences as short sentences. Only describe what you can actually see in the two images.
If the two photos do not appear to show the same place or scene, make that the first item and lower the confidence.
Return ONLY valid JSON, no markdown: {"changes": ["...", "..."], "confidence": 0.0}`;

  const { result } = await generateWithFallback([
    prompt,
    { inlineData: { data: before.data, mimeType: before.mimeType } },
    { inlineData: { data: after.data, mimeType: after.mimeType } },
  ]);

  const raw = parseJson(result.response.text());
  return {
    changes: Array.isArray(raw.changes) ? raw.changes.map(String) : [],
    confidence: clamp01(raw.confidence),
  };
}