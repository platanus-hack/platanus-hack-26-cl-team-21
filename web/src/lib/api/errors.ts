export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const invalidRequest = (message: string) => new ApiError(400, "invalid_request", message);

export function errorResponse(error: unknown) {
  if (!(error instanceof ApiError)) console.error("Unexpected participant API error");
  const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", "Unexpected error");
  return Response.json({ error: { code: apiError.code, message: apiError.message } }, { status: apiError.status });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body !== null && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw invalidRequest("Body must be a JSON object");
}

export const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
