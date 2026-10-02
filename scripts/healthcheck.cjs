'use strict';
fetch(`http://127.0.0.1:${process.env.PORT || 5173}/api/health`, { signal: AbortSignal.timeout(3000) })
  .then(async response => {
    if (!response.ok || (await response.json()).ready !== true) process.exitCode = 1;
  })
  .catch(() => { process.exitCode = 1; });
