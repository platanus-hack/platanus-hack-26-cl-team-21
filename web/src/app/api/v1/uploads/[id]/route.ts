import { connection } from "next/server";
import { getUpload } from "@/lib/api/uploads";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  return getUpload(request, (await params).id);
}
