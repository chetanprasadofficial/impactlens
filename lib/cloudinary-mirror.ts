import crypto from 'crypto';

// Server-side only. Uses the Cloudinary Upload API (signed requests), no SDK needed.
const CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const KEY = process.env.CLOUDINARY_API_KEY;
const SECRET = process.env.CLOUDINARY_API_SECRET;

type MirrorResult = { ok: boolean; error?: string };

function sign(params: Record<string, string>): string {
  const str = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(str + SECRET).digest('hex');
}

async function callCloudinary(
  endpoint: 'tags' | 'context',
  fields: Record<string, string>,
  publicId: string
): Promise<MirrorResult> {
  if (!CLOUD || !KEY || !SECRET) {
    return { ok: false, error: 'CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET not set' };
  }
  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const toSign = { ...fields, public_ids: publicId, timestamp };

    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    body.append('public_ids[]', publicId);
    body.append('timestamp', timestamp);
    body.append('api_key', KEY);
    body.append('signature', sign(toSign));

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/${endpoint}`, {
      method: 'POST',
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Cloudinary ${endpoint} failed (${res.status})` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Cloudinary request failed' };
  }
}

const cleanTag = (t: string) =>
  t.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');

const escapeContext = (v: string) => v.replace(/([=|\\])/g, '\\$1');

export async function mirrorAssetToCloudinary(input: {
  publicId: string;
  assetId: string;
  projectSlug?: string | null;
  phase?: string | null;
  activities?: string[];
  scene?: string | null;
  verified?: boolean;
  locationName?: string | null;
  capturedAt?: string | null;
  model?: string;
  promptVersion?: string;
}): Promise<MirrorResult> {
  const tags = [
    input.projectSlug,
    input.phase,
    input.scene,
    ...(input.activities || []),
    input.verified ? 'verified' : null,
  ]
    .filter((t): t is string => !!t)
    .map(cleanTag)
    .filter(Boolean);

  const context: Record<string, string> = {
    asset_id: input.assetId,
    project: input.projectSlug || '',
    phase: input.phase || 'unknown',
    location_name: input.locationName || '',
    captured_at: input.capturedAt ? input.capturedAt.slice(0, 10) : '',
    ai_model: input.model || '',
    prompt_version: input.promptVersion || '',
  };
  const contextStr = Object.entries(context)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${escapeContext(v)}`)
    .join('|');

  const tagRes = tags.length
    ? await callCloudinary('tags', { command: 'add', tag: tags.join(',') }, input.publicId)
    : { ok: true };
  const ctxRes = contextStr
    ? await callCloudinary('context', { command: 'add', context: contextStr }, input.publicId)
    : { ok: true };

  if (tagRes.ok && ctxRes.ok) return { ok: true };
  return { ok: false, error: [tagRes.error, ctxRes.error].filter(Boolean).join('; ') };
}

// Add or remove the "verified" tag in Cloudinary when a human verifies or un-verifies.
export async function setCloudinaryVerified(publicId: string, verified: boolean): Promise<MirrorResult> {
  return callCloudinary('tags', { command: verified ? 'add' : 'remove', tag: 'verified' }, publicId);
}