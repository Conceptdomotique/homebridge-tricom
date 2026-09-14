import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { TricomPlatform } from './platform';

/**
 * Entry point: registers the Tricom dynamic platform with Homebridge.
 */
export = (api: API) => {
  api.registerPlatform(PLATFORM_NAME, TricomPlatform);
};
