import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const entityId = req.nextUrl.searchParams.get('entity_id');

  if (!entityId) {
    return NextResponse.json({ error: 'entity_id is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('audit_events')
    .select('*')
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data });
}
