// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the App (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
//
// No configuration is read: the module has none (the contract carries the
// prices, the scenes their filters). The contract template is priced by the
// core rule engine from the `zen-flex` calendar this module feeds.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { App } from './src/app.js';
import { createFileStore } from './src/store.js';

const gladys = new GladysIntegration();
const app = new App({ gladys, logger, store: createFileStore() });

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', () => {
  app.start().catch((err) => logger.error('Start failed', err));
});
gladys.on('disconnected', () => {
  app.stop().catch((err) => logger.error('Stop failed', err));
});
gladys.handleShutdown(() => app.stop());

logger.info('Starting the EDF Zen Flex integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
