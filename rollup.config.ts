import { RollupOptions } from "./node_modules/rollup/dist/rollup";
import ts from "@rollup/plugin-typescript";

const config: RollupOptions = {
    input: "docker_child_process.mts",
    plugins: [ts()],
    output: [
        {
            file: "cjs/docker_child_process.cjs",
            sourcemap: true,
            format: "cjs",
        },
        {
            file: "cjs/docker_child_process.js",
            sourcemap: true,
            format: "cjs",
        }
    ],
};

export default config;
