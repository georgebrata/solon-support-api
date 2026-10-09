import { handleHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = (): Response => {
  return handleHealth();
};
