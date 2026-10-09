import { handleGetJob } from "@/lib/internal-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request): Promise<Response> => {
  return handleGetJob(request);
};
