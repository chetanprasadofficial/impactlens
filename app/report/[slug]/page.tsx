import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase"; // <-- adjust to your lib/db.ts export
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const thumb = (url: string, w = 480, h = 320) =>
  url.replace("/upload/", `/upload/c_fill,g_auto,w_${w},h_${h},q_auto,f_auto/`);

const fmt = (d?: string | null) => (d ? d.slice(0, 10) : "unknown");

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ verified?: string; from?: string; to?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const verifiedOnly = sp.verified === "1";

  const { data: project } = await supabase
    .from("projects").select("*").eq("slug", slug).single();
  if (!project) notFound();

  const { data: rows } = await supabase
    .from("assets").select("*").eq("project_id", project.id)
    .order("captured_at", { ascending: true });

  const when = (a: any) => a.captured_at ?? a.uploaded_at;
  const assets = (rows ?? [])
    .filter((a: any) => !verifiedOnly || a.verified)
    .filter((a: any) => {
      const d = fmt(when(a));
      if (sp.from && d < sp.from) return false;
      if (sp.to && d > sp.to) return false;
      return true;
    });

  const ids = assets.map((a: any) => a.id);
  const { data: an } = ids.length
    ? await supabase.from("asset_analysis").select("*").in("asset_id", ids)
    : { data: [] as any[] };
  const analysis: Record<string, any> = {};
  (an ?? []).forEach((r: any) => (analysis[r.asset_id] = r));

  // ---- metrics (exact, from DB) ----
  const verifiedCount = assets.filter((a: any) => a.verified).length;
  const phases: Record<string, number> = {};
  const byActivity: Record<string, string[]> = {};
  const estimates: Record<string, number> = {};
  const locations = new Set<string>();
  assets.forEach((a: any) => {
    phases[a.phase ?? "unknown"] = (phases[a.phase ?? "unknown"] ?? 0) + 1;
    if (a.location_name) locations.add(a.location_name);
    const r = analysis[a.id];
    (r?.activities ?? []).forEach((act: string) => {
      (byActivity[act] ??= []).push(a.id);
    });
    Object.entries(r?.estimated_counts ?? {}).forEach(([k, v]) => {
      if (typeof v === "number") estimates[k] = (estimates[k] ?? 0) + v;
    });
  });
  const activityRows = Object.entries(byActivity).sort((x, y) => y[1].length - x[1].length);
  const dates = assets.map((a: any) => fmt(when(a))).filter((d: string) => d !== "unknown").sort();
  const first = dates[0], last = dates[dates.length - 1];
  const models = [...new Set((an ?? []).map((r: any) => `${r.model} (${r.prompt_version})`))];

  // ---- narrative: only cites IDs that exist ----
  const cite = (list: string[]) => list.slice(0, 3).map((i) => `[${i}]`).join(", ");
  const narrative: string[] = [];
  if (assets.length === 0) {
    narrative.push("No evidence matches the selected filters.");
  } else {
    narrative.push(
      `${project.name} has ${assets.length} evidence item${assets.length > 1 ? "s" : ""} in this report` +
        `${first ? `, captured between ${first} and ${last}` : ""}. ` +
        `${verifiedCount} of ${assets.length} have been verified by a human reviewer.`
    );
    activityRows.slice(0, 3).forEach(([act, list]) =>
      narrative.push(`${act.replace(/_/g, " ")} appears in ${list.length} asset${list.length > 1 ? "s" : ""}, for example ${cite(list)}.`)
    );
    const b = assets.find((a: any) => a.phase === "before");
    const af = [...assets].reverse().find((a: any) => a.phase === "after");
    if (b && af) narrative.push(`Before/after evidence: [${b.id}] (before) and [${af.id}] (after).`);
  }

  return (
    <main className="mx-auto max-w-5xl p-6 text-gray-900 bg-white">
      <div className="print:hidden mb-6 flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-3">
          <label className="text-sm">From<input type="date" name="from" defaultValue={sp.from} className="block border rounded px-2 py-1" /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={sp.to} className="block border rounded px-2 py-1" /></label>
          <label className="text-sm flex items-center gap-2 pb-1">
            <input type="checkbox" name="verified" value="1" defaultChecked={verifiedOnly} /> Verified evidence only
          </label>
          <button className="border rounded px-3 py-1">Apply</button>
        </form>
        <PrintButton />
      </div>

      <h1 className="text-3xl font-bold">{project.name}: Impact Report</h1>
      <p className="text-sm text-gray-600 mt-1">
        Generated {new Date().toISOString().slice(0, 10)}
        {verifiedOnly && " · Verified evidence only"}
        {sp.from && ` · from ${sp.from}`}{sp.to && ` · to ${sp.to}`}
        {" · Sample data where labelled"}
      </p>
      {project.description && <p className="mt-2">{project.description}</p>}

      <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Evidence items", assets.length],
          ["Verified", verifiedCount],
          ["Locations", locations.size],
          ["Before / After", `${phases.before ?? 0} / ${phases.after ?? 0}`],
        ].map(([k, v]) => (
          <div key={String(k)} className="border rounded p-3">
            <div className="text-2xl font-semibold">{v}</div>
            <div className="text-xs text-gray-600">{k}</div>
          </div>
        ))}
      </section>

      <h2 className="mt-8 text-xl font-semibold">Summary</h2>
      {narrative.map((t, i) => <p key={i} className="mt-2">{t}</p>)}

      <h2 className="mt-8 text-xl font-semibold">Activity breakdown</h2>
      <p className="text-xs text-gray-600">Number of assets showing each activity (not objects counted inside them).</p>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {activityRows.map(([act, list]) => (
            <tr key={act} className="border-b">
              <td className="py-1">{act.replace(/_/g, " ")}</td>
              <td className="py-1 w-16 text-right">{list.length}</td>
              <td className="py-1 pl-4 text-gray-500">{cite(list)}{list.length > 3 ? ", …" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {Object.keys(estimates).length > 0 && (
        <div className="mt-6 border border-amber-400 bg-amber-50 rounded p-3 text-sm">
          <b>AI estimates, unverified:</b>{" "}
          {Object.entries(estimates).map(([k, v]) => `${k}: ~${v}`).join(" · ")}
          <div className="text-xs text-gray-600 mt-1">Vision models are unreliable at exact counting. Do not treat these as measured facts.</div>
        </div>
      )}

      <h2 className="mt-8 text-xl font-semibold">Evidence</h2>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-4">
        {assets.map((a: any) => {
          const r = analysis[a.id];
          const low = r && Number(r.confidence) < 0.6;
          return (
            <figure key={a.id} className="border rounded overflow-hidden break-inside-avoid">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb(a.original_url)} alt={r?.caption ?? a.id} className="w-full" />
              <figcaption className="p-2 text-xs space-y-1">
                <div className="font-semibold">
                  [{a.id}] {a.phase ?? "unknown"} · {fmt(when(a))}
                  {a.verified ? " · ✔ verified" : ""}{low ? " · needs review" : ""}
                </div>
                <div>{r?.caption ?? "No analysis yet"}</div>
                <div className="text-gray-500">{a.location_name ?? "Location unknown"}</div>
                <a href={a.original_url} className="text-blue-700 underline print:no-underline" target="_blank">Original asset</a>
              </figcaption>
            </figure>
          );
        })}
      </div>

      <h2 className="mt-8 text-xl font-semibold">Methodology and traceability</h2>
      <p className="mt-2 text-sm">
        Images are stored and delivered by Cloudinary; originals are never overwritten. Thumbnails here are
        Cloudinary URL transformations (fill crop, auto gravity, auto quality and format), so the original
        of every image is linked. Captions, activities and estimates were produced by: {models.join(", ") || "n/a"}.
        Metrics are computed directly from the database; AI counts are estimates.
      </p>
    </main>
  );
}