import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

const validEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "supabase-secret",
  R2_ACCOUNT_ID: "account-id",
  R2_ACCESS_KEY_ID: "r2-access-key",
  R2_SECRET_ACCESS_KEY: "r2-secret-key",
  R2_BUCKET_NAME: "bbc-search-media",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("parseServerEnv", () => {
  it("returns validated environment configuration", () => {
    expect(parseServerEnv(validEnv)).toEqual(validEnv);
  });

  it("names a missing required environment variable", () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        R2_BUCKET_NAME: undefined,
      }),
    ).toThrow(
      "Missing required environment variable: R2_BUCKET_NAME",
    );
  });

  it("never includes a secret value in validation errors", () => {
    const secret = "do-not-leak-this-secret";

    expect(() =>
      parseServerEnv({
        ...validEnv,
        R2_SECRET_ACCESS_KEY: secret,
        SUPABASE_URL: "not-a-url",
      }),
    ).toThrowError(
      expect.not.objectContaining({
        message: expect.stringContaining(secret),
      }),
    );
  });
});
