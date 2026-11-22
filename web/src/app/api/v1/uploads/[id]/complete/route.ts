import { connection } from "next/server";
import { completeUpload } from "@/lib/api/uploads";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  return completeUpload(request, (await params).id);
}
