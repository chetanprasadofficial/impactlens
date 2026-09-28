import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { compareImages } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const { beforeAssetId, afterAssetId } = await req.json();

    if (!beforeAssetId || !afterAssetId) {
      return NextResponse.json({ error: 'Both asset IDs are required' }, { status: 400 });
    }

    const { data: assets, error } = await supabase
      .from('assets')
      .select('id, original_url')
      .in('id', [beforeAssetId, afterAssetId]);

    if (error) throw error;

    const beforeAsset = assets?.find((a: any) => a.id === beforeAssetId);
    const afterAsset = assets?.find((a: any) => a.id === afterAssetId);

    if (!beforeAsset || !afterAsset) {
      return NextResponse.json({ error: 'One or both assets not found' }, { status: 404 });
    }

    const comparison = await compareImages(beforeAsset.original_url, afterAsset.original_url);

    await supabase.from('audit_events').insert({
      entity_type: 'comparison',
      entity_id: `${beforeAssetId}__${afterAssetId}`,
      action: 'compare',
      details: { beforeAssetId, afterAssetId, confidence: comparison.confidence },
    });

    return NextResponse.json({ comparison });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
