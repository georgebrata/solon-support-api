import { handleReply } from "@/lib/internal-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request): Promise<Response> => {
  return handleReply(request);
};
