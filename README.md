# zeropool-js

## Example
```js
import { init, ZeropoolClient } from 'zeropool-js';

const snarkParams = {
  transferParamsUrl: '/path/to/transfer/params',
  treeParamsUrl: '/path/to/tree/params',
  transferVkUrl: '/path/to/transfer/vk',
  treeVkUrl: '/path/to/tree/vk',
};

init('/path/to/wasm', '/path/to/worker', snarkParams)
  .then((ctx) => {
      // some fields from `ctx` can be used in some parts of the library.
  });
```
