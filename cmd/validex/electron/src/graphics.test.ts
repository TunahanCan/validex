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

test("the selected Ozone backend takes precedence over stale environment and argv", () => {
  for (const ozonePlatform of ["x11", "headless"]) {
    const calls: string[] = [];
    equal(configureGraphicsCompatibility({
      commandLine: {
        appendSwitch(name: string) { calls.push(name); },
        getSwitchValue(name: string) {
          return name === "ozone-platform" ? ozonePlatform : "";
        },
      },
    }, {
      arguments: ["validex", "--ozone-platform=wayland"],
      environment: { WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" },
      platform: "linux",
    }), false);
    deepStrictEqual(calls, []);
  }
});

test("an already-selected native Wayland backend gets Vulkan compatibility", () => {
  const calls: [string, string | undefined][] = [];
  equal(configureGraphicsCompatibility({
    commandLine: {
      appendSwitch(name: string, value?: string) { calls.push([name, value]); },
      getSwitchValue(name: string) {
        if (name === "ozone-platform") return "wayland";
        return name === "disable-features" ? "ExistingFeature" : "";
      },
    },
  }, {
    arguments: ["validex"],
    environment: { XDG_SESSION_TYPE: "x11" },
    platform: "linux",
  }), true);
  deepStrictEqual(calls, [
    ["disable-features", "ExistingFeature,Vulkan"],
    ["use-webgpu-adapter", "opengles"],
  ]);
});

test("argument fallback respects the final backend and the option terminator", () => {
  for (const arguments_ of [
    ["validex", "--ozone-platform=wayland", "--ozone-platform=x11"],
    ["validex", "--ozone-platform", "wayland", "--ozone-platform", "headless"],
    ["validex", "--ozone-platform=x11", "--", "--ozone-platform=wayland"],
  ]) {
    equal(requiresWaylandGraphicsFallback({
      arguments: arguments_,
      environment: { XDG_SESSION_TYPE: "wayland" },
      platform: "linux",
    }), false);
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
    ["use-webgpu-adapter", "opengles"],
  ]);
});

test("native Wayland preserves existing disabled Chromium features", () => {
  const calls: [string, string | undefined][] = [];
  const application = {
    commandLine: {
      appendSwitch(name: string, value?: string) {
        calls.push([name, value]);
      },
      getSwitchValue(name: string) {
        return name === "disable-features" ? "ExistingFeature" : "";
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
    ["use-webgpu-adapter", "opengles"],
  ]);
});

test("native Wayland preserves an explicit WebGPU adapter", () => {
  const calls: [string, string | undefined][] = [];
  configureGraphicsCompatibility({
    commandLine: {
      appendSwitch(name: string, value?: string) { calls.push([name, value]); },
      getSwitchValue(name: string) {
        if (name === "ozone-platform") return "wayland";
        return name === "use-webgpu-adapter" ? "vulkan" : "";
      },
    },
  }, { platform: "linux" });
  deepStrictEqual(calls, [["disable-features", "Vulkan"]]);
});
