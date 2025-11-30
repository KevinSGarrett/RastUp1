// cdk/bin/infra.js
// JS shim that forwards to the TypeScript CDK app in infra.ts.
//
// This lets tests (and any tooling) import `cdk/bin/infra.js` even though
// the real source is TypeScript. With the `tsx` loader, importing infra.ts
// at runtime is supported.

export * from './infra.ts';
