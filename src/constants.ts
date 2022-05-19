import { Constants } from 'libzkbob-rs-wasm-web';

// TODO: getConstants is unusable if the wasm module is not loaded yet.
export const CONSTANTS: Constants = {
  HEIGHT: 48,
  IN: 3,
  OUT: (1 << 7) - 1,
  OUTLOG: 7
};
