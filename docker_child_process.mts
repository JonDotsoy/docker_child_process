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
    /** @deprecated */
    nameWorkspace?: string;
    imagen?: string;
    build?: {
        imageName?: string;
        dockerfile: URL;
        cwd?: URL;
        args?: Record<string, string>;
        hashFile?: URL;
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
    const labelLogs = options?.label ?? `## ${cmd}`;
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
        new Promise<number | null>((resolve) =>
            childProcess.once("exit", resolve)
        );
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

export class Instance {
    readonly defaultShell: string;
    readonly cwd: URL | null;
    readonly uid: string;
    readonly buildOptions: CreateRunOptions["build"];
    private image: string;
    private readonly abort: CreateRunOptions["abort"];

    constructor(
        defaultShell: CreateRunOptions["defaultShell"],
        imagen: CreateRunOptions["imagen"],
        build: CreateRunOptions["build"],
        cwd: CreateRunOptions["cwd"],
        abort: CreateRunOptions["abort"]
    ) {
        this.defaultShell = defaultShell ?? "bash";
        this.cwd = cwd ? resolveURL(cwd) : null;
        this.uid = randomUUID();
        this.buildOptions = build;
        this.image = imagen ?? "ubuntu:latest";
        this.abort = abort;

        process.once("SIGINT", () => this.kill());
        process.once("SIGQUIT", () => this.kill());
        process.once("SIGTERM", () => this.kill());
        abort?.signal.addEventListener("abort", (e) => {
            this.kill();
        });
    }

    async init(options?: ChildProcessOptions) {
        const { defaultShell, cwd, uid, buildOptions, abort } = this;

        if (buildOptions) {
            const buildArgs = Object.entries(buildOptions.args ?? {})
                .map(([key, value]) => [`--build-arg`, `${key}=${value}`])
                .flat();
            const dockerfile = buildOptions.dockerfile;

            const dockerfileHash = new Uint8Array(
                await subtle.digest(
                    "SHA-1",
                    new Uint8Array([
                        ...(await readFile(dockerfile)),
                        ...new TextEncoder().encode(buildArgs.join(" ")),
                    ])
                )
            );
            const dockerfileHashHex = dockerfileHash.reduce(
                (str, uint) => `${str}${uint.toString(16).padStart(2, "0")}`,
                ""
            );

            this.image =
                buildOptions?.imageName ??
                `${"docker-child-process"}-${dockerfileHashHex}`;

            const dockerfileHashFile =
                buildOptions.hashFile ??
                new URL(
                    `${dockerfile.pathname}.${this.image}.hash`,
                    dockerfile
                );

            const alreadyBuilt = existsSync(dockerfileHashFile);

            const cwd =
                buildOptions.cwd ?? new URL(".", buildOptions.dockerfile);

            if (!alreadyBuilt) {
                const exitCode = await docker(
                    [
                        `build`,
                        ...buildArgs,
                        `-t`,
                        this.image,
                        `-f`,
                        dockerfile.pathname,
                        cwd.pathname,
                    ],
                    options
                ).wait();
                if (exitCode !== 0) throw new Error(`Failed build imagen`);
                await writeFile(
                    dockerfileHashFile,
                    JSON.stringify(
                        {
                            hash: dockerfileHashHex,
                            createdAt: new Date(),
                            args: buildOptions.args,
                            image: this.image,
                        },
                        null,
                        2
                    )
                );
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
                this.image,
                defaultShell,
                "-i",
                `-c`,
                `tail -f /dev/null`,
            ],
            options
        ).wait();
    }

    commit(imageName: string, options?: ChildProcessOptions) {
        return docker([`commit`, this.uid, imageName], options).wait();
    }

    async exec(cmd: string, options?: ChildProcessOptions) {
        const evaluateExitCode =
            options?.evaluateExitCode ??
            ((exitCode: number | null) => exitCode !== null && exitCode !== 0);
        const args = [`exec`, this.uid, this.defaultShell, "-i", "-c", cmd];

        console.log(`### RUN =>`, cmd);

        const activity = await docker(args, options);

        await activity.wait();
        if (evaluateExitCode(activity.childProcess.exitCode)) {
            throw new Error(
                `Failed process exit with code ${activity.childProcess.exitCode}`
            );
        }
        return activity;
    }

    async stop() {
        await docker(["stop", this.uid]).wait();
    }

    kill() {
        dockerSync(["kill", this.uid]);
    }
}

export const createInterface = (createRunOptions?: CreateRunOptions) =>
    new Instance(
        createRunOptions?.defaultShell,
        createRunOptions?.imagen,
        createRunOptions?.build,
        createRunOptions?.cwd,
        createRunOptions?.abort
    );
