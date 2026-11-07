import { decideGlicPermission, isGoogleNavigation } from "./policies.ts";
import { PermissionDecision, PermissionKind } from "./web-view-port.ts";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("decideGlicPermission", () => {
  test("allows the microphone, denies the camera, leaves the rest", () => {
    assert.equal(decideGlicPermission(PermissionKind.microphone), PermissionDecision.allow);
    assert.equal(decideGlicPermission(PermissionKind.camera), PermissionDecision.deny);
    assert.equal(decideGlicPermission(PermissionKind.other), PermissionDecision.default);
  });
});

describe("isGoogleNavigation", () => {
  test("allows Google and the blank start page", () => {
    assert.equal(isGoogleNavigation("https://gemini.google.com/glic"), true);
    assert.equal(isGoogleNavigation("https://accounts.google.com/RotateCookies"), true);
    assert.equal(isGoogleNavigation("https://accounts.youtube.com/accounts/SetSID"), true);
    assert.equal(isGoogleNavigation("about:blank"), true);
  });

  test("refuses other hosts, look-alikes and other schemes", () => {
    assert.equal(isGoogleNavigation("https://evil.example/"), false);
    assert.equal(isGoogleNavigation("https://notgoogle.com/"), false);
    assert.equal(isGoogleNavigation("https://google.com.evil.example/"), false);
    assert.equal(isGoogleNavigation("http://gemini.google.com/"), false);
    assert.equal(isGoogleNavigation("file:///c:/secret"), false);
    assert.equal(isGoogleNavigation("not a url"), false);
  });
});
