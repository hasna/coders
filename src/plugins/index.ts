export { PluginManifestSchema, type PluginManifest, type InstalledPlugin, type PluginSource } from "./manifest.js";
export { loadPlugins, getLoadedPlugins, getPlugin, discoverPlugins, enablePlugin, disablePlugin, resetPlugins, BUILTIN_PLUGINS } from "./loader.js";
export { getMarketplaces, addMarketplace, removeMarketplace, installFromMarketplace, installFromSource, installFromGit, installFromDirectory, uninstallPlugin, type Marketplace, type InstallResult } from "./marketplace.js";
