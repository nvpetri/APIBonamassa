import { RuleError } from "./domain";

export class RateLimitError extends RuleError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      "RATE_LIMITED",
      "Muitas tentativas. Aguarde antes de tentar novamente.",
      429,
    );
  }
}

export function retryAfterSeconds(resetsAt: Date, now = Date.now()) {
  return Math.max(1, Math.ceil((resetsAt.getTime() - now) / 1000));
}
