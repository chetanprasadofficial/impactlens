import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { embedText } from '@/lib/gemini';
import { cosineSimilarity } from '@/lib/search';

export async function POST(req: NextRequest) {
  try {
    const { query, projectId } = await req.json();

    if (!query || !query.trim()) {
      return NextResponse.json({ results: [] });
    }

    let assetsQuery = supabase
      .from('assets')
      .select('*, asset_analysis(*)')
      .order('uploaded_at', { ascending: false });

    if (projectId) {
      assetsQuery = assetsQuery.eq('project_id', projectId);
    }

    const { data: assets, error } = await assetsQuery;
    if (error) throw error;

    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await embedText(query);
    } catch (e) {
      console.error('embedText failed:', e);
      queryEmbedding = null;
    }

    const queryWords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);

    const scored = (assets || []).map((asset: any) => {
      const analysis = Array.isArray(asset.asset_analysis)
        ? asset.asset_analysis[0]
        : asset.asset_analysis;

      if (!analysis) return { asset, analysis: null, score: 0, matchedBecause: '' };

      let score = 0;
      let matchedBecause = '';

      const haystack = [
        analysis.caption,
        analysis.scene,
        ...(analysis.activities || []),
        ...(analysis.visible_issues || []),
        ...(analysis.objects || []),
      ]
        .join(' ')
        .toLowerCase();

      const matchedWords = queryWords.filter((w: string) => haystack.includes(w));
      if (matchedWords.length > 0) {
        score += 0.3 * (matchedWords.length / queryWords.length);
        matchedBecause = `keyword match (${matchedWords.join(', ')})`;
      }

      if (queryEmbedding && analysis.embedding && Array.isArray(analysis.embedding)) {
        const sim = cosineSimilarity(queryEmbedding, analysis.embedding);
        score += sim;
        if (sim > 0.47 && !matchedBecause) matchedBecause = 'meaning match';
      }

      return { asset, analysis, score, matchedBecause };
    });

    const results = scored
      .filter((r: any) => r.matchedBecause !== '')
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 20);

    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
