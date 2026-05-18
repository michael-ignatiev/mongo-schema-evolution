export class ConfigNotFoundError extends Error {
  constructor(configPath: string) {
    super(`Config file not found: ${configPath}`);
    this.name = "ConfigNotFoundError";
  }
}

export class ConfigAlreadyExistsError extends Error {
  constructor(configPath: string) {
    super(`Config file already exists: ${configPath}`);
    this.name = "ConfigAlreadyExistsError";
  }
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
