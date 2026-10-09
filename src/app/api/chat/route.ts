import { handleChat } from "@/lib/chat-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = (request: Request): Promise<Response> => {
  return handleChat(request);
};

export const OPTIONS = (request: Request): Promise<Response> => {
  return handleChat(request);
};
