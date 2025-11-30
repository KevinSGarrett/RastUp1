// ESM shim so node --test (which expects .js) can load the TypeScript source.
export * from './stack.ts';
export { default } from './stack.ts';
