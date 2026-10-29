import { exec } from "child_process";
import { IS_VERCEL_ENV, IS_DOCKER_ENV, FILE_BASED_MCP_CONFIG } from "lib/const";
import { promisify } from "util";
import "load-env";
const execPromise = promisify(exec);

async function runCommand(command: string, description: string) {
  console.log(`Starting: ${description}`);
  try {
    const { stdout, stderr } = await execPromise(command, {
      cwd: process.cwd(),
      env: process.env,
    });

    console.log(`${description} output:`);
    console.log(stdout);

    if (stderr) {
      console.error(`${description} stderr:`);
      console.error(stderr);
    }
    console.log(`${description} finished successfully.`);
  } catch (error: any) {
    console.error(`${description} error:`, error);
    process.exit(1);
  }
}

async function main() {
  if (IS_VERCEL_ENV) {
    if (FILE_BASED_MCP_CONFIG) {
      console.error("File based MCP config is not supported on Vercel.");
      process.exit(1);
    }
    console.log(
      "Running on Vercel, skipping database migration to prevent timeout.",
    );
    // await runCommand("pnpm db:migrate", "Database migration"); // DISABLED: Causes 45min timeout
  } else if (IS_DOCKER_ENV) {
    if (FILE_BASED_MCP_CONFIG) {
      console.error("File based MCP config is not supported in Docker.");
      process.exit(1);
    }
  } else {
    console.log(
      "Running in a normal environment, performing initial environment setup.",
    );
    await runCommand("pnpm initial:env", "Initial environment setup");
    await runCommand(
      "pnpm openai-compatiable:init",
      "Initial openAI compatiable config setup",
    );
  }
}

main();
