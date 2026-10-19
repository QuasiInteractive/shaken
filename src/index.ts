// Library entry: run inspections from your own code.
export { loadConfig, ConfigError, type Config, type Item, type Check } from './config.js';
export { inspect, grade, type Inspection, type ItemResult } from './inspect.js';
export { readCert, writeCert, type Certificate } from './cert.js';
export { makeJudge } from './judge.js';
export { terminal, markdown } from './report/text.js';
export { html } from './report/html.js';
export { badge } from './report/badge.js';
