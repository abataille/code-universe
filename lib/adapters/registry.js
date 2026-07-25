export class LanguageAdapterRegistry {
  constructor(adapters = []) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  }

  register(adapter) {
    if (!adapter?.id || typeof adapter.scan !== "function") throw new Error("Invalid language adapter.");
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  applicable(detection) {
    const languages = new Set(detection.languages.map((entry) => entry.id));
    return [...this.adapters.values()].filter((adapter) =>
      adapter.languages.some((language) => languages.has(language))
    );
  }

  get(id) {
    return this.adapters.get(id) || null;
  }
}
