export type ServiceStatus = "ok" | "error";

export type HealthResponse = {
  status: "ok" | "degraded";
  services: {
    app: "ok";
    database: ServiceStatus;
    storage: ServiceStatus;
  };
};

type HealthChecks = {
  database: () => Promise<void>;
  storage: () => Promise<void>;
};

type ErrorLogger = (message: string) => void;

function safeErrorIdentifier(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "UnknownError";
  }

  for (const key of ["code", "name"] as const) {
    const value = Reflect.get(error, key);

    if (typeof value === "string" && /^[a-z0-9_.-]+$/i.test(value)) {
      return value;
    }
  }

  return "UnknownError";
}

export async function createHealthResponse(
  checks: HealthChecks,
  logError: ErrorLogger = console.error,
): Promise<Response> {
  const [databaseResult, storageResult] = await Promise.allSettled([
    checks.database(),
    checks.storage(),
  ]);

  const database = databaseResult.status === "fulfilled" ? "ok" : "error";
  const storage = storageResult.status === "fulfilled" ? "ok" : "error";

  if (databaseResult.status === "rejected") {
    logError(
      `Database health check failed: ${safeErrorIdentifier(databaseResult.reason)}`,
    );
  }

  if (storageResult.status === "rejected") {
    logError(
      `R2 health check failed: ${safeErrorIdentifier(storageResult.reason)}`,
    );
  }

  const healthy = database === "ok" && storage === "ok";
  const body: HealthResponse = {
    status: healthy ? "ok" : "degraded",
    services: {
      app: "ok",
      database,
      storage,
    },
  };

  return Response.json(body, { status: healthy ? 200 : 503 });
}
