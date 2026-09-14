import "server-only";

import { z } from "zod";

const requiredValue = z.string().trim().min(1);

const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().trim().url(),
  SUPABASE_SERVICE_ROLE_KEY: requiredValue,
  R2_ACCOUNT_ID: requiredValue,
  R2_ACCESS_KEY_ID: requiredValue,
  R2_SECRET_ACCESS_KEY: requiredValue,
  R2_BUCKET_NAME: requiredValue,
  NEXT_PUBLIC_APP_URL: z.string().trim().url(),
});

export type ServerEnv = Readonly<z.infer<typeof serverEnvSchema>>;

type EnvironmentSource = Record<string, string | undefined>;

export class EnvironmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentConfigurationError";
  }
}

export function parseServerEnv(source: EnvironmentSource): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (result.success) {
    return Object.freeze(result.data);
  }

  const invalidFields = [
    ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
  ].sort();
  const missingFields = invalidFields.filter((field) => !source[field]?.trim());

  if (missingFields.length === 1) {
    throw new EnvironmentConfigurationError(
      `Missing required environment variable: ${missingFields[0]}`,
    );
  }

  if (missingFields.length > 1) {
    throw new EnvironmentConfigurationError(
      `Missing required environment variables: ${missingFields.join(", ")}`,
    );
  }

  throw new EnvironmentConfigurationError(
    `Invalid environment variable${invalidFields.length === 1 ? "" : "s"}: ${invalidFields.join(", ")}`,
  );
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
