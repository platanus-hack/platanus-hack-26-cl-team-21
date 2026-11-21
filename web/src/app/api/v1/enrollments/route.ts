import { connection } from "next/server";
import { enroll } from "@/lib/api/enrollments";

export async function POST(request: Request) {
  await connection();
  return enroll(request);
}
