import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const PROMPT_V1 = `You analyze field photos from sustainability and community projects.
Return ONLY valid JSON, no markdown, no code fences:
{
  "caption": "one factual sentence, no guessing about people",
  "activities": ["tree_planting","cleanup","solar_install","road_repair","water_supply","waste_segregation","community_event","other"],
  "objects": ["saplings","garbage","solar_panels"],
  "scene": "lake | road | farm | school | village | urban | other",
  "phase": "before | during | after | unknown",
  "visible_issues": ["water_pollution","litter","flooding"],
  "people_visible": true,
  "estimated_counts": {"people": 0, "saplings": 0},
  "confidence": 0.0
}
Rules: only describe what is visible. If unsure use "unknown" and lower confidence. Return ONLY the JSON object, nothing else, no markdown formatting.`;

export async function analyzeImage(imageUrl: string) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });

  const imageResp = await fetch(imageUrl);
  const imageBuffer = await imageResp.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString('base64');

  const result = await model.generateContent([
    PROMPT_V1,
    {
      inlineData: {
        data: base64,
        mimeType: 'image/jpeg',
      },
    },
  ]);

  const text = result.response.text();
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function compareImages(beforeUrl: string, afterUrl: string) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });

  const [beforeResp, afterResp] = await Promise.all([fetch(beforeUrl), fetch(afterUrl)]);
  const [beforeBuf, afterBuf] = await Promise.all([
    beforeResp.arrayBuffer(),
    afterResp.arrayBuffer(),
  ]);
  const beforeB64 = Buffer.from(beforeBuf).toString('base64');
  const afterB64 = Buffer.from(afterBuf).toString('base64');

  const prompt = `You are comparing a "before" and "after" photo of the same field project.
List 3-5 visible differences as short bullet points, only describing what you can actually see.
Return ONLY valid JSON, no markdown:
{"changes": ["...", "..."], "confidence": 0.0}`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { data: beforeB64, mimeType: 'image/jpeg' } },
    { inlineData: { data: afterB64, mimeType: 'image/jpeg' } },
  ]);

  const text = result.response.text();
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}
