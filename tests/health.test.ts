import { describe, expect, it, vi } from "vitest";

import { createHealthResponse, type HealthResponse } from "@/lib/health";

type Scenario = {
  databaseFails: boolean;
  expectedDatabase: "ok" | "error";
  expectedStatus: "ok" | "degraded";
  expectedStatusCode: 200 | 503;
  expectedStorage: "ok" | "error";
  name: string;
  storageFails: boolean;
};

const scenarios: Scenario[] = [
  {
    name: "reports healthy when both providers succeed",
    databaseFails: false,
    storageFails: false,
    expectedStatusCode: 200,
    expectedStatus: "ok",
    expectedDatabase: "ok",
    expectedStorage: "ok",
  },
  {
    name: "reports degraded when the database fails",
    databaseFails: true,
    storageFails: false,
    expectedStatusCode: 503,
    expectedStatus: "degraded",
    expectedDatabase: "error",
    expectedStorage: "ok",
  },
  {
    name: "reports degraded when storage fails",
    databaseFails: false,
    storageFails: true,
    expectedStatusCode: 503,
    expectedStatus: "degraded",
    expectedDatabase: "ok",
    expectedStorage: "error",
  },
  {
    name: "reports degraded when both providers fail",
    databaseFails: true,
    storageFails: true,
    expectedStatusCode: 503,
    expectedStatus: "degraded",
    expectedDatabase: "error",
    expectedStorage: "error",
  },
];

function checkThat(fails: boolean): () => Promise<void> {
  return fails
    ? vi.fn().mockRejectedValue(new Error("provider internal detail"))
    : vi.fn().mockResolvedValue(undefined);
}

describe("createHealthResponse", () => {
  it.each(scenarios)("$name", async (scenario) => {
    const logError = vi.fn();
    const response = await createHealthResponse(
      {
        database: checkThat(scenario.databaseFails),
        storage: checkThat(scenario.storageFails),
      },
      logError,
    );
    const body = (await response.json()) as HealthResponse;

    expect(response.status).toBe(scenario.expectedStatusCode);
    expect(body).toEqual({
      status: scenario.expectedStatus,
      services: {
        app: "ok",
        database: scenario.expectedDatabase,
        storage: scenario.expectedStorage,
      },
    });
    expect(JSON.stringify(body)).not.toContain("provider internal detail");
  });
});
