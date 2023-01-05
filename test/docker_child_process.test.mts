import {
    describe,
    it,
    beforeAll,
    afterAll,
    expect,
} from "vitest";
import { createInterface } from "../docker_child_process.mjs";

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
});
