export interface GraphicsCompatibilityController {
  commandLine: {
    appendSwitch(name: string, value?: string): void;
    getSwitchValue(name: string): string;
  };
}

export interface GraphicsCompatibilityOptions {
  arguments?: readonly string[];
  environment?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
}

function commandLineValue(
  arguments_: readonly string[],
  name: string,
): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument?.startsWith(prefix)) {
      const value = argument.slice(prefix.length).trim();
      return value === "" ? undefined : value;
    }
    if (argument === exact) {
      const value = arguments_[index + 1]?.trim();
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}

/**
 * Electron can select native Wayland automatically from the desktop session.
 * An explicit X11 selection always takes precedence over that metadata.
 */
export function requiresWaylandGraphicsFallback({
  arguments: arguments_ = process.argv,
  environment = process.env,
  platform = process.platform,
}: GraphicsCompatibilityOptions = {}): boolean {
  if (platform !== "linux") return false;

  const ozonePlatform = commandLineValue(
    arguments_,
    "ozone-platform",
  )?.toLowerCase();
  if (ozonePlatform === "x11") return false;
  if (ozonePlatform === "wayland") return true;

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
 * Chromium 150 can select an incompatible Vulkan path on native Wayland.
 * Disable only Vulkan instead of disabling GPU compositing altogether.
 */
export function configureGraphicsCompatibility(
  application: GraphicsCompatibilityController,
  options: GraphicsCompatibilityOptions = {},
): boolean {
  if (!requiresWaylandGraphicsFallback(options)) return false;
  const disabledFeatures = withDisabledFeature(
    application.commandLine.getSwitchValue("disable-features"),
    "Vulkan",
  );
  application.commandLine.appendSwitch(
    "disable-features",
    disabledFeatures,
  );
  return true;
}
