import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { analyzeImage, embedText, MODEL_NAME, PROMPT_VERSION } from '@/lib/gemini';
import { mirrorAssetToCloudinary } from '@/lib/cloudinary-mirror';
import { withRetry } from '@/lib/retry';

export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await context.params;
  try {
    const { data: asset, error } = await supabase
      .from('assets')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    let analysis;
    try {
      analysis = await withRetry(() => analyzeImage(asset.original_url));
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 500);
      console.error('reanalyze failed:', e);
      await supabase.from('audit_events').insert({
        entity_type: 'asset',
        entity_id: id,
        action: 'analysis_failed',
        details: { model: MODEL_NAME, error: msg, retry: true },
      });
      return NextResponse.json({ error: `Gemini failed: ${msg}` }, { status: 502 });
    }

    let embedding: number[] | null = null;
    try {
      const embedInput = [
        analysis.caption,
        analysis.scene,
        asset.location_name,
        ...(analysis.activities || []),
        ...(analysis.visible_issues || []),
        ...(analysis.objects || []),
      ]
        .filter(Boolean)
        .join(' ');
      embedding = await withRetry(() => embedText(embedInput), 3, 1000);
    } catch (e) {
      console.error('embedText failed:', e);
    }

    const { error: updateError } = await supabase
      .from('asset_analysis')
      .update({
        caption: analysis.caption,
        activities: analysis.activities,
        objects: analysis.objects,
        scene: analysis.scene,
        visible_issues: analysis.visible_issues,
        estimated_counts: analysis.estimated_counts,
        confidence: analysis.confidence,
        tags: analysis.activities,
        embedding,
        model: MODEL_NAME,
        prompt_version: PROMPT_VERSION,
      })
      .eq('asset_id', id);
    if (updateError) throw updateError;

    await supabase.from('audit_events').insert({
      entity_type: 'asset',
      entity_id: id,
      action: 'reanalyze',
      details: { model: MODEL_NAME, prompt_version: PROMPT_VERSION, confidence: analysis.confidence },
    });

    try {
      const { data: project } = await supabase
        .from('projects')
        .select('slug')
        .eq('id', asset.project_id)
        .single();

      const mirror = await mirrorAssetToCloudinary({
        publicId: asset.cloudinary_public_id,
        assetId: id,
        projectSlug: project?.slug,
        phase: asset.phase || 'unknown',
        activities: analysis.activities,
        scene: analysis.scene,
        locationName: asset.location_name,
        capturedAt: asset.captured_at,
        model: MODEL_NAME,
        promptVersion: PROMPT_VERSION,
      });

      await supabase.from('audit_events').insert({
        entity_type: 'asset',
        entity_id: id,
        action: 'mirror',
        details: { target: 'cloudinary tags + context', ok: mirror.ok, error: mirror.error || null },
      });
    } catch (e) {
      console.error('mirror failed:', e);
    }

    return NextResponse.json({ ok: true, analysis });
  } catch (error: any) {
    console.error('reanalyze error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}