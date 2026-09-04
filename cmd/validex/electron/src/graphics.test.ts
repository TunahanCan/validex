import { deepStrictEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  configureGraphicsCompatibility,
  requiresWaylandGraphicsFallback,
} from "./graphics";

test("Linux Wayland sessions require the Vulkan compatibility path", () => {
  for (const environment of [
    { XDG_SESSION_TYPE: "wayland" },
    { WAYLAND_DISPLAY: "wayland-0" },
  ]) {
    equal(
      requiresWaylandGraphicsFallback({
        arguments: ["electron", "/app"],
        environment,
        platform: "linux",
      }),
      true,
    );
  }
});

test("explicit Ozone selections take precedence over session metadata", () => {
  const environment = {
    WAYLAND_DISPLAY: "wayland-0",
    XDG_SESSION_TYPE: "wayland",
  };
  for (const arguments_ of [
    ["electron", "/app", "--ozone-platform=x11"],
    ["electron", "/app", "--ozone-platform", "x11"],
  ]) {
    equal(
      requiresWaylandGraphicsFallback({
        arguments: arguments_,
        environment,
        platform: "linux",
      }),
      false,
    );
  }
  for (const arguments_ of [
    ["electron", "/app", "--ozone-platform=wayland"],
    ["electron", "/app", "--ozone-platform", "wayland"],
  ]) {
    equal(
      requiresWaylandGraphicsFallback({
        arguments: arguments_,
        environment: { XDG_SESSION_TYPE: "x11" },
        platform: "linux",
      }),
      true,
    );
  }
});

test("X11 and non-Linux runtimes retain their graphics defaults", () => {
  for (const options of [
    {
      arguments: ["electron", "/app"],
      environment: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" },
      platform: "linux",
    },
    {
      arguments: ["electron", "/app", "--ozone-platform=wayland"],
      environment: { XDG_SESSION_TYPE: "wayland" },
      platform: "darwin",
    },
    {
      arguments: ["electron", "/app"],
      environment: { XDG_SESSION_TYPE: "wayland" },
      platform: "win32",
    },
  ] as const) {
    equal(requiresWaylandGraphicsFallback(options), false);
  }
});

test("native Wayland disables Vulkan without disabling GPU compositing", () => {
  const calls: [string, string | undefined][] = [];
  const application = {
    commandLine: {
      appendSwitch(name: string, value?: string) {
        calls.push([name, value]);
      },
      getSwitchValue(name: string) {
        return name === "disable-features" ? "ExistingFeature,Vulkan" : "";
      },
    },
  };

  equal(
    configureGraphicsCompatibility(application, {
      arguments: ["electron", "/app"],
      environment: { XDG_SESSION_TYPE: "wayland" },
      platform: "linux",
    }),
    true,
  );
  equal(
    configureGraphicsCompatibility(application, {
      arguments: ["electron", "/app", "--ozone-platform=x11"],
      environment: { XDG_SESSION_TYPE: "wayland" },
      platform: "linux",
    }),
    false,
  );
  deepStrictEqual(calls, [
    ["disable-features", "ExistingFeature,Vulkan"],
  ]);
});

test("native Wayland preserves existing disabled Chromium features", () => {
  const calls: [string, string | undefined][] = [];
  const application = {
    commandLine: {
      appendSwitch(name: string, value?: string) {
        calls.push([name, value]);
      },
      getSwitchValue() {
        return "ExistingFeature";
      },
    },
  };

  configureGraphicsCompatibility(application, {
    arguments: ["electron", "/app"],
    environment: { WAYLAND_DISPLAY: "wayland-0" },
    platform: "linux",
  });
  deepStrictEqual(calls, [
    ["disable-features", "ExistingFeature,Vulkan"],
  ]);
});
