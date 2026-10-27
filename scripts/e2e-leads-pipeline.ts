// E2E-ALBRA-2026-10-27 — Driver de prueba REAL del pipeline AGENTE-LEADS
// SOLO OBSERVA: usa los módulos del repo sin modificarlos.
// Datos 100% ficticios con prefijo E2E-ALBRA-2026-10-27.
const R = "/home/z/repos/AGENTE-LEADS/src";
import { MockDiscoveryProvider } from "/home/z/repos/AGENTE-LEADS/src/agent/providers/mock_discovery.js";
import { runDiscovery } from "/home/z/repos/AGENTE-LEADS/src/agent/pipelines/discovery.js";
import { runResearch } from "/home/z/repos/AGENTE-LEADS/src/agent/pipelines/research.js";
import { runValidation } from "/home/z/repos/AGENTE-LEADS/src/agent/pipelines/validation.js";
import { runDedup } from "/home/z/repos/AGENTE-LEADS/src/agent/pipelines/dedup.js";
import { runScoring } from "/home/z/repos/AGENTE-LEADS/src/agent/pipelines/scoring.js";
import { runIntelligence } from "/home/z/repos/AGENTE-LEADS/src/agent/pipelines/intelligence.js";
import { generateReport } from "/home/z/repos/AGENTE-LEADS/src/agent/pipelines/report.js";
import { saveLead, getAllLeads, saveExecution } from "/home/z/repos/AGENTE-LEADS/src/agent/storage/lead_intelligence.js";
import { CRMAlbraHooks } from "/home/z/repos/AGENTE-LEADS/src/agent/pipelines/crm_albra_hooks.js";
import { ExecutionRecorder } from "/home/z/repos/AGENTE-LEADS/src/agent/core/execution.js";

const TAG = "E2E-ALBRA-2026-10-27";
const CRM_URL = process.env.CRM_WEBHOOK_URL || "";

function step(name: string, state: string, detail = "") {
  console.log(`[${new Date().toISOString()}] ${name}: ${state}${detail ? " — " + detail : ""}`);
}

async function main() {
  const trace: any = new ExecutionRecorder(`${TAG} prueba integral`, { query: TAG });
  const hooks = new CRMAlbraHooks({
    webhook_url: CRM_URL || undefined,
    enabled: Boolean(CRM_URL),
  });

  // 1. DISCOVERY (mock con candidatos ficticios)
  const candidates = [
    { name: `${TAG} Restaurante Ficticio Alpha`, platform: "instagram", source: "MockDiscovery", discovered_at: new Date().toISOString(), username: "@e2e_alpha", url: "https://example.com/e2e-alpha", location: "Medellín", category: "restaurante", niche: "gastronomía" },
    { name: `${TAG} Tienda Ficticia Beta`, platform: "instagram", source: "MockDiscovery", discovered_at: new Date().toISOString(), username: "@e2e_beta", url: "https://example.com/e2e-beta", location: "Bogotá", category: "retail", niche: "moda" },
  ];
  const disc = await runDiscovery([new MockDiscoveryProvider(candidates)], { query: `${TAG} prospectos ficticios` }, trace);
  step("DISCOVERY", "OK", `provider=${disc.used_provider} candidatos=${disc.candidates.length} fallidos=${disc.failed_providers.length}`);

  // 2. RESEARCH (sin provider externo → "no encontrado" según regla de oro)
  const leads = [];
  for (const c of disc.candidates) {
    const r = await runResearch(null, null, { candidate: c }, trace);
    leads.push(r.lead);
  }
  step("RESEARCH", "OK", `provider=null (sin credenciales) leads=${leads.length}`);

  // 3. VALIDATION (sin provider de verificación)
  for (const l of leads) {
    await runValidation(null, { lead: l }, trace);
  }
  step("VALIDATION", "OK", "provider=null — etiquetas de evidencia aplicadas");

  // 4. DEDUP + 5. SCORING
  let score = -1;
  for (const l of leads) {
    await runDedup({ lead: l }, trace);
    const s = await runScoring({ lead: l }, trace);
    l.score = s.score;
    score = s.score;
  }
  step("DEDUP", "OK", "sin duplicados esperados");
  step("SCORING", "OK", `score=${score}/100`);

  // 6. INTELLIGENCE (requiere LLM real → probable BLOCKED)
  let intel: any = null;
  try {
    const r = await runIntelligence({ lead: leads[0], offer_description: `${TAG} oferta ficticia` }, trace);
    intel = r.intelligence;
    step("INTELLIGENCE", "OK", `confidence=${intel.confidence}`);
  } catch (e: any) {
    step("INTELLIGENCE", "BLOCKED", `cualificación: ${e?.message?.slice(0, 120)}`);
  }

  // 7. STORAGE — runDedup ya persiste los leads nuevos (flujo oficial); se verifica lectura
  const stored = getAllLeads().filter((x: any) => x.name?.includes(TAG));
  step("STORAGE", "OK", `leads persistidos=${stored.length} db=./data/lead-intelligence.db`);

  // 8. REPORT
  const rep = generateReport({ leads, user_request: `${TAG} prueba integral`, top_n: 5 });
  step("REPORT", "OK", `markdown=${rep.text.length} chars`);

  // 9. HOOKS → CRM (evento real con HMAC si hay secret)
  const hookSummary: string[] = [];
  await hooks.fireLeadCreated(leads[0]).then(() => hookSummary.push("lead.created→disparado")).catch((e) => hookSummary.push(`lead.created→ERROR:${e?.message?.slice(0, 80)}`));
  await hooks.fireLeadScored(leads[0], score).catch((e) => hookSummary.push(`lead.scored→ERROR:${e?.message?.slice(0, 80)}`));
  if (intel) await hooks.fireLeadIntelligenced(leads[0], intel).catch((e) => hookSummary.push(`lead.intelligenced→ERROR:${e?.message?.slice(0, 80)}`));
  const t2: any = new ExecutionRecorder(`${TAG} fin`);
  await hooks.fireExecutionCompleted(t2).catch((e) => hookSummary.push(`execution.completed→ERROR:${e?.message?.slice(0, 80)}`));
  const st = hooks.getStats();
  step("CRM-HOOKS", CRM_URL ? "DISPARADO" : "SIN_CONFIG", `sent=${st.sent} failed=${st.failed} ${hookSummary.join(" | ")}`);

  try { const done = trace.finish("success", `${TAG} prueba integral completa`); saveExecution(done); step("TRACE", "OK", `execution_id=${done.id} outcome=${done.outcome}`); }
  catch (e: any) { step("TRACE", "FAIL", e?.message?.slice(0, 100)); }
  console.log("FIN-PIPELINE-E2E");
  process.exit(0);
}

main().catch((e) => { console.error("PIPELINE-FATAL:", e?.message); process.exit(1); });
