import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PermissionDecision, PermissionKind } from "@/google/web-host/web-view-port.ts";

import { decideHiddenPagePermission, isGoogleNavigation } from "./policies.ts";

describe("decideHiddenPagePermission", () => {
  test("denies the camera, allows everything else", () => {
    assert.equal(decideHiddenPagePermission(PermissionKind.MICROPHONE), PermissionDecision.ALLOW);
    assert.equal(decideHiddenPagePermission(PermissionKind.CAMERA), PermissionDecision.DENY);
    assert.equal(decideHiddenPagePermission(PermissionKind.OTHER), PermissionDecision.ALLOW);
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
