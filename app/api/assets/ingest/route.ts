import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { analyzeImage } from '@/lib/gemini';

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
    } = body;

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
        location_source: 'manual',
      })
      .select()
      .single();

    if (assetError) throw assetError;

    let analysis;
    try {
      analysis = await analyzeImage(originalUrl);
    } catch (e) {
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
      model: 'gemini-3.1-flash-lite',
      prompt_version: 'v1',
    });

    if (analysisError) throw analysisError;

    await supabase.from('audit_events').insert({
      entity_type: 'asset',
      entity_id: assetId,
      action: 'upload',
      details: { model: 'gemini-3.1-flash-lite', confidence: analysis.confidence },
    });

    return NextResponse.json({ asset, analysis });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
