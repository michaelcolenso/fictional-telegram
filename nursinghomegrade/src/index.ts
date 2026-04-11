import type { Env } from "./types";
import { handleFacility } from "./handlers/facility";
import { handleHome, handleSearch } from "./handlers/home";
import { handleAbout } from "./handlers/about";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/") return handleHome(request, env);
    if (path === "/about") return handleAbout(request, env);
    if (path === "/search") return handleSearch(request, env);
    if (path === "/sitemap.xml") {
      const sitemap = await env.CACHE.get("sitemap");
      if (sitemap)
        return new Response(sitemap, {
          headers: { "Content-Type": "application/xml" },
        });
      return new Response("Sitemap not found", { status: 404 });
    }

    if (path === "/robots.txt")
      return new Response("User-agent: *\nAllow: /\nSitemap: https://nursinghomegrade.com/sitemap.xml\n", {
        headers: { "Content-Type": "text/plain" },
      });

    const facilityMatch = path.match(/^\/facility\/([a-z0-9-]+)$/);
    if (facilityMatch?.[1]) return handleFacility(request, env, facilityMatch[1]);

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Weekly: invalidate home page cache so pct_failing stat refreshes
    await env.CACHE.delete("page:home");
    console.log("Scheduled: home cache cleared");
  },
} satisfies ExportedHandler<Env>;
