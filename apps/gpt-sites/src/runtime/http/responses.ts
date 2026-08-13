export type PublicErrorDetail = {
  code: string;
  message: string;
  recovery: string;
  request_id: string;
};

export function publicErrorResponse(
  code: string,
  message: string,
  recovery: string,
  status: number,
  headers?: HeadersInit,
): Response {
  const requestId = crypto.randomUUID();
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "private, no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("x-request-id", requestId);
  return Response.json(
    {
      detail: {
        code,
        message,
        recovery,
        request_id: requestId,
      } satisfies PublicErrorDetail,
    },
    { status, headers: responseHeaders },
  );
}
