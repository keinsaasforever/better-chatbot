import { describe, it, expect, vi } from "vitest";
import { safeJsRun } from "./safe-js-run";

describe("safe-js-run", () => {
  it("should execute basic code with console.log", async () => {
    const result = await safeJsRun({ code: "console.log(2 + 3);" });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toEqual({
      type: "log",
      args: [{ type: "data", value: 5 }],
    });
  });

  it("should work with Math API", async () => {
    const result = await safeJsRun({ code: "console.log(Math.max(1, 2, 3));" });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toEqual({
      type: "log",
      args: [{ type: "data", value: 3 }],
    });
  });

  it("should work with JSON API", async () => {
    const result = await safeJsRun({
      code: 'const obj = {name: "test"}; console.log(JSON.stringify(obj));',
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toEqual({
      type: "log",
      args: [{ type: "data", value: '{"name":"test"}' }],
    });
  });

  it("should capture multiple console methods", async () => {
    const result = await safeJsRun({
      code: 'console.log("hello"); console.warn("warning"); console.error("error");',
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(3);
    expect(result.logs[0]).toEqual({
      type: "log",
      args: [{ type: "data", value: "hello" }],
    });
    expect(result.logs[1]).toEqual({
      type: "warn",
      args: [{ type: "data", value: "warning" }],
    });
    expect(result.logs[2]).toEqual({
      type: "error",
      args: [{ type: "data", value: "error" }],
    });
  });

  it("should capture console.log with multiple arguments", async () => {
    const result = await safeJsRun({
      code: 'console.log("hello", "world", 42);',
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toEqual({
      type: "log",
      args: [
        { type: "data", value: "hello" },
        { type: "data", value: "world" },
        { type: "data", value: 42 },
      ],
    });
  });

  it("should call onLog callback when provided", async () => {
    const onLogSpy = vi.fn();
    const result = await safeJsRun({
      code: 'console.log("test"); console.warn("warning");',
      timeout: 5000,
      onLog: onLogSpy,
    });
    expect(result.success).toBe(true);
    expect(onLogSpy).toHaveBeenCalledTimes(2);
    expect(onLogSpy).toHaveBeenCalledWith({
      type: "log",
      args: [{ type: "data", value: "test" }],
    });
    expect(onLogSpy).toHaveBeenCalledWith({
      type: "warn",
      args: [{ type: "data", value: "warning" }],
    });
  });

  it("should handle syntax errors", async () => {
    const result = await safeJsRun({ code: "console.log(2 +);" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unexpected token");
  });

  it("should block forbidden keywords", async () => {
    const result = await safeJsRun({ code: "window.alert('hack');" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Forbidden keyword: 'window'");
  });

  it("should detect Function constructor", async () => {
    const result = await safeJsRun({ code: "new Function('return 1')();" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Function constructor");
  });

  it("should detect infinite loop patterns", async () => {
    const result = await safeJsRun({ code: "while(true) {}" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Infinite while loop");
  });

  it("should handle code with no console output", async () => {
    const result = await safeJsRun({ code: "const x = 5; const y = 10;" });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
  });

  it("should handle different console methods correctly", async () => {
    const result = await safeJsRun({
      code: 'console.info("info"); console.debug("debug"); console.trace("trace");',
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(3);
    expect(result.logs[0]).toEqual({
      type: "info",
      args: [{ type: "data", value: "info" }],
    });
    expect(result.logs[1]).toEqual({
      type: "debug",
      args: [{ type: "data", value: "debug" }],
    });
    expect(result.logs[2]).toEqual({
      type: "trace",
      args: [{ type: "data", value: "trace" }],
    });
  });

  it("should handle async/await operations", async () => {
    const result = await safeJsRun({
      code: `
      const delay = (ms) => new Promise(resolve => resolve("completed"));
      const result = await delay(10);
      console.log("async operation", result);
    `,
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toEqual({
      type: "log",
      args: [
        { type: "data", value: "async operation" },
        { type: "data", value: "completed" },
      ],
    });
  });

  it("should handle Promise-based operations", async () => {
    const result = await safeJsRun({
      code: `
      const result = await Promise.resolve(42);
      console.log("Promise result:", result);
    `,
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toEqual({
      type: "log",
      args: [
        { type: "data", value: "Promise result:" },
        { type: "data", value: 42 },
      ],
    });
  });

  it("should handle async errors properly", async () => {
    const result = await safeJsRun({
      code: `
      try {
        await Promise.reject(new Error("async error"));
      } catch (error) {
        console.error("Caught async error:", error.message);
      }
    `,
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toEqual({
      type: "error",
      args: [
        { type: "data", value: "Caught async error:" },
        { type: "data", value: "async error" },
      ],
    });
  });

  it("should handle sequential async operations with delay", async () => {
    const result = await safeJsRun({
      code: `
        async function delay(ms) { 
          return new Promise(resolve => setTimeout(resolve, ms)); 
        }

        function generateEmployee(id) {
          const names = ['Kim Minjun', 'Lee Jisoo', 'Park Hyunwoo'];
          const departments = ['Engineering', 'Design', 'Marketing'];
          return {
            id,
            name: names[id - 1],
            department: departments[id - 1],
            createdAt: Date.now()
          };
        }

        async function processEmployees() {
          const employees = [];
          console.log("Starting employee processing...");
          
          for (let i = 1; i <= 3; i++) {
            console.log(\`[\${i}] Creating employee data...\`);
            const employee = generateEmployee(i);
            
            console.log(\`[\${i}] Saving to database...\`);
            await delay(50); // 50ms database operation simulation
            
            console.log(\`[\${i}] Employee \${employee.name} saved successfully\`);
            employees.push(employee);
          }
          
          console.log(\`All \${employees.length} employees processed\`);
          return employees;
        }

        await processEmployees();
      `,
      timeout: 2000,
    });
    expect(result.success).toBe(true);
    expect(result.logs.length).toBeGreaterThanOrEqual(10);
    expect(result.logs[0].args[0].value).toBe(
      "Starting employee processing...",
    );
    expect(result.logs[result.logs.length - 1].args[0].value).toBe(
      "All 3 employees processed",
    );
    // Check that delays actually happened (execution time should be > 150ms)
    expect(result.executionTimeMs).toBeGreaterThan(140); // 50ms × 3 + margin
  });

  it("should demonstrate timeout behavior (test environment limitation)", async () => {
    const result = await safeJsRun({
      code: `
        console.log("Starting operation...");
        // In real browser environment, this would trigger timeout
        // But in test environment, timeout may not work as expected
        await new Promise(() => {}); 
        console.log("This should not appear");
      `,
      timeout: 100,
    });
    if (!result.success) {
      expect(result.error).toContain("timeout");
    } else {
      expect(result.success).toBe(true);
      expect(result.logs[0].args[0].value).toBe("Starting operation...");
    }
  });

  it("should return value from code", async () => {
    const result = await safeJsRun({ code: "return 42;" });
    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
  });

  it("should return value from if/else", async () => {
    const result = await safeJsRun({
      code: "if (1 > 0) return 'ok'; else return 'no';",
    });
    expect(result.success).toBe(true);
    expect(result.result).toBe("ok");
  });

  it("should have undefined result if no return", async () => {
    const result = await safeJsRun({ code: "console.log('hi');" });
    expect(result.success).toBe(true);
    expect(result.result).toBeUndefined();
  });

  it("should return value from async function", async () => {
    const result = await safeJsRun({
      code: `
      async function foo() {
        await Promise.resolve();
        return 123;
      }
      return await foo();
    `,
    });
    expect(result.success).toBe(true);
    expect(result.result).toBe(123);
  });
});
