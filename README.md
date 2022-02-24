# zeropool-client-js

## Example
```js
import { init, EvmZeropoolClient } from 'zeropool-js';

const snarkParams = {
  transferParamsUrl: '/path/to/transfer/params',
  treeParamsUrl: '/path/to/tree/params',
  transferVkUrl: '/path/to/transfer/vk',
  treeVkUrl: '/path/to/tree/vk',
};

// Initialize the library.
init('/path/to/wasm', '/path/to/worker.js', snarkParams)
  .then(async (ctx) => {
      // Spending key
      const sk = new Uint8Array(32);

      // Configurations for each supported token.
      const tokens = {
        'token address': {
          poolAddress: '...',
          relayerUrl: '...',
        }
      };


      const client = await EvmZeropoolClient.create(sk, tokens, rpcUrl, ctx.snarkParams, ctx.worker);

      await client.deposit(tokenAddress, amountWei, (data) => sign(data));
  });
```
