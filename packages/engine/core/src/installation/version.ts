declare global {
  const MOKS_VERSION: string
  const MOKS_CHANNEL: string
}

export const InstallationVersion = typeof MOKS_VERSION === "string" ? MOKS_VERSION : "local"
export const InstallationChannel = typeof MOKS_CHANNEL === "string" ? MOKS_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
