import { expect, it, vi } from "vitest";
import { ChildProcess } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { ffmpegWithInput } from "./ffmpeg";

it("stops an encoder that ignores SIGTERM before reporting an input failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adv-encoder-error-"));
  const executable = join(dir, "ffmpeg"), pidFile = join(dir, "pid");
  await writeFile(executable, `#!${process.execPath}\nprocess.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
  await chmod(executable, 0o700);
  vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
  const input = new Readable({ read() {} });
  let encoder: ChildProcess | undefined;
  const realKill = ChildProcess.prototype.kill;
  const kill = vi.spyOn(ChildProcess.prototype, "kill").mockImplementation(function (this: ChildProcess, signal) {
    if (this.spawnfile === "ffmpeg") encoder = this;
    return realKill.call(this, signal);
  });
  const result = ffmpegWithInput([], input).then(() => undefined, (error: Error) => error);
  try {
    let pid = 0;
    for (let i = 0; i < 200 && !pid; i++) {
      pid = Number(await readFile(pidFile, "utf8").catch(() => ""));
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(pid).toBeGreaterThan(0);
    input.destroy(new Error("fixture input failure"));
    expect((await result)?.message).toBe("fixture input failure");
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    kill.mockRestore();
    encoder?.kill("SIGKILL");
    input.destroy();
    vi.unstubAllEnvs();
    await result;
  }
});

it("rejects an input already closed before encoding", async () => {
  const input = new Readable({ read() {} });
  input.destroy();
  await expect(ffmpegWithInput(["-v", "error", "-f", "null", "-"], input))
    .rejects.toThrow("ffmpeg input closed before ending");
});
