import chalk from "./node_modules/chalk/source/index";
import { spawn, SpawnOptionsWithoutStdio, spawnSync } from "node:child_process";
import { subtle, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import * as nodeReadline from "node:readline";
import { cwd } from "node:process";

export interface ChildProcessOptions {
    varLineCaptura?: string;
    silent?: boolean;
    label?: string;
    spawn?: SpawnOptionsWithoutStdio;
    abort?: AbortController;
    cache?: {
        files: [string, ...string[]];
    };
    evaluateExitCode?: (exitCode: number | null) => boolean;
}

export interface CreateRunOptions {
    defaultShell?: string;
    nameWorkspace?: string;
    imagen?: string;
    build?: {
        imageName: string;
        dockerfile: URL;
        cwd?: URL;
    };
    //   workspace?: URL;
    cwd?: string | URL;
    abort?: AbortController;
}

const tryJsonParse = (str: string) => {
    try {
        return JSON.parse(str);
    } catch {
        return str;
    }
};

class ChildProcess {
    constructor() {}
}

class DockerChildProcess extends ChildProcess {}

const createChildProcess = (
    cmd: string,
    args: string[],
    options?: ChildProcessOptions
) => {
    const varLineCaptura = options?.varLineCaptura ?? "###=>";
    const silentLogs = options?.silent ?? false;
    const labelLogs = options?.label ?? chalk.gray(`## ${cmd}`);
    const childProcess = spawn(cmd, args, options?.spawn);
    const stdoutLines = nodeReadline.createInterface({
        input: childProcess.stdout,
    });
    const stderrLines = nodeReadline.createInterface({
        input: childProcess.stderr,
    });
    const outputs: Record<string, any> = {};
    const newLocal = /\s+?(?<name>\w+)\s*=\s*(?<val>.+)/;
    const out: ["log" | "err", Date, string][] = [];

    stdoutLines.on("line", (line) => {
        out.push(["log", new Date(), line]);

        if (line.startsWith(varLineCaptura)) {
            const subLine = line.substring(varLineCaptura.length);
            const r = newLocal.exec(subLine);
            if (r) {
                outputs[r.groups!.name] = tryJsonParse(r.groups!.val);
                return;
            }
        }

        if (!silentLogs) {
            console.log(`${labelLogs}: ${line}`);
        }
    });

    stderrLines.on("line", (line) => {
        out.push(["err", new Date(), line]);

        if (!silentLogs) {
            console.error(`${labelLogs}: ${line}`);
        }
    });

    const wait = () =>
        new Promise((resolve) => childProcess.once("exit", resolve));
    const kill = (signal?: number | NodeJS.Signals) =>
        childProcess.kill(signal);

    options?.abort?.signal.addEventListener("abort", () => {
        kill();
    });

    return { childProcess, kill, wait, outputs, out };
};

const createChildProcessSync = (
    cmd: string,
    args: string[],
    options?: ChildProcessOptions
) => {
    const ps = spawnSync(cmd, args, options?.spawn);
    return { ps };
};

const docker = (args: string[], options?: ChildProcessOptions) =>
    createChildProcess("docker", args, options);
const dockerSync = (args: string[], options?: ChildProcessOptions) =>
    createChildProcessSync("docker", args, options);

const resolveURL = (likeURL: string | URL): URL => {
    if (typeof likeURL === "string")
        return new URL(likeURL, `file://${cwd()}/`);
    return likeURL;
};

export const createInterface = (createRunOptions?: CreateRunOptions) => {
    const outs: { output: Record<string, any>; logs: string[] }[] = [];
    const defaultShell = createRunOptions?.defaultShell ?? "bash";
    const cwd = createRunOptions?.cwd ? resolveURL(createRunOptions.cwd) : null;
    // const workspace =
    //     createRunOptions?.workspace ?? new URL(`.`, import.meta.url);
    const uid = randomUUID();
    const baseBuild = createRunOptions?.build;
    const baseImagen =
        baseBuild?.imageName ?? createRunOptions?.imagen ?? "ubuntu:latest";

    const init = async (options?: ChildProcessOptions) => {
        if (baseBuild) {
            const dockerfile = baseBuild.dockerfile;
            const dockerfileHashFile = new URL(
                `${dockerfile.pathname}.hash`,
                dockerfile
            );
            const previouslyDockerfileHash = existsSync(dockerfileHashFile)
                ? new Uint8Array(await readFile(dockerfileHashFile))
                : null;
            const dockerfileHash = new Uint8Array(
                await subtle.digest("SHA-1", await readFile(dockerfile))
            );
            const cwd = baseBuild.cwd ?? new URL(".", baseBuild.dockerfile);

            const dockerfileSame =
                previouslyDockerfileHash?.every(
                    (v, i) => v === dockerfileHash[i]
                ) ?? false;

            if (!dockerfileSame || !existsSync(dockerfileHashFile)) {
                await docker(
                    [
                        `build`,
                        `-t`,
                        baseBuild.imageName,
                        `-f`,
                        dockerfile.pathname,
                        cwd.pathname,
                    ],
                    options
                ).wait();
                await writeFile(dockerfileHashFile, dockerfileHash);
            }
        }

        await docker(
            [
                `run`,
                ...(cwd ? [`-v`, `${cwd.pathname}:/workspace`] : []),
                "-w",
                `/workspace`,
                `--rm`,
                `-d`,
                `--name`,
                uid,
                baseImagen,
                defaultShell,
                "-i",
                `-c`,
                `tail -f /dev/null`,
            ],
            options
        ).wait();
    };

    const commit = (imageName: string, options?: ChildProcessOptions) =>
        docker([`commit`, uid, imageName], options).wait();

    const exec = async (cmd: string, options?: ChildProcessOptions) => {
        const evaluateExitCode =
            options?.evaluateExitCode ??
            ((exitCode: number | null) => exitCode !== null && exitCode !== 0);
        const args = [`exec`, uid, defaultShell, "-i", "-c", cmd];

        console.log(chalk.gray(`### RUN =>`), cmd);

        const activity = await docker(args, options);

        await activity.wait();
        if (evaluateExitCode(activity.childProcess.exitCode)) {
            throw new Error(
                `Failed process exit with code ${activity.childProcess.exitCode}`
            );
        }
        return activity;
    };

    const stop = async () => {
        await docker(["stop", uid]).wait();
    };

    const kill = () => {
        dockerSync(["kill", uid]);
    };

    process.once("SIGINT", () => kill());
    process.once("SIGQUIT", () => kill());
    process.once("SIGTERM", () => kill());
    createRunOptions?.abort?.signal.addEventListener("abort", (e) => {
        kill();
    });

    return { uid, commit, init, stop, kill, exec };
};
