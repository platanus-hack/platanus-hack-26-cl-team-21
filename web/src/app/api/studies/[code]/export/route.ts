import { connection, type NextRequest } from "next/server";
import { runExport } from "@/lib/export/build";
import { parseExportRequest } from "@/lib/export/params";
import { findExportStudy, listParticipantPseudonyms } from "@/lib/export/queries";

// Generates a study export on demand and returns it as a download. POST because every export is
// recorded (exports + audit_log): it must never run from a prefetch or a crawler.
// Body: form data with format (csv|json), dataset (observations|coverage_intervals|both) and the
// optional participant, from and to (YYYY-MM-DD, participant local days).
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studies/[code]/export">) {
  await connection();
  const { code } = await ctx.params;
  // Body parsing and the study lookup are independent: run them together.
  const [study, form] = await Promise.all([findExportStudy(code), request.formData().catch(() => null)]);
  if (!study) return Response.json({ error: "Estudio no encontrado." }, { status: 404 });
  if (!form) return Response.json({ error: "La solicitud debe enviarse como formulario." }, { status: 400 });

  const parsed = parseExportRequest(form, await listParticipantPseudonyms(study.id));
  if (!parsed.ok) return Response.json({ error: parsed.message }, { status: 400 });

  const file = await runExport(study, parsed.request);
  return new Response(file.body as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Content-Length": String(file.body.byteLength),
      "Cache-Control": "no-store",
      "X-Export-Id": file.exportId,
      "X-Content-SHA256": file.sha256,
    },
  });
}
