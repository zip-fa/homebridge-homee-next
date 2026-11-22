import type { API } from 'homebridge';

import {
  HomeePlatform,
  PLATFORM_NAME,
  PLUGIN_NAME,
} from './platform/platform.js';

export default (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HomeePlatform);
};
