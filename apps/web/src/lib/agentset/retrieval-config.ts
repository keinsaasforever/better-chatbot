export function getAgentsetRetrievalMinScore() {
  const parsed = Number(process.env.AGENTSET_RETRIEVAL_MIN_SCORE);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.35;
}

export function getAgentsetRetrievalRerankLimit() {
  const parsed = Number(process.env.AGENTSET_RETRIEVAL_RERANK_LIMIT);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 10) : 5;
}
