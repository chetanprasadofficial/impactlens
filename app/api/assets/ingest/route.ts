import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { analyzeImage, embedText, MODEL_NAME, PROMPT_VERSION } from '@/lib/gemini';
import { mirrorAssetToCloudinary } from '@/lib/cloudinary-mirror';
import { withRetry } from '@/lib/retry';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      cloudinaryPublicId,
      cloudinaryAssetId,
      version,
      originalUrl,
      width,
      height,
      phase,
      locationName,
      capturedAt,
    } = body;

    if (new URL(originalUrl).hostname !== 'res.cloudinary.com') {
      return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
    }

    const cleanLocation =
      typeof locationName === 'string' && locationName.trim()
        ? locationName.trim().slice(0, 120)
        : null;

    let capturedIso: string | null = null;
    if (typeof capturedAt === 'string' && capturedAt.trim()) {
      const d = new Date(capturedAt);
      if (!isNaN(d.getTime())) capturedIso = d.toISOString();
    }

    const assetId = `A-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        id: assetId,
        project_id: projectId,
        cloudinary_public_id: cloudinaryPublicId,
        cloudinary_asset_id: cloudinaryAssetId,
        version: String(version),
        original_url: originalUrl,
        resource_type: 'image',
        width,
        height,
        phase: phase || 'unknown',
        location_name: cleanLocation,
        location_source: cleanLocation ? 'manual' : 'unknown',
        captured_at: capturedIso,
      })
      .select()
      .single();

    if (assetError) throw assetError;

    // Analysis: retry temporary Gemini errors, and record the reason if it still fails
    let analysis;
    let analysisFailure: string | null = null;
    try {
      analysis = await withRetry(() => analyzeImage(originalUrl));
    } catch (e: any) {
      analysisFailure = String(e?.message ?? e).slice(0, 500);
      console.error('analyzeImage failed:', e);
      analysis = {
        caption: 'Analysis pending - retry needed',
        activities: [],
        objects: [],
        scene: 'other',
        phase: 'unknown',
        visible_issues: [],
        estimated_counts: {},
        confidence: 0,
      };
    }

    // Skip the embedding for failed analyses so placeholder text doesn't pollute search
    let embedding: number[] | null = null;
    if (!analysisFailure) {
      try {
        const embedInput = [
          analysis.caption,
          analysis.scene,
          cleanLocation,
          ...(analysis.activities || []),
          ...(analysis.visible_issues || []),
          ...(analysis.objects || []),
        ]
          .filter(Boolean)
          .join(' ');
        embedding = await withRetry(() => embedText(embedInput), 3, 1000);
      } catch (e) {
        console.error('embedText failed:', e);
        embedding = null;
      }
    }

    const { error: analysisError } = await supabase.from('asset_analysis').insert({
      asset_id: assetId,
      caption: analysis.caption,
      activities: analysis.activities,
      objects: analysis.objects,
      scene: analysis.scene,
      visible_issues: analysis.visible_issues,
      estimated_counts: analysis.estimated_counts,
      confidence: analysis.confidence,
      tags: analysis.activities,
      embedding: embedding,
      model: MODEL_NAME,
      prompt_version: PROMPT_VERSION,
    });

    if (analysisError) throw analysisError;

    await supabase.from('audit_events').insert({
      entity_type: 'asset',
      entity_id: assetId,
      action: 'upload',
      details: {
        model: MODEL_NAME,
        prompt_version: PROMPT_VERSION,
        confidence: analysis.confidence,
        location_name: cleanLocation,
        captured_at: capturedIso,
      },
    });

    if (analysisFailure) {
      await supabase.from('audit_events').insert({
        entity_type: 'asset',
        entity_id: assetId,
        action: 'analysis_failed',
        details: { model: MODEL_NAME, error: analysisFailure },
      });
    }

    // Mirror tags and context into Cloudinary (never blocks the upload)
    try {
      const { data: project } = await supabase
        .from('projects')
        .select('slug')
        .eq('id', projectId)
        .single();

      const mirror = await mirrorAssetToCloudinary({
        publicId: cloudinaryPublicId,
        assetId,
        projectSlug: project?.slug,
        phase: phase || 'unknown',
        activities: analysis.activities,
        scene: analysis.scene,
        locationName: cleanLocation,
        capturedAt: capturedIso,
        model: MODEL_NAME,
        promptVersion: PROMPT_VERSION,
      });

      await supabase.from('audit_events').insert({
        entity_type: 'asset',
        entity_id: assetId,
        action: 'mirror',
        details: { target: 'cloudinary tags + context', ok: mirror.ok, error: mirror.error || null },
      });
    } catch (e) {
      console.error('mirror failed:', e);
    }

    return NextResponse.json({ asset, analysis });
  } catch (error: any) {
    console.error('ingest failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}