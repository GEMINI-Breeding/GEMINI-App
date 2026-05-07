/**
 * Unit tests for lib/auth.ts.
 *
 * Scope: token storage, isLoggedIn, logout event bus, 401 interceptor.
 * `login()` wraps UsersService.apiUsersLoginAccessTokenLoginAccessToken,
 * which is a plain axios call under the hood — tested only via a
 * mocked module so we don't talk to a real backend.
 */
import axios, { type AxiosError } from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { UsersService } from "@/client"

import {
  clearToken,
  getToken,
  installAuthInterceptors,
  isLoggedIn,
  login,
  logout,
  onLogout,
  setToken,
} from "./auth"

describe("token storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("reads an empty string when no token is stored", () => {
    expect(getToken()).toBe("")
    expect(isLoggedIn()).toBe(false)
  })

  it("round-trips a token through localStorage", () => {
    setToken("tok-abc")
    expect(getToken()).toBe("tok-abc")
    expect(isLoggedIn()).toBe(true)
  })

  it("clearToken removes the value", () => {
    setToken("tok-abc")
    clearToken()
    expect(getToken()).toBe("")
    expect(isLoggedIn()).toBe(false)
  })

  it("isLoggedIn returns false for an empty string token", () => {
    setToken("")
    expect(isLoggedIn()).toBe(false)
  })
})

describe("logout event bus", () => {
  afterEach(() => {
    localStorage.clear()
  })

  it("logout() clears the token and fires the logout event", () => {
    setToken("before-logout")
    const handler = vi.fn()
    const off = onLogout(handler)
    logout()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getToken()).toBe("")
    off()
  })

  it("onLogout's returned disposer stops further firings", () => {
    const handler = vi.fn()
    const off = onLogout(handler)
    off()
    logout()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("login()", () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("stashes the access_token in localStorage on success", async () => {
    vi.spyOn(
      UsersService,
      "apiUsersLoginAccessTokenLoginAccessToken",
    ).mockResolvedValue({
      access_token: "fresh-jwt",
      token_type: "bearer",
    } as never)
    const token = await login("user@example.com", "secret")
    expect(token).toBe("fresh-jwt")
    expect(getToken()).toBe("fresh-jwt")
  })

  it("throws when the response has no access_token", async () => {
    vi.spyOn(
      UsersService,
      "apiUsersLoginAccessTokenLoginAccessToken",
    ).mockResolvedValue({} as never)
    await expect(login("u", "p")).rejects.toThrow(/no access_token/i)
  })
})

describe("installAuthInterceptors()", () => {
  // We install the axios response interceptor on the global axios
  // instance. Capture it via spying on `axios.interceptors.response.use`
  // so each test can drive the rejection handler directly without
  // actually firing real HTTP.
  let onRejected: ((err: AxiosError) => unknown) | undefined

  beforeEach(() => {
    vi.spyOn(axios.interceptors.response, "use").mockImplementation(
      (_fulfilled, rejected) => {
        onRejected = rejected as typeof onRejected
        return 0
      },
    )
    localStorage.clear()
    setToken("a-token")
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("logs out on a 401 from a non-login endpoint", async () => {
    installAuthInterceptors()
    expect(typeof onRejected).toBe("function")
    const err = {
      response: { status: 401 },
      config: { url: "/api/jobs/all" },
    } as unknown as AxiosError
    await expect(Promise.resolve().then(() => onRejected!(err))).rejects.toBe(
      err,
    )
    expect(getToken()).toBe("")
  })

  it("does NOT log out on a 401 from the login endpoint itself", async () => {
    installAuthInterceptors()
    const err = {
      response: { status: 401 },
      config: { url: "/api/users/login/access-token" },
    } as unknown as AxiosError
    await expect(Promise.resolve().then(() => onRejected!(err))).rejects.toBe(
      err,
    )
    expect(getToken()).toBe("a-token")
  })

  it("ignores non-401 errors", async () => {
    installAuthInterceptors()
    const err = {
      response: { status: 500 },
      config: { url: "/api/jobs/all" },
    } as unknown as AxiosError
    await expect(Promise.resolve().then(() => onRejected!(err))).rejects.toBe(
      err,
    )
    expect(getToken()).toBe("a-token")
  })

  // The OpenAPI.TOKEN resolver is a function value; calling it should
  // return the current token from localStorage.
  it("OpenAPI.TOKEN resolver reads the live token", async () => {
    const { OpenAPI } = await import("@/client/core/OpenAPI")
    installAuthInterceptors()
    setToken("rotated")
    const resolver = OpenAPI.TOKEN
    if (typeof resolver !== "function") throw new Error("expected fn")
    expect(await resolver({} as never)).toBe("rotated")
  })
})
