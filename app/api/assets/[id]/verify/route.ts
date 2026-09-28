import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const verified = body.verified !== false; // default: verify

  const { error } = await supabase
    .from("assets")
    .update({ verified, verified_by: verified ? "analyst" : null })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_events").insert({
    entity_type: "asset",
    entity_id: id,
    action: "verify",
    details: { verified },
    actor: "analyst",
  });

  return NextResponse.json({ ok: true, verified });
}
