import cron, { type ScheduledTask } from "node-cron";
import { listTriggers } from "../../config/appStore.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { runTriggerWindow } from "./TriggerService.js";

type JobKey = string;

class TriggerScheduler {
  private jobs = new Map<JobKey, ScheduledTask>();
  private started = false;

  start(): void {
    if (this.started) {
      this.resync();
      return;
    }
    this.started = true;
    this.resync();
    logger.info({ operation: "trigger-scheduler" }, "Trigger scheduler started");
  }

  stop(): void {
    for (const task of this.jobs.values()) {
      task.stop();
    }
    this.jobs.clear();
    this.started = false;
  }

  resync(): void {
    const desired = new Map<JobKey, { triggerId: string; windowId: string; cron: string; timezone: string }>();
    for (const trigger of listTriggers()) {
      if (trigger.status !== "active") continue;
      for (const window of trigger.windows) {
        const key = `${trigger.id}:${window.id}`;
        desired.set(key, {
          triggerId: trigger.id,
          windowId: window.id,
          cron: window.schedule.cron,
          timezone: window.schedule.timezone || env.timezone
        });
      }
    }

    for (const [key, task] of this.jobs) {
      if (!desired.has(key)) {
        task.stop();
        this.jobs.delete(key);
      }
    }

    for (const [key, spec] of desired) {
      const existing = this.jobs.get(key);
      if (existing) {
        // Recreate to pick up cron/timezone changes
        existing.stop();
        this.jobs.delete(key);
      }
      if (!cron.validate(spec.cron)) {
        logger.warn(
          { triggerId: spec.triggerId, windowId: spec.windowId, cron: spec.cron },
          "Invalid cron expression; window not scheduled"
        );
        continue;
      }
      const task = cron.schedule(
        spec.cron,
        () => {
          void runTriggerWindow({
            triggerId: spec.triggerId,
            windowId: spec.windowId,
            sendEmail: true,
            dryRun: false
          }).catch((error) => {
            logger.warn(
              {
                triggerId: spec.triggerId,
                windowId: spec.windowId,
                message: error instanceof Error ? error.message : "run failed"
              },
              "Scheduled trigger run failed"
            );
          });
        },
        { timezone: spec.timezone }
      );
      this.jobs.set(key, task);
    }

    logger.info({ jobs: this.jobs.size, operation: "trigger-scheduler-resync" }, "Trigger jobs resynced");
  }
}

export const triggerScheduler = new TriggerScheduler();
