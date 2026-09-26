import type { CycleDeps } from "../engine/cycle.js";
import { errMsg, log } from "../lib/logger.js";
import { tick } from "./scheduler.js";

export interface WorkerLoop {
  stop(): Promise<void>;
}

/**
 * The scheduler loop, usable as its own process (worker) or inside the web process
 * (RUN_WORKER_IN_WEB=true) so one small server can run everything.
 */
export function startWorkerLoop(deps: CycleDeps, tickSeconds: number): WorkerLoop {
  let stopping = false;
  let wake: (() => void) | undefined;
  const done = (async () => {
    log.info("worker loop started", { market: deps.market.name, tickSeconds });
    while (!stopping) {
      const started = Date.now();
      try {
        await tick(deps);
      } catch (err) {
        log.error("tick failed", { error: errMsg(err) });
      }
      const wait = Math.max(1000, tickSeconds * 1000 - (Date.now() - started));
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, wait);
      });
    }
    log.info("worker loop stopped");
  })();
  return {
    async stop() {
      stopping = true;
      wake?.();
      await done; // finish the current tick before shutting down
    },
  };
}
