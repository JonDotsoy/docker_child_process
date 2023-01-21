import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createInterface } from "../docker_child_process.mjs";
import { demoWorkspace } from "@jondotsoy/demo-workspace";
import { existsSync } from "fs";
import { stat } from "fs/promises";

describe("Docker Child Process", () => {
    it("should create instance of docker", async () => {
        const dockerInterface = createInterface();
        await dockerInterface.init();
        dockerInterface.kill();
    });

    describe("with a instance", () => {
        const dockerInterface = createInterface();
        beforeAll(async () => {
            await dockerInterface.init();
        });
        afterAll(() => {
            dockerInterface.kill();
        });

        it("should read the outputs", async () => {
            const { out } = await dockerInterface.exec("echo ok");

            expect(out).toBeTypeOf("object");
            expect(Array.isArray(out), "out is an array").toBeTruthy();
            expect(out.find(([kind]) => kind === "log")?.[2]).toEqual("ok");
        });

        it("should catch a error", async () => {
            await expect(async () => {
                await dockerInterface.exec(`exit 12`);
            }).rejects.toThrowError();
        });

        it("should abort a child process executed", async () => {
            const abortControl = new AbortController();
            const p = dockerInterface.exec(`sleep 50`, { abort: abortControl });
            setTimeout(() => {
                abortControl.abort();
            }, 5);
            const startDuration = Date.now();
            await p;
            const endDuration = Date.now();
            const duration = endDuration - startDuration;

            expect(
                duration < 50,
                "duration process is more than 50 seconds"
            ).toBeTruthy();
        });
    });

    describe("build image", () => {
        const dockerInterface = createInterface({
            build: {
                imageName: "custom-dockerfile-1234ga43",
                dockerfile: new URL("Dockerfile", import.meta.url),
            },
        });
        afterAll(async () => {
            dockerInterface.kill();
        });

        it("should build imagen by a dockerfile", async () => {
            await dockerInterface.init();
            const { outputs } = await dockerInterface.exec(
                `echo "###=> hi=$(cat /hi.txt)"`
            );

            expect(outputs).toEqual({ hi: "HI!" });
        });
    });

    describe("build image with build arguments", () => {
        const dockerInterface = createInterface({
            build: {
                dockerfile: new URL("Dockerfile", import.meta.url),
                args: {
                    CONTENT_HI_TXT: "cool!",
                },
            },
        });
        afterAll(async () => {
            dockerInterface.kill();
        });

        it("should build imagen by a dockerfile", async () => {
            await dockerInterface.init();
            const { outputs } = await dockerInterface.exec(
                `echo "###=> hi=$(cat /hi.txt)"`
            );

            expect(outputs).toEqual({ hi: "cool!" });
        });
    });

    describe("copy files", () => {
        const localWorkspace = demoWorkspace({
            workspaceName: "copy_files_local",
        });
        const containerWorkspace = demoWorkspace({
            workspaceName: "copy_files_container",
        });
        const instance = createInterface({
            cwd: containerWorkspace.cwd,
        });
        let files: Record<string, URL>;

        beforeAll(async () => {
            await instance.init();
            files = localWorkspace.makeTree({
                "hi.txt": "hi",
                "directory/file1.txt": "",
                "directory/file2.txt": "",
            });
        });

        afterAll(() => {
            instance.kill();
        });

        it("should copy the file hi.txt", async () => {
            await instance.cp(files["hi.txt"], "hi.txt");
            const remoteFile = new URL("hi.txt", containerWorkspace.cwd);

            expect(existsSync(remoteFile)).toBeTruthy();
            const statFile = await stat(remoteFile);
            expect(statFile.isFile()).toBeTruthy();
        });

        it("should copy the directory", async () => {
            const directoryLocal = new URL("directory/", localWorkspace.cwd);
            const directoryRemote = new URL(
                "directory/",
                containerWorkspace.cwd
            );

            await instance.cp(directoryLocal, "directory/");

            const file1 = new URL("file1.txt", directoryRemote);
            const file2 = new URL("file2.txt", directoryRemote);

            expect(existsSync(file1)).toBeTruthy();
            expect(existsSync(file2)).toBeTruthy();
        });
    });
});
