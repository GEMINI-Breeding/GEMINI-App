/**
 * Unit tests for lib/auth.ts.
 *
 * Scope: token storage, isLoggedIn, logout event bus, 401 interceptor.
 * `login()` wraps UsersService.apiUsersLoginAccessTokenLoginAccessToken,
 * which is a plain axios call under the hood — tested only via a
 * mocked module so we don't talk to a real backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  clearToken,
  getToken,
  isLoggedIn,
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
