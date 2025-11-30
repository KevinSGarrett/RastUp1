// amplify/stack.js
// JS shim so tests and tools can import a compiled-looking entrypoint.
//
// The real implementation lives in ./stack.ts. In this repo, Node is
// launched with the `tsx` loader for infra commands/tests, so importing
// the TypeScript file at runtime is fine.

export * from './stack.ts';
