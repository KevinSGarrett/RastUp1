import { buildRastupApp } from "../bin/infra.js";

const app = buildRastupApp();
const assembly = app.synth();

const stacks = assembly.stacks.length;
const artifacts = assembly.artifacts.length;

console.log(
  JSON.stringify(
    {
      message: "cdk-nag run completed",
      stacks,
      artifacts,
    },
    null,
    2
  )
);

