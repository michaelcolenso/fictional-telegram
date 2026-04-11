import type { Env } from "./types";

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response("NursingHomeGrade coming soon", { status: 200 });
  },

  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Weekly cache invalidation — implemented in Task 8
  },
} satisfies ExportedHandler<Env>;
