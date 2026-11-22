import { connection } from "next/server";
import { createUpload } from "@/lib/api/uploads";

export async function POST(request: Request) {
  await connection();
  return createUpload(request);
}
