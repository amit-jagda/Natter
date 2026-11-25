import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage in Node/Vitest environment
const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = String(value);
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  },
  length: 0,
  key: () => null,
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

import { apiClient } from "@/lib/api-client";

describe("API Client Auth & Token Lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores and retrieves access and refresh tokens from localStorage", () => {
    expect(apiClient.getToken()).toBeNull();
    expect(apiClient.getRefreshToken()).toBeNull();

    const sampleAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sample.access";
    const sampleRefreshToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sample.refresh";

    apiClient.setToken(sampleAccessToken);
    apiClient.setRefreshToken(sampleRefreshToken);

    expect(apiClient.getToken()).toBe(sampleAccessToken);
    expect(apiClient.getRefreshToken()).toBe(sampleRefreshToken);
    expect(localStorage.getItem("auth_token")).toBe(sampleAccessToken);
    expect(localStorage.getItem("access_token")).toBe(sampleAccessToken);
    expect(localStorage.getItem("refresh_token")).toBe(sampleRefreshToken);
  });

  it("removes both access and refresh tokens from localStorage on removeToken", () => {
    apiClient.setToken("token-to-delete");
    apiClient.setRefreshToken("refresh-to-delete");
    expect(apiClient.getToken()).toBe("token-to-delete");
    expect(apiClient.getRefreshToken()).toBe("refresh-to-delete");

    apiClient.removeToken();
    expect(apiClient.getToken()).toBeNull();
    expect(apiClient.getRefreshToken()).toBeNull();
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("access_token")).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
  });

  it("calls /api/v1/auth/refresh with credentials: 'include', request body, and rotates both tokens on success", async () => {
    apiClient.setRefreshToken("existing-refresh-token");

    const mockAccessToken = "new-refreshed-jwt-access-token";
    const mockRefreshToken = "new-rotated-jwt-refresh-token";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: mockAccessToken,
        refresh_token: mockRefreshToken,
        token_type: "bearer",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await apiClient.refreshToken();

    expect(result).toBe(mockAccessToken);
    expect(apiClient.getToken()).toBe(mockAccessToken);
    expect(apiClient.getRefreshToken()).toBe(mockRefreshToken);
    expect(localStorage.getItem("auth_token")).toBe(mockAccessToken);
    expect(localStorage.getItem("access_token")).toBe(mockAccessToken);
    expect(localStorage.getItem("refresh_token")).toBe(mockRefreshToken);

    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/auth/refresh", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ refresh_token: "existing-refresh-token" }),
    }));
  });

  it("handles failed refresh gracefully and clears localStorage", async () => {
    apiClient.setToken("stale-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Refresh token expired" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await apiClient.refreshToken();

    expect(result).toBeNull();
    expect(apiClient.getToken()).toBeNull();
  });

  it("calls /api/v1/auth/logout with credentials: 'include' and clears localStorage", async () => {
    apiClient.setToken("active-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "success" }), { status: 200 })
    );

    await apiClient.logout();

    expect(apiClient.getToken()).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/auth/logout", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }));
  });
});
