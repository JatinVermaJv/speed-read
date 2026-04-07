type CooldownEntry = {
  untilMs: number;
};

const cooldownByModel = new Map<string, CooldownEntry>();

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
const MIN_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

function clampCooldownMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, Math.floor(ms)));
}

function getCooldownRemainingMs(model: string, nowMs: number): number | undefined {
  const entry = cooldownByModel.get(model);
  if (!entry) return undefined;

  const remaining = entry.untilMs - nowMs;
  if (remaining <= 0) {
    cooldownByModel.delete(model);
    return undefined;
  }

  return remaining;
}

export function filterModelsForCooldown(models: string[], nowMs = Date.now()): string[] {
  const available = models.filter((model) => getCooldownRemainingMs(model, nowMs) === undefined);
  return available.length > 0 ? available : models;
}

export function getModelCooldownRemainingMs(model: string, nowMs = Date.now()): number | undefined {
  return getCooldownRemainingMs(model, nowMs);
}

export function markModelRateLimited(
  model: string,
  retryAfterSeconds?: number,
  nowMs = Date.now()
): void {
  const retryAfterMs =
    typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : DEFAULT_RATE_LIMIT_COOLDOWN_MS;

  cooldownByModel.set(model, { untilMs: nowMs + clampCooldownMs(retryAfterMs) });
}
