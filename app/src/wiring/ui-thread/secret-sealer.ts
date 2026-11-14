import { userSecret } from "@/core/secret/user-secret.ts";
import type { SecretSealer } from "@/google/ports.ts";

// Seals what the UI thread keeps on disk (the Google session) to this Windows user
export const sealer: SecretSealer = {
  seal: plain => Promise.resolve(userSecret.seal({ plain })),
  unseal: sealed => Promise.resolve(userSecret.unseal({ sealed }))
};
