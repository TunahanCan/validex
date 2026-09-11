export interface GraphicsCompatibilityController {
  commandLine: {
    appendSwitch(name: string, value?: string): void;
    getSwitchValue(name: string): string;
  };
}

export interface GraphicsCompatibilityOptions {
  arguments?: readonly string[];
  environment?: Readonly<Record<string, string | undefined>>;
  /** Backend already selected by Electron before application startup. */
  ozonePlatform?: string;
  platform?: NodeJS.Platform;
}

function commandLineValue(
  arguments_: readonly string[],
  name: string,
): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  let selectedValue: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") break;
    if (argument?.startsWith(prefix)) {
      const value = argument.slice(prefix.length).trim();
      selectedValue = value === "" ? undefined : value;
    }
    if (argument === exact) {
      const value = arguments_[index + 1]?.trim();
      selectedValue = !value || value.startsWith("--") ? undefined : value;
    }
  }
  return selectedValue;
}

/**
 * Electron can select native Wayland automatically from the desktop session.
 * An explicit X11 selection always takes precedence over that metadata.
 */
export function requiresWaylandGraphicsFallback({
  arguments: arguments_ = process.argv,
  environment = process.env,
  ozonePlatform: selectedPlatform,
  platform = process.platform,
}: GraphicsCompatibilityOptions = {}): boolean {
  if (platform !== "linux") return false;

  const ozonePlatform = (
    selectedPlatform || commandLineValue(arguments_, "ozone-platform")
  )?.trim().toLowerCase();
  if (ozonePlatform && ozonePlatform !== "auto") {
    return ozonePlatform === "wayland";
  }

  return (
    environment.XDG_SESSION_TYPE?.trim().toLowerCase() === "wayland" ||
    Boolean(environment.WAYLAND_DISPLAY?.trim())
  );
}

function withDisabledFeature(value: string, feature: string): string {
  const features = value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== "");
  if (!features.includes(feature)) features.push(feature);
  return features.join(",");
}

/**
 * Electron selects Ozone before loading the main script. Use that backend
 * instead of inferring native Wayland from session metadata under XWayland.
 * Chromium 150 can initialize Vulkan through WebGPU/GL interop even when the
 * Vulkan feature is disabled. Select its OpenGL ES adapter on native Wayland
 * so GPU compositing and compositor presentation feedback stay enabled.
 */
export function configureGraphicsCompatibility(
  application: GraphicsCompatibilityController,
  options: GraphicsCompatibilityOptions = {},
): boolean {
  if (!requiresWaylandGraphicsFallback({
    ...options,
    ozonePlatform:
      application.commandLine.getSwitchValue("ozone-platform") ||
      options.ozonePlatform,
  })) return false;
  const disabledFeatures = withDisabledFeature(
    application.commandLine.getSwitchValue("disable-features"),
    "Vulkan",
  );
  application.commandLine.appendSwitch(
    "disable-features",
    disabledFeatures,
  );
  if (!application.commandLine.getSwitchValue("use-webgpu-adapter")) {
    application.commandLine.appendSwitch("use-webgpu-adapter", "opengles");
  }
  return true;
}
