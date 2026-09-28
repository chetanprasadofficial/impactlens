import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { setCloudinaryVerified } from '@/lib/cloudinary-mirror';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const verified = body.verified !== false; // default: verify

  const { data: row, error } = await supabase
    .from('assets')
    .update({ verified, verified_by: verified ? 'analyst' : null })
    .eq('id', id)
    .select('cloudinary_public_id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep the "verified" tag in Cloudinary in sync (best effort)
  let cloudinaryOk = false;
  let cloudinaryError: string | null = null;
  if (row?.cloudinary_public_id) {
    const res = await setCloudinaryVerified(row.cloudinary_public_id, verified);
    cloudinaryOk = res.ok;
    cloudinaryError = res.error || null;
  }

  await supabase.from('audit_events').insert({
    entity_type: 'asset',
    entity_id: id,
    action: 'verify',
    details: { verified, cloudinary_tag_synced: cloudinaryOk, cloudinary_error: cloudinaryError },
    actor: 'analyst',
  });

  return NextResponse.json({ ok: true, verified });
}