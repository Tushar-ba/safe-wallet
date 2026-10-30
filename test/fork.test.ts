import { registrySuite } from "./flow";

// Fork dry-run (FORK=1): uses the canonical Safe v1.4.1 contracts already deployed on Amoy.
import { CANONICAL_AMOY } from "../scripts/addresses";

describe("TxProposalRegistry (Amoy fork, canonical Safe v1.4.1)", () => {
  registrySuite(async () => ({
    singleton: CANONICAL_AMOY.safeSingleton,
    factory: CANONICAL_AMOY.proxyFactory,
    handler: CANONICAL_AMOY.fallbackHandler,
  }));
});
