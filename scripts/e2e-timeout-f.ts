// E2E-ALBRA-2026-10-27 — Test F: timeout del bridge contra host colgado
process.env.ALBRA_AGENT_URL = "http://127.0.0.1:9999";
const t0 = Date.now();
const m = await import("/home/z/my-project/src/lib/albra-agent-bridge.ts");
const r = await m.checkAgentHealth(true);
console.log("bridge health con host colgado →", JSON.stringify({ online: r.online, error: (r.error || "").slice(0, 80), ms: Date.now() - t0 }));
process.exit(0);
